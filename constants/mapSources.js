// Pin sources for the Explore map — ONE derived list that answers both "which pins
// render" and (Slice 3) "which chips render". Derived at RUNTIME from MODULE_FLAGS and
// the Explore taxonomy, never hardcoded, so a dark module can neither draw a chip nor
// contribute a pin. Flipping a flag locally lights the map up with no code change; that
// is the whole point, and it is how the module is previewed (see check-module-flags.mjs).
//
// ─── WHY THIS LIVES IN SLICE 2, NOT SLICE 3 ─────────────────────────────────
// The chips are Slice 3, but the GATING cannot wait for them: a Slice-2 map that
// rendered every place row would commit a path that draws 38 heritage pins while
// MODULE_FLAGS.explore is false. Slice 3 adds the chip row ON TOP of this list; it does
// not change what this file decides.
//
// ─── THE EXPLORE GATE IS TWO GATES, NOT ONE ─────────────────────────────────
// groupVisible() is the tile grid's INNER gate (row-count threshold + the LIVE_TILE_GROUPS
// exemption). It assumes the caller already passed the OUTER gate — reaching ExploreScreen
// at all — which App.js owns as `MODULE_FLAGS.explore || isAdmin`. On the map there is no
// App.js branch to pass through, so both gates are expressed here:
//
//   explore reachable  -> groupVisible(g, count, isAdmin)   (the REAL function, not a copy)
//   explore dark       -> LIVE_TILE_GROUPS only
//
// The second line is load-bearing. groupVisible('heritage', 38, false) is TRUE on the
// threshold alone (38 >= 8), so calling it unconditionally would publish 38 dark-module
// pins. Beaches stay live either way, which is the hard constraint in exploreCategories.js.

// Extensions are explicit so plain Node (scripts/validate-map-sources.mjs) can import this
// module and exercise the real gate against the real constants. Metro resolves both forms.
import { MODULE_FLAGS } from './flags.js'
import { HEALTH_TYPES } from './facilityTypes.js'
import { parseIsOpen } from '../utils/facilityUtils.js'
import { typeColors, placeColors } from './theme.js'
import {
  EXPLORE_GROUPS, GROUP_ORDER, GROUP_META, LIVE_TILE_GROUPS,
  categoryToGroup, groupVisible,
} from './exploreCategories.js'

// Explore is REACHABLE — the outer gate App.js applies before rendering ExploreScreen.
export function exploreReachable(isAdmin) {
  return MODULE_FLAGS.explore || isAdmin
}

// The `places.category` allow-list to FETCH. Used to narrow the query server-side while
// explore is dark: the exemption list needs no row counts, so there is nothing circular
// about applying it before the fetch. When explore is reachable we cannot pre-narrow —
// groupVisible's threshold arm needs the counts the fetch itself produces — so we take
// every active row and gate in JS below.
export function mapFetchCategories(isAdmin) {
  if (exploreReachable(isAdmin)) return null   // null = no .in() filter, fetch all active
  return LIVE_TILE_GROUPS.flatMap(g => EXPLORE_GROUPS[g] || [])
}

function healthPins(facilities, dutyFacilityId) {
  return (facilities || [])
    .filter(f => HEALTH_TYPES.includes(f.type))
    // Moderation is defence-in-depth here; the RLS gate from 20260820 is the real one.
    .filter(f => (f.status === 'active' || f.status === 'trial') && !f.hidden_at)
    .filter(f => f.latitude != null && f.longitude != null)
    .map(f => ({
      id:    `health:${f.id}`,
      kind:  'health',
      row:   f,
      lat:   f.latitude,
      lng:   f.longitude,
      color:   (typeColors[f.type] || typeColors.clinic).text,
      colorBg: (typeColors[f.type] || typeColors.clinic).bg,
      // Duty pharmacy keeps its accent pin so the flagship feature survives the swap.
      // ⚠ THIS BRANCH CANNOT FIRE TODAY, AND THAT IS A DATA GAP, NOT A BUG: all 387
      //   pharmacies have NULL latitude/longitude, so no pharmacy ever reaches this
      //   .map() and dutyFacilityId can never match. It starts working the day the
      //   pharmacies are geocoded — do not read the dead branch as broken and delete it.
      //   (seed_pharmacies_geocoded.sql exists but is NOT the fix: its 387 rows carry
      //   only 142 distinct points, 28 of them stacked on one coordinate.)
      isDuty: dutyFacilityId != null && f.id === dutyFacilityId,
    }))
}

function placePins(places) {
  return (places || [])
    .filter(p => p.latitude != null && p.longitude != null)
    .map(p => {
      const group = categoryToGroup(p.category)
      return {
        id:    `place:${p.id}`,
        kind:  'place',
        row:   p,
        group,
        lat:   p.latitude,
        lng:   p.longitude,
        color:   (GROUP_META[group]?.colorToken || placeColors.landmark).text,
        colorBg: (GROUP_META[group]?.colorToken || placeColors.landmark).bg,
        isDuty: false,
      }
    })
    .filter(p => p.group != null)   // an unmapped category has no group, so no chip to own it
}

