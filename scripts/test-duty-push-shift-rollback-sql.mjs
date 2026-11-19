// 20261222 — ROLLBACK of the 20261221 duty-push shift (supabase/migrations/20261222_duty_push_shift_rollback.sql) against a Supabase-shaped
// Postgres (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-duty-push-shift-rollback-sql.mjs
// Order: 20261205 (data_jobs) -> 20261210 (the duty_push_due body this file replaces) -> 20261221; the duty-push cron command is
// the exact 20261139 text, and duty_thursday_closing_local / weekend_digest_due are the real functions.
// Evidence of: the file's own assertions run clean, the red-first mutants are each REFUSED by the file itself, the behaviour measured
// from outside (roles, ticks). NOT evidence of: pg_cron / Vault / pg_net on the real database (cron.* and net.* are stubs, cron.alter_job
// has pg_cron's argument names), the real cron.job.username, PG 17 renderings of pg_get_functiondef.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, asRole } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = rel('../supabase/migrations/')
const FILES = readdirSync(MIG)
const A = FILES.find(f => /^\d+_data_jobs_switches\.sql$/.test(f))
const SHIFT = FILES.find(f => /^\d+_duty_push_shift_3min\.sql$/.test(f))
const ROLL = FILES.find(f => /^\d+_duty_push_shift_rollback\.sql$/.test(f))
assert.ok(ROLL, '20261222 file not found')
assert.ok(A && SHIFT, '20261210 or 20261221 file not found')
const read = f => readFileSync(MIG + f, 'utf8')
const nonotify = s => s.replace(/^NOTIFY pgrst.*$/m, '')

let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  WANT ${JSON.stringify(want)}`}`)
}

const grab = (file, start, ends) => {
  const s = read(file)
  const i = s.indexOf(start)
  assert.ok(i >= 0, `${file}: ${start} not found`)
  const hits = ends.map(e => [s.indexOf(e, i + start.length), e]).filter(([j]) => j >= 0).sort((a, b) => a[0] - b[0])
  assert.ok(hits.length, `${file}: end of ${start} not found`)
  return s.slice(i, hits[0][0] + hits[0][1].length)
}
const cap = FILES.find(f => f.startsWith('20260718_capture_3_functions'))
const DUTY = FILES.find(f => f.startsWith('20261103_duty_push_famagusta'))
const WEEK = FILES.find(f => f.startsWith('20261177_weekend_digest_schedule'))
const R1 = '20261205_data_jobs.sql'
const F196 = '20261196_marketplace_photo_review_reminder.sql'

// every cron job name 20261205 knows, so the coverage assertion is real
const r1src = read(R1)
const r1from = r1src.indexOf('INSERT INTO public.data_jobs (key')
const r1block = r1src.slice(r1from, r1src.indexOf("('purge-data-job-runs',", r1from) + 200)
const cronNames = [...new Set([...r1block.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1])))]
  .filter(n => !['x', 'zz-probe-no-such-cron-job'].includes(n))
const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const ADMIN2 = '00000000-0000-0000-0000-0000000000a2'
const CUST = '00000000-0000-0000-0000-0000000000c1'

// the live duty-push command, as 20261139 wrote it (cron stores it verbatim)
const CMD_RE = /SELECT cron\.schedule\('duty-push', '0,30 \* \* \* \*', \$job\$([\s\S]*?)\$job\$\);/
const DUTY_CMD_TEXT = read('20261139_duty_push_places_refresh_cron_timeout.sql').match(CMD_RE)?.[1]
assert.ok(DUTY_CMD_TEXT && DUTY_CMD_TEXT.includes('timeout_milliseconds := 60000'), '20261139 duty-push command not found')
const DUTY_CMD = `$dc$${DUTY_CMD_TEXT}$dc$`

