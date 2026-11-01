// When events stop being listed (utils/eventVisibility.js) — shared by Etkinlikler and the Home strip.
//   node scripts/test-event-visibility.mjs
import { eventListedUntil, isEventOver, isEventOnNow, maybeListedFilter } from '../utils/eventVisibility.js'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}
const at = iso => new Date(iso)

// Cyprus is UTC+3 until 25 Oct 2026 04:00 local, UTC+2 after (EEST → EET).
const halloween = { start_date: '2026-10-31T17:00:00Z', end_date: null }           // 19:00 Cyprus, Sat 31 Oct
t('no end: cut-off is 06:00 Cyprus next morning (04:00Z in winter)', eventListedUntil(halloween).toISOString(), '2026-11-01T04:00:00.000Z')
t('no end: still listed at 23:30 Cyprus', isEventOver(halloween, at('2026-10-31T21:30:00Z')), false)
t('past midnight: still listed at 02:00 Cyprus, and on now', [isEventOver(halloween, at('2026-11-01T00:00:00Z')), isEventOnNow(halloween, at('2026-11-01T00:00:00Z'))], [false, true])
t('no end: gone at 06:00 Cyprus', isEventOver(halloween, at('2026-11-01T04:00:00Z')), true)
t('no end: gone at 15:30 Cyprus next day (the reported bug)', isEventOver(halloween, at('2026-11-01T13:30:00Z')), true)

// Cyprus vs UTC: 01:30 Cyprus on 1 Nov is still 31 Oct in UTC. The cut-off follows the CYPRUS date.
const afterMidnight = { start_date: '2026-10-31T23:30:00Z', end_date: null }        // 01:30 Cyprus, 1 Nov
t('Cyprus vs UTC: 01:30 Cyprus start runs to 06:00 on 2 Nov, not 1 Nov', eventListedUntil(afterMidnight).toISOString(), '2026-11-02T04:00:00.000Z')
const summer = { start_date: '2026-07-10T21:30:00Z', end_date: null }               // 00:30 Cyprus, 11 Jul (UTC says 10th)
t('Cyprus vs UTC in summer (+03:00): cut-off 03:00Z on 12 Jul', eventListedUntil(summer).toISOString(), '2026-07-12T03:00:00.000Z')
t('DST week: start before the switch, cut-off after it uses winter offset', eventListedUntil({ start_date: '2026-10-24T18:00:00Z' }).toISOString(), '2026-10-25T04:00:00.000Z')

// end_date set: listed until end_date, whatever the 06:00 rule says.
const lateParty = { start_date: '2026-10-31T19:00:00Z', end_date: '2026-11-01T03:00:00Z' }   // 21:00 → 05:00 Cyprus
t('end set past midnight: listed at 04:30 Cyprus', isEventOver(lateParty, at('2026-11-01T02:30:00Z')), false)
t('end set past midnight: gone at 05:00 Cyprus', isEventOver(lateParty, at('2026-11-01T03:00:00Z')), true)
const festival = { start_date: '2026-10-30T15:00:00Z', end_date: '2026-11-02T20:00:00Z' }
t('multi-day: on now on day 3 (old 24 h rule dropped it after day 1)', isEventOnNow(festival, at('2026-11-01T13:30:00Z')), true)
t('multi-day: gone after its end', isEventOver(festival, at('2026-11-02T20:00:01Z')), true)

// Upcoming vs on now.
const tomorrow = { start_date: '2026-11-02T17:00:00Z', end_date: null }
t('upcoming: not over, not on now', [isEventOver(tomorrow, at('2026-11-01T13:30:00Z')), isEventOnNow(tomorrow, at('2026-11-01T13:30:00Z'))], [false, false])

// Bad data never lists.
t('unreadable start, no end: over', isEventOver({ start_date: 'x' }), true)
t('unreadable end falls back to the 06:00 rule', eventListedUntil({ start_date: '2026-10-31T17:00:00Z', end_date: 'x' }).toISOString(), '2026-11-01T04:00:00.000Z')

// Server filter: wide enough for the client rule (30 h back for no-end rows).
t('server filter', maybeListedFilter(at('2026-11-01T13:30:00Z')),
  'end_date.gte.2026-11-01T13:30:00.000Z,and(end_date.is.null,start_date.gte.2026-10-31T07:30:00.000Z)')
const earliest = { start_date: '2026-10-31T22:00:00Z' }                                     // 00:00 Cyprus, 1 Nov
t('longest no-end listing is 30 h (00:00 start → 06:00 next day)', (eventListedUntil(earliest) - at(earliest.start_date)) / 3600000, 30)

if (bad) { console.error(`\n${bad} failing`); process.exit(1) }
console.log('\nall passing')
