// ─── Island Calendar (Variant C of the dark Home experiment) — dated-day TABLE ──
//
// PURE DATA. No React, no expo imports: node scripts import this file
// (scripts/check-season-staleness.mjs).
//
// WHAT EACH KIND SHOWS (the app never names a national day — several are politically
// contested, and el-GR names no state — so only these three neutral kinds exist):
//   newYear        1 Jan                    -> a "Happy new year" greeting
//   publicHoliday  non-religious TRNC public holiday
//                                           -> "Public holiday"
//   bayram         each day of the Ramazan / Kurban Bayramı span
//                                           -> a neutral "Happy holidays" greeting,
//                                              no religious iconography
//   bayramEve      arefe, where it is an official half/full holiday
//                                           -> same neutral greeting as bayram
// When a public holiday falls on a bayram day (19 May 2027) the entry is `bayram`.
//
// DATES ARE A TABLE, NEVER COMPUTED. Lunar dates move; a formula would be wrong
// silently. Every entry is one real calendar day with its own source.
//
// `verified: false` = taken from a secondary or non-TRNC source and NOT yet checked
// against the official TRNC announcement. scripts/check-season-staleness.mjs fails
// while any exist; verify them all before HOME_CALENDAR_LIVE goes true.
//
// HOW TO EXTEND: add entries in date order (one per day), raise CALENDAR_VALID_THROUGH,
// set CALENDAR_CHECKED to the day you checked, run
//   node scripts/check-season-staleness.mjs      (and --self after changing the checker)
// Lunar dates: Diyanet dini günler takvimi, then the TRNC government announcement
// (TRNC spans/arife can differ from Turkey's). Never guess a day: leave it out.

export const CALENDAR_VALID_THROUGH = '2027-12-31'
export const CALENDAR_CHECKED = '2026-10-14'
export const KINDS = ['newYear', 'publicHoliday', 'bayram', 'bayramEve']

const LAW = 'KKTC Bayram ve Tatil Günleri Yasası (fixed national dates; gov.ct.tr unreachable from build server, cross-listed at https://en.wikipedia.org/wiki/Public_holidays_in_Northern_Cyprus)'
const DIY27 = 'Diyanet dini günler 2027 https://vakithesaplama.diyanet.gov.tr/icerik.php?icerik=154 (Turkey list; TRNC span/arife not confirmed)'

export const ISLAND_DAYS = [
  { date: '2026-10-29', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2026-11-15', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-01-01', kind: 'newYear',       source: LAW, verified: false },
  { date: '2027-03-08', kind: 'bayramEve',     source: DIY27 + ' arefe', verified: false },
  { date: '2027-03-09', kind: 'bayram',        source: DIY27 + ' Ramazan Bayramı day 1', verified: false },
  { date: '2027-03-10', kind: 'bayram',        source: DIY27 + ' Ramazan Bayramı day 2', verified: false },
  { date: '2027-03-11', kind: 'bayram',        source: DIY27 + ' Ramazan Bayramı day 3', verified: false },
  { date: '2027-04-23', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-05-01', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-05-15', kind: 'bayramEve',     source: DIY27 + ' arefe', verified: false },
  { date: '2027-05-16', kind: 'bayram',        source: DIY27 + ' Kurban Bayramı day 1', verified: false },
  { date: '2027-05-17', kind: 'bayram',        source: DIY27 + ' Kurban Bayramı day 2', verified: false },
  { date: '2027-05-18', kind: 'bayram',        source: DIY27 + ' Kurban Bayramı day 3', verified: false },
  { date: '2027-05-19', kind: 'bayram',        source: DIY27 + ' Kurban Bayramı day 4 (also 19 May public holiday: ' + 'bayram wins)', verified: false },
  { date: '2027-07-20', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-08-01', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-08-30', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-10-29', kind: 'publicHoliday', source: LAW, verified: false },
  { date: '2027-11-15', kind: 'publicHoliday', source: LAW, verified: false },
]

/** The table entry for 'YYYY-MM-DD', or null (an ordinary day). */
export function islandDayFor(dateStr) {
  return ISLAND_DAYS.find(d => d.date === dateStr) || null
}