const SEED = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid serial PRIMARY KEY, jobid int, status text, start_time timestamptz, end_time timestamptz, return_message text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
-- pg_cron's own signature and argument names (>= 1.4); NULL = leave as is
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j SET schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command), active = coalesce(alter_job.active, j.active) WHERE j.jobid = alter_job.job_id;
END $$;
-- cron.* is owned by postgres and NOT granted to service_role (as on Supabase): the watchdog_age DEFINER proof depends on it
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}') RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users, role text NOT NULL DEFAULT 'customer', push_token text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  title text, body text, type text, created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (type IS NULL OR type IN ('admin_alert', 'other')));
CREATE TABLE public.push_log (id bigserial PRIMARY KEY, user_id uuid REFERENCES public.profiles ON DELETE CASCADE, kind text NOT NULL, request_id bigint, sent_at timestamptz DEFAULT now());
CREATE TABLE public.duty_push_runs (id bigserial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, outcome text NOT NULL);
CREATE TABLE public.weekend_digest_runs (id bigserial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, outcome text NOT NULL, mode text NOT NULL DEFAULT 'all');
${grab(cap, 'CREATE OR REPLACE FUNCTION public.is_admin()', ['$function$;'])}
${grab(cap, 'CREATE OR REPLACE FUNCTION public.is_anonymous_session()', ['$function$;'])}
${grab(DUTY, '\nCREATE OR REPLACE FUNCTION public.duty_thursday_closing_local()\n', ['$$;'])}
${grab(DUTY, 'CREATE OR REPLACE FUNCTION public.duty_push_due(', ['$$;'])}
${grab(WEEK, 'CREATE OR REPLACE FUNCTION public.weekend_digest_due(', ['$fn$;'])}
REVOKE ALL ON FUNCTION public.duty_push_due(timestamptz), public.weekend_digest_due(timestamptz) FROM PUBLIC, anon, authenticated;
-- 20261196's reminder (Turkish text, live today) and its state row: file C replaces the function, and its pre-flight needs both
CREATE TABLE public.marketplace_photo_reminder_state (id boolean NOT NULL DEFAULT true PRIMARY KEY, last_sent_at timestamptz);
${grab(F196, 'CREATE OR REPLACE FUNCTION public.marketplace_photo_review_reminder()', ['$function$;'])}
REVOKE ALL ON FUNCTION public.marketplace_photo_review_reminder() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${ADMIN2}'), ('${CUST}');
INSERT INTO public.profiles (id, role, push_token) VALUES ('${ADMIN}', 'admin', 'ExponentPushToken[aaa]'), ('${ADMIN2}', 'admin', NULL), ('${CUST}', 'customer', 'ExponentPushToken[ccc]');
INSERT INTO cron.job (jobname, schedule, command) SELECT n, '0 3 * * *', 'SELECT 1' FROM unnest(ARRAY[${cronNames.map(n => `'${n}'`).join(',')}]) n WHERE n NOT IN ('purge-data-job-runs');
-- live-scores as on prod (read 2026-11-16): all six paused (active = false), the polls every minute, the dailies at 03:00 / 03:02 / 03:04
UPDATE cron.job SET active = false, schedule = CASE jobname WHEN 'live-scores-basketball-poll' THEN '* * * * *' WHEN 'live-scores-f1-poll' THEN '* * * * *' WHEN 'live-scores-football-poll' THEN '* * * * *'
  WHEN 'live-scores-basketball-daily' THEN '0 3 * * *' WHEN 'live-scores-f1-daily' THEN '2 3 * * *' ELSE '4 3 * * *' END WHERE jobname LIKE 'live-scores-%';
