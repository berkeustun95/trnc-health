// 20261238 — weekend digest at 3,33 * * * 5,6 + 60 s timeout (supabase/migrations/20261238_weekend_digest_shift_3min.sql) against a
// Supabase-shaped Postgres (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-weekend-digest-shift-sql.mjs
// Order: 20261205 (data_jobs) -> 20261210 (the weekend_digest_due gate this file relies on) -> 20261221 (duty push at :27/:57, which the
// sweep depends on) -> 20261238. The weekend-digest cron command is the exact 20261187 text, duty-push the exact 20261139 text.
// Evidence of: the file's own assertions run clean, every red-first mutant is REFUSED by the file itself, the behaviour measured from
// outside (roles, ticks). NOT evidence of: pg_cron / Vault / pg_net on the real database (cron.* and net.* are stubs, cron.alter_job
// has pg_cron's argument names), that the live cron.job.command equals the 20261187 text byte for byte (the file's pre-flight checks
// that on prod), PG 17 renderings of pg_get_functiondef.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, asRole } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = rel('../supabase/migrations/')
const FILES = readdirSync(MIG)
const A = FILES.find(f => /^\d+_data_jobs_switches\.sql$/.test(f))
const DUTYSHIFT = FILES.find(f => /^\d+_duty_push_shift_3min\.sql$/.test(f))
const SHIFT = FILES.find(f => /^\d+_weekend_digest_shift_3min\.sql$/.test(f))
assert.ok(A && DUTYSHIFT, '20261210 or 20261221 file not found')
assert.ok(SHIFT, 'RED: the 20261238 weekend digest shift file does not exist')
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

