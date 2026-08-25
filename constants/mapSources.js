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
    // The count fed to groupVisible is the PINNABLE count, not the tile grid's RPC count
    // (active incl. hidden). The map can only ever draw rows that have coordinates, so a
    // group counted on rows it cannot plot would earn a chip that filters to nothing.
    const visible = reachable ? groupVisible(g, pins.length, isAdmin) : LIVE_TILE_GROUPS.includes(g)
    if (!visible) continue
    sources.push({
      key:      `explore:${g}`,
      labelKey: GROUP_META[g]?.labelKey,
      color:    (GROUP_META[g]?.colorToken || placeColors.landmark).text,
      pins,
    })
  }

  return sources.filter(s => s.pins.length > 0)
}
