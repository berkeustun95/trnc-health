#!/usr/bin/env node
// ─── Nöbetçi Eczane roster health ────────────────────────────────────────────
//
//   node scripts/check-duty-staleness.mjs          # exit 1 if empty today, or running out
//   node scripts/check-duty-staleness.mjs --self   # prove both thresholds actually fire
//
// ─── THE FAILURE CLASS THIS CLOSES ──────────────────────────────────────────
//
// The duty roster ran out on 2026-06-30 and nobody noticed for two months. Every check
// this repo owns — verify_schema.sql, schema_drift_audit.sql, migration_ledger_check.sql
// — asks "does this column exist". `duty_list` passed all of them the whole time, while
// being empty.
//
// Schema drift was the failure we had tooling for. CONTENT EXPIRY was not, and it is the
// one that reached users: an empty table renders identically to a quiet night, so the app
// told people there was no duty pharmacy rather than that we had lost the list.
//
// ─── WHY IT IS NOT IN pre-push ──────────────────────────────────────────────
//
// A push must not be blocked because a roster is running low. That is data operations,
// not code quality, and a guard that blocks unrelated work gets disabled. Same posture as
// check-novest-staleness.mjs: run it by hand (`npm run duty:health`) or from a cron.
// pre-push guards what the COMMIT could break; this watches what the WORLD does.
//
// ─── THE CLASSIFIER IS IMPORTED, NOT REIMPLEMENTED ──────────────────────────
//
// utils/dutyStatus.js is the same module DutyListScreen uses. Two copies of "what counts
// as stale" would drift the first time either was tuned, and both would keep working
// while disagreeing.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { dutyStatus, dutyDaysRemaining, localDateKey, DUTY_FRESH, DUTY_STALE } from '../utils/dutyStatus.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ─── The forward-coverage threshold ─────────────────────────────────────────
//
// 14 DAYS, and the number is chosen from how long a REFILL takes, not from a round figure.
//
// The roster arrives monthly and getting the next one is human-latency work: a call to
// KTEB, a reply, then transcription. Seven days is too tight — one unanswered call across
// a weekend or a public holiday and the warning window is gone before anyone acts. Two
// weeks leaves room for the call to go unanswered twice and still be comfortable.
//
// It is also not so large that it is permanently red: a month-start refresh gives 28-31
// days of cover, so roughly a fortnight of quiet before it starts asking.
const WARN_DAYS = 14

// ─── The SOFT horizon, for a year-sized roster ──────────────────────────────
//
// 14 days is the right number when a refill is one month transcribed from KTEB's
// publication. It is the WRONG number for a full-year load: nobody transcribes ~5,100
// rows, or negotiates a feed, on a fortnight's notice. By the time 14 days is the answer,
// the only options left are bad ones.
//
// 60 days is two clear months — enough to place the call, wait for a reply, agree a
// format and do the work, with slack for a holiday. It does NOT fail: a soft horizon that
// exits 1 is just an earlier hard horizon, and one that blocks a workflow gets silenced.
// It prints, and the printing is the point.
const SOFT_WARN_DAYS = 60

const c = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

