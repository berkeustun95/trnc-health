// supabase/readonly/onboarding_events_weekly.sql on the PGlite harness (PostgreSQL 18; prod 17.6). By hand:
//   node scripts/test-onboarding-events-weekly-sql.mjs
// Evidence of: the probe's arithmetic, flags and that it prints no counts. NOT evidence of: live data.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const PROBE = readFileSync(rel('../supabase/readonly/onboarding_events_weekly.sql'), 'utf8')
let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  WANT ${JSON.stringify(want)}`}`)
}
const db = await freshDb('')
await applyFile(db, rel('../supabase/migrations/20261202_onboarding_events.sql'))
await applyFile(db, rel('../supabase/migrations/20261204_onboarding_events_start_choice.sql'))
// Insert n rows of an event on TRNC day (today - ago), at local noon.
const add = (event, ago, n) => db.exec(`INSERT INTO public.onboarding_events (event, platform, created_at)
  SELECT '${event}', 'android', ((((now() at time zone 'Asia/Famagusta')::date - ${ago}) + time '12:00') at time zone 'Asia/Famagusta')
  FROM generate_series(1, ${n})`)
const run = async () => (await db.query(PROBE)).rows

t('empty table: no rows', await run(), [])
// start_shown: steady 10/day for 35 days → ratio 1.0x, peak 1.0x, ok
for (let ago = 1; ago <= 35; ago++) await add('start_shown', ago, 10)
// offer_shown: 3/day prior, then 30 on one day last week → week 30+... spike by both ratios
for (let ago = 8; ago <= 35; ago++) await add('offer_shown', ago, 3)
await add('offer_shown', 2, 60)
// choices: only last 7 days (new); 6 signup, 3 signin, 1 guest → 60% / 30% / 10%, under 20 rows → ok
await add('start_choice_signup', 3, 6); await add('start_choice_signin', 3, 3); await add('start_choice_guest', 4, 1)
// today's rows and 36-day-old rows are ignored
await add('reoffer_shown', 0, 50); await add('reoffer_shown', 36, 50)
const rows = await run()
t('rows: only events seen in the window, sorted', rows.map(r => r.event),
  ['offer_shown', 'start_choice_guest', 'start_choice_signin', 'start_choice_signup', 'start_shown'])
const by = Object.fromEntries(rows.map(r => [r.event, r]))
t('steady event: 1.0x / 1.0x / ok', [by.start_shown.last7_vs_prior_weeks, by.start_shown.peak_day_vs_week_avg, by.start_shown.flag], ['1.0x', '1.0x', 'ok'])
t('spike: 60 in a week vs 21/week prior = 2.9x, all on one day = 7.0x → SPIKE',
  [by.offer_shown.last7_vs_prior_weeks, by.offer_shown.peak_day_vs_week_avg, by.offer_shown.flag], ['2.9x', '7.0x', 'SPIKE'])
t('choice shares 60/30/10, new, ok (under 20 rows)', ['signup', 'signin', 'guest'].map(c => [by['start_choice_' + c].choice_share_7d, by['start_choice_' + c].last7_vs_prior_weeks, by['start_choice_' + c].flag]),
  [['60%', 'new', 'ok'], ['30%', 'new', 'ok'], ['10%', 'new', 'ok']])
t('non-choice rows carry no share', by.start_shown.choice_share_7d, null)
t('no column can carry a count (every value is a ratio, share, flag or name)',
  rows.every(r => Object.values(r).every(v => v === null || /^(-|new|ok|SPIKE|\d+\.\dx|\d+%|[a-z_]+)$/.test(v))), true)
console.log(fail ? `FAIL (${fail})` : 'ALL PASS')
process.exit(fail ? 1 : 0)
