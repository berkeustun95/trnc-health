#!/usr/bin/env node
// ─── Explore map pin-source gate ─────────────────────────────────────────────
//
//   node scripts/validate-map-sources.mjs          # exit 0 if the gate holds
//
// WHAT THIS GUARDS: constants/mapSources.js decides which content reaches the Explore
// map. Get it wrong in the permissive direction and the map publishes a dark module's
// content to every user — the same class of leak CLAUDE.md records for search_content,
// where a module flag hides the SCREEN but not the DATA. Nothing else in the repo would
// notice: the map would simply look fuller.
//
// The single most important assertion here is HERITAGE IS ABSENT while
// MODULE_FLAGS.explore is false. groupVisible('heritage', 38, false) is TRUE on the
// row-count threshold alone (38 >= 8), so the obvious one-line implementation — "just
// call groupVisible" — leaks 38 dark-module pins and still passes any test that only
// counts beaches. This script exists to fail on exactly that mistake.
//
// SEEN TO GO RED. Every assertion group here has been watched failing against a
// deliberately broken build, then restored. It is not a decoration.
//
//   gate arm swapped for `groupVisible(g, pins.length, isAdmin)` alone
//     ✗ heritage contributes NO pins → 38    ✗ TOTAL PINNABLE = 11 → 49
//     ✗ All totals 11, not 49 → 49           ✗ a dark source key selects nothing → 38
//   mapFetchCategories always returning null
//     ✗ fetch narrows to the nature categories → null
//   selection filter inverted in selectedPins()
//     ✗ All === ticking every chip by hand    ✗ one chip selects only that chip → 7
//   openNowApplicable() dropping the parseIsOpen test
//     ✗ not applicable against live-shaped data → true
//
// WORTH KNOWING: the gate break left FIVE of the eight dark-state checks green, "beaches
// stay live" among them. A suite that asserted only the happy path would have shipped the
// leak with a full row of ticks. Assert what must be ABSENT, not only what must be there.
//
// Fixtures are synthetic but shaped from the live 2026-08-25 audit, so the printed
// numbers are the real ones and a data change shows up as a diff to explain, not a
// silent drift.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMapSources, mapFetchCategories, selectedPins, applyOpenNow, openNowApplicable,
  TRNC_CENTER,
} from '../constants/mapSources.js'
import { MODULE_FLAGS, EXPLORE_ROUTES_LIVE } from '../constants/flags.js'
import { routesLayerVisible, resolveRoutes, walkEstimate, overlapSlots, walkStep, walkAdvance, walkDistance } from '../constants/walkingRoutes.js'
import { HEALTH_TYPES } from '../constants/facilityTypes.js'
import { GROUP_META, EXPLORE_GROUPS,
         NON_CLAIMABLE_CATEGORIES, CLAIMABLE_CATEGORIES } from '../constants/exploreCategories.js'
import { t, LANG_CODES } from '../constants/i18n.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ─── Fixtures — live shape as of 2026-08-25 ─────────────────────────────────
// facilities: 6 public hospitals + 1 private clinic carry coordinates. All 387
// pharmacies are latitude NULL, so they are pinnable-zero, not merely few.
const FACILITIES = [
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `hos-${i}`, type: 'hospital', status: 'active', hidden_at: null,
    latitude: 35.2 + i * 0.01, longitude: 33.33 + i * 0.01, provider_id: null,
  })),
  { id: 'cli-0', type: 'clinic', status: 'active', hidden_at: null,
    latitude: 35.191, longitude: 33.353, provider_id: 'prov-1' },
  ...Array.from({ length: 387 }, (_, i) => ({
    id: `pha-${i}`, type: 'pharmacy', status: 'active', hidden_at: null,
    latitude: null, longitude: null, provider_id: null,
  })),
  // Moderation must still bite on the map: an active row that is hidden, and a
  // pending row, both carry coordinates and must NOT appear.
  { id: 'hid-0', type: 'hospital', status: 'active', hidden_at: '2026-08-01T00:00:00Z',
    latitude: 35.3, longitude: 33.3, provider_id: null },
  { id: 'pen-0', type: 'clinic', status: 'pending', hidden_at: null,
    latitude: 35.3, longitude: 33.3, provider_id: null },
]

