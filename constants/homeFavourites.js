// Sık kullandıkların — the favourites row's vocabulary and its PURE resolution rules.
//
// Extension-explicit imports so plain Node can exercise this without Metro. There is no
// AsyncStorage, no React and no side effect in this file: it is the cityWelcomeRules /
// cityWelcome split applied again, and it exists in that shape so the degradation rules
// below can be tested by a script rather than by tapping a phone.
import { LABEL_MIN_PX } from './homeModules.js'

export const FAVOURITE_SLOTS = 8

// Ids that are never AUTO-filled: Nöbetçi and Acil are tiles directly above the row on
// Home, so repeating them would echo. A manual PIN of either is still honoured.
export const AUTO_FILL_EXCLUDE = new Set(['duty', 'emergency'])

// ─── ▼ EDITORIAL DEFAULTS — THIS IS THE LINE TO EDIT ▼ ──────────────────────
//
// What a fresh install shows, in this order, before the device has learned anything.
// Ids are tile ids from constants/homeModules.js or the EXTRA ids in constants/homeGroups.js.
// It is also the TIE-BREAK order (see compareCandidates below), so a default outranks a
// non-default at equal usage.
//
// ⚠ AN ENTRY THAT IS NOT VISIBLE OR IS MISSPELLED IS SILENTLY SKIPPED — a default must never
//   put a dead tile on Home — but a typo costs a slot with no error. `npm run home:check`
//   asserts every id exists and that at least FAVOURITE_SLOTS defaults resolve.
//
// Locked 2026-11 (Home Hizmetler): events · accommodation · exchangeRates · newcomerEssentials
// · exploreTab · eatery · hotels · pets. `explore` (hidden, the Keşfet tab covers it) and
// `transport` (hidden since 2026-10-10) stay at their positions, dormant: this is a preference
// ORDER, so an entry that becomes visible again takes its position back with no edit.
export const DEFAULT_FAVOURITES = [
  'explore',
  'events',
  'transport',
  'accommodation',
  'exchangeRates',
  'newcomerEssentials',
  'exploreTab',
  'eatery',
  'hotels',
  'pets',
]

const DEFAULT_INDEX = new Map(DEFAULT_FAVOURITES.map((id, i) => [id, i]))

// Auto-filled slots sort by, in order:
//   1. usage count, descending — the stated rule
//   2. position in DEFAULT_FAVOURITES — so a fresh device shows exactly the editorial
//      eight, in their editorial order, with no separate "is this a fresh install" branch
//   3. position in `visible` (Home's own order) — a total order, so two renders of the same
//      state can never disagree
function compareCandidates(a, b, usage, order) {
  const byUse = (usage[b] || 0) - (usage[a] || 0)
  if (byUse) return byUse
  const da = DEFAULT_INDEX.has(a) ? DEFAULT_INDEX.get(a) : Infinity
  const db = DEFAULT_INDEX.has(b) ? DEFAULT_INDEX.get(b) : Infinity
  if (da !== db) return da - db
  return order.get(a) - order.get(b)
}

// ─── RESOLUTION ─────────────────────────────────────────────────────────────
//
// pins     array of FAVOURITE_SLOTS entries, each a tile id or null. A pin holds its SLOT.
// usage    { [id]: count }, device-local.
// visible  ordered ids of every tile Home shows (visibleServiceIds in constants/homeGroups.js,
//          passed in so this file stays plain-Node). It is the ONLY eligibility rule.
//
// ⚠ A PIN THAT IS NOT VISIBLE IS SKIPPED, NOT DELETED. Storage keeps it, so a module that
//   goes dark for a release and comes back restores the user's own arrangement.
//
// Returns AT MOST FAVOURITE_SLOTS ids, never duplicated, no holes.
export function resolveFavourites({ pins = [], usage = {}, visible = [] } = {}) {
  const order = new Map(visible.map((id, i) => [id, i]))
  const slots = new Array(FAVOURITE_SLOTS).fill(null)
  const taken = new Set()

  for (let i = 0; i < FAVOURITE_SLOTS; i++) {
    const id = pins[i]
    if (id && !taken.has(id) && order.has(id)) {
      slots[i] = id
      taken.add(id)
    }
  }

  const auto = [...order.keys()]
    .filter(id => !taken.has(id) && !AUTO_FILL_EXCLUDE.has(id))
    .sort((a, b) => compareCandidates(a, b, usage, order))

  let next = 0
  for (let i = 0; i < FAVOURITE_SLOTS; i++) {
    if (slots[i]) continue
    if (next >= auto.length) break
    slots[i] = auto[next++]
  }

  return slots.filter(Boolean)
}

// ─── Düzenle slot label size ────────────────────────────────────────────────
// Slot labels render at SLOT_LABEL_PX. A label that would break mid-word in the slot box
// (Home's tile width, 320dp and up, font scale 1.0 and capped 1.3) renders at its entry
// here instead, never below SLOT_LABEL_MIN_PX. Keys are full language names. The table is
// DERIVED by `npm run labels:check`, which fails on a missing, stale or over-shrunk entry
// and prints the table it expects.
export const SLOT_LABEL_PX = 10
export const SLOT_LABEL_MIN_PX = LABEL_MIN_PX
export const SLOT_LABEL_FIT = {
  Russian: { accommodation: 8.5, ehliyet: 9 },
}
