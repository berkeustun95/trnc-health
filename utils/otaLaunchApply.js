// Applying a downloaded OTA at launch (Berke 2026-11-09). Before this, a fetched update waited
// for the NEXT cold start, and iPhones keep the JS alive for days, so a crash fix could take a
// week to reach someone. Now the launch that downloads it reloads into it at once, but only
// while nothing can be lost: inside the first seconds, before any touch, not opened from a push
// or a link, app in the foreground, and once per update id (no reload loop). Anything else keeps
// the old behaviour: it applies on the next cold start.
//
// Pure, no React Native imports, so __tests__/otaLaunchApply.test.js runs it as is.

export const OTA_APPLY_WINDOW_MS = 8000
export const OTA_APPLIED_KEY = '@ada_ota_applied'

// Was this launch opened from a push? Any last response counts: expo-notifications keeps it per JS runtime, and this
// runs once, at mount, so it was tapped during this launch. Never age it by notification.date: that is not the tap time
// (iOS gives seconds since 1970, Android the server's send time), and the age check let a 17:00 duty push tapped at 17:10
// reload the app onto Home. `routed` = a push handler already navigated (and cleared the response).
export function openedByPush(tap, routed) {
  return routed === true || !!tap
}

// Returns null to reload now, or why not.
export function otaApplyBlocker({ fetchedId, runningId, emergency, elapsedMs, touched, appState, launchedByTap, launchedByLink, lastAppliedId }) {
  if (!fetchedId || fetchedId === runningId) return 'nothing new'
  if (emergency) return 'emergency launch'
  if (lastAppliedId === fetchedId) return 'already reloaded for this update'
  if (elapsedMs > OTA_APPLY_WINDOW_MS) return 'too late in the launch'
  if (touched) return 'user already acting'
  if (appState !== 'active') return 'not in the foreground'
  if (launchedByTap) return 'opened from a push'
  if (launchedByLink) return 'opened from a link'
  return null
}