UPDATE cron.job SET schedule = '0,30 * * * *', command = ${DUTY_CMD} WHERE jobname = 'duty-push';
UPDATE cron.job SET schedule = '0,30 * * * 5,6', command = 'SELECT net.http_post() WHERE public.weekend_digest_due();' WHERE jobname = 'weekend-digest';
-- the live 2026-11-13 'all' run that made the old weekend probe date false on prod
INSERT INTO public.weekend_digest_runs (started_at, finished_at, outcome, mode) VALUES ('2026-11-13 15:00+00', '2026-11-13 15:00:05+00', 'sent', 'all');
`

const run = async (db, sql) => {
  const notices = []
  try { await db.exec(sql, { onNotice: n => notices.push(n.message) }); return { ok: true, notices } }
  catch (e) { return { ok: false, notices, msg: String(e.message || e).split('\n')[0] } }
}
const base = async () => {
  const db = await freshDb(SEED)
  const r1 = await run(db, nonotify(read(R1))); assert.ok(r1.ok, 'R1 must apply: ' + r1.msg)
  const ra = await run(db, nonotify(read(A))); assert.ok(ra.ok, '20261210 must apply: ' + ra.msg)
  await clock(db, SAFE)
  return db
}
// HARNESS-ONLY clock: the files' apply-window check reads clock_timestamp() unqualified; a schema placed BEFORE pg_catalog in this
// session's search_path supplies a clock_timestamp() that returns harness.now. Nothing of this exists in the migrations or in prod.
const clock = async (d, localIso) => {
  await d.exec(`CREATE SCHEMA IF NOT EXISTS clk;
    CREATE OR REPLACE FUNCTION clk.clock_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('harness.now')::timestamptz $$;
    SET search_path = clk, public, pg_catalog;`)
  await d.query(`SELECT set_config('harness.now', (timestamp '${localIso}' AT TIME ZONE 'Asia/Famagusta')::text, false)`)
}
const SAFE = '2026-11-18 12:00'
const SHIFT_SQL = read(SHIFT)
const ROLL_SQL = read(ROLL)


const mutant = async (label, from, to, want) => {
  assert.ok(ROLL_SQL.includes(from), `${label}: anchor not in file: ${from}`)
  const mutated = ROLL_SQL.replace(from, () => to)
  assert.ok(mutated !== ROLL_SQL, `${label}: mutation did not land`)
  const db = await shifted()
  const r = await run(db, nonotify(mutated))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}
const shifted = async () => {
  const d = await base()
  const r = await run(d, nonotify(SHIFT_SQL)); assert.ok(r.ok, '20261221 must apply: ' + r.msg)
  return d
}

console.log('── state before 20261221 (the 20261210 + 20261139 state the rollback must restore)')
const d0 = await base()
const snap = async d => ({
  def: (await d.query(`SELECT pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure) d`)).rows[0].d,
  job: (await d.query(`SELECT schedule, active, md5(command) m, jobid, username FROM cron.job WHERE jobname='duty-push'`)).rows[0],
  nJobs: (await d.query(`SELECT count(*)::int n FROM cron.job WHERE jobname='duty-push'`)).rows[0].n,
  weekend: (await d.query(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m FROM cron.job WHERE jobname='weekend-digest'`)).rows[0].m,
  weekendFn: (await d.query(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`)).rows[0].m,
  attrs: (await d.query(`SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner)) a FROM pg_proc WHERE oid='public.duty_push_due(timestamptz)'::regprocedure`)).rows[0].a,
})
const s0 = await snap(d0)
t('before: duty-push at 0,30 * * * *, no 3-minute shift', [s0.job.schedule, s0.def.includes("interval '3 minutes'")], ['0,30 * * * *', false])

console.log('── 20261221 then 20261222 (the exact files)')
const d1 = await base()
const r21 = await run(d1, nonotify(SHIFT_SQL))
t('20261221 applies', [r21.ok, r21.msg ?? null], [true, null])
const s1 = await snap(d1)
t('after 20261221: 27,57 and the 3-minute gate (so the rollback has something to undo)', [s1.job.schedule, s1.def.includes("interval '3 minutes'")], ['27,57 * * * *', true])
const r22 = await run(d1, nonotify(ROLL_SQL))
t('20261222 applies (its own assertions, sweeps and pause probe ran clean)', [r22.ok, r22.msg ?? null], [true, null])
console.log('  NOTICE lines printed by the file:')
for (const n of r22.notices ?? []) console.log('    ' + n)
const nl = r22.notices ?? []
t('NOTICE: Fri 17:00, Sat 13:00, Sun 08:00', [nl.includes('20261222 Fri 2026-11-20 due at 17:00 Asia/Famagusta'), nl.includes('20261222 Sat 2026-11-21 due at 13:00 Asia/Famagusta'), nl.includes('20261222 Sun 2026-11-22 due at 08:00 Asia/Famagusta')], [true, true, true])
t('NOTICE: final OK line', nl.some(n => n.startsWith('20261222 OK:')), true)
t('NOTICES mention no user / token / notified / push counts', nl.every(n => !/\b(users?|tokens?|notified|push_ok)\b/i.test(n)), true)
const s2 = await snap(d1)
t('function definition is BYTE-IDENTICAL to the 20261210 one', s2.def === s0.def, true)
t('duty-push: one job, active, 0,30 * * * *, command md5 + jobid + username as before', [s2.nJobs, s2.job.active, s2.job.schedule, s2.job.m === s0.job.m, s2.job.jobid === s0.job.jobid, s2.job.username === s0.job.username], [1, true, '0,30 * * * *', true, true, true])
t('weekend-digest job and weekend_digest_due unchanged through both files', [s2.weekend === s0.weekend, s2.weekendFn === s0.weekendFn], [true, true])
t('volatility / security / search_path / ACL / owner identical to before 20261221', s2.attrs === s0.attrs, true)
const due = async iso => (await d1.query(`SELECT public.duty_push_due('${iso}') b`)).rows[0].b
t('Fri 15:00Z (17:00) due; 14:57Z (16:57) not due; 15:27Z (17:27, a late start inside the 17:00 slot, as before 20261221) due; 15:30Z (17:30) not due',
  [await due('2026-11-20 15:00+00'), await due('2026-11-20 14:57+00'), await due('2026-11-20 15:27+00'), await due('2026-11-20 15:30+00')], [true, false, true, false])
t('has_function_privilege: anon false, authenticated false, postgres true',
  (await d1.query(`SELECT has_function_privilege('anon', 'public.duty_push_due(timestamptz)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.duty_push_due(timestamptz)', 'EXECUTE') u, has_function_privilege('postgres', 'public.duty_push_due(timestamptz)', 'EXECUTE') p`)).rows[0], { a: false, u: false, p: true })
t('ledger row written by the rollback itself', (await d1.query(`SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${ROLL}'`)).rows[0].n, 1)

