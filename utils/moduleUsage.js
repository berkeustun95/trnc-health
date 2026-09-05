// Module usage counts and manual pins — the storage half of the favourites row.
//
// ═══ EVERYTHING HERE IS DEVICE-LOCAL AND MUST STAY THAT WAY ═════════════════
//
// Nothing in this file writes to Supabase, and nothing may be added that does. That is a
// DELIBERATE PRODUCT DECISION, not an implementation convenience:
//
//   • It is behavioural data — which parts of a health app a person opens, and how often.
//     "Opens the pharmacy module every night" and "opens the jobs board twenty times a
//     week" are inferences about someone's life, not telemetry.
//   • ADA has declared 13-15 and 16-17 year old users since 2026-08-29. Behavioural
//     profiling of minors is the single most sensitive category this app could collect.
//   • The database is EU-hosted and every table here carries an RLS story. A usage table
//     would need one too — and the only honest policy is "nobody but the user", at which
//     point the row has no reader and the table has no purpose.
//
// Keeping the counts on the device means the feature works for guests identically to
// signed-in users, survives sign-out, and produces nothing anybody has to be told about
// in a privacy policy. If a future slice wants aggregate module popularity, that is a
// SEPARATE decision with a separate consent story, and it does not start by promoting
// this file's data.
//
// ⚠ NOT NAMESPACED PER ACCOUNT, ON PURPOSE. Two accounts on one phone share the counts.
//   The alternative is keying on a user id, which would mean this data starts describing
//   an ACCOUNT rather than a HANDSET — a small step that undoes the whole paragraph
//   above, and buys almost nothing since the shared-device case is rare and the failure
//   mode is a slightly-wrong tile order.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FAVOURITE_SLOTS } from '../constants/homeFavourites'

const KEY_USAGE = '@trnc_module_usage'
const KEY_PINS  = '@trnc_module_pins'

// A ceiling, so an id that gets tapped constantly for a month cannot become permanently
// unbeatable and freeze the row. Once everything interesting is at the cap the tie-break
// (defaults, then grid order) takes over, which is a sane resting state rather than a
// fossil of whatever somebody did in their first week.
const MAX_COUNT = 999

// ─── READS NEVER THROW ──────────────────────────────────────────────────────
// Absent is the normal state on a fresh install, and a corrupt value is a state we can do
// nothing about at read time. Both degrade to "no history", which resolveFavourites
// answers with the editorial defaults — the same output a new device gets.
export async function loadUsage() {
  try {
    const raw = await AsyncStorage.getItem(KEY_USAGE)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Coerce here rather than trusting the file: a non-numeric count would poison the
    // comparator's arithmetic into NaN, and NaN comparisons make Array.sort's order
    // undefined — a silently scrambled row rather than a visible error.
    const out = {}
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out[k] = Math.min(Math.trunc(n), MAX_COUNT)
    }
    return out
  } catch { return {} }
}

export async function loadPins() {
  try {
    const raw = await AsyncStorage.getItem(KEY_PINS)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return new Array(FAVOURITE_SLOTS).fill(null)
    // Normalised to exactly FAVOURITE_SLOTS entries so every consumer can index blindly.
    // A longer array from a future build that added a fifth slot truncates rather than
    // confusing a four-slot row.
    const out = new Array(FAVOURITE_SLOTS).fill(null)
    for (let i = 0; i < FAVOURITE_SLOTS; i++) {
      out[i] = typeof parsed[i] === 'string' && parsed[i] ? parsed[i] : null
    }
    return out
  } catch { return new Array(FAVOURITE_SLOTS).fill(null) }
}

export async function savePins(pins) {
  try {
    const out = new Array(FAVOURITE_SLOTS).fill(null)
    for (let i = 0; i < FAVOURITE_SLOTS; i++) out[i] = pins?.[i] ?? null
    await AsyncStorage.setItem(KEY_PINS, JSON.stringify(out))
  } catch { /* device-local nicety; a failed write costs a tile order, nothing more */ }
}

// ─── INCREMENT IS FIRE-AND-FORGET AND MUST NEVER BE AWAITED ─────────────────
//
// It is called from a tile's onPress, immediately before navigation. Awaiting it would
// put a disk round-trip between the user's finger and the screen opening — for a counter
// whose only job is to influence tile order on the NEXT mount. It returns a promise so a
// test can settle it; no caller in the app does.
//
// Read-modify-write is not atomic, so two taps in the same tick could lose a count. That
// is accepted: the cost is one tile being one place lower for one session, and the fix
// (a queue, or a mutex) is more moving parts than the defect is worth.
export function recordModuleOpen(id) {
  if (!id) return Promise.resolve()
  return (async () => {
    try {
      const usage = await loadUsage()
      usage[id] = Math.min((usage[id] || 0) + 1, MAX_COUNT)
      await AsyncStorage.setItem(KEY_USAGE, JSON.stringify(usage))
    } catch { /* see above */ }
  })()
}

// ⚠ COUNTS ARE RECORDED FOR EVERY MODULE, INCLUDING DARK ONES, AND THE FILTERING HAPPENS
//   AT RENDER (constants/homeFavourites.js). Two reasons that is the right split:
//   a dark module's tile IS tappable in the grid — it routes to Coming Soon, deliberately,
//   so that a gated module can still collect demand — and a module that launches later
//   then arrives with its interest already measured, instead of starting from zero on the
//   day it becomes eligible. Filtering at write time would throw that away and would also
//   bake today's flag values into stored data.

export async function clearModuleUsage() {
  try { await AsyncStorage.multiRemove([KEY_USAGE, KEY_PINS]) } catch { /* nothing to do */ }
}
