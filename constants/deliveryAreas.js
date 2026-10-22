// Delivery address helpers over the bundled area list (constants/areas.js + the generated areaPoints.js): offline and pure.
// No network and no reverse geocoder of any kind. Explicit .js extensions so plain Node can run the tests.
import { AREAS_BY_REGION, areaSlug } from './areas.js'
import { AREA_POINTS } from './areaPoints.js'
import { resolveRegion } from '../utils/resolveRegion.js'
import { haversineKm } from '../utils/facilityUtils.js'

export const NEAREST_AREA_MAX_KM = 2

const FOLD = { 'ı': 'i', 'İ': 'i', 'I': 'i', 'ş': 's', 'Ş': 's', 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ö': 'o', 'Ö': 'o', 'ü': 'u', 'Ü': 'u' }
const fold = v => String(v ?? '').replace(/[ıİIşŞçÇğĞöÖüÜ]/g, c => FOLD[c]).toLowerCase().replace(/\s+/g, ' ').trim()

// Every area that has a point: { name, region, lat, lng } (areas without an OSM point cannot be pinned, so they are not offered).
const AREA_LIST = Object.entries(AREAS_BY_REGION).flatMap(([region, names]) =>
  names.map(name => ({ name, region, pt: AREA_POINTS[region]?.[areaSlug(name)] }))
    .filter(a => Array.isArray(a.pt))
    .map(a => ({ name: a.name, region, lat: a.pt[0], lng: a.pt[1] })))

// The display name of the nearest area within NEAREST_AREA_MAX_KM of the pin, else ''. A pin outside the TRNC gives ''.
export function nearestArea(lat, lng) {
  if (resolveRegion(lat, lng) == null) return ''
  let best = '', bestKm = Infinity
  for (const a of AREA_LIST) {
    const km = haversineKm(lat, lng, a.lat, a.lng)
    if (km < bestKm) { bestKm = km; best = a.name }
  }
  return bestKm <= NEAREST_AREA_MAX_KM ? best : ''
}

// Turkish-insensitive substring search ("gonyeli" finds Gönyeli); names that start with the query come first.
export function searchAreas(query) {
  const q = fold(query)
  if (!q) return []
  return AREA_LIST
    .map(a => ({ a, f: fold(a.name) }))
    .filter(x => x.f.includes(q))
    .sort((x, y) => (y.f.startsWith(q) - x.f.startsWith(q)) || x.a.name.localeCompare(y.a.name, 'tr'))
    .map(x => ({ ...x.a }))
}