console.log('── one send per local day after the rollback, three windows, ticks = the live schedule')
for (const [label, a, b] of [['Fri 20 - Sun 22 Nov 2026', '2026-11-20', '2026-11-22'], ['March 2027 change', '2027-03-21', '2027-04-04'], ['October 2027 change', '2027-10-24', '2027-11-07']]) {
  const rows = (await d1.query(`
    WITH mins AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 1), ',')::int[]) m FROM cron.job WHERE jobname='duty-push'),
         ticks AS (SELECT h + make_interval(mins => m) ts FROM generate_series(timestamptz '${a} 00:00+00' - interval '1 day', timestamptz '${b} 23:00+00' + interval '1 day', interval '1 hour') h, mins),
         x AS (SELECT (ts AT TIME ZONE 'Asia/Famagusta')::date dy, to_char(ts AT TIME ZONE 'Asia/Famagusta', 'HH24:MI') tm FROM ticks WHERE public.duty_push_due(ts))
    SELECT to_char(dy, 'Dy YYYY-MM-DD') dy, count(*)::int n, min(tm) tm FROM x WHERE dy BETWEEN date '${a}' AND date '${b}' GROUP BY dy ORDER BY dy`)).rows
  const nDays = (await d1.query(`SELECT (date '${b}' - date '${a}' + 1)::int n`)).rows[0].n
  t(`${label}: ${nDays} local days, each with exactly one due tick on :00 or :30`, [rows.length, rows.every(r => r.n === 1 && /:(00|30)$/.test(r.tm))], [nDays, true])
  console.log('      ' + rows.map(r => `${r.dy} ${r.tm}`).join(' · '))
}

console.log('── refusals (the file stops, nothing applied)')
{
  const dn = await base()
  const r = await run(dn, nonotify(ROLL_SQL))
  t('rollback on the pre-20261221 state (nothing to undo): refused', [r.ok, (r.msg || '').includes('not the active job at 27,57')], [false, true])
  const dp = await shifted()
  await dp.exec(`UPDATE data_jobs SET paused = true, paused_note = 'x', paused_at = now() WHERE key = 'duty-push'`)
  const rp = await run(dp, nonotify(ROLL_SQL))
  t('duty-push paused at apply time: refused', [rp.ok, (rp.msg || '').includes('duty-push is paused')], [false, true])
  const dh = await shifted()
  await dh.exec(`UPDATE cron.job SET schedule = '5,35 * * * *' WHERE jobname = 'duty-push'`)
  const rh = await run(dh, nonotify(ROLL_SQL))
  t('duty-push hand-edited schedule: refused', [rh.ok, (rh.msg || '').includes('not the active job at 27,57')], [false, true])
  const da = await shifted()
  await da.exec(`DROP FUNCTION cron.alter_job(bigint, text, text, text, text, boolean)`)
  const ra = await run(da, nonotify(ROLL_SQL))
  t('pg_cron without alter_job: refused', [ra.ok, (ra.msg || '').includes('no cron.alter_job')], [false, true])
}

