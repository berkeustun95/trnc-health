// 20261239 — ROLLBACK of the 20261238 weekend digest shift (supabase/migrations/20261239_weekend_digest_shift_rollback.sql) against a
// Supabase-shaped Postgres (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-weekend-digest-shift-rollback-sql.mjs
// Order: 20261205 (data_jobs) -> 20261210 (the gate) -> 20261221 (duty push :27/:57) -> 20261238 (the shift this file undoes) -> 20261239.
// Evidence of: the file's own assertions run clean, every red-first mutant is REFUSED by the file itself, the behaviour measured from
// outside (roles, ticks), and that 1238 then 1239 returns the job to the exact 20261187 text. NOT evidence of: pg_cron / Vault / pg_net
// on the real database (cron.* and net.* are stubs, cron.alter_job has pg_cron's argument names), PG 17 pg_get_functiondef renderings.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, asRole } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = rel('../supabase/migrations/')
const FILES = readdirSync(MIG)
const A = FILES.find(f => /^\d+_data_jobs_switches\.sql$/.test(f))
const DUTYSHIFT = FILES.find(f => /^\d+_duty_push_shift_3min\.sql$/.test(f))
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

const SHIFT = FILES.find(f => /^\d+_weekend_digest_shift_3min\.sql$/.test(f))
const ROLL = FILES.find(f => /^\d+_weekend_digest_shift_rollback\.sql$/.test(f))
assert.ok(SHIFT, '20261238 file not found')
assert.ok(ROLL, 'RED: the 20261239 weekend digest rollback file does not exist')
const SHIFT_SQL = read(SHIFT)
const ROLL_SQL = read(ROLL)
// the state 20261238 leaves: shift applied on top of the base
const shifted = async () => {
  const d = await base()
  const r = await run(d, nonotify(SHIFT_SQL)); assert.ok(r.ok, '20261238 must apply: ' + r.msg)
  return d
}
const mutant = async (label, from, to, want, sql = ROLL_SQL) => {
  assert.ok(sql.includes(from), `${label}: anchor not in file: ${from}`)
  const mutated = sql.replace(from, () => to)
  assert.ok(mutated !== sql, `${label}: mutation did not land`)
  const db = await shifted()
  const r = await run(db, nonotify(mutated))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}
// the file's own equality check on the schedule removed, so the SWEEP (not the equality) has to notice
const RELAX_FROM = "SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'weekend-digest' AND active AND schedule = '0,30 * * * 5,6';"
const RELAXED_SQL = ROLL_SQL.replace(RELAX_FROM, "SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'weekend-digest' AND active AND schedule IS NOT NULL;")
assert.ok(RELAXED_SQL !== ROLL_SQL, 'relaxed variant did not land')
const SCHED_ANCHOR = `schedule := '0,30 * * * 5,6', command := v_old`

console.log('── state before 20261238 (the 20261187 state the rollback must restore)')
const d0 = await base()
const snap = async d => ({
  job: (await d.query(`SELECT schedule, command, jobid, active, username FROM cron.job WHERE jobname='weekend-digest'`)).rows[0],
  nJobs: (await d.query(`SELECT count(*)::int n FROM cron.job WHERE jobname='weekend-digest'`)).rows[0].n,
  nGateJobs: (await d.query(`SELECT count(*)::int n FROM cron.job WHERE command LIKE '%public.weekend_digest_due()%'`)).rows[0].n,
  gate: (await d.query(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`)).rows[0].m,
  attrs: (await d.query(`SELECT concat_ws('|', provolatile, prosecdef::text, proconfig::text, proacl::text, pg_get_userbyid(proowner)) a FROM pg_proc WHERE oid='public.weekend_digest_due(timestamptz)'::regprocedure`)).rows[0].a,
  duty: (await d.query(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m FROM cron.job WHERE jobname='duty-push'`)).rows[0].m,
  dutyFn: (await d.query(`SELECT md5(pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure)) m`)).rows[0].m,
  pauseRow: (await d.query(`SELECT paused, paused_note FROM data_jobs WHERE key='weekend-digest'`)).rows[0],
})
const s0 = await snap(d0)
t('before 20261238: weekend-digest at 0,30 * * * 5,6, exact 20261187 command, no timeout', [s0.job.schedule, s0.job.command === WEEK_CMD_TEXT, s0.job.command.includes('timeout_milliseconds')], ['0,30 * * * 5,6', true, false])

