import { Platform } from 'react-native'
import * as Updates from 'expo-updates'
import { supabase } from '../lib/supabase'

// Onboarding v2 funnel counts (onboarding_events, INSERT only). No identifier of any kind.
// Same contract as logAppUpdateEvent (utils/appUpdate.js): never awaited by a caller, never
// throws. The builder is lazy, so it is .then()ed; no .select() (no SELECT grant -> 42501).
export function logOnboardingEvent(event) {
  try {
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null
    if (!event || !platform) return
    const runtime = typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion.slice(0, 64) : null
    supabase.from('onboarding_events').insert({ event, platform, runtime_version: runtime })
      .then(
        res => { if (__DEV__ && res?.error) console.warn('[logOnboardingEvent] insert failed:', res.error.message) },
        err => { if (__DEV__) console.warn('[logOnboardingEvent] insert threw:', err?.message || err) },
      )
  } catch (e) {
    if (__DEV__) console.warn('[logOnboardingEvent] threw synchronously:', e?.message || e)
  }
}
