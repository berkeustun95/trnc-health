// Keşfet map events mode (constants/mapEvents.js): windows, pinnability, venue grouping.
import { eventsInRange, venueGroups, eventIcon, MAP_EVENT_RANGES, DEFAULT_EVENT_RANGE } from '../constants/mapEvents.js'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// Wednesday 2026-11-11 12:00 Cyprus (UTC+2).
const now = new Date('2026-11-11T10:00:00Z')
const ev = (id, start, extra = {}) => ({ id, start_date: start, end_date: null, latitude: 35.19, longitude: 33.36, category: 'music', ...extra })
const rows = [
  ev('today', '2026-11-11T18:00:00+02:00'),
  ev('sat', '2026-11-14T20:00:00+02:00', { latitude: 35.34, longitude: 33.32 }),
  ev('sun', '2026-11-15T11:00:00+02:00', { latitude: 35.340001, longitude: 33.320001 }),
  ev('next-mon', '2026-11-16T20:00:00+02:00'),
  ev('nocoords', '2026-11-11T19:00:00+02:00', { latitude: null, longitude: null }),
  ev('over', '2026-11-10T18:00:00+02:00', { end_date: '2026-11-10T21:00:00+02:00' }),
  ev('running', '2026-11-01T10:00:00+02:00', { end_date: '2026-11-20T22:00:00+02:00', category: 'arts' }),
]
const ids = k => eventsInRange(rows, k, now).map(e => e.id)
check('today: tonight + a running festival, no coordless, no finished', ids('today'), ['running', 'today'])
check('weekend: Sat + Sun + running', ids('weekend'), ['running', 'sat', 'sun'])
check('week: Wed → Sun, not next Monday', ids('week'), ['running', 'today', 'sat', 'sun'])
check('default window is the week', DEFAULT_EVENT_RANGE, 'week')
check('ranges in chip order', MAP_EVENT_RANGES.map(r => r.key), ['today', 'weekend', 'week'])
const v = venueGroups(eventsInRange(rows, 'week', now))
check('one marker per venue (Sat + Sun share a hall)', v.map(x => x.events.map(e => e.id)), [['running', 'today'], ['sat', 'sun']])
check('icons: music, legacy festival, unknown', [eventIcon('music'), eventIcon('festival'), eventIcon('x')], ['musical-notes', 'musical-notes', 'calendar'])

if (fails) { console.error(`\n${fails} failing`); process.exit(1) }
console.log('\nall passing')
