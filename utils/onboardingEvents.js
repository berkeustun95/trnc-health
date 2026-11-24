import { Platform, Linking } from 'react-native'
import * as Updates from 'expo-updates'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'

// Only production store installs count. Preview builds (channel 'preview'), dev bundles and Expo Go
// (no channel) would pollute the funnel.
export const SENDS_ONBOARDING_EVENTS = Updates.channel === 'production' && !__DEV__

// A phone opened once with ada://test-device stops sending for good. Not in RESET_ONBOARDING_KEYS on purpose.
const KEY_TEST_DEVICE = '@ada_test_device'
let testDevice = false
let gate = null

export function isTestDeviceLink(url) {
  return typeof url === 'string' && /^ada:\/\/test-device\/?(\?.*)?(#.*)?$/.test(url)
}

export async function markTestDevice() {
  testDevice = true
  try { await AsyncStorage.setItem(KEY_TEST_DEVICE, 'true') } catch {}
}

// Resolves true when this phone must not send. Memoised: one storage read and one initial-URL read, so a cold
// start opened by the test-device link blocks start_shown before App's deep-link handler has run.
// Fails CLOSED: on a read error we do not send (a production user loses at most one event; test traffic
// must never leak in).
function isBlocked() {
  if (!gate) {
    gate = (async () => {
      try {
        if ((await AsyncStorage.getItem(KEY_TEST_DEVICE)) === 'true') return true
        return isTestDeviceLink(await Linking.getInitialURL())
      } catch {
        return true
      }
    })()
  }
  return gate
}

// Onboarding v2 funnel counts (onboarding_events, INSERT only). No identifier of any kind.
// Same contract as logAppUpdateEvent (utils/appUpdate.js): never awaited by a caller, never
// throws. The builder is lazy, so it is .then()ed; no .select() (no SELECT grant -> 42501).
export function logOnboardingEvent(event) {
  try {
    if (!SENDS_ONBOARDING_EVENTS) return
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null
    if (!event || !platform) return
    const runtime = typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion.slice(0, 64) : null
    isBlocked().then(blocked => {
      if (blocked || testDevice) return
      supabase.from('onboarding_events').insert({ event, platform, runtime_version: runtime })
        .then(
          res => { if (__DEV__ && res?.error) console.warn('[logOnboardingEvent] insert failed:', res.error.message) },
          err => { if (__DEV__) console.warn('[logOnboardingEvent] insert threw:', err?.message || err) },
        )
    }).catch(e => { if (__DEV__) console.warn('[logOnboardingEvent] threw:', e?.message || e) })
  } catch (e) {
    if (__DEV__) console.warn('[logOnboardingEvent] threw synchronously:', e?.message || e)
  }
}