console.log('── 20261238 then 20261239 (the exact files)')
const d1 = await base()
const r38 = await run(d1, nonotify(SHIFT_SQL))
t('20261238 applies', [r38.ok, r38.msg ?? null], [true, null])
const s1 = await snap(d1)
t('after 20261238: 3,33 and the new command with the timeout (so the rollback has something to undo)', [s1.job.schedule, s1.job.command === NEW_CMD_TEXT], ['3,33 * * * 5,6', true])
const r39 = await run(d1, nonotify(ROLL_SQL))
t('20261239 applies (its own assertions, sweeps and pause probe ran clean)', [r39.ok, r39.msg ?? null], [true, null])
console.log('  NOTICE lines printed by the file:')
for (const n of r39.notices ?? []) console.log('    ' + n)
const nl = r39.notices ?? []
t('NOTICE: six sweep windows, each one due tick on the Friday at 17:00', nl.filter(n => n.includes('one due tick on the Friday at 17:00')).length, 6)
t('NOTICE: the clock-change windows ran (Mar 2027 forward, Oct 2027 back)', [nl.some(n => n.includes('clocks forward Sun 28 Mar')), nl.some(n => n.includes('clocks back Sun 31 Oct'))], [true, true])
t('NOTICE: pause probe true -> false -> true', nl.some(n => n.includes('{due=true,paused=false,resumed=true}')), true)
t('NOTICE: final OK line', nl.some(n => n.startsWith('20261239 OK:')), true)
t('NOTICES mention no user / token / notified / push counts', nl.every(n => !/\b(users?|tokens?|notified|push_ok)\b/i.test(n)), true)
const s2 = await snap(d1)
t('weekend-digest: one job, active, 0,30 * * * 5,6, jobid and username as before 20261238', [s2.nJobs, s2.job.active, s2.job.schedule, s2.job.jobid === s0.job.jobid, s2.job.username === s0.job.username], [1, true, '0,30 * * * 5,6', true, true])
t('command is BYTE-IDENTICAL to the 20261187 text (no timeout, one gate call, Vault lookup, no key)', [s2.job.command === WEEK_CMD_TEXT, s2.job.command.includes('timeout_milliseconds'), s2.job.command.includes('vault.decrypted_secrets'), s2.job.command.includes('WHERE public.weekend_digest_due()'), /eyJ|sb_secret/.test(s2.job.command)], [true, false, true, true, false])
console.log('      restored command: ' + JSON.stringify(s2.job.command))
t('exactly one job calls weekend_digest_due', s2.nGateJobs, 1)
t('weekend_digest_due definition (md5) and attributes identical to before 20261238', [s2.gate === s0.gate, s2.attrs === s0.attrs], [true, true])
t('duty-push job and duty_push_due md5 unchanged through both files', [s2.duty === s0.duty, s2.dutyFn === s0.dutyFn], [true, true])
t('data_jobs weekend-digest row unchanged (pause probe left no trace)', s2.pauseRow, s0.pauseRow)
const due = async iso => (await d1.query(`SELECT public.weekend_digest_due('${iso}') b`)).rows[0].b
t('Fri 15:00Z (17:00 local winter) due; 15:30Z not due; 15:03Z gate-yes but not a tick; Sat 15:00Z not due',
  [await due('2026-11-27 15:00+00'), await due('2026-11-27 15:30+00'), await due('2026-11-27 15:03+00'), await due('2026-11-28 15:00+00')], [true, false, true, false])
t('has_function_privilege by role name: anon false, authenticated false, postgres true',
  (await d1.query(`SELECT has_function_privilege('anon', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') u, has_function_privilege('postgres', 'public.weekend_digest_due(timestamptz)', 'EXECUTE') p`)).rows[0], { a: false, u: false, p: true })
const msg = r => (r.ok ? 'ALLOWED' : /permission denied/.test(r.msg) ? 'permission denied' : r.msg)
t('anon / authenticated denied; owner and service_role allowed (positive controls)',
  [msg(await asRole(d1, 'anon', null, `SELECT public.weekend_digest_due()`)), msg(await asRole(d1, 'authenticated', ADMIN, `SELECT public.weekend_digest_due()`)),
   msg(await asRole(d1, null, null, `SELECT public.weekend_digest_due('2026-11-27 15:00+00') b`)), msg(await asRole(d1, 'service_role', null, `SELECT public.weekend_digest_due('2026-11-27 15:00+00') b`))],
  ['permission denied', 'permission denied', 'ALLOWED', 'ALLOWED'])
t('ledger row written by the rollback itself', (await d1.query(`SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${ROLL}'`)).rows[0].n, 1)

