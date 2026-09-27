import * as Location from 'expo-location'

// ─── Device location OFF (services, not permission) — who may ask ───────────
//
// On Android, getCurrentPositionAsync and watchPositionAsync default to
// mayShowUserSettingsDialog: true: with permission granted but device location off, each
// call opens the Play services "turn on location" dialog. At startup two calls made it
// (App.js load() and the City Welcome check), and the dialog itself sends the app
// background → active, which re-ran the City Welcome check — so "No thanks" brought it
// straight back and the only way into the app was "Turn on" (2026-09-27, store build).
//
// Rules:
//   passiveFix  — anything the user did not tap. NEVER shows the dialog; services off → null.
//   askedFix / askedWatch — a tap that needs location (locate-me, Başla, pin picker). May
//     show the dialog ONCE per session: a failure while services were off is a "No thanks",
//     remembered SYNCHRONOUSLY before anything else runs, so the background → active the
//     dialog causes cannot race a second prompt.
// iOS has no such dialog option; skipping the automatic reads while services are off also
// keeps iOS's own "Turn On Location Services" alert out of startup.

let declined = false

async function servicesOff() {
  try { return !(await Location.hasServicesEnabledAsync()) } catch { return false }
}

export async function passiveFix(accuracy) {
  if (await servicesOff()) return null
  return Location.getCurrentPositionAsync({ accuracy, mayShowUserSettingsDialog: false })
}

export async function askedFix(accuracy) {
  const off = await servicesOff()
  if (off && declined) return null
  try {
    return await Location.getCurrentPositionAsync({ accuracy, mayShowUserSettingsDialog: true })
  } catch (e) {
    if (off) declined = true
    throw e
  }
}

export async function askedWatch(options, callback) {
  const off = await servicesOff()
  if (off && declined) return null
  try {
    return await Location.watchPositionAsync({ ...options, mayShowUserSettingsDialog: true }, callback)
  } catch (e) {
    if (off) declined = true
    throw e
  }
}