// places: 42 active rows — 4 beach (nature) + 38 heritage, all with coordinates.
const HERITAGE = { museum: 14, religious_site: 8, ancient_ruins: 6, castle_fortress: 5, monument: 5 }
const PLACES = [
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `bch-${i}`, category: 'beach', status: 'active', region: 'girne',
    latitude: 35.34 + i * 0.01, longitude: 33.3 + i * 0.01,
  })),
  ...Object.entries(HERITAGE).flatMap(([cat, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${cat}-${i}`, category: cat, status: 'active', region: 'lefkosa',
      latitude: 35.18 + i * 0.01, longitude: 33.36 + i * 0.01,
    }))
  ),
]

const problems = []
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) problems.push(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → got ${JSON.stringify(actual)}`}`)
}

function summarise(sources) {
  return Object.fromEntries(sources.map(s => [s.key, s.pins.length]))
}

// The suite asserts the DARK case against the committed flag, so if explore is ever
// launched for real this script fails loudly and has to be updated deliberately rather
// than quietly asserting the wrong world.
// EXPLORE WENT LIVE 2026-08-26. Before that this file refused to run whenever the flag
// was true, so a local preview flip could not quietly re-baseline it. That guard has done
// its job and is retired — but the assertions it protected are NOT, because
// buildMapSources now takes an explicit `exploreLive` and both worlds stay testable.
//
// Keeping the dark case matters after launch, not less: it is the only thing asserting
// that a group which is neither reachable nor exempt contributes nothing. The next dark
// module to reach this map inherits that protection for free.
console.log(`\nMODULE_FLAGS.explore is currently ${MODULE_FLAGS.explore} (live since 2026-08-26)`)

console.log('\nexplore DARK (simulated — the pre-launch world, still asserted)')
const dark = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: null, isAdmin: false, exploreLive: false })
const darkCounts = summarise(dark)

check('sources are exactly clinic, hospital, nature', Object.keys(darkCounts),
  ['health:clinic', 'health:hospital', 'explore:nature'])
check('heritage contributes NO pins', darkCounts['explore:heritage'] ?? 0, 0)
check('beaches stay live (nature = 4)', darkCounts['explore:nature'], 4)
check('pharmacy earns no chip (0 geocoded)', darkCounts['health:pharmacy'] ?? 0, 0)
check('dentist earns no chip (0 rows)', darkCounts['health:dentist'] ?? 0, 0)
check('hidden + pending facilities excluded', darkCounts['health:hospital'], 6)
check('TOTAL PINNABLE = 11', dark.reduce((n, s) => n + s.pins.length, 0), 11)
check('fetch narrows to the nature categories', mapFetchCategories(false, false), ['beach', 'nature_scenic'])

console.log('\nexplore REACHABLE (the live world since 2026-08-26)')
// isAdmin forces the outer gate open regardless of the flag, so this arm asserts the
// same thing before and after launch.
const live = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: null, isAdmin: true })
const liveCounts = summarise(live)

check('heritage appears with all 38', liveCounts['explore:heritage'], 38)
check('nature still 4', liveCounts['explore:nature'], 4)
check('empty groups draw no chip', Object.keys(liveCounts).filter(k => k.startsWith('explore:')),
  ['explore:nature', 'explore:heritage'])
check('TOTAL PINNABLE = 49', live.reduce((n, s) => n + s.pins.length, 0), 49)
check('fetch is unnarrowed', mapFetchCategories(true), null)

console.log('\nchip selection — "All" must mean the union of VISIBLE sources')
// Berke's requirement, and the reason it is a requirement: if "All" is ever implemented
// as "apply no filter" rather than "every source the gate allowed", the dark-module leak
// walks straight back in through the path almost every user takes. The default is not a
// lesser path to protect; it is the main one.
const allDark  = selectedPins(dark, new Set())
const everyKey = selectedPins(dark, new Set(dark.map(s => s.key)))

check('All totals 11, not 49', allDark.length, 11)
check('All === ticking every chip by hand', [allDark.length, everyKey.length], [11, 11])
check('All draws no heritage pin', allDark.filter(p => p.group === 'heritage').length, 0)
check('one chip selects only that chip', selectedPins(dark, new Set(['explore:nature'])).length, 4)
// A key for a gated source must select NOTHING — it must never fall through to "All".
check('a dark source key selects nothing', selectedPins(dark, new Set(['explore:heritage'])).length, 0)
check('All totals 49 once explore is reachable', selectedPins(live, new Set()).length, 49)

console.log('\nopen now')
// parseIsOpen returns null for every facility in the live DB (393 NULL + 1 unparseable
// HoursPicker JSON), so the chip must not render at all today.
check('not applicable against live-shaped data', openNowApplicable(allDark), false)

const HOURS_FIXTURE = buildMapSources({
  facilities: [
    { id: 'always', type: 'clinic', status: 'active', hidden_at: null,
      latitude: 35.2, longitude: 33.3, provider_id: null, opening_hours: '24/7' },
    { id: 'unknown', type: 'clinic', status: 'active', hidden_at: null,
      latitude: 35.21, longitude: 33.31, provider_id: null, opening_hours: null },
  ],
  places: PLACES.filter(p => p.category === 'beach'),
  dutyFacilityId: null,
  isAdmin: false,
})
const hoursPins = selectedPins(HOURS_FIXTURE, new Set())
check('applicable once one facility has parseable hours', openNowApplicable(hoursPins), true)
check('off changes nothing', applyOpenNow(hoursPins, false).length, 6)
check('on drops the unknown-hours facility', applyOpenNow(hoursPins, true).map(p => p.row.id).includes('unknown'), false)
check('on keeps the 24/7 facility', applyOpenNow(hoursPins, true).map(p => p.row.id).includes('always'), true)
// A beach has no hours to be open against; hiding it would turn a modifier into a mode.
check('on keeps non-health pins untouched', applyOpenNow(hoursPins, true).filter(p => p.kind === 'place').length, 4)

console.log('\nchip labels resolve in all 9 locales')
// The chips look their labels up THROUGH A VARIABLE — t(src.labelKey, lang), where
// labelKey comes out of HEALTH_TYPES / GROUP_META. That is precisely the shape the old
// i18n completeness checker could not see (it matched only literal t('key')), and it is
// why this check reads the keys from the same data structures the chips do: add a sixth
// group to GROUP_META with a labelKey nobody defined and it goes red here, not on a
// user's screen.
//
// Deliberately NOT asserted: "the translation differs from English." That check cries
// wolf — hospital/es, exploreGroupNature/fr and exploreGroupServices/fr are all correct
// translations that happen to be the same word. A test that fires on correct data teaches
// you to ignore it.
const CHIP_KEYS = ['all', 'openNow', ...HEALTH_TYPES, ...Object.values(GROUP_META).map(m => m.labelKey)]
const raw = []
for (const key of CHIP_KEYS) {
  for (const lang of Object.keys(LANG_CODES)) {
    if (t(key, lang) === key) raw.push(`${key}/${lang}`)
  }
}
check('no chip label renders as a raw key', raw, [])

console.log('\ndefault viewport frames every pin')
// A default map view is wrong for months without anyone filing it: you cannot tell a map
// that is MISSING content from a map of a region that HAS no content. The old framing
// (centre 33.5, delta 0.9 x 0.9) cut nine of the 49 pins — all of Karpaz and all of
// Lefke/Güzelyurt — and it shipped that way on the live beaches map.
//
// These are the REAL extreme coordinates, measured 2026-08-25, not invented fixtures.
// Re-derive with:  node scripts/validate-map-sources.mjs --live
const EDGE_PINS = [
  { name: 'Vuni Sarayı  (W)',                 lng: 32.7731, lat: 35.1588 },
  { name: 'Apostolos Andreas Manastırı (E,N)', lng: 34.5695, lat: 35.6557 },
  { name: 'Lefke Maden Müzesi  (S)',          lng: 32.8496, lat: 35.1135 },
  { name: 'Altın Kumsal  (Karpaz beach)',     lng: 34.5423, lat: 35.6412 },
]
const BOX = {
  w: TRNC_CENTER.longitude - TRNC_CENTER.longitudeDelta / 2,
  e: TRNC_CENTER.longitude + TRNC_CENTER.longitudeDelta / 2,
  s: TRNC_CENTER.latitude  - TRNC_CENTER.latitudeDelta  / 2,
  n: TRNC_CENTER.latitude  + TRNC_CENTER.latitudeDelta  / 2,
}
const inBox = p => p.lng >= BOX.w && p.lng <= BOX.e && p.lat >= BOX.s && p.lat <= BOX.n
check('every known edge pin is inside the default region',
  EDGE_PINS.filter(p => !inBox(p)).map(p => p.name), [])

// The margin is PRINTED, not asserted at a fixed value, and not left to a comment that
// goes stale silently — CLAUDE.md's rule about measured numbers. A shrinking margin is
// visible here before it becomes a cut-off pin.
const margins = {
  W: Math.min(...EDGE_PINS.map(p => p.lng - BOX.w)),
  E: Math.min(...EDGE_PINS.map(p => BOX.e - p.lng)),
  S: Math.min(...EDGE_PINS.map(p => p.lat - BOX.s)),
  N: Math.min(...EDGE_PINS.map(p => BOX.n - p.lat)),
}
console.log(`    region lng ${BOX.w.toFixed(2)}..${BOX.e.toFixed(2)}  lat ${BOX.s.toFixed(2)}..${BOX.n.toFixed(2)}`)
console.log(`    margin  W ${margins.W.toFixed(3)}  E ${margins.E.toFixed(3)}  S ${margins.S.toFixed(3)}  N ${margins.N.toFixed(3)}  (degrees)`)
// ⚠ HONEST LIMIT: this checks the extremes KNOWN on 2026-08-25. A newly added place
//   beyond them is not caught offline — `--live` is what actually checks every row.
check('no margin has gone negative', Object.values(margins).every(m => m > 0), true)

console.log('\nownership scope — every category must be decided, not defaulted')
// A block list alone lets a NEW category default to CLAIMABLE: add `national_park` and it
// silently becomes ownable with nothing failing. That is the inverse of the
// towing.is_active DEFAULT false lesson — the default must protect the path nobody has
// written yet. So both lists are explicit and this asserts they PARTITION the taxonomy.
// Adding a category without deciding fails the push.
const allCats = [...new Set(Object.values(EXPLORE_GROUPS).flat())]
const undecided = allCats.filter(c => !NON_CLAIMABLE_CATEGORIES.includes(c) && !CLAIMABLE_CATEGORIES.includes(c))
const both      = allCats.filter(c =>  NON_CLAIMABLE_CATEGORIES.includes(c) &&  CLAIMABLE_CATEGORIES.includes(c))
check('every category is in exactly one ownership list', undecided, [])
check('no category is in both lists', both, [])
// And nothing may be listed that is not a real category — a typo in either list would
// otherwise sit there looking decided while gating nothing.
const ghosts = [...NON_CLAIMABLE_CATEGORIES, ...CLAIMABLE_CATEGORIES].filter(c => !allCats.includes(c))
check('neither list names a category that does not exist', ghosts, [])

console.log('\nownership scope — the JS list and the SQL guard must agree')
// The same seven categories are declared twice, once per language, because a Postgres
// trigger cannot import from JS. Same shape as check-module-flags.mjs reading NOTIFY_SQL,
// and same reason: a comment saying KEEP IN SYNC is not a mechanism.
//
// The failure is ASYMMETRIC, which is why this is worth a guard rather than a habit:
//   blocked in SQL, not JS  -> the button shows, the insert 500s. Loud. Fixed in a day.
//   blocked in JS, not SQL  -> the button is hidden and the path is OPEN. Silent. Nothing
//                              surfaces it, because nothing is trying to file the claim.
// This asserts the second cannot happen unnoticed.
const GUARD_SQL = 'supabase/migrations/20260921_place_claims_category_guard.sql'
try {
  const sql = readFileSync(resolve(ROOT, GUARD_SQL), 'utf8')
  const start = sql.indexOf('IF target_category = ANY')
  const body  = sql.slice(start, sql.indexOf('THEN', start))
  const inSql = [...body.matchAll(/'([a-z_]+)'::text/g)].map(m => m[1]).sort()
  check('SQL guard blocks exactly the JS non-claimable list', inSql, [...NON_CLAIMABLE_CATEGORIES].sort())
} catch (e) {
  check(`could not read ${GUARD_SQL} to compare the lists`, e.message, null)
}

console.log('\nduty pharmacy')
const duty = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: 'pha-0', isAdmin: false })
check('duty pin is unreachable until pharmacies are geocoded',
  duty.flatMap(s => s.pins).filter(p => p.isDuty).length, 0)

// ─── Walking routes (Visit NCY) — a LAYER, gated on its own flag ─────────────
//
// The discriminating case is the second one: an ADMIN, no review mode, flag false. The
// house pattern everywhere else on this map is `|| isAdmin`, and that is exactly the
// one-line "fix" that would show dark partner routes to every admin in production. It is
// asserted here so that change fails a push rather than surviving review.
console.log(`\nwalking routes — EXPLORE_ROUTES_LIVE is ${EXPLORE_ROUTES_LIVE}`)
check('layer hidden: user, flag off',              routesLayerVisible({ routesLive: false, review: false, isAdmin: false }), false)
check('layer hidden: ADMIN, flag off, no review',  routesLayerVisible({ routesLive: false, review: false, isAdmin: true }), false)
check('layer hidden: review env but not admin',    routesLayerVisible({ routesLive: false, review: true,  isAdmin: false }), false)
check('layer shown: review env + admin',           routesLayerVisible({ routesLive: false, review: true,  isAdmin: true }), true)
check('layer shown: flag on, plain user',          routesLayerVisible({ routesLive: true,  review: false, isAdmin: false }), true)
check('committed flag hides the layer from an admin',
  routesLayerVisible({ routesLive: EXPLORE_ROUTES_LIVE, review: false, isAdmin: true }), EXPLORE_ROUTES_LIVE)

// Fixture: 5 live stops ~300 m apart on a line, one pending stop in the middle (absent from
// the loaded places, as RLS makes it), plus an inactive route and a route with one live stop.
const RS = Array.from({ length: 6 }, (_, i) => ({ id: `rs-${i}`, latitude: 35.17, longitude: 33.36 + i * 0.0033 }))
const loaded = new Map(RS.filter(p => p.id !== 'rs-2').map(p => [p.id, p]))
const stopsOf = ids => ids.map((id, i) => ({ position: i + 1, place_id: id }))
const ROUTE_ROWS = [
  { id: 'r-live', is_active: true,  sort_order: 1, walking_route_stops: stopsOf(RS.map(p => p.id)) },
  { id: 'r-dark', is_active: false, sort_order: 0, walking_route_stops: stopsOf(['rs-0', 'rs-1', 'rs-3']) },
  { id: 'r-thin', is_active: true,  sort_order: 2, walking_route_stops: stopsOf(['rs-0', 'rs-2']) },
]
const resolved = resolveRoutes(ROUTE_ROWS, loaded)
check('inactive route never resolves outside review', resolved.map(r => r.id), ['r-live'])
check('review mode keeps the inactive route, in sort_order', resolveRoutes(ROUTE_ROWS, loaded, { review: true }).map(r => r.id), ['r-dark', 'r-live'])
check('a non-live stop is skipped and the rest renumbered', resolved[0]?.stops.map(p => p.id), ['rs-0', 'rs-1', 'rs-3', 'rs-4', 'rs-5'])
check('a route left with < 2 drawable stops is dropped', resolved.some(r => r.id === 'r-thin'), false)
const est = walkEstimate(resolved[0]?.stops ?? [])
check('≈ figures are rounded: whole km, minutes in 5s', [Number.isInteger(est.km), est.min % 5], [true, 0])
check('≈ figures use ×1.3 at 4.5 km/h (~1.5 km straight → ≈2 km, ≈25 min)', est, { km: 2, min: 25 })

// Near-overlapping stops must each get their own slot (Lefke 2–3 is 1 m apart), and stops
// that are comfortably apart must stay exactly on their point (slot 0).
const at = (lat, lng) => ({ latitude: lat, longitude: lng })
const M = 0.000009   // ≈ 1 m of latitude
check('a 1 m pair is split into two slots', overlapSlots([at(35, 33), at(35 + M, 33)]), [-0.5, 0.5])
check('stops 40 m apart stay on their point', overlapSlots([at(35, 33), at(35 + 40 * M, 33)]), [0, 0])
check('a 20 m + 20 m chain spreads as one group of three', overlapSlots([at(35, 33), at(35 + 20 * M, 33), at(35 + 40 * M, 33)]), [-1, 0, 1])

// Walk mode. The case that matters is the manual Previous: you are standing at the stop you
// stepped back to, and a naive "within 30 m → advance" bounces you forward again at once.
const W = [at(35, 33), at(35 + 100 * M, 33), at(35 + 300 * M, 33)]
let ws = walkStep(W, 0, at(35 - 200 * M, 33))
check('walk: starting far away arms stop 1', ws, { next: 0, armed: true })
ws = walkAdvance(W, ws, at(35 - 5 * M, 33))
check('walk: arriving within 30 m advances', ws.next, 1)
ws = walkStep(W, 0, at(35 + 2 * M, 33))
check('walk: manual Previous onto the stop you stand at is NOT armed', ws, { next: 0, armed: false })
check('walk: …and the next fix there does not bounce you forward', walkAdvance(W, ws, at(35 + 2 * M, 33)).next, 0)
ws = walkAdvance(W, walkAdvance(W, ws, at(35 + 60 * M, 33)), at(35 + 1 * M, 33))
check('walk: walking away (>30 m) and back re-arms and advances', ws.next, 1)
check('walk: nothing happens after the last stop', walkAdvance(W, { next: 3, armed: true }, at(35, 33)), { next: 3, armed: true })
check('walk: distances are rounded, never raw', [walkDistance(123), walkDistance(2600)], [{ unit: 'm', n: 120 }, { unit: 'km', n: 3 }])

// The gate above is only worth something if the screen USES it. Code-shape checks, anchored
// to code (not prose), with the raw value printed on failure.
const MAP_SRC = readFileSync(resolve(ROOT, 'screens/ExploreMapScreen.js'), 'utf8')
const REVIEW_SRC = readFileSync(resolve(ROOT, 'utils/exploreReview.js'), 'utf8')
check('ExploreMapScreen gates the layer on EXPLORE_ROUTES_LIVE via routesLayerVisible',
  /routesLayerVisible\(\{\s*routesLive:\s*EXPLORE_ROUTES_LIVE\b/.test(MAP_SRC), true)
const routesQuery = MAP_SRC.indexOf(".from('walking_routes')")
const effectStart = MAP_SRC.lastIndexOf('useEffect(', routesQuery)
check('the walking_routes query sits behind `if (!routesOn) return`',
  routesQuery > 0 && MAP_SRC.slice(effectStart, routesQuery).includes('if (!routesOn) return'), true)
check('outside review the client filters is_active itself (RLS opens inactive rows to admins)',
  MAP_SRC.includes("if (!review) q = q.eq('is_active', true)"), true)
check('review mode is __DEV__-folded (utils/exploreReview.js)',
  /export const EXPLORE_REVIEW = __DEV__ && /.test(REVIEW_SRC), true)

if (problems.length) {
  console.error('\n  ┌─ MAP SOURCE GATE FAILED ───────────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}

console.log(`\nmap source gate: OK — ${live.reduce((n, s) => n + s.pins.length, 0)} pinnable LIVE, `
  + `${dark.reduce((n, s) => n + s.pins.length, 0)} in the simulated dark world\n`)

// ─── --live: assert EVERY pinnable row, not just the known extremes ──────────
//
// Opt-in and network-dependent, so it is NOT in the pre-push chain — a guard that needs
// the internet is a guard that blocks a push on a train. Run it before flipping
// EXPLORE_MAP_LIVE, and any time places gains rows in a new corner of the island.
//
//   node scripts/validate-map-sources.mjs --live
if (process.argv.includes('--live')) {
  const U = process.env.EXPO_PUBLIC_SUPABASE_URL
  const K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!U || !K) {
    console.error('\n  --live needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.\n')
    process.exit(1)
  }
  const get = async q => (await fetch(`${U}/rest/v1/${q}`, { headers: { apikey: K } })).json()
  const [facilities, places] = await Promise.all([
    get('facilities?select=*&limit=2000'),
    get('places?select=id,category,name,name_i18n,latitude,longitude&status=eq.active&limit=2000'),
  ])
  // isAdmin:true measures the set the map must frame ONCE EXPLORE IS LIVE, not today's
  // gated subset. Measuring the dark set would size the viewport to 11 pins and re-cut
  // Karpaz the day the flag flips — which is exactly the mistake this check exists for.
  const livePins = selectedPins(
    buildMapSources({ facilities, places, dutyFacilityId: null, isAdmin: true }), new Set())
  const outside = livePins.filter(p => !inBox({ lng: p.lng, lat: p.lat }))
  console.log(`\nLIVE — ${livePins.length} pinnable rows fetched`)
  for (const p of outside) {
    console.log(`  ✗ OUTSIDE  ${(p.row.name_i18n?.tr || p.row.name)}  ${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`)
  }
  if (outside.length) {
    console.error(`\n  ${outside.length} live pin(s) fall outside the default region — widen TRNC_CENTER.\n`)
    process.exit(1)
  }
  console.log(`  ✓ all ${livePins.length} live pins inside the default region`)
}
