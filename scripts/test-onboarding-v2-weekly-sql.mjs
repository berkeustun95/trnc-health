// supabase/readonly/onboarding_v2_weekly.sql on the PGlite harness. By hand (no registry; same as
// test-onboarding-events-weekly-sql.mjs):  node scripts/test-onboarding-v2-weekly-sql.mjs
// Evidence of: the report's arithmetic, window, first_time_from handling, flags, and that it prints no counts.
// NOT evidence of: live data.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const SQL = readFileSync(rel('../supabase/readonly/onboarding_v2_weekly.sql'), 'utf8')
let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  WANT ${JSON.stringify(want)}`}`)
}
let db = await freshDb('')
await applyFile(db, rel('../supabase/migrations/20261202_onboarding_events.sql'))
await applyFile(db, rel('../supabase/migrations/20261204_onboarding_events_start_choice.sql'))

const ANCHOR = "date '2026-11-24'"
const count = SQL.split(ANCHOR).length - 1
if (count !== 1) throw new Error(`first_time_from anchor found ${count} times, want 1`)
const today = async () => (await db.query(`select (now() at time zone 'Asia/Famagusta')::date as d`)).rows[0].d
const dayStr = async ago => (await db.query(`select ((now() at time zone 'Asia/Famagusta')::date - ${ago})::text as d`)).rows[0].d
const run = async ftfAgo => {
  const sql = ftfAgo === null ? SQL.replace(ANCHOR, "date '2099-01-01'") : SQL.replace(ANCHOR, `date '${await dayStr(ftfAgo)}'`)
  return Object.fromEntries((await db.query(sql)).rows.map(r => [r.metric, r]))
}
const addAt = (event, atSql, n) => db.exec(`INSERT INTO public.onboarding_events (event, platform, created_at)
  SELECT '${event}', 'android', ${atSql} FROM generate_series(1, ${n})`)
const add = (event, ago, n, platform = 'android') => db.exec(`INSERT INTO public.onboarding_events (event, platform, created_at)
  SELECT '${event}', '${platform}', ((((now() at time zone 'Asia/Famagusta')::date - ${ago}) + time '12:00') at time zone 'Asia/Famagusta')
  FROM generate_series(1, ${n})`)
const v = (r, ...m) => m.map(k => r[k].value)
const pattern = /^(\d+%|n\/a|not live|full|partial|ok|small \(<20\))$/
const names = ['choice_signup', 'choice_signin', 'choice_guest', 'screen2_tapped_enable', 'screen2_os_allowed', 'screen2_not_now',
  'screen2_left_without_choice', 'reoffer_later_allowed', 'reoffer_existing_allowed', 'screen2_reach_first_time_guest', 'first_time_window']

// 1. empty table
let r = await run(null)
t('empty: 11 rows in order', Object.keys(r), names)
t('empty: rates n/a', v(r, ...names.slice(0, 9)), Array(9).fill('n/a'))
t('empty: reach + window not live', v(r, 'screen2_reach_first_time_guest', 'first_time_window'), ['not live', 'not live'])

