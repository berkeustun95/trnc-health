// City welcome — the pure rules. No React Native, no Expo, no storage: this file
// imports nothing, so plain Node (and scripts/validate-city-welcome.mjs) can
// exercise the throttling without a device and without waiting 30 days.
//
// The imperative shell — AsyncStorage, expo-location, the AppState trigger —
// lives in cityWelcome.js and imports this.

// --- storage keys -----------------------------------------------------------
// `@trnc_` prefix per the AsyncStorage convention in architecture.md.

export const KEY_ENABLED = '@trnc_city_welcome' // 'on' | 'off'   (absent => on)
export const KEY_HOME    = '@trnc_city_home'    // region slug | 'visiting'
export const KEY_SEEN    = '@trnc_city_seen'    // { [slug]: epochMs }
export const KEY_ASKED   = '@trnc_city_asked'   // 'true' once the home-city question is answered

export const VISITING = 'visiting'
export const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000 // once per city per 30 days

// --- the decision -----------------------------------------------------------
//
// Returns { show, variant, reason }.
//   variant 'rich'  — first ever entry to this city: the full "Welcome to X" card
//   variant 'nudge' — been here before, cooldown elapsed: lighter "You're in X — what's on"
//
// Order matters:
//   - `disabled` outranks everything the user did not ask for.
//   - `home-city` is checked BEFORE the cooldown, so a resident is suppressed
//     permanently rather than merely throttled to once a month. Resident
//     spam-avoidance is a first-class constraint, not a side effect.
//   - `home === VISITING` deliberately matches no region, so a self-declared
//     visitor is welcome-eligible everywhere.
export function decideWelcome({ region, enabled, home, seen, asked, now }) {
  if (!region)  return { show: false, variant: null, reason: 'no-region' }
  if (!enabled) return { show: false, variant: null, reason: 'disabled' }

  // We cannot tell a resident from a visitor until the home-city question has
  // been answered, and welcoming a resident to their own city is the one thing
  // this feature must never do. Stay quiet until then (slice 4 asks).
  if (!asked)   return { show: false, variant: null, reason: 'home-city-unknown' }

  if (home && home === region) return { show: false, variant: null, reason: 'home-city' }

  const last = seen?.[region]
  if (!last)                     return { show: true, variant: 'rich',  reason: 'first-visit' }
  if (now - last >= COOLDOWN_MS) return { show: true, variant: 'nudge', reason: 'cooldown-elapsed' }

  return { show: false, variant: null, reason: 'cooldown-active' }
}

// Tolerate a corrupted / hand-edited @trnc_city_seen rather than throwing on
// every foreground: keep only well-formed { slug: number } pairs.
export function parseSeen(raw) {
  try {
    const parsed = JSON.parse(raw ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [k, v] of Object.entries(parsed)) if (Number.isFinite(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}
