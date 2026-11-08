// "Yakınımda şimdi" on the Keşfet map (stage 3, 2026-11-07): the nearest things worth going to RIGHT
// NOW, mixed — open eateries, today's events, places not known to be closed, the duty pharmacy. Pure,
// so scripts/test-near-now.mjs can import it in Node.
import { pinOpenNow } from './mapSources.js'
import { eventsInRange } from './mapEvents.js'

export const NEAR_NOW_KM = 15
export const NEAR_NOW_MAX = 10
const PER_KIND = 3   // variety: ten museums in Lefkoşa must not push the open café and tonight's show off

const R = 6371
const rad = d => (d * Math.PI) / 180
export function km(a, b) {
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// → [{ key, kind: 'eatery'|'event'|'place'|'duty', km, open, pin?, event? }], nearest first.
export function nearNow({ pins = [], events = [], pos, now = new Date(), dutyWindows = null }) {
  if (!pos) return []
  const out = []
  for (const p of pins) {
    const d = km(pos, { latitude: p.lat, longitude: p.lng })
    if (d > NEAR_NOW_KM) continue
    if (p.kind === 'health') {
      if (p.isDuty) out.push({ key: p.id, kind: 'duty', km: d, open: true, pin: p })
      continue
    }
    const open = pinOpenNow(p, dutyWindows, now)
    if (p.kind === 'eatery') { if (open === true) out.push({ key: p.id, kind: 'eatery', km: d, open: true, pin: p }); continue }
    if (p.kind === 'place' && open !== false) out.push({ key: p.id, kind: 'place', km: d, open, pin: p })
  }
  for (const e of eventsInRange(events, 'today', now)) {
    const d = km(pos, e)
    if (d <= NEAR_NOW_KM) out.push({ key: `event:${e.id}`, kind: 'event', km: d, open: null, event: e })
  }
  out.sort((a, b) => a.km - b.km)
  const taken = {}
  return out.filter(x => (taken[x.kind] = (taken[x.kind] || 0) + 1) <= (x.kind === 'duty' ? 1 : PER_KIND))
    .slice(0, NEAR_NOW_MAX)
}