// Returns [{ key, labelKey, color, pins }] in render order: health types first (the app's
// core directory, ungated), then Explore groups in GROUP_ORDER.
//
// A source with ZERO pinnable rows is DROPPED, live or not. A chip that filters the map
// to nothing reads as broken — the same reasoning that puts a Coming Soon screen in front
// of an empty module instead of an empty list. Today that silently drops Pharmacy and
// Dentist (no geocoded rows) alongside Accommodation (88 rows, latitude NULL by privacy
// design in 20260904) and Events (no approved rows).
export function buildMapSources({ facilities, places, dutyFacilityId, isAdmin = false }) {
  const health = healthPins(facilities, dutyFacilityId)
  const sources = HEALTH_TYPES.map(type => ({
    key:      `health:${type}`,
    labelKey: type,
    color:    (typeColors[type] || typeColors.clinic).text,
    colorBg:  (typeColors[type] || typeColors.clinic).bg,
    pins:     health.filter(p => p.row.type === type),
  }))

  const placed  = placePins(places)
  const byGroup = placed.reduce((acc, p) => {
    ;(acc[p.group] = acc[p.group] || []).push(p)
    return acc
  }, {})

  const reachable = exploreReachable(isAdmin)
  for (const g of GROUP_ORDER) {
    const pins = byGroup[g] || []
    // ⚠ DO NOT "SIMPLIFY" THIS TO `groupVisible(g, pins.length, isAdmin)` ALONE.
    //   That looks like the correct move — reuse the real function instead of a copy —
    //   and it is WRONG, because groupVisible answers the INNER question only: "given
    //   that the user can reach Explore, does this group earn a tile?" It has no idea
    //   whether the user can reach Explore at all; ExploreScreen never has to ask,
    //   because App.js already answered it upstream (`MODULE_FLAGS.explore || isAdmin`).
    //   There is no upstream here. And the inner answer for heritage is TRUE on the row
    //   count alone — groupVisible('heritage', 38, false) === true, since 38 >= 8 — so
    //   the "simplification" silently publishes 38 pins of a module that is still dark,
    //   with the flag still reading false and nothing on screen to say otherwise.
    //   scripts/validate-map-sources.mjs fails on exactly this edit. Keep both arms.
    //
    // The count fed to groupVisible is the PINNABLE count, not the tile grid's RPC count
    // (active incl. hidden). The map can only ever draw rows that have coordinates, so a
    // group counted on rows it cannot plot would earn a chip that filters to nothing.
    const visible = reachable ? groupVisible(g, pins.length, isAdmin) : LIVE_TILE_GROUPS.includes(g)
    if (!visible) continue
    sources.push({
      key:      `explore:${g}`,
      labelKey: GROUP_META[g]?.labelKey,
      color:    (GROUP_META[g]?.colorToken || placeColors.landmark).text,
      colorBg:  (GROUP_META[g]?.colorToken || placeColors.landmark).bg,
      pins,
    })
  }

  return sources.filter(s => s.pins.length > 0)
}

// ─── USER FILTERS ────────────────────────────────────────────────────────────
//
// Everything above this line is the GATE: it decides what a user is ALLOWED to see, and
// getting it wrong leaks a dark module. Everything below is PRESENTATION: it decides what
// the user has ASKED to see out of that allowed set. The two must never be conflated —
// a presentation helper that can widen the set is a gate bug wearing a filter's clothes.

// The pins for the current chip selection. An empty (or absent) selection is "All", and
// "All" means THE UNION OF THE VISIBLE SOURCES — never "skip filtering".
//
// That distinction is the whole ballgame. `sources` is the gated output of
// buildMapSources(); a default path that instead reached past it for "every pin we
// fetched" would look identical on screen today and would republish every dark-module row
// the moment one exists. The gate must sit on the DEFAULT path, not only on the
// explicitly-filtered one — the default is the path almost every user takes.
export function selectedPins(sources, selectedKeys) {
  const active = (!selectedKeys || selectedKeys.size === 0)
    ? sources
    : sources.filter(s => selectedKeys.has(s.key))
  return active.flatMap(s => s.pins)
}

// Should the "Open now" chip render at all?
//
// ⚠ THIS IS FALSE FOR THE ENTIRE LIVE DATABASE TODAY, AND THAT IS THE POINT. 393 of 394
//   facilities have opening_hours NULL, and the one that does not holds JSON text written
//   by HoursPicker, which parseIsOpen (a legacy "Mon-Fri 09:00-18:00" parser) cannot read.
//   So parseIsOpen returns null for every facility that exists, and an Open-now chip would
//   filter the map to zero pins every single time it was tapped.
//
//   Rendering it anyway is the dead-chip failure: the user reads an empty map as a broken
//   app rather than as missing data. So the chip is carried, correct, and hidden until
//   at least one facility has hours that actually parse. Do not delete this as unused.
//
//   (The same silence affects the SHIPPED HomeScreen and MapScreen "Open now" filters,
//   which call parseIsOpen unguarded. Pre-existing, out of scope here, logged.)
export function openNowApplicable(pins) {
  return pins.some(p => p.kind === 'health' && parseIsOpen(p.row.opening_hours) !== null)
}

// Open-now is structurally HEALTH-ONLY: BROWSE_COLS does not select opening_hours, so a
// place pin carries no hours to test. That is deliberate and must stay that way — widening
// or narrowing that select on a whim is precisely how photo attribution silently broke.
//
// Non-health pins pass through UNFILTERED rather than being hidden. A beach has no opening
// hours to be open or closed against; dropping it would turn a modifier into a mode and
// leave the user staring at an empty map wondering which chip did it.
export function applyOpenNow(pins, on) {
  if (!on) return pins
  return pins.filter(p => p.kind !== 'health' || parseIsOpen(p.row.opening_hours) === true)
}
