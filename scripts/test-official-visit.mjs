// EEMD visiting info (utils/officialVisit.js): season window, closed sites, Sunday note; and the
// Keşfet map's "Müze & Ören Yeri" chip (constants/mapSources.js).
//   node scripts/test-official-visit.mjs
import { officialVisitView, cyprusDate, officialFeeText } from '../utils/officialVisit.js'
import { buildMapSources, selectedPins, officialVisitApplicable, applyOfficialVisit, applyOpenNow } from '../constants/mapSources.js'

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

// Fee line: one wording for the place page and the map pin sheet.
const tr = k => ({ ovFree: 'Ücretsiz', ovFee: 'Tam {full} TL · Öğrenci {student} TL' })[k]
t('fee line', officialFeeText({ full: 150, student: 50 }, tr), 'Tam 150 TL · Öğrenci 50 TL')
t('free site', officialFeeText({ full: 0, student: 0 }, tr), 'Ücretsiz')
t('no fee → no line', officialFeeText(null, tr), null)

// ─── Map chip ───────────────────────────────────────────────────────────────
const place = (id, category, official_visit = null) => ({ id, category, latitude: 35.3, longitude: 33.3, official_visit })
const heritage = [
  place('bellapais', 'religious_site', open), place('othello', 'castle_fortress', closed),
  place('salamis', 'ancient_ruins', linkOnly),
  ...Array.from({ length: 6 }, (_, i) => place(`mon${i}`, 'monument')),          // heritage, no EEMD data
]
const PLACES = [...heritage, place('beach', 'beach')]
const FAC = [{ id: 'f1', type: 'pharmacy', status: 'active', provider_id: 'p', latitude: 35.2, longitude: 33.4 }]
const opts = { facilities: FAC, places: PLACES, dutyFacilityId: null, petHotelLive: false, eateryLive: false }
const ids = pins => pins.map(p => p.id).sort()
const live = buildMapSources({ ...opts, exploreLive: true })
const all = selectedPins(live, new Set())

t('chip off: map unchanged', applyOfficialVisit(all, false).length, all.length)
t('chip on: only places with official_visit (open, closed, link-only)', ids(applyOfficialVisit(all, true)),
  ['place:bellapais', 'place:othello', 'place:salamis'])
t('chip on: drops beaches, plain heritage and health pins',
  applyOfficialVisit(all, true).some(p => p.kind !== 'place' || p.row.category === 'beach' || p.row.category === 'monument'), false)
t('chip on + a Kategori pick: intersects, never widens', ids(applyOfficialVisit(selectedPins(live, new Set(['explore:nature'])), true)), [])
t('chip renders when a visible pin has EEMD data', officialVisitApplicable(all), true)
t('no EEMD data anywhere → no chip (never a dead chip)', officialVisitApplicable(selectedPins(buildMapSources({ ...opts, exploreLive: true,
  places: PLACES.map(p => ({ ...p, official_visit: null })) }), new Set())), false)
// The gate: with Explore dark only nature is live, so the heritage EEMD sites are not pins
// and the chip cannot appear (it reads the GATED pins, not the fetched rows).
const dark = selectedPins(buildMapSources({ ...opts, exploreLive: false }), new Set())
t('Explore dark: no EEMD pin, no chip', [applyOfficialVisit(dark, true).length, officialVisitApplicable(dark)], [0, false])
t('with Open now on as well: still only EEMD sites', ids(applyOfficialVisit(applyOpenNow(all, true), true)),
  ['place:bellapais', 'place:othello', 'place:salamis'])

if (bad) { console.error(`\n${bad} failing`); process.exit(1) }
console.log('\nall passing')
