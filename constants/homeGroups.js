// ─── "Tüm hizmetler": the redesigned Home's four service panels ─────────────
//
// Every LIVE module appears in exactly one panel. Liveness is DERIVED from the flags, never
// listed here, so a module that goes live (or dark) moves on or off Home in the same commit
// as its flag and cannot be forgotten. The __DEV__ check at the bottom logs any live
// module that no panel places — that list is computed, not remembered.
//
// COMING SOON (Slice 1 revision, Berke 2026-09-30): jobs, transport, insurance and eSIM show
// in their groups with a "Yakında" badge and open their existing Coming Soon / waitlist
// screens — that is how a dark module collects demand ("the towing lesson",
// constants/homeModules.js). Hotels shows while HOTELS_LIVE; grooming and garages stay
// hidden (HIDDEN_TILES), and since 2026-10-10 so do jobs, transport, insurance, games and eSIM.
// A module that goes live loses its badge automatically.
import { MODULE_FLAGS, HOTELS_LIVE, CONNECTIVITY_LIVE, EXPLORE_ROUTES_LIVE, LIVE_SCORES_LIVE } from './flags'
import { HOME_MODULES, HIDDEN_TILES } from './homeModules'

// Tiles that are not HOME_MODULES entries: the duty list, the Keşfet tab, walking routes
// and live scores have no grid tile in V2 (so the pre-redesign ModuleGrid, which
// deliberately shows dark modules, never shows these flag-hidden ones).
const EXTRA = {
  duty:          { id: 'duty',          icon: 'medkit-outline',     labelKey: 'hrTileDuty' },
  exploreTab:    { id: 'exploreTab',    icon: 'compass-outline',    labelKey: 'menuExplore' },
  walkingRoutes: { id: 'walkingRoutes', icon: 'walk-outline',       labelKey: 'hrTileRoutes' },
  liveScores:    { id: 'liveScores',    icon: 'football-outline',   labelKey: 'menuLiveScores' },
}

// id → the gate that decides whether it is live. Anything absent here is ungated.
const GATES = {
  jobPostings:   () => MODULE_FLAGS.jobs !== false,
  transport:     () => MODULE_FLAGS.transport !== false,
  insurance:     () => MODULE_FLAGS.insurance !== false,
  grooming:      () => MODULE_FLAGS.grooming !== false,
  garages:       () => MODULE_FLAGS.garages !== false,
  events:        () => MODULE_FLAGS.events !== false,
  accommodation: () => MODULE_FLAGS.accommodation !== false,
  homeServices:  () => MODULE_FLAGS.homeServices !== false,
  pets:          () => MODULE_FLAGS.pets !== false,
  studentHub:    () => MODULE_FLAGS.studentHub !== false,
  towing:        () => MODULE_FLAGS.towing !== false,
  hotels:        () => HOTELS_LIVE === true,
  liveScores:    () => LIVE_SCORES_LIVE === true,
  // eSIM is the face of Connectivity: while CONNECTIVITY_LIVE is false it only shows the
  // waitlist screen, and the brief says hidden connectivity must not show.
  esim:          () => CONNECTIVITY_LIVE === true,
  walkingRoutes: () => EXPLORE_ROUTES_LIVE === true,
  // `explore` (the directory tile) stays hidden: HIDDEN_TILES says the Keşfet tab covers
  // it, and the Keşfet tile below opens that tab.
  explore:       () => false,
}

const COMING_SOON = new Set(['jobPostings', 'transport', 'insurance', 'esim'])

// A hidden tile is not live, so without the HIDDEN_TILES check it would come back as "Yakında".
export function isComingSoon(id, unlocked) {
  return COMING_SOON.has(id) && !HIDDEN_TILES.has(id) && !isLive(id, unlocked)
}

// `unlocked`: module ids this USER may see while their flag is still false — today only
// liveScores for a score editor (live_score_editors, asked of the database by App.js), so
// Berke can test it on a production build. Everyone else passes nothing and sees the flag.
export function isLive(id, unlocked) {
  if (unlocked?.has(id)) return true
  if (HIDDEN_TILES.has(id) && id !== 'explore') return false
  const gate = GATES[id]
  return gate ? gate() : true
}

// Order inside a panel is the order here. Placements marked (★) are Slice 1 decisions
// reported at the gate rather than taken from the brief.
export const HOME_GROUPS = [
  { key: 'health',   titleKey: 'hrGroupHealth',  ids: ['duty', 'health', 'emergency'] },
  { key: 'explore',  titleKey: 'hrGroupExplore', ids: ['exploreTab', 'events', 'liveScores', 'walkingRoutes', 'hotels', 'games'] },
  { key: 'homeLife', titleKey: 'hrGroupHome',    ids: ['accommodation', 'homeServices', 'pets', 'insurance',
                                                        'studentHub' /* ★ */] },
  { key: 'city',     titleKey: 'hrGroupCity',    ids: ['transport', 'esim', 'municipal',
                                                        'towing' /* ★ */, 'exchangeRates' /* ★ */,
                                                        'newcomerEssentials' /* ★ */, 'jobPostings'] },
]

const BY_ID = new Map([...HOME_MODULES.map(m => [m.id, m]), ...Object.values(EXTRA).map(m => [m.id, m])])

export function moduleById(id) { return BY_ID.get(id) }

// The category a module belongs to — its colour everywhere (favourites, search results).
const CATEGORY_OF = new Map(HOME_GROUPS.flatMap(g => g.ids.map(id => [id, g.key])))
export function categoryOf(id) { return CATEGORY_OF.get(id) || 'city' }

export function liveGroups(unlocked) {
  return HOME_GROUPS
    .map(g => ({
      ...g,
      modules: g.ids
        .filter(id => isLive(id, unlocked) || isComingSoon(id, unlocked))
        .map(id => BY_ID.get(id) && { ...BY_ID.get(id), soon: isComingSoon(id, unlocked) })
        .filter(Boolean),
    }))
    .filter(g => g.modules.length > 0)
}

// Live modules no panel places. Logged once in __DEV__ and read at the gate.
export function unplacedLiveModules() {
  const placed = new Set(HOME_GROUPS.flatMap(g => g.ids))
  return HOME_MODULES.map(m => m.id).filter(id => isLive(id) && !placed.has(id))
}

// Placed twice is as wrong as not placed: two tiles, one module, two colours.
export function duplicatePlacements() {
  const seen = new Set(), dup = []
  for (const id of HOME_GROUPS.flatMap(g => g.ids)) { if (seen.has(id)) dup.push(id); seen.add(id) }
  return dup
}
