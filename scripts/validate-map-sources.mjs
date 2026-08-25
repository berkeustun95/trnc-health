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
// SEEN TO GO RED: with the gate's `LIVE_TILE_GROUPS.includes(g)` arm swapped for
// `groupVisible(g, pins.length, isAdmin)`, this reports
//   ✗ explore DARK: heritage must contribute NO pins — got 38
//   ✗ explore DARK: total pinnable is 11 — got 49
// and exits 1. Restored, it passes. It has been watched failing; it is not a decoration.
//
// Fixtures are synthetic but shaped from the live 2026-08-25 audit, so the printed
// numbers are the real ones and a data change shows up as a diff to explain, not a
// silent drift.

import { buildMapSources, mapFetchCategories } from '../constants/mapSources.js'
import { MODULE_FLAGS } from '../constants/flags.js'

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
if (MODULE_FLAGS.explore !== false) {
  console.error('\n  MODULE_FLAGS.explore is TRUE. If that is a local preview flip, revert it '
    + '(git checkout -- constants/flags.js). If explore genuinely launched, update the '
    + 'DARK expectations in this file deliberately.\n')
  process.exit(1)
}

console.log('\nexplore DARK (committed state)')
const dark = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: null, isAdmin: false })
const darkCounts = summarise(dark)

check('sources are exactly clinic, hospital, nature', Object.keys(darkCounts),
  ['health:clinic', 'health:hospital', 'explore:nature'])
check('heritage contributes NO pins', darkCounts['explore:heritage'] ?? 0, 0)
check('beaches stay live (nature = 4)', darkCounts['explore:nature'], 4)
check('pharmacy earns no chip (0 geocoded)', darkCounts['health:pharmacy'] ?? 0, 0)
check('dentist earns no chip (0 rows)', darkCounts['health:dentist'] ?? 0, 0)
check('hidden + pending facilities excluded', darkCounts['health:hospital'], 6)
check('TOTAL PINNABLE = 11', dark.reduce((n, s) => n + s.pins.length, 0), 11)
check('fetch narrows to the nature categories', mapFetchCategories(false), ['beach', 'nature_scenic'])

console.log('\nexplore REACHABLE (local preview flip / admin)')
// isAdmin drives the same outer gate a local `explore: true` flip does, so this exercises
// the demo configuration without editing the committed flag.
const live = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: null, isAdmin: true })
const liveCounts = summarise(live)

check('heritage appears with all 38', liveCounts['explore:heritage'], 38)
check('nature still 4', liveCounts['explore:nature'], 4)
check('empty groups draw no chip', Object.keys(liveCounts).filter(k => k.startsWith('explore:')),
  ['explore:nature', 'explore:heritage'])
check('TOTAL PINNABLE = 49', live.reduce((n, s) => n + s.pins.length, 0), 49)
check('fetch is unnarrowed', mapFetchCategories(true), null)

console.log('\nduty pharmacy')
const duty = buildMapSources({ facilities: FACILITIES, places: PLACES, dutyFacilityId: 'pha-0', isAdmin: false })
check('duty pin is unreachable until pharmacies are geocoded',
  duty.flatMap(s => s.pins).filter(p => p.isDuty).length, 0)

if (problems.length) {
  console.error('\n  ┌─ MAP SOURCE GATE FAILED ───────────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}

console.log(`\nmap source gate: OK — ${dark.reduce((n, s) => n + s.pins.length, 0)} pinnable committed, `
  + `${live.reduce((n, s) => n + s.pins.length, 0)} with explore flipped locally\n`)
