import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'
import { AREA_POINTS } from '../constants/areaPoints.js'

// A hotel's areas.js area, for the Oteller "Bölge" filter. Always WITHIN the hotel's region
// (Boğaz exists in both Girne and İskele, 40 km apart).
//   1. KITOB's village (hotels.address). Hyphens ignored: "Yeni Erenköy" = "Yenierenköy".
//   2. No village (KITOB left 43 blank) → the area whose OSM village point is nearest the pin,
//      i.e. the area the pin falls in. Recomputed on every render, so a moved pin moves it.
// No village and no pin → null: the hotel shows under its district and in the full list.
const AREA_ALIASES = { bellapais: 'beylerbeyi' }
const flat = n => areaSlug(n).replace(/-/g, '')

export function hotelArea(hotel) {
  const names = AREAS_BY_REGION[hotel.region] || []
  if (hotel.address) {
    const key = flat(hotel.address)
    const want = AREA_ALIASES[key] || key
    const name = names.find(n => flat(n) === want)
    if (name) return { value: `${hotel.region}/${areaSlug(name)}`, name, from: 'village' }
  }
  if (hotel.lat == null || hotel.lng == null) return null
  const points = AREA_POINTS[hotel.region] || {}
  const k = Math.cos(hotel.lat * Math.PI / 180)
  let best = null, bestD = Infinity
  for (const [slug, [lat, lng]] of Object.entries(points)) {
    const d = (lat - hotel.lat) ** 2 + ((lng - hotel.lng) * k) ** 2
    if (d < bestD) { bestD = d; best = slug }
  }
  const name = best && names.find(n => areaSlug(n) === best)
  return name ? { value: `${hotel.region}/${best}`, name, from: 'pin', km: Math.sqrt(bestD) * 111.2 } : null
}
