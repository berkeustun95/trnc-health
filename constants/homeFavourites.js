// Sık kullandıkların — the favourites row's vocabulary and its PURE resolution rules.
//
// Extension-explicit imports so plain Node can exercise this without Metro. There is no
// AsyncStorage, no React and no side effect in this file: it is the cityWelcomeRules /
// cityWelcome split applied again, and it exists in that shape so the degradation rules
// below can be tested by a script rather than by tapping a phone.
import { HOME_MODULES, HIDDEN_TILES } from './homeModules.js'
import { MODULE_FLAGS } from './flags.js'

export const FAVOURITE_SLOTS = 4

// ─── ▼ EDITORIAL DEFAULTS — THIS IS THE LINE TO EDIT ▼ ──────────────────────
//
// What a fresh install shows, in this order, before the device has learned anything.
// Ids come from constants/homeModules.js.
//
// Change this array and nothing else. It is not a fallback of last resort — it is the
// first impression of the row for every new user, and it stays visible until somebody
// has opened enough modules for usage to overtake it. It is also the TIE-BREAK order
// (see compareCandidates below), so a default outranks a non-default at equal usage
// forever, not just on day one.
//
// ⚠ AN ENTRY THAT IS DARK OR MISSPELLED IS SILENTLY SKIPPED. That is deliberate — a
//   default must never be able to put a dead tile on Home — but it means a typo here
//   costs you a slot with no error. `npm run home:check` asserts every id in this array
//   exists in HOME_MODULES, and that at least FAVOURITE_SLOTS of them are ELIGIBLE right
//   now, so neither a typo nor a dark entry can quietly hand a slot back to grid order.
//
// ─── IT IS A PREFERENCE ORDER, NOT EXACTLY FOUR ─────────────────────────────
//
// Longer than FAVOURITE_SLOTS on purpose. Ineligible entries are skipped and the ones
// below them move up, so a module can sit in its intended POSITION while still dark and
// take that position automatically on the day it launches — no edit, no follow-up ticket,
// no "why is this not in the row" three months later.
//
// `transport` is exactly that case today: MODULE_FLAGS.transport is false, so the row
// currently renders explore · events · exchangeRates · newcomerEssentials, and becomes
// explore · events · transport · exchangeRates the moment transport goes live.
//
// ─── WHY THESE FOUR (2026-09-05) ────────────────────────────────────────────
//
// The previous set opened with `health`, which is ALSO the grid's first tile in the
// grid's first position — so the shortcuts row read as a partial clone of the grid 40pt
// below it, which on first launch looks like a rendering bug rather than a feature. These
// five are drawn from the middle and end of the grid (positions 5, 4, 11, 16, 15), so
// there is no positional echo.
//
// They are also all `standard` tint. The old set led with a coral tile sitting above the
// grid's three coral tiles — health + emergency + towing stacked with the coral Nöbetçi
// row a little further up, which is a lot of one colour in a short stretch of screen.
// Coral is the urgency signal in this design; it stops being one when it is also the
// colour of the shortcuts.
export const DEFAULT_FAVOURITES = [
  // Hidden since 2026-09-13 (the Keşfet tab covers it), so it is SKIPPED — kept in the list
  // for the same reason `transport` is: this is a preference ORDER, and an entry that
  // becomes eligible again takes its position back with no edit.
  'explore',
  'events',
  'transport',          // dark today — see the note above; takes its slot on launch
  // ⚠ ADDED WHEN explore WAS HIDDEN, AND THE GUARD IS WHY. Hiding explore took the
  //   eligible-default count from 4 to 3, which would have filled one shortcut slot from
  //   GRID ORDER — health, emergency, towing, the coral block this set was chosen to get
  //   away from. `npm run home:check` failed on exactly that and named the shortfall.
  //   Housing is the natural replacement: live, `standard` tint like the rest of this set,
  //   drawn from the middle of the grid so there is no positional echo, and the most
  //   practical thing a newcomer opens after events.
  'accommodation',
  'exchangeRates',
  // The backstop, and it is UNGATED on purpose: no flag can switch it off, so the row is
  // guaranteed to be filled from editorial choices in every flag state rather than
  // falling through to grid order.
  'newcomerEssentials',
]

