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
// `Updates.runtimeVersion` is the one used instead. It is read from the NATIVE build
// configuration, baked at build time, and EAS serves an update only to an IDENTICAL runtime —
// so a JS bundle cannot change it.
//
// ─── WHY NOT expo-application, WHICH IS THE PURPOSE-BUILT API ──────────────
//
// `Application.nativeApplicationVersion` reads the installed binary directly and was the
// first choice here. It is genuinely available (expo-application@7.0.8 arrives with
// expo-notifications and is autolinked; verified present in the lockfile at both shipped
// build commits, 1.1.0 23a04b2 and 1.2.0 e58f23b). It was dropped anyway, on Berke's call,
// because it buys nothing this app can use:
//
//   runtimeVersion.policy is 'appVersion', and check-ota-preflight.mjs:69 REFUSES the
//   publish unless that policy is exactly 'appVersion'.
//
// So on every build that can ever run this code, Updates.runtimeVersion IS the app version,
// by a guard rather than by convention. The one theoretical gap — somebody switching to a
// fingerprint policy, after which runtimeVersion would be a hash — is the case that guard
// already refuses to publish.
//
// What dropping it buys: no native module in the OTA-shipped path at all. expo-application
// was a TRANSITIVE dependency, present only because expo-notifications pulls it in, and this
// module ships by OTA onto binaries built months ago. A version read that cannot touch a
// native module cannot crash one.
function installedNativeVersion() {
  // In __DEV__ the only accepted source is the explicit override. Expo Go has no meaningful
  // runtimeVersion of its own, and without this the feature simply cannot be exercised on a
  // dev client:
  //   EXPO_PUBLIC_DEV_APP_VERSION=1.0.0 npx expo start -c
  // Metro strips this branch from a production bundle (__DEV__ is false there), so it cannot
  // ship enabled. Same precedent as EXPO_PUBLIC_DEV_ONBOARDED in utils/devRoot.js.
  if (__DEV__) return process.env.EXPO_PUBLIC_DEV_APP_VERSION || null
  return Updates.runtimeVersion || null
}

const SNOOZE_KEY  = '@trnc_update_snooze'
const SNOOZE_DAYS = 3

// Re-check on foreground only after this long in the background. Short enough that somebody
// who leaves the app overnight is told in the morning, long enough that tabbing out to copy
// a phone number and back does not re-run a network call or re-open a dismissed popup.
export const FOREGROUND_RECHECK_MS = 30 * 60 * 1000

// Matches utils/logContactEvent.js. A metric is never worth holding a socket open for.
const LOG_TIMEOUT_MS = 4000

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

// ─── The backup signal: one row each time a popup is SHOWN ──────────────────
//
// Without this, "the popup never appeared" and "the popup works and this binary is current"
// look identical from the outside — every path in evaluateAppUpdate() fails OPEN, so silence
// is both the healthy and the broken state. Schema, RLS and the two rules this obeys:
// supabase/migrations/20261051_app_versions.sql.
//
// Same contract as utils/logContactEvent.js, which this is modelled on:
//   • NOTHING IS AWAITED AND NOTHING CAN THROW. A blocked user must never wait on an
//     analytics round-trip before [Update] works.
//   • NO IDENTIFIER, EVER. No user, device or install id. The question is a COUNT.
//
// ONE version column. runtimeVersion.policy is 'appVersion' and check-ota-preflight.mjs
// refuses a publish under any other policy, so the runtime IS the app version on every build
// that can run this — a second column would have stored the same string twice.
//
// It logs installedNativeVersion(), NOT Updates.runtimeVersion directly: the value recorded
// should be the one the tier decision was actually made on. In production they are the same
// call; in __DEV__ this records the override, which is what makes a device pass verifiable.
//
// In __DEV__ the installed version is the EXPO_PUBLIC_DEV_APP_VERSION override, so device-pass
// rows land with whatever was typed (0.9.0, 1.1.0 …). That is deliberate — it is how the
// device pass proves the write path works at all — and those values are self-identifying,
// since no such build exists. Filter them out when reading real numbers.
export function logAppUpdateEvent(tier) {
  try {
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null
    if (!tier || !platform) return

    let signal
    let done = () => {}
    if (typeof AbortController === 'function') {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LOG_TIMEOUT_MS)
      signal = controller.signal
      done = () => clearTimeout(timer)
    }

    let q = supabase.from('app_update_events').insert({
      tier,
      platform,
      runtime_version: installedNativeVersion(),
    })
    if (signal) q = q.abortSignal(signal)

    // BOTH handlers, and no .select(). The client holds no SELECT privilege on this table,
    // so asking for the row back would turn every successful write into a visible error.
    // The second handler is what makes an aborted or failed write a no-op rather than an
    // unhandled rejection.
    q.then(
      res => { done(); if (__DEV__ && res?.error) console.warn('[logAppUpdateEvent] insert failed:', res.error.message) },
      err => { done(); if (__DEV__ && err?.name !== 'AbortError') console.warn('[logAppUpdateEvent] insert threw:', err?.message || err) },
    )
  } catch (e) {
    if (__DEV__) console.warn('[logAppUpdateEvent] threw synchronously:', e?.message || e)
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
