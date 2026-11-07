// "Yakınımda şimdi" (constants/nearNow.js): what counts as near and open right now, and the mix.
import { nearNow, km } from '../constants/nearNow.js'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const pos = { latitude: 35.19, longitude: 33.36 }            // Lefkoşa
const wedNoon = new Date('2026-07-15T09:00:00Z')               // Wed 12:00 Cyprus, EEMD in season
const daily = Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d => [d, { open: '11:00', close: '23:00' }]))
const at = (dLat, dLng) => ({ lat: pos.latitude + dLat, lng: pos.longitude + dLng })
const eatery = (id, h, o = [0.01, 0]) => ({ id, kind: 'eatery', ...at(...o), row: { opening_hours: h } })
const place = (id, ov = null, o = [0.02, 0]) => ({ id, kind: 'place', ...at(...o), row: { official_visit: ov } })
const SUMMER = { from: '04-01', to: '10-31', open: '08:00', close: '19:00', weekends: true }
const pins = [
  eatery('eat-open', daily),
  eatery('eat-closed', { wed: { open: '18:00', close: '23:00' } }),
  place('museum-open', { status: 'open', hours: SUMMER }),
  place('museum-closed', { status: 'closed', hours: null }),
  place('beach'),                                   // no hours: unknown, still worth going
  place('far', null, [0.5, 0]),                     // ~55 km
  { id: 'duty', kind: 'health', isDuty: true, ...at(0.03, 0), row: {} },
  { id: 'clinic', kind: 'health', isDuty: false, ...at(0.001, 0), row: {} },
]
const events = [{ id: 'tonight', start_date: '2026-07-15T20:00:00+03:00', end_date: null, latitude: 35.20, longitude: 33.36, category: 'music' }]
const keys = nearNow({ pins, events, pos, now: wedNoon }).map(x => x.key)
check('open eatery, open museum, beach, duty, tonight; no closed, no far, no plain clinic',
  [...keys].sort(), ['beach', 'duty', 'eat-open', 'event:tonight', 'museum-open'].sort())
check('nearest first', nearNow({ pins, events, pos, now: wedNoon })[0].key, 'eat-open')
check('no position → nothing (the sheet asks for location instead)', nearNow({ pins, events, pos: null }), [])
const many = Array.from({ length: 8 }, (_, i) => place(`m${i}`, null, [0.001 * (i + 1), 0]))
const mixed = nearNow({ pins: [...many, eatery('eat-open', daily, [0.05, 0])], events: [], pos, now: wedNoon })
check('at most 3 of a kind, so the open café still makes the list', [mixed.filter(x => x.kind === 'place').length, mixed.some(x => x.kind === 'eatery')], [3, true])
check('km: Lefkoşa → Girne ≈ 18 km', Math.round(km(pos, { latitude: 35.34, longitude: 33.32 })), 17)

if (fails) { console.error(`\n${fails} failing`); process.exit(1) }
console.log('\nall passing')