// ─── IDENTITY: THE TILE ID, AND THE MAP THAT MAKES THAT SAFE ────────────────
//
// Counts key on `mod.id` from HOME_MODULES, because that is already the app's identity
// for a tile — the grid renders it, moduleHandlers dispatches on it, and the favourites
// row stores it. The flag key is a DIFFERENT namespace and it does not always agree:
//
//     HOME_MODULES id   'jobPostings'
//     MODULE_FLAGS key  'jobs'
//
// ⚠ NEITHER SIDE MAY BE RENAMED TO CLOSE THE GAP, and that is a constraint rather than a
//   preference. The MODULE_FLAGS key is reused VERBATIM as the `module` value in
//   module_waitlist, in that column's CHECK constraint, and inside notify_module_waitlist
//   — so renaming 'jobs' is a database migration plus a guard-baseline edit, for a
//   cosmetic win. The tile id is wired into moduleHandlers and into every stored
//   favourite on every device. So the honest fix is neither rename: it is this map,
//   which is empty except where the two namespaces actually disagree.
//
// Anything absent maps to itself.
export const MODULE_FLAG_KEY = {
  jobPostings: 'jobs',
}

// Tiles that reach a destination NO flag gates — App.js renders them unconditionally.
// Read off the App.js branches, not guessed: health opens the facility list, emergency
// and municipal are modals, the other four are ungated screens.
//
// This set exists so that "no flag" is something a module DECLARES rather than something
// inferred from a lookup coming back undefined — which is exactly how the jobPostings gap
// would have read if eligibility failed open.
export const UNGATED_MODULES = new Set([
  'health', 'emergency', 'games', 'exchangeRates', 'newcomerEssentials', 'esim', 'municipal',
])

const MODULE_IDS    = HOME_MODULES.map(m => m.id)
const MODULE_INDEX  = new Map(MODULE_IDS.map((id, i) => [id, i]))
const DEFAULT_INDEX = new Map(DEFAULT_FAVOURITES.map((id, i) => [id, i]))

// ─── ELIGIBILITY — AND IT FAILS CLOSED ──────────────────────────────────────
//
// A module may occupy a favourite slot only if tapping it reaches the real thing. Three
// ways it can fail, and all three degrade to the same silent drop:
//
//   • REMOVED   the id is not in HOME_MODULES at all — a stored favourite from an older
//               build, or a module the consolidation pass deleted.
//   • DARK      its MODULE_FLAGS entry is false, so the tile lands on Coming Soon. The
//               GRID still shows it (deliberately — a flag-gated entry point hides the
//               very demand the flag waits for, which is the towing lesson), but a
//               favourite is "the thing you reach for most", and Coming Soon is not it.
//   • UNRESOLVABLE  the id is neither declared ungated nor resolvable to a real
//               MODULE_FLAGS key.
//
// ⚠ THAT LAST BRANCH IS THE WHOLE POINT AND IT MUST STAY FAIL-CLOSED. If a future tile id
//   drifts from its flag key the way jobPostings already has, a fail-OPEN lookup reads
//   `undefined` as "ungated" and cheerfully promotes a dead tile into the row — the exact
//   defect this file was written to prevent, reintroduced by the thing meant to prevent
//   it. Unknown means ineligible, loudly in __DEV__ and quietly in production.
//
// `overrides` is for the one case a flag cannot express: HomeScreen already computes
// garagesTileVisible (GARAGES_LIVE || admin || ownsGarage), and a garage owner genuinely
// uses that module while it is dark for everyone else.
export function moduleEligible(id, { flags = MODULE_FLAGS, overrides = {} } = {}) {
  if (!MODULE_INDEX.has(id)) return false
  // ⚠ HIDDEN BEATS EVERYTHING, INCLUDING AN OVERRIDE. A shortcut to a tile the grid does
  //   not show is an orphan: the user cannot find it again, cannot see what it belongs to,
  //   and Düzenle would offer it from a list of modules that are otherwise all present.
  //   Pins naming a hidden tile SURVIVE in storage — same rule as a dark module — so
  //   unhiding restores the user's own arrangement rather than having forgotten it.
  if (HIDDEN_TILES.has(id)) return false
  if (overrides[id]) return true
  if (UNGATED_MODULES.has(id)) return true

  const key = MODULE_FLAG_KEY[id] ?? id
  const value = flags[key]
  if (typeof value !== 'boolean') {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(
        `homeFavourites: '${id}' resolves to flag key '${key}', which is not a boolean in ` +
        `MODULE_FLAGS. Treating it as INELIGIBLE. Add it to UNGATED_MODULES if it has no ` +
        `gate, or to MODULE_FLAG_KEY if its flag is named differently.`)
    }
    return false
  }
  return value
}

