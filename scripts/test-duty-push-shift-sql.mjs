// 20261221 — duty push 3 minutes early (supabase/migrations/20261221_duty_push_shift_3min.sql) against a Supabase-shaped
// Postgres (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-duty-push-shift-sql.mjs
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
  return db
}
const SHIFT_SQL = read(SHIFT)
const mutant = async (label, from, to, want) => {
  assert.ok(SHIFT_SQL.includes(from), `${label}: anchor not in file: ${from}`)
  const mutated = SHIFT_SQL.replace(from, () => to)
  assert.ok(mutated !== SHIFT_SQL, `${label}: mutation did not land`)
  const db = await base()
  const r = await run(db, nonotify(mutated))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}

console.log("── 20261221 applied after 20261205 + 20261210: the file's own assertions + probes")
let db = await base()
const q = async sql => (await db.query(sql)).rows
const before = {
  cmd: (await q(`SELECT md5(command) m, jobid FROM cron.job WHERE jobname='duty-push'`))[0],
  weekendJob: (await q(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m FROM cron.job WHERE jobname='weekend-digest'`))[0].m,
  weekendFn: (await q(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`))[0].m,
  oldDef: (await q(`SELECT pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure) d`))[0].d,
  oldSched: (await q(`SELECT schedule s FROM cron.job WHERE jobname='duty-push'`))[0].s,
}
t('before: duty-push at 0,30 * * * *, no 3-minute shift in the gate', [before.oldSched, !before.oldDef.includes("interval '3 minutes'")], ['0,30 * * * *', true])
const res = await run(db, nonotify(SHIFT_SQL))
t('the exact file applies (its own assertions, sweeps and pause probe ran clean)', [res.ok, res.msg ?? null], [true, null])
console.log('  NOTICE lines printed by the file:')
for (const n of res.notices ?? []) console.log('    ' + n)
const nl = res.notices ?? []
t('NOTICE: Fri 2026-11-20 due at 16:57', nl.includes('20261221 Fri 2026-11-20 due at 16:57 Asia/Famagusta'), true)
t('NOTICE: Sat 2026-11-21 due at 12:57', nl.includes('20261221 Sat 2026-11-21 due at 12:57 Asia/Famagusta'), true)
t('NOTICE: Sun 2026-11-22 due at 07:57', nl.includes('20261221 Sun 2026-11-22 due at 07:57 Asia/Famagusta'), true)
t('NOTICE: one due tick per local day, March 2027 window', nl.some(n => n.includes('March 2027 clock change') && n.includes('one due tick per local day')), true)
t('NOTICE: one due tick per local day, October 2027 window', nl.some(n => n.includes('October 2027 clock change') && n.includes('one due tick per local day')), true)
t('NOTICE: pause probe true -> false -> true', nl.some(n => n.includes('{due=true,paused=false,resumed=true}')), true)
t('NOTICE: final OK line', nl.some(n => n.startsWith('20261221 OK:')), true)
t('NOTICES mention no user / token / notified / push counts', nl.every(n => !/\b(users?|tokens?|notified|push_ok)\b/i.test(n)), true)

console.log('── state after the apply (measured from outside the file)')
const after = {
  job: (await q(`SELECT schedule, active, md5(command) m, jobid FROM cron.job WHERE jobname='duty-push'`))[0],
  nJobs: (await q(`SELECT count(*)::int n FROM cron.job WHERE jobname='duty-push'`))[0].n,
  weekendJob: (await q(`SELECT md5(concat_ws('|', schedule, command, active::text, username)) m FROM cron.job WHERE jobname='weekend-digest'`))[0].m,
  weekendFn: (await q(`SELECT md5(pg_get_functiondef('public.weekend_digest_due(timestamptz)'::regprocedure)) m`))[0].m,
  def: (await q(`SELECT pg_get_functiondef('public.duty_push_due(timestamptz)'::regprocedure) d`))[0].d,
}
t('duty-push: one job, active, schedule 27,57 * * * *', [after.nJobs, after.job.active, after.job.schedule], [1, true, '27,57 * * * *'])
t('duty-push command md5 unchanged, jobid unchanged', [after.job.m === before.cmd.m, after.job.jobid === before.cmd.jobid], [true, true])
t('weekend-digest cron job unchanged (schedule, command, active, username)', after.weekendJob === before.weekendJob, true)
t('weekend_digest_due definition unchanged', after.weekendFn === before.weekendFn, true)
console.log('  pg_get_functiondef FROM line: ' + after.def.split('\n').filter(l => l.includes('AT TIME ZONE')).join(' | ').trim())
t('definition: +3 minutes sits before AT TIME ZONE; the 20261210 body otherwise intact',
  [after.def.includes("(p_at + interval '3 minutes') AT TIME ZONE 'Asia/Famagusta'"),
   after.def.replace("(p_at + interval '3 minutes')", 'p_at') === before.oldDef], [true, true])