// the live weekend-digest command, as 20261187 wrote it (cron stores it verbatim: leading newline, trailing ";\n")
const WEEK_CMD_TEXT = read('20261187_weekend_digest_resume.sql').match(/SELECT cron\.schedule\('weekend-digest', '0,30 \* \* \* 5,6', \$job\$([\s\S]*?)\$job\$\);/)?.[1]
assert.ok(WEEK_CMD_TEXT && WEEK_CMD_TEXT.startsWith('\n  SELECT net.http_post(') && WEEK_CMD_TEXT.endsWith(';\n') && !WEEK_CMD_TEXT.includes('timeout_milliseconds'), '20261187 weekend-digest command not found')
const WEEK_CMD = `$wc$${WEEK_CMD_TEXT}$wc$`
const NEW_CMD_TEXT = WEEK_CMD_TEXT.replace("body    := '{}'::jsonb)", "body    := '{}'::jsonb,\n    timeout_milliseconds := 60000)")
assert.ok(NEW_CMD_TEXT !== WEEK_CMD_TEXT, 'new command text did not build')

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
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
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
UPDATE cron.job SET schedule = '0,30 * * * 5,6', command = ${WEEK_CMD} WHERE jobname = 'weekend-digest';
-- the live 2026-11-13 'all' run that made the old weekend probe date false on prod
INSERT INTO public.weekend_digest_runs (started_at, finished_at, outcome, mode) VALUES ('2026-11-13 15:00+00', '2026-11-13 15:00:05+00', 'sent', 'all');
`

const run = async (db, sql) => {
  const notices = []
  try { await db.exec(sql, { onNotice: n => notices.push(n.message) }); return { ok: true, notices } }
  catch (e) { return { ok: false, notices, msg: String(e.message || e).split('\n')[0] } }
}
// HARNESS-ONLY clock: the file reads clock_timestamp() unqualified; a schema placed BEFORE pg_catalog in this session's search_path
// supplies a clock_timestamp() that returns harness.now. Nothing of this exists in the migration or in prod.
const clock = async (d, localIso) => {
  await d.exec(`CREATE SCHEMA IF NOT EXISTS clk;
    CREATE OR REPLACE FUNCTION clk.clock_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('harness.now')::timestamptz $$;
    SET search_path = clk, public, pg_catalog;`)
  await d.query(`SELECT set_config('harness.now', (timestamp '${localIso}' AT TIME ZONE 'Asia/Famagusta')::text, false)`)
}
const SAFE = '2026-11-18 12:00'
// the live state the file expects: 20261205, 20261210 (the gate), 20261221 (duty at 27,57 with the 3-minute gate)
const base = async ({ withDutyShift = true } = {}) => {
  const db = await freshDb(SEED)
  const r1 = await run(db, nonotify(read(R1))); assert.ok(r1.ok, 'R1 must apply: ' + r1.msg)
  const ra = await run(db, nonotify(read(A))); assert.ok(ra.ok, '20261210 must apply: ' + ra.msg)
  await clock(db, SAFE)
  if (withDutyShift) { const rd = await run(db, nonotify(read(DUTYSHIFT))); assert.ok(rd.ok, '20261221 must apply: ' + rd.msg) }
  return db
}
const SHIFT_SQL = read(SHIFT)
const mutant = async (label, from, to, want, sql = SHIFT_SQL) => {
  assert.ok(sql.includes(from), `${label}: anchor not in file: ${from}`)
  const mutated = sql.replace(from, () => to)
  assert.ok(mutated !== sql, `${label}: mutation did not land`)
  const db = await base()
  const r = await run(db, nonotify(mutated))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}
// the file's own equality check on the schedule removed, so the SWEEP (not the equality) has to notice
const RELAX_FROM = "SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'weekend-digest' AND active AND schedule = '3,33 * * * 5,6';"
const RELAXED_SQL = SHIFT_SQL.replace(RELAX_FROM, "SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'weekend-digest' AND active AND schedule IS NOT NULL;")
assert.ok(RELAXED_SQL !== SHIFT_SQL, 'relaxed variant did not land')

console.log("── 20261238 applied after 20261205 + 20261210 + 20261221: the file's own assertions + probes")
let db = await base()
const q = async sql => (await db.query(sql)).rows
const before = {
  job: (await q(`SELECT schedule, command, jobid, active FROM cron.job WHERE jobname='weekend-digest'`))[0],
  gate: (await q(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`))[0].m,
  duty: (await q(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m, schedule FROM cron.job WHERE jobname='duty-push'`))[0],
  dutyFn: (await q(`SELECT md5(pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure)) m`))[0].m,
  pauseRow: (await q(`SELECT paused, paused_note FROM data_jobs WHERE key='weekend-digest'`))[0],
}
t('before: weekend-digest at 0,30 * * * 5,6, exact 20261187 command, no timeout; duty-push at 27,57', [before.job.schedule, before.job.command === WEEK_CMD_TEXT, before.job.command.includes('timeout_milliseconds'), before.duty.schedule],
  ['0,30 * * * 5,6', true, false, '27,57 * * * *'])
const res = await run(db, nonotify(SHIFT_SQL))
t('the exact file applies (its own assertions, sweeps and pause probe ran clean)', [res.ok, res.msg ?? null], [true, null])
console.log('  NOTICE lines printed by the file:')
for (const n of res.notices ?? []) console.log('    ' + n)
const nl = res.notices ?? []
t('NOTICE: six sweep windows, each one due tick on the Friday at 17:03', nl.filter(n => n.includes('one due tick on the Friday at 17:03')).length, 6)
t('NOTICE: the clock-change windows ran (Mar 2027 forward, Oct 2027 back)', [nl.some(n => n.includes('clocks forward Sun 28 Mar')), nl.some(n => n.includes('clocks back Sun 31 Oct'))], [true, true])
t('NOTICE: pause probe true -> false -> true', nl.some(n => n.includes('{due=true,paused=false,resumed=true}')), true)
t('NOTICE: final OK line', nl.some(n => n.startsWith('20261238 OK:')), true)
t('NOTICES mention no user / token / notified / push counts', nl.every(n => !/\b(users?|tokens?|notified|push_ok)\b/i.test(n)), true)

console.log('── state after the apply (measured from outside the file)')
const after = {
  job: (await q(`SELECT schedule, command, jobid, active, username FROM cron.job WHERE jobname='weekend-digest'`))[0],
  nJobs: (await q(`SELECT count(*)::int n FROM cron.job WHERE jobname='weekend-digest'`))[0].n,
  nGateJobs: (await q(`SELECT count(*)::int n FROM cron.job WHERE command LIKE '%public.weekend_digest_due()%'`))[0].n,
  gate: (await q(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`))[0].m,
  duty: (await q(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m FROM cron.job WHERE jobname='duty-push'`))[0].m,
  dutyFn: (await q(`SELECT md5(pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure)) m`))[0].m,
  pauseRow: (await q(`SELECT paused, paused_note FROM data_jobs WHERE key='weekend-digest'`))[0],
}
t('weekend-digest: one job, active, schedule 3,33 * * * 5,6, jobid unchanged', [after.nJobs, after.job.active, after.job.schedule, after.job.jobid === before.job.jobid], [1, true, '3,33 * * * 5,6', true])
t('command = the exact expected new text (old + one 60 s timeout)', after.job.command === NEW_CMD_TEXT, true)
t('removing the timeout clause gives the old command back; exactly one timeout, Vault lookup, gate, no key', [after.job.command.replace(',\n    timeout_milliseconds := 60000)', ')') === WEEK_CMD_TEXT,
  after.job.command.split('timeout_milliseconds := 60000').length - 1, after.job.command.includes('vault.decrypted_secrets'), after.job.command.includes('WHERE public.weekend_digest_due()'),
  /eyJ|sb_secret/.test(after.job.command)], [true, 1, true, true, false])
console.log('      new command: ' + JSON.stringify(after.job.command))
t('exactly one job calls weekend_digest_due', after.nGateJobs, 1)
t('weekend_digest_due definition (md5) unchanged', after.gate === before.gate, true)
t('duty-push job and duty_push_due md5 unchanged', [after.duty === before.duty.m, after.dutyFn === before.dutyFn], [true, true])
t('data_jobs weekend-digest row unchanged (pause probe left no trace)', after.pauseRow, before.pauseRow)
const due = async iso => (await q(`SELECT public.weekend_digest_due('${iso}') b`))[0].b
t('Fri 15:03Z (17:03 local winter) due; 15:33Z not; 15:00Z gate-yes but not a tick; Sat 15:03Z not due',
  [await due('2026-11-27 15:03+00'), await due('2026-11-27 15:33+00'), await due('2026-11-27 15:00+00'), await due('2026-11-28 15:03+00')], [true, false, true, false])

console.log('── one send per Friday at 17:03 local, measured again from outside, six Fri/Sat pairs (ticks = the live job schedule, UTC day list 5,6)')
const perDay = async fri => (await q(`
  WITH mins AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 1), ',')::int[]) m FROM cron.job WHERE jobname='weekend-digest'),
       dows AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 5), ',')::int[]) d FROM cron.job WHERE jobname='weekend-digest'),
       ticks AS (SELECT h + make_interval(mins => m) ts FROM generate_series(timestamptz '${fri} 00:00+00' - interval '2 days', timestamptz '${fri} 23:00+00' + interval '4 days', interval '1 hour') h, mins
                  WHERE extract(dow FROM h)::int IN (SELECT d FROM dows)),
       t AS (SELECT ts, (ts AT TIME ZONE 'Asia/Famagusta')::date d, to_char(ts AT TIME ZONE 'Asia/Famagusta', 'HH24:MI') lt, public.weekend_digest_due(ts) due FROM ticks)
  SELECT to_char(d, 'Dy YYYY-MM-DD') dy, count(*) FILTER (WHERE due)::int n_due, min(lt) FILTER (WHERE due) tm, count(*) FILTER (WHERE lt = '17:03')::int n1703
    FROM t WHERE d BETWEEN date '${fri}' - 1 AND date '${fri}' + 2 GROUP BY d ORDER BY d`))
for (const fri of ['2026-11-20', '2026-11-27', '2027-03-26', '2027-04-02', '2027-10-29', '2027-11-05']) {
  const rows = await perDay(fri)
  const friRow = rows.find(r => r.dy.startsWith('Fri'))
  const satRow = rows.find(r => r.dy.startsWith('Sat'))
  t(`${fri}: Fri one due tick at 17:03; Sat has its 17:03 tick and it is not due; every other day zero`,
    [friRow.n_due, friRow.tm, satRow.n1703, satRow.n_due, rows.filter(r => !r.dy.startsWith('Fri')).every(r => r.n_due === 0)], [1, '17:03', 1, 0, true])
  console.log('      ' + rows.map(r => `${r.dy} due=${r.n_due}${r.tm ? '@' + r.tm : ''}`).join(' · '))
}

console.log('── never the same minute as duty-push; the Friday duty tick is >= 5 minutes before the digest tick')
{
  const r = (await q(`SELECT (SELECT schedule FROM cron.job WHERE jobname='weekend-digest') w, (SELECT schedule FROM cron.job WHERE jobname='duty-push') d`))[0]
  const wm = r.w.split(' ')[0].split(',').map(Number), dm = r.d.split(' ')[0].split(',').map(Number)
  t(`minute lists ${wm} vs ${dm} share nothing`, wm.filter(m => dm.includes(m)), [])
  const fri = (await q(`SELECT to_char(min((ts AT TIME ZONE 'Asia/Famagusta')::time), 'HH24:MI') d
     FROM (SELECT h + make_interval(mins => 57) ts FROM generate_series(timestamptz '2026-11-27 00:00+00', timestamptz '2026-11-27 23:00+00', interval '1 hour') h) x
    WHERE public.duty_push_due(ts)`))[0].d
  t('Fri duty due tick 16:57 (the digest tick 17:03 is 6 minutes later)', fri, '16:57')
}

console.log('── pause: no send while paused, send again after (the real data_jobs row, then restored)')
await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness', paused_at = now() WHERE key = 'weekend-digest'`)
const pausedNow = await due('2026-11-27 15:03+00')
await db.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'weekend-digest'`)
t('Fri 17:03 local: due -> paused: not due -> resumed: due', [true, pausedNow, await due('2026-11-27 15:03+00')], [true, false, true])

console.log('── who can call it (denials with their positive control)')
const msg = r => (r.ok ? 'ALLOWED' : /permission denied/.test(r.msg) ? 'permission denied' : r.msg)
t('anon / authenticated denied; owner (postgres) and service_role allowed (positive controls)',
  [msg(await asRole(db, 'anon', null, `SELECT public.weekend_digest_due()`)),
   msg(await asRole(db, 'authenticated', ADMIN, `SELECT public.weekend_digest_due()`)),
   msg(await asRole(db, null, null, `SELECT public.weekend_digest_due('2026-11-27 15:03+00') b`)),
   msg(await asRole(db, 'service_role', null, `SELECT public.weekend_digest_due('2026-11-27 15:03+00') b`))],
  ['permission denied', 'permission denied', 'ALLOWED', 'ALLOWED'])
t('has_function_privilege by role name: anon false, authenticated false, postgres true',
  (await q(`SELECT has_function_privilege('anon', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') u, has_function_privilege('postgres', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') p`))[0],
  { a: false, u: false, p: true })
t('ledger row written by the file itself', (await q(`SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${SHIFT}'`))[0].n, 1)

