import { Platform, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'
import { supabase } from '../lib/supabase'
import { compareVersions } from './semver'

// ─── Store-update popup: which tier, if any, this install should see ────────
//
// Reads ONE row of app_versions (20261051) for this platform and compares it against the
// INSTALLED NATIVE version. Cold start, and foreground after >30 min in background.
//
// ─── THE VERSION SOURCE, AND WHY IT IS NOT Constants.expoConfig.version ─────
//
// The whole feature is worthless if an OTA can make an old binary look updated — the popup
// exists BECAUSE people are sitting on old native builds. `Constants.expoConfig.version` is
// the manifest version carried by the JS bundle, so publishing this update from a tree whose
// app.config.js says 1.3.0 would make every 1.1.0 install report 1.3.0 and see nothing. It
// is the obvious-looking API and it is the wrong one.
//
// `Application.nativeApplicationVersion` is the right one. It reads the INSTALLED binary:
// CFBundleShortVersionString on iOS (expo-application/ios/ApplicationModule.swift:19) and
// PackageInfo.versionName on Android (…/ApplicationModule.kt:36). A JS bundle cannot change
// either.
//
// expo-application is NOT in package.json — it arrives as a hard dependency of
// expo-notifications@0.32.17 and is autolinked (it ships expo-module.config.json declaring
// native modules for apple and android). Verified 2026-09-25 that it is in the lockfile at
// BOTH shipped build commits: 1.1.0 (23a04b2) and 1.2.0 (e58f23b). So the native module
// exists on every binary this OTA can reach.
//
// ─── WHY IT IS STILL require()d INSIDE THE FUNCTION ────────────────────────
//
// check-native-import-safety.mjs does not guard expo-application, and by that guard's own
// criterion it does not need to — it predates both builds. But this code's entire purpose is
// to land by OTA on OLD binaries, and a top-level import of a native module that turned out
// to be missing kills the app at launch on exactly the population being targeted. A deferred
// require in a try/catch costs nothing and makes the worst case "no popup" instead of "app
// dies on the splash screen". Do not hoist it.
//
// Falls back to Updates.runtimeVersion, which is also native and also un-fakeable by an OTA
// (EAS serves an update only to an identical runtime). It is the FALLBACK rather than the
// primary because it only equals the app version while runtimeVersion.policy is 'appVersion';
// a later switch to a fingerprint policy would silently turn it into a hash.
function installedNativeVersion() {
  // In Expo Go, nativeApplicationVersion is EXPO GO'S OWN version (e.g. '2.33.x'), not this
  // app's — a real-looking string that would compare as nonsense. So in __DEV__ the only
  // accepted source is the explicit override, and without it the feature is simply off.
  // That is what makes the Turkish spot-check possible at all:
  //   EXPO_PUBLIC_DEV_APP_VERSION=1.0.0 npx expo start -c
  // Metro strips this branch from a production bundle (__DEV__ is false there), so it
  // cannot ship enabled. Same precedent as EXPO_PUBLIC_DEV_ONBOARDED in utils/devRoot.js.
  if (__DEV__) return process.env.EXPO_PUBLIC_DEV_APP_VERSION || null

  try {
    const v = require('expo-application').nativeApplicationVersion
    if (v) return v
  } catch {
    // The module is not on this binary. Fall through — never throw out of here.
  }
  return Updates.runtimeVersion || null
}

const SNOOZE_KEY  = '@trnc_update_snooze'
const SNOOZE_DAYS = 3

// Re-check on foreground only after this long in the background. Short enough that somebody
// who leaves the app overnight is told in the morning, long enough that tabbing out to copy
// a phone number and back does not re-run a network call or re-open a dismissed popup.
export const FOREGROUND_RECHECK_MS = 30 * 60 * 1000

const IOS_APP_ID = '6783996527'
// Hardcoded, and NOT read from expo-constants. It is the value of `android.package` in
// app.config.js and cannot drift from it in any way that matters: changing an app's store
// identity makes it a DIFFERENT LISTING, which is not an edit anyone makes by accident.
// Reading it from the manifest would mean a top-level native import in a module that ships
// by OTA onto old binaries — a real launch-crash risk bought for a value that never changes.
const ANDROID_PACKAGE = 'com.berkeustun95.ada'

// [deep link, https fallback]. Tried in order by openStore().
function storeUrls() {
  return Platform.OS === 'ios'
    ? [`itms-apps://apps.apple.com/app/id${IOS_APP_ID}`,
       `https://apps.apple.com/app/id${IOS_APP_ID}`]
    : [`market://details?id=${ANDROID_PACKAGE}`,
       `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`]
}

// openURL(deep).catch(https), NOT canOpenURL. On iOS, canOpenURL for a custom scheme
// returns false unless the scheme is declared in LSApplicationQueriesSchemes — which is an
// Info.plist change, which is a config-plugin change, which is a native build. This feature
// is JS-only, so the probe that would tell us up front is exactly the thing we cannot have.
// Trying and falling back needs no declaration and behaves the same for the user.
export async function openStore() {
  const [deep, web] = storeUrls()
  try {
    await Linking.openURL(deep)
  } catch {
    try { await Linking.openURL(web) } catch { /* nothing left to try; leave the modal up */ }
  }
}

const NO_UPDATE = { tier: null, latestVersion: null }

async function isSnoozed(latestVersion) {
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY)
    if (!raw) return false
    const { version, until } = JSON.parse(raw)
    // Keyed on the VERSION as well as the clock: a NEW release must re-prompt immediately
    // rather than inheriting the remainder of a snooze taken against the previous one.
    return version === latestVersion && typeof until === 'number' && Date.now() < until
  } catch {
    // Unreadable snooze ⇒ not snoozed. Showing a DISMISSIBLE popup once more is the cheaper
    // mistake than suppressing it forever, and it matches utils/stripDismissals.js, which
    // returns an empty set for the same reason. Never applies to the force tier, which does
    // not consult this at all.
    return false
  }
}

export async function snoozeSoftUpdate(latestVersion) {
  if (!latestVersion) return
  try {
    await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({
      version: latestVersion,
      until: Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000,
    }))
  } catch { /* a snooze that could not be written just means they are asked again */ }
}

// → { tier: 'force' | 'soft' | null, latestVersion }
//
// FAILS OPEN ON EVERY PATH. No network, a fetch error, no row, an unparseable version, a
// platform we do not publish to, or anything thrown anywhere in here, all return tier null
// and the app carries on. A version check that can block the app when the SERVER is having a
// bad day is worse than no version check — this is a health app, and the force tier hides
// everything except emergency numbers and the duty roster.
export async function evaluateAppUpdate() {
  try {
    const installed = installedNativeVersion()
    if (!installed) return NO_UPDATE

    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null
    if (!platform) return NO_UPDATE

    const { data, error } = await supabase
      .from('app_versions')
      .select('latest_version, min_supported_version')
      .eq('platform', platform)
      .maybeSingle()

    // maybeSingle() returns { data: null, error: null } for zero rows — it does not throw.
    // Both halves are checked because they are genuinely different failures (RLS/network vs
    // an unseeded platform) and both mean the same thing here: show nothing.
    if (error || !data) return NO_UPDATE

    const latest = data.latest_version
    if (compareVersions(installed, data.min_supported_version) === -1) {
      return { tier: 'force', latestVersion: latest }
    }
    if (compareVersions(installed, latest) === -1) {
      if (await isSnoozed(latest)) return NO_UPDATE
      return { tier: 'soft', latestVersion: latest }
    }
    return NO_UPDATE
  } catch {
    return NO_UPDATE
  }
}