const due = async iso => (await q(`SELECT public.duty_push_due('${iso}') b`))[0].b
t('Fri 14:57Z (16:57 local) due; 15:00Z (17:00) due; 15:27Z (17:27) not due; 14:56Z not due',
  [await due('2026-11-20 14:57+00'), await due('2026-11-20 15:00+00'), await due('2026-11-20 15:27+00'), await due('2026-11-20 14:56+00')], [true, true, false, false])

console.log('── one send per local day, measured again from outside, three windows (ticks = the live job schedule)')
const perDay = async (d0, d1) => (await q(`
  WITH mins AS (SELECT unnest(string_to_array(split_part(schedule, ' ', 1), ',')::int[]) m FROM cron.job WHERE jobname='duty-push'),
       ticks AS (SELECT h + make_interval(mins => m) ts FROM generate_series(timestamptz '${d0} 00:00+00' - interval '1 day', timestamptz '${d1} 23:00+00' + interval '1 day', interval '1 hour') h, mins),
       t AS (SELECT ts, (ts AT TIME ZONE 'Asia/Famagusta')::date d, to_char(ts AT TIME ZONE 'Asia/Famagusta', 'HH24:MI') lt FROM ticks WHERE public.duty_push_due(ts))
  SELECT to_char(d, 'Dy YYYY-MM-DD') dy, count(*)::int n, min(lt) tm FROM t WHERE d BETWEEN date '${d0}' AND date '${d1}' GROUP BY d ORDER BY d`))
for (const [label, d0, d1] of [['Fri 20 - Sun 22 Nov 2026', '2026-11-20', '2026-11-22'], ['March 2027 change (28 Mar)', '2027-03-21', '2027-04-04'], ['October 2027 change (31 Oct)', '2027-10-24', '2027-11-07']]) {
  const rows = await perDay(d0, d1)
  const nDays = (await q(`SELECT (date '${d1}' - date '${d0}' + 1)::int n`))[0].n
  t(`${label}: ${nDays} local days, each with exactly one due tick`, [rows.length, rows.every(r => r.n === 1)], [nDays, true])
  console.log('      ' + rows.map(r => `${r.dy} ${r.tm}`).join(' · '))
}