console.log('── apply window: 20261222 at a controlled clock, on the SHIFTED gate (slot [16:57,17:27) local weekdays)')
const REFUSAL = "within 20 minutes of today's duty push slot"
const attempt = async (localIso, sql = ROLL_SQL) => {
  const d = await shifted()
  await clock(d, localIso)
  const r = await run(d, nonotify(sql))
  return { r, d }
}
const dayName = iso => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const WIN = [
  ['2026-11-20 16:30', false], ['2026-11-20 16:36:59', false], ['2026-11-20 16:37', true], ['2026-11-20 16:58', true], ['2026-11-20 17:10', true],
  ['2026-11-20 17:31:59', true], ['2026-11-20 17:32', false], ['2026-11-20 17:40', false],
  ['2026-11-21 12:30', false], ['2026-11-21 12:37', true], ['2026-11-21 12:58', true], ['2026-11-21 13:31:59', true], ['2026-11-21 13:32', false],
  ['2026-11-22 07:30', false], ['2026-11-22 07:37', true], ['2026-11-22 07:58', true], ['2026-11-22 08:32', false],
  ['2026-11-19 16:58', true], ['2026-11-19 16:30', false],
]
for (const [iso, refuse] of WIN) {
  const { r } = await attempt(iso)
  const refused = !r.ok && r.msg.includes(REFUSAL)
  t(`${dayName(iso)} ${iso.slice(11)} local: ${refuse ? 'REFUSED' : 'accepted'}`, [r.ok, refused, r.ok ? null : (refused ? null : r.msg)], [!refuse, refuse, null])
  if (refused && iso.endsWith('16:58') && iso.startsWith('2026-11-20')) console.log(`      message: ${r.msg}`)
}
{
  const { r, d } = await attempt('2026-11-20 16:58')
  await d.exec('ROLLBACK')
  t('refusal leaves nothing applied (schedule still 27,57, gate still shifted)', [r.ok, (await d.query(`SELECT schedule FROM cron.job WHERE jobname='duty-push'`)).rows[0].schedule], [false, '27,57 * * * *'])
}
{
  const from = ROLL_SQL.indexOf('  IF EXISTS (SELECT 1 FROM generate_series(clock_timestamp()')
  const IF_BLOCK = ROLL_SQL.slice(from, ROLL_SQL.indexOf("  PERFORM set_config('r222.duty_cmd'"))
  assert.ok(from > 0 && IF_BLOCK.includes('REFUSING: within 20 minutes') && IF_BLOCK.length < 700, 'refusal block slice')
  const noRefusal = ROLL_SQL.replace(IF_BLOCK, '')
  assert.ok(noRefusal !== ROLL_SQL && !noRefusal.includes('within 20 minutes of'), 'mutant landed')
  const m1 = await attempt('2026-11-20 16:58', noRefusal)
  t('red-first: refusal removed -> the file APPLIES at Fri 16:58 (the DOUBLE-send case; the window test above would fail = caught)', m1.r.ok, true)
  const short = ROLL_SQL.replace("clock_timestamp() + interval '20 minutes'", "clock_timestamp() + interval '2 minutes'")
  assert.ok(short !== ROLL_SQL, 'short mutant landed')
  const m2 = await attempt('2026-11-20 16:37', short)
  t('red-first: window shortened to +2 min -> applies at Fri 16:37 (caught)', m2.r.ok, true)
  const noback = ROLL_SQL.replace("clock_timestamp() - interval '5 minutes'", "clock_timestamp()")
  assert.ok(noback !== ROLL_SQL, 'noback mutant landed')
  const m3 = await attempt('2026-11-20 17:31:59', noback)
  t('red-first: look-back (-5 min) removed -> applies at Fri 17:31:59 (caught)', m3.r.ok, true)
}

console.log('── red-first mutants (each breaks ONE thing; the file itself must refuse; the anchor is asserted present)')
await mutant('3-minute shift left in the gate', `FROM (SELECT p_at AT TIME ZONE 'Asia/Famagusta' AS t) l\n$$;`, `FROM (SELECT (p_at + interval '3 minutes') AT TIME ZONE 'Asia/Famagusta' AS t) l\n$$;`, 'no 3-minute shift')
await mutant('schedule left at 27,57', `schedule := '0,30 * * * *'`, `schedule := '27,57 * * * *'`, 'not the active job at 0,30')
await mutant('schedule 0,30,57 (double send)', `schedule := '0,30 * * * *'`, `schedule := '0,30,57 * * * *'`, 'not the active job at 0,30')
await mutant('pause clause dropped', `         AND NOT public.data_job_paused('duty-push')\n  FROM (SELECT p_at AT`, `  FROM (SELECT p_at AT`, 'lost its pause clause')
await mutant('Sunday slot off (08:00 -> 08:30): behaviour only', `             WHEN 7 THEN time '08:00'\n             WHEN 6 THEN time '13:30' - interval '30 minutes'\n             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'\n             ELSE        time '17:30' - interval '30 minutes'\n           END)\n         AND NOT`, `             WHEN 7 THEN time '08:30'\n             WHEN 6 THEN time '13:30' - interval '30 minutes'\n             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'\n             ELSE        time '17:30' - interval '30 minutes'\n           END)\n         AND NOT`, 'sweep')
await mutant('the restored definition made VOLATILE', `RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$\n  SELECT (date_trunc`, `RETURNS boolean LANGUAGE sql VOLATILE SET search_path = '' AS $$\n  SELECT (date_trunc`, 'changed volatility')

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed')
process.exit(fail ? 1 : 0)