// ─── --self: prove the thresholds fire, against fixtures ────────────────────
//
// A threshold nobody has watched trip is a decoration. This runs the real classifier
// against constructed states and asserts each verdict, so the check can be trusted
// without waiting for the roster to actually run out.
if (process.argv.includes('--self')) {
  const today = '2026-08-26'
  const cases = [
    ['rows for today',            { todayCount: 13, maxDate: '2026-09-30' }, DUTY_FRESH,  35],
    ['roster ran out in June',    { todayCount: 0,  maxDate: '2026-06-30' }, DUTY_STALE,  -57],
    ['table completely empty',    { todayCount: 0,  maxDate: null },         'absent',    null],
    ['gap: today missing, future present', { todayCount: 0, maxDate: '2026-09-10' }, DUTY_STALE, 15],
  ]
  let bad = 0
  for (const [label, input, wantStatus, wantDays] of cases) {
    const got = dutyStatus(input)
    const days = dutyDaysRemaining({ maxDate: input.maxDate, today })
    const ok = got === wantStatus && days === wantDays
    if (!ok) bad++
    console.log(`  ${ok ? c.g('ok  ') : c.r('FAIL')} ${label.padEnd(38)} ${got}, ${days} day(s)`)
  }
  // The warning arm, separately: a roster with less than WARN_DAYS left must warn even
  // though today is covered — that is the whole point of warning before it is critical.
  const nearlyOut = dutyDaysRemaining({ maxDate: '2026-09-02', today })
  const warns = nearlyOut < WARN_DAYS
  console.log(`  ${warns ? c.g('ok  ') : c.r('FAIL')} ${'7 days left must warn'.padEnd(38)} ${nearlyOut} < ${WARN_DAYS} → ${warns}`)
  if (!warns) bad++
  const plenty = dutyDaysRemaining({ maxDate: '2026-10-31', today })
  const quiet = plenty >= WARN_DAYS
  console.log(`  ${quiet ? c.g('ok  ') : c.r('FAIL')} ${'66 days left must not FAIL'.padEnd(38)} ${plenty} >= ${WARN_DAYS} → ${quiet}`)
  if (!quiet) bad++
  // The soft horizon must speak where the hard one is silent — otherwise it is decoration.
  const soft = dutyDaysRemaining({ maxDate: '2026-10-10', today })
  const softSpeaks = soft >= WARN_DAYS && soft < SOFT_WARN_DAYS
  console.log(`  ${softSpeaks ? c.g('ok  ') : c.r('FAIL')} ${'45 days: soft warns, hard silent'.padEnd(38)} ${WARN_DAYS} <= ${soft} < ${SOFT_WARN_DAYS} → ${softSpeaks}`)
  if (!softSpeaks) bad++
  const wayOut = dutyDaysRemaining({ maxDate: '2027-08-26', today })
  const fullyQuiet = wayOut >= SOFT_WARN_DAYS
  console.log(`  ${fullyQuiet ? c.g('ok  ') : c.r('FAIL')} ${'a full year must be fully quiet'.padEnd(38)} ${wayOut} >= ${SOFT_WARN_DAYS} → ${fullyQuiet}`)
  if (!fullyQuiet) bad++
  console.log(bad ? c.r(`\n  ${bad} self-check(s) FAILED\n`) : c.g('\n  self-check: all thresholds fire correctly\n'))
  process.exit(bad ? 1 : 0)
}

// ─── Live check ──────────────────────────────────────────────────────────────

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error(c.r('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY missing — expected in .env'))
  process.exit(1)
}
// The ANON key on purpose: duty_list is world-readable ("Anyone can read duty_list"), and
// this check should see exactly what a user's app sees. A service-role read could succeed
// where the app fails and report health that users do not have.
const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const today = localDateKey()

const [{ count: todayCount, error: e1 }, { data: newest, error: e2 }] = await Promise.all([
  supabase.from('duty_list').select('id', { head: true, count: 'exact' }).eq('duty_date', today),
  supabase.from('duty_list').select('duty_date').order('duty_date', { ascending: false }).limit(1),
])
if (e1 || e2) {
  console.error(c.r(`duty_list unreadable: ${(e1 || e2).message}`))
  process.exit(1)
}

const maxDate = newest?.[0]?.duty_date ?? null
const status  = dutyStatus({ todayCount: todayCount ?? 0, maxDate })
const left    = dutyDaysRemaining({ maxDate, today })

console.log(`\nduty roster — ${today}`)
console.log(`  rows for today : ${todayCount ?? 0}`)
console.log(`  last day covered: ${maxDate ?? c.d('(table is empty)')}`)
console.log(`  status         : ${status === DUTY_FRESH ? c.g(status) : c.r(status)}`)

if (status !== DUTY_FRESH) {
  console.error(c.r('\n  ┌─ DUTY ROSTER FAILING USERS RIGHT NOW ──────────────────────────┐'))
  console.error(c.r(`  │ status: ${status}. No duty pharmacies are listed for today.`))
  console.error(c.r('  │ There is ALWAYS a duty pharmacy in the TRNC, so this is our'))
  console.error(c.r('  │ missing data, not a quiet night. Users see an empty list.'))
  console.error(c.r('  └────────────────────────────────────────────────────────────────┘'))
  console.error(c.d('  Refill: KTEB info@kteb.org / +90 392 228 06 22 — they publish the roster.\n'))
  process.exit(1)
}

if (left < WARN_DAYS) {
  console.error(c.y(`\n  ROSTER RUNNING OUT — ${left} day(s) of cover left (warn below ${WARN_DAYS}).`))
  console.error(c.d(`  Last covered day is ${maxDate}. Refilling needs a call to KTEB and`))
  console.error(c.d('  transcription, so start now rather than on the day it empties.\n'))
  process.exit(1)
}

if (left < SOFT_WARN_DAYS) {
  console.log(c.y(`  ${left} day(s) of cover remaining — start the next roster soon `
    + `(soft horizon ${SOFT_WARN_DAYS}d, hard ${WARN_DAYS}d).`))
  console.log(c.d('  A year-sized load is not a fortnight of work; this is the notice that'))
  console.log(c.d('  assumes it is not. Not a failure — exit 0.\n'))
  process.exit(0)
}

console.log(c.g(`  ${left} day(s) of cover remaining — OK\n`))