console.log('── re-run on the applied state refuses (not the 0,30 job any more)')
{
  const r = await run(db, nonotify(SHIFT_SQL))
  t('second apply: refused', [r.ok, (r.msg || '').includes('is not the active job at 0,30 * * * 5,6')], [false, true])
}

console.log('── refusals (the file stops, nothing applied)')
{
  const probe = async (label, prep, want, opts) => {
    const d = await base(opts)
    await d.exec(prep)
    const r = await run(d, nonotify(SHIFT_SQL))
    t(label, [r.ok, (r.msg || '').includes(want)], [false, true])
    if (r.ok === false && !(r.msg || '').includes(want)) console.log('      got: ' + r.msg)
    else console.log('      refusal: ' + r.msg)
  }
  await probe('weekend-digest paused at apply time', `UPDATE data_jobs SET paused = true, paused_note = 'x', paused_at = now() WHERE key = 'weekend-digest'`, 'weekend-digest is paused')
  await probe('hand-edited schedule (5,35)', `UPDATE cron.job SET schedule = '5,35 * * * 5,6' WHERE jobname = 'weekend-digest'`, 'not the active job at 0,30 * * * 5,6')
  await probe('inactive job', `UPDATE cron.job SET active = false WHERE jobname = 'weekend-digest'`, 'not the active job at 0,30 * * * 5,6')
  await probe('hand-edited command (one extra space)', `UPDATE cron.job SET command = replace(command, 'SELECT net', 'SELECT  net') WHERE jobname = 'weekend-digest'`, 'exactly the 20261187 command')
  await probe('command already carries a timeout', `UPDATE cron.job SET command = replace(command, 'body    := ''{}''::jsonb)', 'body    := ''{}''::jsonb, timeout_milliseconds := 60000)') WHERE jobname = 'weekend-digest'`, 'exactly the 20261187 command')
  await probe('inline key pasted into the command', `UPDATE cron.job SET command = replace(command, 'SELECT net', '-- eyJabc' || chr(10) || 'SELECT net') WHERE jobname = 'weekend-digest'`, 'exactly the 20261187 command')
  await probe('weekend-digest job missing', `DELETE FROM cron.job WHERE jobname = 'weekend-digest'`, 'exactly one cron job named weekend-digest')
  await probe('a second job calling the gate', `INSERT INTO cron.job (jobname, schedule, command) VALUES ('digest-copy', '1 * * * *', 'SELECT 1 WHERE public.weekend_digest_due()')`, 'exactly one cron job calling weekend_digest_due')
  await probe('gate edited (minute < 45)', `CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $f$
      SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5 AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17' AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 45
         AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r WHERE r.mode = 'all' AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date)
         AND NOT public.data_job_paused('weekend-digest') $f$;
    REVOKE ALL ON FUNCTION public.weekend_digest_due(timestamptz) FROM PUBLIC, anon, authenticated`, 'not the 20261210 definition')
  await probe('gate without its pause clause (the 20261177 body)', `CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $f$
      SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5 AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17' AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 30
         AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r WHERE r.mode = 'all' AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date) $f$;
    REVOKE ALL ON FUNCTION public.weekend_digest_due(timestamptz) FROM PUBLIC, anon, authenticated`, 'not the 20261210 definition')
  await probe('pg_cron without alter_job(job_id, schedule, command)', `DROP FUNCTION cron.alter_job(bigint, text, text, text, text, boolean)`, 'no cron.alter_job')
  await probe('pg_net without a timeout_milliseconds parameter', `DROP FUNCTION net.http_post(text, jsonb, jsonb, int); CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}') RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$`, 'no timeout_milliseconds parameter')
  await probe('20261221 not applied (duty push still at 0,30: its Friday tick would be 17:00, 3 minutes from 17:03)', `SELECT 1`, 'at least 5 minutes before 17:03', { withDutyShift: false })
}

