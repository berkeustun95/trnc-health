// EEMD visiting info (utils/officialVisit.js): season window, closed sites, Sunday note.
//   node scripts/test-official-visit.mjs
import { officialVisitView, cyprusDate } from '../utils/officialVisit.js'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}

const SUMMER = { from: '04-01', to: '10-31', open: '08:00', close: '19:00', last_entry: '18:00', weekends: true }
const open    = { status: 'open', fee: { full: 150, student: 50 }, hours: SUMMER, source_url: 'https://eemd.gov.ct.tr/x', updated: '2026-10' }
const weekday = { ...open, hours: { ...SUMMER, weekends: false } }
const closed  = { status: 'closed', fee: null, hours: null, source_url: 'https://eemd.gov.ct.tr/y', updated: '2026-10' }
const linkOnly = { status: 'open', fee: null, hours: null, source_url: 'https://eemd.gov.ct.tr/z', updated: '2026-10' }

// The window is Cyprus-dated: 2026-10-31 21:30 UTC is already 1 November in Nicosia (EET, +02:00).
t('Cyprus date crosses midnight before UTC', cyprusDate(new Date('2026-10-31T22:30:00Z')), '2026-11-01')
t('last day of season: hours shown', officialVisitView(open, new Date('2026-10-31T12:00:00Z')).hours, SUMMER)
t('first day after season: hours hidden', officialVisitView(open, new Date('2026-10-31T22:30:00Z')).hours, null)
t('next year, 1 April: shown again with no data change', officialVisitView(open, new Date('2027-04-01T09:00:00Z')).hours, SUMMER)
t('31 March: still hidden', officialVisitView(open, new Date('2027-03-31T09:00:00Z')).hours, null)
t('season start: shown', officialVisitView(open, new Date('2026-04-01T06:00:00Z')).hours, SUMMER)
t('fee survives the season end', officialVisitView(open, new Date('2026-12-01T09:00:00Z')).fee, { full: 150, student: 50 })
t('Sunday note on a weekend-open site, even out of season', officialVisitView(open, new Date('2026-12-01T09:00:00Z')).sundayFree, true)
t('no Sunday note on a weekday-only site', officialVisitView(weekday, new Date('2026-06-01T09:00:00Z')).sundayFree, false)
t('closed: no fee, no hours, no note', (({ closed, fee, hours, sundayFree }) => ({ closed, fee, hours, sundayFree }))(officialVisitView(closed, new Date('2026-06-01T09:00:00Z'))),
  { closed: true, fee: null, hours: null, sundayFree: false })
t('link-only site: no note, keeps link', (({ sundayFree, sourceUrl }) => ({ sundayFree, sourceUrl }))(officialVisitView(linkOnly)), { sundayFree: false, sourceUrl: 'https://eemd.gov.ct.tr/z' })
t('no data → null', officialVisitView(null), null)
t('malformed updated is dropped', officialVisitView({ ...open, updated: 'Ekim' }).updated, null)

if (bad) { console.error(`\n${bad} failing`); process.exit(1) }
console.log('\nall passing')
