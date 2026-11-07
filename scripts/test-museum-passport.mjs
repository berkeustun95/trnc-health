// Müze Pasaportu (constants/museumPassport.js): stamps, progress, medal tiers, order.
import { passportState, passportOrder } from '../constants/museumPassport.js'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const sites = Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, name: `Site ${String(i).padStart(2, '0')}` }))
const ci = (id, at) => ({ place_id: id, created_at: at })

const none = passportState(sites, [])
check('empty: 0 / 33, no medal, next goal 5', [none.count, none.total, none.medals.map(m => m.earned), none.next], [0, 33, [false, false, false], 5])

const six = passportState(sites, [
  ...['s1', 's2', 's3', 's4', 's5', 's6'].map(id => ci(id, '2026-11-01T10:00:00Z')),
  ci('s1', '2026-10-01T10:00:00Z'),          // an earlier visit to the same site: one stamp, earliest date
  ci('not-eemd', '2026-11-01T10:00:00Z'),    // a beach check-in is not a passport stamp
  ci(null, '2026-11-01T10:00:00Z'),          // a Google-place check-in has no place_id
])
check('6 distinct EEMD sites: 5 earned, 10 not, next 10', [six.count, six.medals.map(m => m.earned), six.next], [6, [true, false, false], 10])
check('repeat visits keep the FIRST date', six.stamps.get('s1'), '2026-10-01T10:00:00Z')
check('medal keys', six.medals.map(m => m.key), ['5', '10', 'all'])

const all = passportState(sites, sites.map(s => ci(s.id, '2026-11-02T10:00:00Z')))
check('every site: all three medals, no next goal', [all.medals.every(m => m.earned), all.next], [true, null])

const few = passportState(sites.slice(0, 7), [])
check('fewer than 10 sites: tiers 5 + all (no unreachable 10)', few.medals.map(m => m.need), [5, 7])

const order = passportOrder(sites.slice(0, 4), new Map([['s3', '2026-10-02'], ['s1', '2026-10-01']]), s => s.name).map(s => s.id)
check('stamped first in collection order, then by name', order, ['s1', 's3', 's0', 's2'])

if (fails) { console.error(`\n${fails} failing`); process.exit(1) }
console.log('\nall passing')