// 2. data: guest taps ago5 x4, ago2 x2; offer_shown ago5 x4, ago2 x3; plus rows that must be ignored
await add('start_choice_guest', 5, 4); await add('start_choice_guest', 2, 2)
await add('start_choice_signup', 3, 2); await add('start_choice_signin', 3, 2)
await add('offer_shown', 5, 4); await add('offer_shown', 2, 3)
await add('offer_granted', 2, 1); await add('offer_denied', 2, 1); await add('offer_later', 2, 2)   // resolved 4, shown 7
await add('reoffer_shown', 4, 4); await add('reoffer_granted', 4, 1)
await add('reoffer_existing_shown', 4, 2); await add('reoffer_existing_granted', 4, 1)
await add('start_choice_guest', 0, 50); await add('offer_shown', 0, 50)     // today: excluded
await add('start_choice_guest', 8, 50); await add('offer_shown', 8, 50)     // before the window: excluded
await add('start_choice_signup', 6, 40, 'ios')                              // ios counts too
r = await run(null)
t('window: choice shares (6 guest, 2 signup+40 ios, 2 signin of 50)', v(r, 'choice_signup', 'choice_signin', 'choice_guest'), ['84%', '4%', '12%'])
t('screen2 rates over resolved=4, shown=7', v(r, 'screen2_tapped_enable', 'screen2_os_allowed', 'screen2_not_now', 'screen2_left_without_choice'), ['50%', '25%', '50%', '43%'])
t('reoffers', v(r, 'reoffer_later_allowed', 'reoffer_existing_allowed'), ['25%', '50%'])
t('small sample flag on choice (50 taps = ok) and on reoffer (4 = small)', [r.choice_signup.sample, r.reoffer_later_allowed.sample], ['ok', 'small (<20)'])
t('future literal: reach not live', v(r, 'screen2_reach_first_time_guest', 'first_time_window'), ['not live', 'not live'])

// 3. literal in the past
r = await run(8)
t('literal before window: full, reach over whole window (7 offers / 6 taps)', v(r, 'first_time_window', 'screen2_reach_first_time_guest'), ['full', '117%'])
r = await run(7)
t('literal = window start: full', r.first_time_window.value, 'full')
r = await run(3)
t('literal straddles: partial, reach only from ago<=3 (3 offers / 2 taps)', v(r, 'first_time_window', 'screen2_reach_first_time_guest'), ['partial', '150%'])
r = await run(1)
t('literal yesterday: partial, no taps/offers that day -> n/a', v(r, 'first_time_window', 'screen2_reach_first_time_guest'), ['partial', 'n/a'])
r = await run(0)
t('literal today: not live', v(r, 'first_time_window', 'screen2_reach_first_time_guest'), ['not live', 'not live'])
t('choice_* unaffected by the literal', v(r, 'choice_guest'), ['12%'])
t('sample flag on reach: 2 taps = small', (await run(3)).screen2_reach_first_time_guest.sample, 'small (<20)')
await add('start_choice_guest', 2, 20); await add('offer_shown', 2, 10)
t('sample flag on reach: 22 taps = ok', (await run(3)).screen2_reach_first_time_guest.sample, 'ok')

// 3b. window edges, on reoffer_existing (before: 1 of 2 = 50%)
await add('reoffer_existing_shown', 7, 2)                                   // oldest day in the window: counted
await add('reoffer_existing_shown', 8, 6)                                   // one day before: not counted
r = await run(null)
t('window start: ago=7 counted, ago=8 not (1 of 4)', r.reoffer_existing_allowed.value, '25%')
await addAt('reoffer_existing_granted', `((now() at time zone 'Asia/Famagusta')::date)::timestamp at time zone 'Asia/Famagusta'`, 3)
r = await run(null)
t('window end: a row exactly at Famagusta midnight today is excluded (still 1 of 4)', r.reoffer_existing_allowed.value, '25%')

// 4. no count can leak
for (const ftf of [null, 8, 3, 1, 0]) {
  const rows = Object.values(await run(ftf))
  t(`no count leaks (literal ${ftf})`, rows.every(x => pattern.test(x.value) && (pattern.test(x.sample) || x.sample === 'n/a')), true)
}
// 5. sample threshold on a fresh table: den 19 = small, den 20 = ok
db = await freshDb('')
await applyFile(db, rel('../supabase/migrations/20261202_onboarding_events.sql'))
await applyFile(db, rel('../supabase/migrations/20261204_onboarding_events_start_choice.sql'))
await add('reoffer_shown', 3, 19)
t('sample: den 19 = small (<20)', (await run(null)).reoffer_later_allowed.sample, 'small (<20)')
await add('reoffer_shown', 3, 1)
t('sample: den 20 = ok', (await run(null)).reoffer_later_allowed.sample, 'ok')

console.log(fail ? `FAIL (${fail})` : 'ALL PASS')
process.exit(fail ? 1 : 0)