console.log('── pause: no send while paused, send again after (the real data_jobs row, then restored)')
await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness', paused_at = now() WHERE key = 'duty-push'`)
const pausedNow = await due('2026-11-20 14:57+00')
await db.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'duty-push'`)
t('Fri 16:57 local: due -> paused: not due -> resumed: due', [true, pausedNow, await due('2026-11-20 14:57+00')], [true, false, true])

console.log('── who can call it (denials with their positive control)')
const msg = r => (r.ok ? 'ALLOWED' : /permission denied/.test(r.msg) ? 'permission denied' : r.msg)
t('anon / authenticated denied; owner (postgres) and service_role allowed (positive controls)',
  [msg(await asRole(db, 'anon', null, `SELECT public.duty_push_due()`)),
   msg(await asRole(db, 'authenticated', ADMIN, `SELECT public.duty_push_due()`)),
   msg(await asRole(db, null, null, `SELECT public.duty_push_due('2026-11-20 14:57+00') b`)),
   msg(await asRole(db, 'service_role', null, `SELECT public.duty_push_due('2026-11-20 14:57+00') b`))],
  ['permission denied', 'permission denied', 'ALLOWED', 'ALLOWED'])
t('has_function_privilege by role name: anon false, authenticated false, postgres true',
  (await q(`SELECT has_function_privilege('anon', 'public.duty_push_due(timestamptz)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.duty_push_due(timestamptz)', 'EXECUTE') u, has_function_privilege('postgres', 'public.duty_push_due(timestamptz)', 'EXECUTE') p`))[0],
  { a: false, u: false, p: true })
t('ledger row written by the file itself', (await q(`SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = '${SHIFT}'`))[0].n, 1)

console.log('── the read-only probe supabase/readonly/duty_push_shift_check.sql, on the applied db with seeded cron + run rows')
{
  const PROBE = readFileSync(rel('../supabase/readonly/duty_push_shift_check.sql'), 'utf8')
  const code = PROBE.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  t('probe is one SELECT, no write / DDL keyword', [/\b(insert|update|delete|drop|alter|create|grant|truncate)\b/i.test(code), (code.match(/;/g) || []).length], [false, 1])
  t('probe never reads notified / push_* / return_message / counts of people', /\b(notified|push_attempted|push_ok|push_errors|return_message|pharmacies)\b/i.test(code), false)
  await db.exec(`ALTER TABLE public.duty_push_runs ADD COLUMN error_kinds jsonb NOT NULL DEFAULT '{}'::jsonb`)
  await db.exec(`INSERT INTO cron.job_run_details (jobid, status, start_time)
    SELECT (SELECT jobid FROM cron.job WHERE jobname='duty-push'), CASE WHEN h % 5 = 0 THEN 'failed' ELSE 'succeeded' END, date_trunc('hour', now()) - make_interval(hours => h) + make_interval(mins => m)
      FROM generate_series(0, 40) h, unnest(ARRAY[27, 57]) m WHERE date_trunc('hour', now()) - make_interval(hours => h) + make_interval(mins => m) < now()`)
  await db.exec(`INSERT INTO public.duty_push_runs (started_at, finished_at, outcome, error_kinds) VALUES (now() - interval '2 hours', now() - interval '2 hours' + interval '4 seconds', 'sent', '{"DeviceNotRegistered": 3, "MessageRateExceeded": 1}'::jsonb)`)
  const r = (await db.query(PROBE)).rows[0].duty_push_shift_check
  const days = r.cron_per_day
  t('cron jobs listed: duty-push 27,57 active; weekend-digest still 0,30 * * * 5,6', r.cron_jobs.map(j => `${j.job} ${j.schedule} ${j.active}`), ['duty-push 27,57 * * * * true', 'weekend-digest 0,30 * * * 5,6 true'])
  t('gate booleans: 3-minute shift, pause clause, Famagusta; anon / authenticated cannot execute', r.gate, { exists: true, has_3min_shift: true, has_pause_clause: true, reads_famagusta: true, anon_can_execute: false, authenticated_can_execute: false })
  t('ledger row: the 20261221 file, checksum shown as 12 chars', [r.ledger_20261221.length, r.ledger_20261221[0].filename === SHIFT, r.ledger_20261221[0].checksum12.length], [1, true, 12])
  t('cron_per_day: every day shows minutes {27,57} only, ticks = succeeded + failed', [days.length > 0, days.every(d => JSON.stringify(d.minutes_seen) === '[27,57]' && d.ticks === d.succeeded + d.failed + d.other)], [true, true])
  t('cron_last_24h: raw list of start time + status only', [r.cron_last_24h.length > 0, r.cron_last_24h.every(x => Object.keys(x).sort().join() === 'start,status')], [true, true])
  t('duty_push_runs per day: started_at, outcome, error_kinds KEYS only (no values)', r.duty_push_runs_per_day.flatMap(d => d.runs).map(x => [Object.keys(x).sort().join(), x.error_kinds]), [['error_kinds,outcome,started_at', ['DeviceNotRegistered', 'MessageRateExceeded']]])
  t('the probe output carries no count-like field names', /notified|push_ok|push_attempted|push_errors|return_message/i.test(JSON.stringify(r)), false)
  console.log('      sample: ' + JSON.stringify({ cron_jobs: r.cron_jobs, gate: r.gate, ledger: r.ledger_20261221, day0: days[0], runs: r.duty_push_runs_per_day }).slice(0, 700))
  const dpre = await base()
  await dpre.exec(`ALTER TABLE public.duty_push_runs ADD COLUMN error_kinds jsonb NOT NULL DEFAULT '{}'::jsonb`)
  const rpre = (await dpre.query(PROBE)).rows[0].duty_push_shift_check
  t('BEFORE the apply: ledger row absent, duty-push 0,30, no 3-minute shift in the gate', [rpre.ledger_20261221, rpre.cron_jobs.find(j => j.job === 'duty-push').schedule, rpre.gate.has_3min_shift], [[], '0,30 * * * *', false])
}

console.log('── refusals (the file stops, nothing applied)')
{
  const d = await base()
  await d.exec(`UPDATE data_jobs SET paused = true, paused_note = 'x', paused_at = now() WHERE key = 'duty-push'`)
  const r = await run(d, nonotify(SHIFT_SQL))
  t('duty-push paused at apply time: refused', [r.ok, (r.msg || '').includes('duty-push is paused; the sweep cannot prove one send per day')], [false, true])
  const d2 = await base()
  await d2.exec(`UPDATE cron.job SET schedule = '5,35 * * * *' WHERE jobname = 'duty-push'`)
  const r2 = await run(d2, nonotify(SHIFT_SQL))
  t('duty-push hand-edited schedule: refused', [r2.ok, (r2.msg || '').includes('not the active job at 0,30')], [false, true])
  const d3 = await base()
  await d3.exec(`DROP FUNCTION cron.alter_job(bigint, text, text, text, text, boolean)`)
  const r3 = await run(d3, nonotify(SHIFT_SQL))
  t('pg_cron without alter_job: refused', [r3.ok, (r3.msg || '').includes('no cron.alter_job')], [false, true])
}

console.log('── red-first mutants (each breaks ONE thing; the file itself must refuse; the anchor is asserted present)')
await mutant('+3 minutes removed (cron-only shift: 17:27 would not send)', `(p_at + interval '3 minutes') AT TIME ZONE`, `p_at AT TIME ZONE`, 'must add + interval')
await mutant('+3 placed AFTER AT TIME ZONE', `(p_at + interval '3 minutes') AT TIME ZONE 'Asia/Famagusta' AS t`, `(p_at AT TIME ZONE 'Asia/Famagusta') + interval '3 minutes' AS t`, 'must add + interval')
await mutant("interval '33 minutes'", `(p_at + interval '3 minutes') AT TIME ZONE`, `(p_at + interval '33 minutes') AT TIME ZONE`, 'must add + interval')
await mutant('pause clause dropped', `         AND NOT public.data_job_paused('duty-push')\n  FROM (SELECT (p_at`, `  FROM (SELECT (p_at`, 'lost its pause clause')
await mutant('schedule left at 0,30', `schedule := '27,57 * * * *'`, `schedule := '0,30 * * * *'`, 'not the active job at 27,57')
await mutant('a second schedule 27,57,0 (double send)', `schedule := '27,57 * * * *'`, `schedule := '27,57,0 * * * *'`, 'not the active job at 27,57')
await mutant('Sunday slot off (08:00 -> 08:30): behaviour only, the text checks pass', `             WHEN 7 THEN time '08:00'\n             WHEN 6 THEN time '13:30' - interval '30 minutes'\n             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'\n             ELSE        time '17:30' - interval '30 minutes'\n           END)\n         AND NOT`, `             WHEN 7 THEN time '08:30'\n             WHEN 6 THEN time '13:30' - interval '30 minutes'\n             WHEN 4 THEN public.duty_thursday_closing_local() - interval '30 minutes'\n             ELSE        time '17:30' - interval '30 minutes'\n           END)\n         AND NOT`, 'sweep')
await mutant('weekday slot off by a minute (17:30 - 31 min): behaviour only', `             ELSE        time '17:30' - interval '30 minutes'\n           END)\n         AND NOT`, `             ELSE        time '17:30' - interval '31 minutes'\n           END)\n         AND NOT`, 'sweep')
await mutant('the new definition made VOLATILE', `RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$\n  SELECT (date_trunc`, `RETURNS boolean LANGUAGE sql VOLATILE SET search_path = '' AS $$\n  SELECT (date_trunc`, 'changed volatility')
{
  const relaxed = SHIFT_SQL.replace(`IF v_cmd IS NULL THEN RAISE EXCEPTION 'duty-push is not the active job at 27,57 * * * *'; END IF;`, '')
    .replace(`schedule := '27,57 * * * *'`, `schedule := '27,57,0 * * * *'`)
    .replace(`AND schedule = '27,57 * * * *'`, `AND schedule IS NOT NULL`)
  assert.ok(relaxed !== SHIFT_SQL && relaxed.includes('27,57,0 * * * *'), 'relaxed mutant did not land')
  const d = await base()
  const r = await run(d, nonotify(relaxed))
  t('double-send schedule with the equality check removed: the SWEEP still refuses', [r.ok, (r.msg || '').includes('sweep')], [false, true])
  console.log(`      refusal: ${r.msg}`)
}

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed')
process.exit(fail ? 1 : 0)
