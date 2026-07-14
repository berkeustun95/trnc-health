// Extensions are explicit here (the rest of the app omits them) so that plain
// Node can import this module and scripts/validate-regions.mjs can exercise the
// real resolver instead of a copy of it. Metro resolves both forms.
import { haversineKm } from './facilityUtils.js'
import { ANCHORS, TRNC_OUTLINE, MAX_ANCHOR_KM } from '../constants/regions.js'

// Ray casting. Counts crossings of the ring by a ray heading east from the
// point; odd => inside. Ring is [lat, lng] and treated as planar, which is fine
// at this latitude over an island ~150 km across.
function pointInPolygon(lat, lng, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i]
    const [latJ, lngJ] = ring[j]
    const straddles = (latI > lat) !== (latJ > lat)
    if (!straddles) continue
    const lngAtLat = lngI + ((lat - latI) / (latJ - latI)) * (lngJ - lngI)
    if (lng < lngAtLat) inside = !inside
  }
  return inside
}

// Coordinate -> canonical TRNC region slug, or null when we can't say.
//
// Two stages, and both are needed:
//   1. Gate on the TRNC outline. Outside it => null. This is what keeps Larnaca,
//      Ayia Napa, Athienou and the whole Republic from resolving to a TRNC
//      region just because a TRNC town happens to be the closest anchor.
//   2. Nearest anchor wins. Anchors are real towns from our geocoded pharmacy
//      data, so district shape comes out of the data instead of a hand-drawn
//      boundary.
//
// Pure, offline, no network. Tolerates the 2 dp (~1.1 km) coarsening in
// `coarseCoord` — no boundary here is decided at finer than ~2 km, except at
// Nicosia, where north and south are physically inseparable at this precision
// (see constants/regions.js).
export function resolveRegion(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (!pointInPolygon(lat, lng, TRNC_OUTLINE)) return null

  let best = null
  let bestKm = Infinity
  for (const [aLat, aLng, region] of ANCHORS) {
    const km = haversineKm(lat, lng, aLat, aLng)
    if (km < bestKm) {
      bestKm = km
      best = region
    }
  }
  return bestKm <= MAX_ANCHOR_KM ? best : null
}

export { pointInPolygon }