console.log('── apply window: the file at a controlled clock (gate: Friday 17:00-17:29 local, no run yet today; refusal from 5 min before to 20 min after)')
const REFUSAL = "within 20 minutes of today's weekend digest slot"
const attemptDb = async (localIso, sql = SHIFT_SQL) => {
  const d = await base()
  await clock(d, localIso)
  const r = await run(d, nonotify(sql))
  return { r, d }
}
const attempt = async (localIso, sql = SHIFT_SQL) => (await attemptDb(localIso, sql)).r
const dayName = iso => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const WIN = [
  ['2026-11-27 16:30', false], ['2026-11-27 16:39:59', false], ['2026-11-27 16:40', true], ['2026-11-27 16:58', true], ['2026-11-27 17:03', true], ['2026-11-27 17:10', true],
  ['2026-11-27 17:34:59', true], ['2026-11-27 17:35', false], ['2026-11-27 17:40', false],
  ['2026-11-28 16:58', false], ['2026-11-28 17:10', false], ['2026-11-26 16:58', false], ['2026-11-26 17:10', false], ['2026-11-29 17:10', false], ['2026-11-30 17:10', false],
]
for (const [iso, refuse] of WIN) {
  const r = await attempt(iso)
  const refused = !r.ok && r.msg.includes(REFUSAL)
  t(`${dayName(iso)} ${iso.slice(11)} local: ${refuse ? 'REFUSED' : 'accepted'}`, [r.ok, refused, r.ok ? null : (refused ? null : r.msg)], [!refuse, refuse, null])
  if (refused && iso.endsWith('16:58') && iso.startsWith('2026-11-27')) console.log(`      message: ${r.msg}`)
}
{
  // a Friday whose 'all' run already exists: the gate is false, so the window does not refuse (and it sends nothing more that day)
  const d = await base()
  await d.exec(`INSERT INTO public.weekend_digest_runs (started_at, finished_at, outcome, mode) VALUES ('2026-11-27 15:03:05+00', '2026-11-27 15:03:20+00', 'sent', 'all')`)
  await clock(d, '2026-11-27 17:10')
  const r = await run(d, nonotify(SHIFT_SQL))
  t("Fri 17:10 with today's 'all' run already recorded: accepted (the gate is false for the rest of the day)", [r.ok, r.msg ?? null], [true, null])
}
{
  const { r, d } = await attemptDb('2026-11-27 16:58')
  await d.exec('ROLLBACK')
  const a = await d.query(`SELECT (SELECT schedule FROM cron.job WHERE jobname='weekend-digest') sched, (SELECT command FROM cron.job WHERE jobname='weekend-digest') cmd`)
  t('refusal leaves nothing applied (schedule still 0,30, command still without the timeout)', [r.ok, a.rows[0].sched, a.rows[0].cmd === WEEK_CMD_TEXT], [false, '0,30 * * * 5,6', true])
}
{
  const IF_BLOCK = SHIFT_SQL.slice(SHIFT_SQL.indexOf('  IF EXISTS (SELECT 1 FROM generate_series(clock_timestamp()'), SHIFT_SQL.indexOf('  -- captured, compared again at the end'))
  assert.ok(IF_BLOCK.includes('REFUSING: within 20 minutes') && IF_BLOCK.length < 600, 'refusal block slice')
  const noRefusal = SHIFT_SQL.replace(IF_BLOCK, '')
  assert.ok(noRefusal !== SHIFT_SQL && !noRefusal.includes('within 20 minutes of'), 'mutant landed')
  const m1 = await attempt('2026-11-27 16:58', noRefusal)
  t('red-first: refusal removed -> the file APPLIES at Fri 16:58 (the window test above would fail = caught)', m1.ok, true)
  const short = SHIFT_SQL.replace(IF_BLOCK, IF_BLOCK.replace("clock_timestamp() + interval '20 minutes'", "clock_timestamp() + interval '2 minutes'"))
  assert.ok(short !== SHIFT_SQL && short.includes("interval '2 minutes'"), 'short mutant landed')
  const m2 = await attempt('2026-11-27 16:40', short)
  t('red-first: window shortened to +2 min -> applies at Fri 16:40 (boundary test would fail = caught)', m2.ok, true)
  const noback = SHIFT_SQL.replace(IF_BLOCK, IF_BLOCK.replace("clock_timestamp() - interval '5 minutes'", 'clock_timestamp()'))
  assert.ok(noback !== SHIFT_SQL && IF_BLOCK.includes("clock_timestamp() - interval '5 minutes'"), 'noback mutant landed')
  const m3 = await attempt('2026-11-27 17:34:59', noback)
  t('red-first: look-back (-5 min) removed -> applies at Fri 17:34:59 (caught)', m3.ok, true)
}

