#!/usr/bin/env node
// ─── Island Calendar table: staleness + shape + verification ────────────────
//   node scripts/check-season-staleness.mjs          real table (exit 1 = problems)
//   node scripts/check-season-staleness.mjs --self   red-first: bad fixtures must each FAIL
// Hand/cron, not pre-push. Reads constants/islandCalendar.js (dated TABLE, never computed).
import { CALENDAR_VALID_THROUGH, CALENDAR_CHECKED, ISLAND_DAYS, KINDS } from '../constants/islandCalendar.js'

const FLOOR = '2026-01-01'
const MIN_DAYS_LEFT = 60
const DAY = 86400000
const parse = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d
}

// Pure: returns { problems, unverified }. `today` injected so the boundary is testable.
export function validate(entries, validThrough, today) {
  const problems = [], unverified = []
  const vt = parse(validThrough)
  if (!vt) problems.push(`CALENDAR_VALID_THROUGH ${JSON.stringify(validThrough)} is not a real YYYY-MM-DD date`)
  else {
    const left = Math.floor((vt - today) / DAY)
    if (left < MIN_DAYS_LEFT) problems.push(`CALENDAR_VALID_THROUGH ${validThrough} is ${left} days from today ${today.toISOString().slice(0, 10)} (< ${MIN_DAYS_LEFT}): extend the table`)
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push('ISLAND_DAYS is empty or not an array (cannot legitimately be empty)')
    return { problems, unverified }
  }
  let prev = null
  entries.forEach((e, i) => {
    const tag = `entry #${i} ${JSON.stringify(e && e.date)}`
    if (!e || !parse(e.date)) { problems.push(`${tag}: not a real date`); return }
    if (e.date < FLOOR || (vt && e.date > validThrough)) problems.push(`${tag}: outside [${FLOOR}, ${validThrough}]`)
    if (prev !== null && e.date === prev) problems.push(`${tag}: duplicate date`)
    else if (prev !== null && e.date < prev) problems.push(`${tag}: unsorted (follows ${prev})`)
    prev = e.date
    if (!KINDS.includes(e.kind)) problems.push(`${tag}: unknown kind ${JSON.stringify(e.kind)} (allowed: ${KINDS.join(', ')})`)
    if (typeof e.source !== 'string' || !e.source.trim()) problems.push(`${tag}: missing source`)
    if (typeof e.verified !== 'boolean') problems.push(`${tag}: verified must be true|false, got ${JSON.stringify(e.verified)}`)
    else if (e.verified === false) unverified.push(e.date)
  })
  if (unverified.length) problems.push(`${unverified.length} unverified dates — verify against the official TRNC announcement before HOME_CALENDAR_LIVE goes true: ${unverified.join(', ')}`)
  return { problems, unverified }
}

const ok = (d, k = 'publicHoliday') => ({ date: d, kind: k, source: 'x', verified: true })
function self() {
  const today = new Date('2026-10-14T00:00:00Z')
  const good = [ok('2026-10-29'), ok('2027-01-01', 'newYear')]
  const cases = [
    ['POSITIVE CONTROL: clean verified table passes', good, '2027-12-31', null],
    ['valid-through too close (59 days; entries inside range)', [ok('2026-10-29'), ok('2026-12-01')], '2026-12-12', /59 days/],
    ['valid-through exactly 60 days passes', [ok('2026-10-29')], '2026-12-13', null],
    ['unsorted', [ok('2027-01-01', 'newYear'), ok('2026-10-29')], '2027-12-31', /unsorted/],
    ['duplicate', [ok('2026-10-29'), ok('2026-10-29')], '2027-12-31', /duplicate/],
    ['not a real date (2027-02-30)', [ok('2027-02-30')], '2027-12-31', /not a real date/],
    ['before floor', [ok('2025-12-31')], '2027-12-31', /outside/],
    ['after valid-through', [ok('2028-01-01')], '2027-12-31', /outside/],
    ['unknown kind', [{ ...ok('2026-10-29'), kind: 'nationalDay' }], '2027-12-31', /unknown kind/],
    ['missing source', [{ ...ok('2026-10-29'), source: '' }], '2027-12-31', /missing source/],
    ['unverified entry', [{ ...ok('2026-10-29'), verified: false }], '2027-12-31', /1 unverified dates/],
    ['empty table', [], '2027-12-31', /empty/],
  ]
  let bad = 0
  for (const [name, ent, vt, re] of cases) {
    const { problems } = validate(ent, vt, today)
    const pass = re ? problems.some(p => re.test(p)) : problems.length === 0
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}  -> ${problems.length} problem(s)${problems[0] ? ': ' + problems[0] : ''}`)
    if (!pass) bad++
  }
  console.log(bad ? `SELF-TEST FAILED (${bad})` : `SELF-TEST OK (${cases.length} cases)`)
  process.exit(bad ? 1 : 0)
}

if (process.argv.includes('--self')) self()
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
const { problems, unverified } = validate(ISLAND_DAYS, CALENDAR_VALID_THROUGH, today)
const by = {}
for (const e of ISLAND_DAYS) by[e.kind] = (by[e.kind] || 0) + 1
console.log(`Island Calendar: ${ISLAND_DAYS.length} dates, valid through ${CALENDAR_VALID_THROUGH}, checked ${CALENDAR_CHECKED}`)
console.table(Object.entries(by).map(([kind, n]) => ({ kind, n })))
console.log(`verified: ${ISLAND_DAYS.length - unverified.length} / ${ISLAND_DAYS.length}`)
if (problems.length) { console.error('\nRED:\n - ' + problems.join('\n - ')); process.exit(1) }
console.log('GREEN')