console.log('── one send per Friday at 17:00 local after the rollback, six Fri/Sat pairs, ticks = the live job schedule (UTC day list 5,6)')
for (const fri of ['2026-11-20', '2026-11-27', '2027-03-26', '2027-04-02', '2027-10-29', '2027-11-05']) {
  const rows = (await d1.query(`
    WITH mins AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 1), ',')::int[]) m FROM cron.job WHERE jobname='weekend-digest'),
         dows AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 5), ',')::int[]) d FROM cron.job WHERE jobname='weekend-digest'),
         ticks AS (SELECT h + make_interval(mins => m) ts FROM generate_series(timestamptz '${fri} 00:00+00' - interval '2 days', timestamptz '${fri} 23:00+00' + interval '4 days', interval '1 hour') h, mins
                    WHERE extract(dow FROM h)::int IN (SELECT d FROM dows)),
         t AS (SELECT ts, (ts AT TIME ZONE 'Asia/Famagusta')::date d, to_char(ts AT TIME ZONE 'Asia/Famagusta', 'HH24:MI') lt, public.weekend_digest_due(ts) due FROM ticks)
    SELECT to_char(d, 'Dy YYYY-MM-DD') dy, count(*) FILTER (WHERE due)::int n_due, min(lt) FILTER (WHERE due) tm, count(*) FILTER (WHERE lt = '17:00')::int n1700
      FROM t WHERE d BETWEEN date '${fri}' - 1 AND date '${fri}' + 2 GROUP BY d ORDER BY d`)).rows
  const friRow = rows.find(r => r.dy.startsWith('Fri')), satRow = rows.find(r => r.dy.startsWith('Sat'))
  t(`${fri}: Fri one due tick at 17:00; Sat has its 17:00 tick and it is not due; every other day zero`,
    [friRow.n_due, friRow.tm, satRow.n1700, satRow.n_due, rows.filter(r => !r.dy.startsWith('Fri')).every(r => r.n_due === 0)], [1, '17:00', 1, 0, true])
  console.log('      ' + rows.map(r => `${r.dy} due=${r.n_due}${r.tm ? '@' + r.tm : ''}`).join(' · '))
}