console.log('── red-first mutants (each breaks ONE thing; the file itself must refuse; the anchor is asserted present)')
await mutant('schedule left at 0,30 (the equality check)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '0,30 * * * 5,6', command := v_new`, 'not the active job at 3,33')
await mutant('schedule 57,27 (duty push minutes)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '27,57 * * * 5,6', command := v_new`, 'not the active job at 3,33')
await mutant('3,33 on Saturdays only (* * 6)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '3,33 * * * 6', command := v_new`, 'not the active job at 3,33')
await mutant('a third tick (3,33,0)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '3,33,0 * * * 5,6', command := v_new`, 'not the active job at 3,33')
console.log('   -- the same schedule mutants with the equality check removed: the SWEEP and tolerance controls have to notice')
await mutant('SWEEP: schedule 0,30 (17:00 would send, not 17:03)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '0,30 * * * 5,6', command := v_new`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: schedule 57,27 (shares duty-push minutes)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '27,57 * * * 5,6', command := v_new`, 'shares a minute-of-hour', RELAXED_SQL)
await mutant('SWEEP: 3,33 on Saturday only (no Friday send)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '3,33 * * * 6', command := v_new`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 3,33 on Friday only (the Saturday tick the file promises is gone)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '3,33 * * * 5', command := v_new`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 8,38 (a Friday send at 17:08)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '8,38 * * * 5,6', command := v_new`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 3,13,33 (two due ticks on the Friday)', `schedule := '3,33 * * * 5,6', command := v_new`, `schedule := '3,13,33 * * * 5,6', command := v_new`, 'sweep', RELAXED_SQL)
await mutant('timeout missing from the new command', `body    := '{}'::jsonb,\n    timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$new$`, `body    := '{}'::jsonb)\n  WHERE public.weekend_digest_due();\n$new$`, 'plus exactly one timeout')
await mutant('timeout changed to 30000', `timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$new$`, `timeout_milliseconds := 30000)\n  WHERE public.weekend_digest_due();\n$new$`, 'plus exactly one timeout')
await mutant('timeout written twice', `timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$new$`, `timeout_milliseconds := 60000,\n    timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$new$`, 'plus exactly one timeout')
await mutant('command otherwise altered (function URL)', `functions/v1/send-weekend-digest',\n    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||\n                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),\n    body    := '{}'::jsonb,\n    timeout_milliseconds`, `functions/v1/send-duty-notification',\n    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||\n                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),\n    body    := '{}'::jsonb,\n    timeout_milliseconds`, 'plus exactly one timeout')
await mutant('command otherwise altered (gate call dropped from the new command)', `    timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$new$`, `    timeout_milliseconds := 60000);\n$new$`, 'plus exactly one timeout')
await mutant('command otherwise altered (Vault key name)', `WHERE name = 'novest_sync_key')),\n    body    := '{}'::jsonb,\n    timeout_milliseconds`, `WHERE name = 'other_key')),\n    body    := '{}'::jsonb,\n    timeout_milliseconds`, 'plus exactly one timeout')
await mutant('the file also rewrites the gate (a CREATE OR REPLACE with minute < 31)', `-- ─── 2. The change: schedule and command, same jobid`, `CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $f$
  SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5 AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17' AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 31
     AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r WHERE r.mode = 'all' AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date)
     AND NOT public.data_job_paused('weekend-digest') $f$;
-- ─── 2. The change: schedule and command, same jobid`, 'weekend_digest_due changed')
await mutant("the file also rewrites the duty-push job (schedule 27,57 -> 28,58)", `-- ─── 2. The change: schedule and command, same jobid`, `SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'duty-push'), schedule := '28,58 * * * *');
-- ─── 2. The change: schedule and command, same jobid`, 'duty-push job changed')

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed')
process.exit(fail ? 1 : 0)