// ─── THE ORDER, AS ONE COMPARATOR ───────────────────────────────────────────
//
// Auto-filled slots sort by, in order:
//   1. usage count, descending — the stated rule
//   2. position in DEFAULT_FAVOURITES — so a fresh device shows exactly the editorial
//      four, in their editorial order, with no separate "is this a fresh install" branch
//   3. position in HOME_MODULES — a total order, so the result is deterministic and two
//      renders of the same state can never disagree
//
// Folding the defaults into the tie-break rather than special-casing an empty device is
// what keeps this one function instead of two code paths that drift.
function compareCandidates(a, b, usage) {
  const byUse = (usage[b] || 0) - (usage[a] || 0)
  if (byUse) return byUse
  const da = DEFAULT_INDEX.has(a) ? DEFAULT_INDEX.get(a) : Infinity
  const db = DEFAULT_INDEX.has(b) ? DEFAULT_INDEX.get(b) : Infinity
  if (da !== db) return da - db
  return MODULE_INDEX.get(a) - MODULE_INDEX.get(b)
}

// ─── RESOLUTION ─────────────────────────────────────────────────────────────
//
// pins      array of FAVOURITE_SLOTS entries, each a module id or null. A pin holds its
//           SLOT, not just a place in the ordering — that is what makes "pin this to
//           position 2" mean anything, and it is the least surprising reading of a row of
//           four boxes the user just arranged.
// usage     { [moduleId]: count }, device-local.
// overrides { [moduleId]: true } — see moduleEligible.
//
// ⚠ AN INELIGIBLE PIN IS SKIPPED, NOT DELETED. Storage keeps it. A module that goes dark
//   for a release and comes back live restores the user's own arrangement instead of
//   having quietly forgotten it — and the same reasoning covers a pin made on a newer
//   build and read by an older one.
//
// Returns AT MOST FAVOURITE_SLOTS ids, never duplicated.
export function resolveFavourites({ pins = [], usage = {}, flags = MODULE_FLAGS, overrides = {} } = {}) {
  const opts  = { flags, overrides }
  const slots = new Array(FAVOURITE_SLOTS).fill(null)
  const taken = new Set()

  for (let i = 0; i < FAVOURITE_SLOTS; i++) {
    const id = pins[i]
    if (id && !taken.has(id) && moduleEligible(id, opts)) {
      slots[i] = id
      taken.add(id)
    }
  }

  const auto = MODULE_IDS
    .filter(id => !taken.has(id) && moduleEligible(id, opts))
    .sort((a, b) => compareCandidates(a, b, usage))

  let next = 0
  for (let i = 0; i < FAVOURITE_SLOTS; i++) {
    if (slots[i]) continue
    if (next >= auto.length) break
    slots[i] = auto[next++]
  }

  return slots.filter(Boolean)
}

// Everything the Düzenle sheet may offer, in grid order. Same eligibility as the row —
// a sheet that let you pin a dark module would be a way to put a dead tile on Home by
// hand, which is the thing the resolver refuses to do by itself.
export function eligibleModules({ flags = MODULE_FLAGS, overrides = {} } = {}) {
  return MODULE_IDS.filter(id => moduleEligible(id, { flags, overrides }))
}

// ─── THE ROW CANNOT COME UP EMPTY ───────────────────────────────────────────
//
// Structural, not hopeful, and it matters because the section HEADING lives in HomeScreen
// (so it uses the same token as the other headings) and would otherwise be left standing
// over nothing. UNGATED_MODULES holds seven ids that no flag can turn off, so the
// auto-fill pool is never smaller than seven whatever the flags say, whatever is stored,
// and whatever the network is doing. Four slots cannot outrun that.
//
// Asserted rather than asserted-about: `npm run home:check` computes this against an
// all-false flag set on every run.
export const MIN_ALWAYS_ELIGIBLE = UNGATED_MODULES.size