console.log('── pause: no send while paused, send again after')
await d1.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness', paused_at = now() WHERE key = 'weekend-digest'`)
const pausedNow = await due('2026-11-27 15:00+00')
await d1.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'weekend-digest'`)
t('Fri 17:00 local: due -> paused: not due -> resumed: due', [true, pausedNow, await due('2026-11-27 15:00+00')], [true, false, true])

console.log('── re-run on the rolled-back state refuses (not the 3,33 job any more)')
{
  const r = await run(d1, nonotify(ROLL_SQL))
  t('second apply: refused', [r.ok, (r.msg || '').includes('is not the active job at 3,33 * * * 5,6')], [false, true])
}

console.log('── refusals (the file stops, nothing applied)')
{
  const probe = async (label, prep, want, fromShifted = true) => {
    const d = fromShifted ? await shifted() : await base()
    if (prep) await d.exec(prep)
    const r = await run(d, nonotify(ROLL_SQL))
    t(label, [r.ok, (r.msg || '').includes(want)], [false, true])
    console.log(r.ok === false && !(r.msg || '').includes(want) ? '      got: ' + r.msg : '      refusal: ' + r.msg)
  }
  await probe('rollback on the pre-20261238 state (nothing to undo)', null, 'is not the active job at 3,33 * * * 5,6', false)
  await probe('weekend-digest paused at apply time', `UPDATE data_jobs SET paused = true, paused_note = 'x', paused_at = now() WHERE key = 'weekend-digest'`, 'weekend-digest is paused')
  await probe('hand-edited schedule (5,35)', `UPDATE cron.job SET schedule = '5,35 * * * 5,6' WHERE jobname = 'weekend-digest'`, 'not the active job at 3,33 * * * 5,6')
  await probe('inactive job', `UPDATE cron.job SET active = false WHERE jobname = 'weekend-digest'`, 'not the active job at 3,33 * * * 5,6')
  await probe('hand-edited command (one extra space)', `UPDATE cron.job SET command = replace(command, 'SELECT net', 'SELECT  net') WHERE jobname = 'weekend-digest'`, 'exactly the 20261238 command')
  await probe('timeout edited to 30000', `UPDATE cron.job SET command = replace(command, 'timeout_milliseconds := 60000', 'timeout_milliseconds := 30000') WHERE jobname = 'weekend-digest'`, 'exactly the 20261238 command')
  await probe('inline key pasted into the command', `UPDATE cron.job SET command = replace(command, 'SELECT net', '-- eyJabc' || chr(10) || 'SELECT net') WHERE jobname = 'weekend-digest'`, 'exactly the 20261238 command')
  await probe('weekend-digest job missing', `DELETE FROM cron.job WHERE jobname = 'weekend-digest'`, 'exactly one cron job named weekend-digest')
  await probe('a second job calling the gate', `INSERT INTO cron.job (jobname, schedule, command) VALUES ('digest-copy', '1 * * * *', 'SELECT 1 WHERE public.weekend_digest_due()')`, 'exactly one cron job calling weekend_digest_due')
  await probe('gate edited (minute < 45)', `CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $f$
      SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5 AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17' AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 45
         AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r WHERE r.mode = 'all' AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date)
         AND NOT public.data_job_paused('weekend-digest') $f$;
    REVOKE ALL ON FUNCTION public.weekend_digest_due(timestamptz) FROM PUBLIC, anon, authenticated`, 'not the 20261210 definition')
  await probe('pg_cron without alter_job(job_id, schedule, command)', `DROP FUNCTION cron.alter_job(bigint, text, text, text, text, boolean)`, 'no cron.alter_job')
}

console.log('── apply window: the rollback at a controlled clock on the 20261238 state (gate: Friday 17:00-17:29 local, no run yet today; refusal from 5 min before to 20 min after)')
const REFUSAL = "within 20 minutes of today's weekend digest slot"
const attemptDb = async (localIso, sql = ROLL_SQL) => {
  const d = await shifted()
  await clock(d, localIso)
  return { r: await run(d, nonotify(sql)), d }
}
const attempt = async (localIso, sql = ROLL_SQL) => (await attemptDb(localIso, sql)).r
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
  if (refused && iso.endsWith('16:58')) console.log(`      message: ${r.msg}`)
}
{
  const d = await shifted()
  await d.exec(`INSERT INTO public.weekend_digest_runs (started_at, finished_at, outcome, mode) VALUES ('2026-11-27 15:03:05+00', '2026-11-27 15:03:20+00', 'sent', 'all')`)
  await clock(d, '2026-11-27 17:10')
  const r = await run(d, nonotify(ROLL_SQL))
  t("Fri 17:10 with today's 'all' run already recorded: accepted", [r.ok, r.msg ?? null], [true, null])
}
{
  const { r, d } = await attemptDb('2026-11-27 16:58')
  await d.exec('ROLLBACK')
  const a = await d.query(`SELECT (SELECT schedule FROM cron.job WHERE jobname='weekend-digest') sched, (SELECT command FROM cron.job WHERE jobname='weekend-digest') cmd`)
  t('refusal leaves nothing applied (schedule still 3,33, command still the new text)', [r.ok, a.rows[0].sched, a.rows[0].cmd === NEW_CMD_TEXT], [false, '3,33 * * * 5,6', true])
}
{
  const IF_BLOCK = ROLL_SQL.slice(ROLL_SQL.indexOf('  IF EXISTS (SELECT 1 FROM generate_series(clock_timestamp()'), ROLL_SQL.indexOf('  -- captured, compared again at the end'))
  assert.ok(IF_BLOCK.includes('REFUSING: within 20 minutes') && IF_BLOCK.length < 600, 'refusal block slice')
  const noRefusal = ROLL_SQL.replace(IF_BLOCK, '')
  assert.ok(noRefusal !== ROLL_SQL && !noRefusal.includes('within 20 minutes of'), 'mutant landed')
  t('red-first: refusal removed -> the file APPLIES at Fri 16:58 (the window test above would fail = caught)', (await attempt('2026-11-27 16:58', noRefusal)).ok, true)
  const short = ROLL_SQL.replace(IF_BLOCK, IF_BLOCK.replace("clock_timestamp() + interval '20 minutes'", "clock_timestamp() + interval '2 minutes'"))
  assert.ok(short !== ROLL_SQL && short.includes("interval '2 minutes'"), 'short mutant landed')
  t('red-first: window shortened to +2 min -> applies at Fri 16:40 (caught)', (await attempt('2026-11-27 16:40', short)).ok, true)
  assert.ok(IF_BLOCK.includes("clock_timestamp() - interval '5 minutes'"), 'noback anchor')
  const noback = ROLL_SQL.replace(IF_BLOCK, IF_BLOCK.replace("clock_timestamp() - interval '5 minutes'", 'clock_timestamp()'))
  assert.ok(noback !== ROLL_SQL, 'noback mutant landed')
  t('red-first: look-back (-5 min) removed -> applies at Fri 17:34:59 (caught)', (await attempt('2026-11-27 17:34:59', noback)).ok, true)
}

console.log('── red-first mutants (each breaks ONE thing; the file itself must refuse; the anchor is asserted present)')
await mutant('schedule left at 3,33', SCHED_ANCHOR, `schedule := '3,33 * * * 5,6', command := v_old`, 'not the active job at 0,30')
await mutant('schedule 27,57', SCHED_ANCHOR, `schedule := '27,57 * * * 5,6', command := v_old`, 'not the active job at 0,30')
await mutant('0,30 on Saturdays only (* * 6)', SCHED_ANCHOR, `schedule := '0,30 * * * 6', command := v_old`, 'not the active job at 0,30')
await mutant('a third tick (0,30,3)', SCHED_ANCHOR, `schedule := '0,30,3 * * * 5,6', command := v_old`, 'not the active job at 0,30')
console.log('   -- the same schedule mutants with the equality check removed: the SWEEP and tolerance controls have to notice')
await mutant('SWEEP: schedule 3,33 (17:03 would send, not 17:00)', SCHED_ANCHOR, `schedule := '3,33 * * * 5,6', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: schedule 27,57', SCHED_ANCHOR, `schedule := '27,57 * * * 5,6', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 0,30 on Saturday only (no Friday send)', SCHED_ANCHOR, `schedule := '0,30 * * * 6', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 0,30 on Friday only (the Saturday tick the file promises is gone)', SCHED_ANCHOR, `schedule := '0,30 * * * 5', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 5,35 (a Friday send at 17:05)', SCHED_ANCHOR, `schedule := '5,35 * * * 5,6', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('SWEEP: 0,10,30 (two due ticks on the Friday)', SCHED_ANCHOR, `schedule := '0,10,30 * * * 5,6', command := v_old`, 'sweep', RELAXED_SQL)
await mutant('timeout left in the restored command (command := v_cur)', SCHED_ANCHOR, `schedule := '0,30 * * * 5,6', command := v_cur`, 'not the expected restored text')
await mutant('timeout inside the restored literal', `body    := '{}'::jsonb)\n  WHERE public.weekend_digest_due();\n$old$`, `body    := '{}'::jsonb,\n    timeout_milliseconds := 60000)\n  WHERE public.weekend_digest_due();\n$old$`, 'minus exactly its timeout')
await mutant('command otherwise altered (function URL)', SCHED_ANCHOR, `schedule := '0,30 * * * 5,6', command := replace(v_old, 'send-weekend-digest', 'send-duty-notification')`, 'not the expected restored text')
await mutant('command otherwise altered (gate call dropped)', SCHED_ANCHOR, `schedule := '0,30 * * * 5,6', command := replace(v_old, 'WHERE public.weekend_digest_due()', '')`, 'not the expected restored text')
await mutant('command otherwise altered (Vault key name)', SCHED_ANCHOR, `schedule := '0,30 * * * 5,6', command := replace(v_old, 'novest_sync_key', 'other_key')`, 'not the expected restored text')
await mutant('the file also rewrites the gate (a CREATE OR REPLACE with minute < 31)', `-- ─── 2. The change: schedule and command back, same jobid`, `CREATE OR REPLACE FUNCTION public.weekend_digest_due(p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $f$
  SELECT extract(isodow FROM (p_at AT TIME ZONE 'Asia/Famagusta')) = 5 AND to_char(p_at AT TIME ZONE 'Asia/Famagusta', 'HH24') = '17' AND extract(minute FROM (p_at AT TIME ZONE 'Asia/Famagusta')) < 31
     AND NOT EXISTS (SELECT 1 FROM public.weekend_digest_runs r WHERE r.mode = 'all' AND (r.started_at AT TIME ZONE 'Asia/Famagusta')::date = (p_at AT TIME ZONE 'Asia/Famagusta')::date)
     AND NOT public.data_job_paused('weekend-digest') $f$;
-- ─── 2. The change: schedule and command back, same jobid`, 'weekend_digest_due changed')
await mutant('the file also rewrites the duty-push job (schedule 27,57 -> 28,58)', `-- ─── 2. The change: schedule and command back, same jobid`, `SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'duty-push'), schedule := '28,58 * * * *');
-- ─── 2. The change: schedule and command back, same jobid`, 'duty-push job changed')

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed')
process.exit(fail ? 1 : 0)
