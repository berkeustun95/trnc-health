// When events stop being listed (utils/eventVisibility.js) — shared by Etkinlikler and the Home strip.
//   node scripts/test-event-visibility.mjs
import { eventListedUntil, isEventOver, isEventOnNow, maybeListedFilter, isRunningFromEarlierDay, ongoingEndLabel, eventOverlaps, startsSoon } from '../utils/eventVisibility.js'

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

// Server filter: exact. 15:30 Cyprus on 1 Nov − 6 h = 1 Nov → no-end rows from 00:00 Cyprus 1 Nov (22:00Z 31 Oct).
t('server filter at 15:30 Cyprus', maybeListedFilter(at('2026-11-01T13:30:00Z')),
  'end_date.gte.2026-11-01T13:30:00.000Z,and(end_date.is.null,start_date.gte.2026-10-31T22:00:00.000Z)')
t('server filter at 03:00 Cyprus keeps last night (31 Oct 00:00 Cyprus)', maybeListedFilter(at('2026-11-01T01:00:00Z')),
  'end_date.gte.2026-11-01T01:00:00.000Z,and(end_date.is.null,start_date.gte.2026-10-30T22:00:00.000Z)')
const earliest = { start_date: '2026-10-31T22:00:00Z' }                                     // 00:00 Cyprus, 1 Nov
t('longest no-end listing is 30 h (00:00 start → 06:00 next day)', (eventListedUntil(earliest) - at(earliest.start_date)) / 3600000, 30)

// The server bound and the client rule must agree on EVERY no-end row: a row the server drops but the
// client would list is a missing event; the reverse fills a small limit with over rows (the review finding).
// Sweep: starts every 30 min over 4 days around the October DST switch, "now" every 30 min across the same span.
const sinceOf = now => new Date(maybeListedFilter(now).match(/start_date\.gte\.([^)]+)\)/)[1])
let disagree = 0, checked = 0
for (let n = Date.parse('2026-10-23T00:00:00Z'); n < Date.parse('2026-10-27T00:00:00Z'); n += 30 * 60000) {
  const now = new Date(n), since = sinceOf(now)
  for (let s = n - 3 * 24 * 3600000; s < n + 3600000; s += 30 * 60000) {
    const ev = { start_date: new Date(s).toISOString(), end_date: null }
    checked++
    if ((new Date(s) >= since) !== !isEventOver(ev, now)) disagree++
  }
}
t(`server bound == client rule for no-end rows (${checked} pairs, DST week)`, disagree, 0)
let disagreeMar = 0
for (let n = Date.parse('2027-03-26T00:00:00Z'); n < Date.parse('2027-03-30T00:00:00Z'); n += 30 * 60000) {
  const now = new Date(n), since = sinceOf(now)
  for (let s = n - 3 * 24 * 3600000; s < n + 3600000; s += 30 * 60000)
    if ((new Date(s) >= since) !== !isEventOver({ start_date: new Date(s).toISOString() }, now)) disagreeMar++
}
t('server bound == client rule, March DST week', disagreeMar, 0)


// ─── Running events: "Devam ediyor · <end date>" ────────────────────────────────────────────
const NOW = at('2026-11-01T13:30:00Z')                                                    // 15:30 Cyprus, Sun 1 Nov
t('running: started 30 Oct, ends 2 Nov → label', isRunningFromEarlierDay(festival, NOW), true)
t('running: started TODAY with an end → keeps its time', isRunningFromEarlierDay({ start_date: '2026-11-01T08:00:00Z', end_date: '2026-11-03T20:00:00Z' }, NOW), false)
t('running: no end_date (carried past midnight) → no label', isRunningFromEarlierDay({ start_date: '2026-10-31T21:00:00Z', end_date: null }, at('2026-11-01T01:00:00Z')), false)
t('running: already over → no label', isRunningFromEarlierDay(festival, at('2026-11-03T00:00:00Z')), false)
t('running: Cyprus vs UTC — 22:30Z 31 Oct is 00:30 Cyprus 1 Nov = today', isRunningFromEarlierDay({ start_date: '2026-10-31T22:30:00Z', end_date: '2026-11-05T20:00:00Z' }, NOW), false)
t('running: 21:30Z 31 Oct is 23:30 Cyprus 31 Oct = earlier day', isRunningFromEarlierDay({ start_date: '2026-10-31T21:30:00Z', end_date: '2026-11-05T20:00:00Z' }, NOW), true)
t('label en-GB: British order', ongoingEndLabel('2026-11-04T20:00:00Z', 'en-GB-u-ca-gregory', NOW), '4 November')
t('label tr', ongoingEndLabel('2026-11-04T20:00:00Z', 'tr-u-ca-gregory', NOW), '4 Kasım')
t('label: Cyprus calendar day (22:30Z 4 Nov = 5 Nov in Cyprus)', ongoingEndLabel('2026-11-04T22:30:00Z', 'en-GB-u-ca-gregory', NOW), '5 November')
t('label: year only when it differs', ongoingEndLabel('2027-01-10T20:00:00Z', 'en-GB-u-ca-gregory', NOW), '10 January 2027')
t('label fa: Gregorian, not Jalali', /نوامبر/.test(ongoingEndLabel('2026-11-04T20:00:00Z', 'fa-u-ca-gregory', NOW)), true)

// ─── "Bugün" and the other date filters: running events count ────────────────────────────────
const dayFrom = at('2026-10-31T22:00:00Z'), dayTo = at('2026-11-01T21:59:59.999Z')           // 1 Nov in Cyprus
t('Bugün: festival started 30 Oct, running today → in', eventOverlaps(festival, dayFrom, dayTo), true)
t('Bugün: starts tonight → in', eventOverlaps({ start_date: '2026-11-01T17:00:00Z' }, dayFrom, dayTo), true)
t('Bugün: starts tomorrow → out', eventOverlaps(tomorrow, dayFrom, dayTo), false)
t('Bugün: ended yesterday → out', eventOverlaps({ start_date: '2026-10-29T17:00:00Z', end_date: '2026-10-31T20:00:00Z' }, dayFrom, dayTo), false)
t('Bugün: last night, no end, listed until 06:00 today → in (still on after midnight)', eventOverlaps(halloween, dayFrom, dayTo), true)

// ─── Home strip "starting soon" ───────────────────────────────────────────────────────────────
t('soon: starts in 2 h', startsSoon({ start_date: '2026-11-01T15:30:00Z' }, NOW, 6), true)
t('soon: running already → NOT soon', startsSoon(festival, NOW, 6), false)
t('soon: starts in 8 h → not soon', startsSoon({ start_date: '2026-11-01T21:30:00Z' }, NOW, 6), false)

if (bad) { console.error(`\n${bad} failing`); process.exit(1) }
console.log('\nall passing')
