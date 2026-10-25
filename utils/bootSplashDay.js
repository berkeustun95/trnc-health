// When the boot splash plays (Berke 2026-10-25): the full clip on the first cold start of each
// day, by the device's local date, and on the first launch of every new build or OTA; any later
// cold start that day skips it and launches exactly as before the splash existed.
//
// Pure, no React Native imports, so scripts/test-boot-splash-day.mjs runs it under node.

export const BOOT_SPLASH_KEY = '@ada_boot_splash_seen'

// The device's local calendar day, never UTC: a 01:00 launch in Cyprus is a new day there.
export function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// `stored` is the raw AsyncStorage value (null on a fresh install). Anything unreadable plays.
export function shouldPlaySplash(stored, day, build) {
  if (!stored) return true
  try {
    const s = JSON.parse(stored)
    return s?.day !== day || s?.build !== build
  } catch {
    return true
  }
}

export const splashRecord = (day, build) => JSON.stringify({ day, build })
