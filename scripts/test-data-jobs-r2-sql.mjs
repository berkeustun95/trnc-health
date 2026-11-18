// Data jobs R2 (20261210 switches + 20261211 watchdog) against a Supabase-shaped Postgres
// (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-data-jobs-r2-sql.mjs
// Order: 20261205 (R1) -> 20261210 -> 20261211, as the one supabase-migrate run applies them.
// Evidence of: the files' own in-transaction assertions + probes run clean, the red-first mutants are caught, and the
// behaviour measured from outside (roles, claims, ticks). NOT evidence of: pg_cron / pg_net / Vault on the real database
// (cron.* and net.* are stubs here), the real cron.job.username, PG 17 renderings of pg_get_functiondef.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, asRole } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const MIG = rel('../supabase/migrations/')
const FILES = readdirSync(MIG)
const A = FILES.find(f => /^\d+_data_jobs_switches\.sql$/.test(f))
const B = FILES.find(f => /^\d+_data_jobs_watchdog\.sql$/.test(f))
assert.ok(A && B, 'R2 files not found')
const read = f => readFileSync(MIG + f, 'utf8')

let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  WANT ${JSON.stringify(want)}`}`)
}

// the real bodies, extracted at run time
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

// every cron job name 20261205 knows, so the coverage assertion is real
const r1src = read(R1)
const r1from = r1src.indexOf('INSERT INTO public.data_jobs (key')
const r1block = r1src.slice(r1from, r1src.indexOf("('purge-data-job-runs',", r1from) + 200)
const cronNames = [...new Set([...r1block.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1])))]
  .filter(n => !['x', 'zz-probe-no-such-cron-job'].includes(n))
const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const ADMIN2 = '00000000-0000-0000-0000-0000000000a2'
const CUST = '00000000-0000-0000-0000-0000000000c1'

const SEED = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid serial PRIMARY KEY, jobid int, status text, start_time timestamptz, end_time timestamptz, return_message text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
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
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${ADMIN2}'), ('${CUST}');
INSERT INTO public.profiles (id, role, push_token) VALUES ('${ADMIN}', 'admin', 'ExponentPushToken[aaa]'), ('${ADMIN2}', 'admin', NULL), ('${CUST}', 'customer', 'ExponentPushToken[ccc]');
INSERT INTO cron.job (jobname, schedule, command) SELECT n, '0 3 * * *', 'SELECT 1' FROM unnest(ARRAY[${cronNames.map(n => `'${n}'`).join(',')}]) n WHERE n NOT IN ('purge-data-job-runs');
-- live-scores as on prod (read 2026-11-16): all six paused (active = false), the polls every minute, the dailies at 03:00 / 03:02 / 03:04
UPDATE cron.job SET active = false, schedule = CASE jobname WHEN 'live-scores-basketball-poll' THEN '* * * * *' WHEN 'live-scores-f1-poll' THEN '* * * * *' WHEN 'live-scores-football-poll' THEN '* * * * *'
  WHEN 'live-scores-basketball-daily' THEN '0 3 * * *' WHEN 'live-scores-f1-daily' THEN '2 3 * * *' ELSE '4 3 * * *' END WHERE jobname LIKE 'live-scores-%';
UPDATE cron.job SET schedule = '0,30 * * * *', command = 'SELECT net.http_post() WHERE public.duty_push_due();' WHERE jobname = 'duty-push';
UPDATE cron.job SET schedule = '0,30 * * * 5,6', command = 'SELECT net.http_post() WHERE public.weekend_digest_due();' WHERE jobname = 'weekend-digest';
-- the live 2026-11-13 'all' run that made the old weekend probe date false on prod
INSERT INTO public.weekend_digest_runs (started_at, finished_at, outcome, mode) VALUES ('2026-11-13 15:00+00', '2026-11-13 15:00:05+00', 'sent', 'all');
`

const run = async (db, sql) => { try { await db.exec(sql); return { ok: true } } catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } } }
const build = async (upTo) => {
  const db = await freshDb(SEED)
  const r1r = await run(db, read(R1).replace(/^NOTIFY pgrst.*$/m, ''))
  assert.ok(r1r.ok, 'R1 must apply: ' + r1r.msg)
  if (upTo >= 1) { const r = await run(db, read(A).replace(/^NOTIFY pgrst.*$/m, '')); if (!r.ok) throw new Error('A: ' + r.msg) }
  if (upTo >= 2) { const r = await run(db, read(B).replace(/^NOTIFY pgrst.*$/m, '')); if (!r.ok) throw new Error('B: ' + r.msg) }
  return db
}
// red-first: break ONE thing in a file, require the file to refuse with a message naming it
const mutant = async (label, file, upTo, from, to, want, pre = '') => {
  const text = read(file)
  assert.ok(text.includes(from), `${label}: anchor not in file: ${from}`)
  const db = await freshDb(SEED)
  assert.ok((await run(db, read(R1).replace(/^NOTIFY pgrst.*$/m, ''))).ok)
  if (upTo === 2) assert.ok((await run(db, read(A).replace(/^NOTIFY pgrst.*$/m, ''))).ok)
  if (pre) assert.ok((await run(db, pre)).ok, `${label}: pre-SQL failed`)
  const r = await run(db, text.replace(from, to).replace(/^NOTIFY pgrst.*$/m, ''))
  t(`red-first ${label}`, !r.ok && r.msg.includes(want) ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
}

console.log('── file A applied after R1: its own assertions + probes ran inside the transaction')
let db = await build(1)
const q = async sql => (await db.query(sql)).rows
const asAdmin = (sql, uid = ADMIN, extra = {}) => asRole(db, 'authenticated', uid, sql)

t('switchable set (derived)', (await q(`SELECT string_agg(key, ',' ORDER BY key) k FROM data_jobs WHERE switchable`))[0].k,
  'duty-push,duyurular-fetch,gisekibris-feed,google-places-refresh,novest-images,sync-novest,weekend-digest')
t('nothing paused', (await q(`SELECT count(*)::int n FROM data_jobs WHERE paused`))[0].n, 0)
t('no stale right after apply (grace)', (await q(`SELECT count(*)::int n FROM jsonb_array_elements(data_jobs_overview()) e WHERE e->>'state' = 'stale'`))[0].n, 0)
t('records_expected_from set on every row', (await q(`SELECT count(*)::int n FROM data_jobs WHERE records_expected_from IS NULL`))[0].n, 0)
const r1 = await asAdmin(`SELECT public.admin_set_data_job_paused('novest-images', true, 'harness')->>'state' s`)
t('admin pauses (positive control)', r1.rows?.[0]?.s, 'paused')
const r2 = await asRole(db, 'authenticated', CUST, `SELECT public.admin_set_data_job_paused('novest-images', false, NULL)`)
t('customer refused', r2.msg, 'ADMIN_ONLY')
const r3 = await asRole(db, 'authenticated', ADMIN, `SELECT public.admin_set_data_job_paused('novest-images', false, NULL)->>'state' s`)
t('admin resumes (positive control)', r3.rows?.[0]?.s, 'no_record')
t('duty_push_due still not callable by authenticated', (await asAdmin(`SELECT public.duty_push_due()`)).msg?.slice(0, 29), 'permission denied for functio')
t('helper as service_role works', (await asRole(db, 'service_role', null, `SELECT public.duty_push_due('2030-01-07 12:00+00') b`)).ok, true)


console.log('── file A: who can call what (every denial has a positive control above or beside it)')
const asJwt = async (dbh, role, claims, sql) => {
  await dbh.exec('RESET ROLE;')
  await dbh.query("SELECT set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ''])
  if (role) await dbh.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await dbh.query(sql)).rows } } catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } } finally { await dbh.exec('RESET ROLE;') }
}
const SET = (job, paused, note) => `SELECT public.admin_set_data_job_paused('${job}', ${paused}, ${note === null ? 'NULL' : `'${note}'`}) j`
const msg = r => (r.ok ? 'ALLOWED' : r.msg.startsWith('permission denied') ? 'permission denied' : r.msg)
const GUEST = '00000000-0000-0000-0000-0000000000g1'.replace('g', 'd')
t('anon role', msg(await asJwt(db, 'anon', null, SET('gisekibris-feed', true, 'x'))), 'permission denied')
t('authenticated GUEST (anonymous session, unknown sub)', msg(await asJwt(db, 'authenticated', { sub: GUEST, role: 'authenticated', is_anonymous: true }, SET('gisekibris-feed', true, 'x'))), 'ADMIN_ONLY')
t('authenticated GUEST carrying an admin sub', msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated', is_anonymous: true }, SET('gisekibris-feed', true, 'x'))), 'ADMIN_ONLY')
t('authenticated NON-admin customer', msg(await asJwt(db, 'authenticated', { sub: CUST, role: 'authenticated' }, SET('gisekibris-feed', true, 'x'))), 'ADMIN_ONLY')
t('service_role with no user behind it (EXECUTE is not revoked from it by Supabase defaults; the gate still refuses)', msg(await asJwt(db, 'service_role', { role: 'service_role' }, SET('gisekibris-feed', true, 'x'))), 'ADMIN_ONLY')
t('nothing was paused by any refused caller', (await q(`SELECT count(*)::int n FROM data_jobs WHERE paused`))[0].n, 0)
const ap = await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, SET('gisekibris-feed', true, '  harness  '))
t('ADMIN pauses (positive control)', [ap.ok, ap.rows?.[0]?.j?.paused, ap.rows?.[0]?.j?.paused_note], [true, true, 'harness'])
const ar = await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, SET('gisekibris-feed', false, null))
t('ADMIN resumes with a NULL note (what the app sends)', [ar.ok, ar.rows?.[0]?.j?.paused, ar.rows?.[0]?.j?.paused_note], [true, false, null])
t('pause with a NULL note is refused', msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, SET('gisekibris-feed', true, null))), 'NOTE_REQUIRED')
t('pause with a tab-only note is refused', msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, `SELECT public.admin_set_data_job_paused('gisekibris-feed', true, E' \\t ')`)), 'NOTE_REQUIRED')
t('a non-switchable job is refused', msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, SET('daily-health', true, 'x'))), 'NOT_SWITCHABLE')
t('gate: anon / authenticated admin denied, service_role allowed (positive control)',
  [msg(await asJwt(db, 'anon', null, `SELECT public.data_job_gate('novest-images','github')`)),
   msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, `SELECT public.data_job_gate('novest-images','github')`)),
   msg(await asJwt(db, 'service_role', null, `SELECT public.data_job_gate('novest-images','github') g`))],
  ['permission denied', 'permission denied', 'ALLOWED'])
t('gate while paused, as service_role: paused, ONE skipped_paused row', await (async () => {
  await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'h', paused_by = '${ADMIN}', paused_at = now() WHERE key = 'novest-images'`)
  const g1 = await asJwt(db, 'service_role', null, `SELECT public.data_job_gate('novest-images','github','55') g`)
  const g2 = await asJwt(db, 'service_role', null, `SELECT public.data_job_gate('novest-images','github','56') g`)
  const n = (await q(`SELECT count(*)::int n FROM data_job_runs WHERE job_key = 'novest-images' AND outcome = 'skipped_paused'`))[0].n
  await db.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'novest-images'; DELETE FROM data_job_runs WHERE outcome = 'skipped_paused'`)
  return [g1.rows[0].g, g2.rows[0].g, n]
})(), ['paused', 'paused', 1])
t('due() gates keep their ACL: authenticated / service_role cannot call them, owner can', [msg(await asJwt(db, 'authenticated', { sub: ADMIN, role: 'authenticated' }, `SELECT public.weekend_digest_due()`)), (await asJwt(db, null, null, `SELECT public.weekend_digest_due('2030-01-04 15:00+00')`)).ok], ['permission denied', true])

console.log('── red-first mutants of file A (each must be refused by the file itself)')
await mutant('A: an eighth switchable job', A, 1, `'duty-push', 'weekend-digest');`, `'duty-push', 'weekend-digest', 'daily-health');`, 'switchable set is not the seven')
await mutant('A: pause clause missing from duty_push_due', A, 1, `         AND NOT public.data_job_paused('duty-push')\n  FROM`, `  FROM`, 'pause clause')
await mutant('A: gate dedupe removed', A, 1, `AND started_at > now() - interval '6 hours') THEN`, `AND started_at > now() - interval '0 hours') THEN`, 'probe results differ')
await mutant('A: grace ignored (stale at once)', A, 1, `WHEN j.expected_every IS NOT NULL AND j.l_key IS NULL AND j.grace_over THEN 'stale'`, `WHEN j.expected_every IS NOT NULL AND j.l_key IS NULL THEN 'stale'`, 'probe results differ')
await mutant('A: helper widened to anon', A, 1, `GRANT EXECUTE ON FUNCTION public.data_job_paused(text) TO service_role;`, `GRANT EXECUTE ON FUNCTION public.data_job_paused(text) TO service_role, anon;`, 'data_job_paused grants are wrong')
await mutant('A: guests allowed in the admin switch', A, 1, `IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN\n    RAISE EXCEPTION 'ADMIN_ONLY';\n  END IF;\n  IF p_job IS NULL`, `IF auth.uid() IS NULL OR NOT public.is_admin() THEN\n    RAISE EXCEPTION 'ADMIN_ONLY';\n  END IF;\n  IF p_job IS NULL`, 'probe results differ')

await mutant('A: trim only spaces (tab-only note passes)', A, 1, `v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');`, `v_note := btrim(p_note);`, 'probe results differ')
await mutant('A: pause clause missing from weekend_digest_due', A, 1, `     AND NOT public.data_job_paused('weekend-digest')\n$fn$;`, `$fn$;`, 'pause clause')
await mutant('A: weekend_digest_due made VOLATILE', A, 1, ` STABLE\n SET search_path = public, pg_catalog\nAS $fn$`, ` VOLATILE\n SET search_path = public, pg_catalog\nAS $fn$`, 'changed volatility')
await mutant('A: gate opened to authenticated', A, 1, `GRANT EXECUTE ON FUNCTION public.data_job_gate(text, text, text) TO service_role;`, `GRANT EXECUTE ON FUNCTION public.data_job_gate(text, text, text) TO service_role, authenticated;`, 'data_job_gate must be EXECUTE for service_role only')
await mutant('A: switch opened to anon', A, 1, `GRANT EXECUTE ON FUNCTION public.admin_set_data_job_paused(text, boolean, text) TO authenticated;`, `GRANT EXECUTE ON FUNCTION public.admin_set_data_job_paused(text, boolean, text) TO authenticated, anon;`, 'grants are wrong')
await mutant('A: resume no longer restamps the grace', A, 1, `paused_at = NULL, records_expected_from = now()`, `paused_at = NULL`, 'probe results differ')
await mutant('A: a resume without a note is refused (the app sends null)', A, 1, `  ELSIF v_row.paused THEN\n    UPDATE public.data_jobs\n       SET paused = false`, `  ELSIF v_row.paused AND p_note IS NULL THEN\n    RAISE EXCEPTION 'NOTE_REQUIRED';\n  ELSIF v_row.paused THEN\n    UPDATE public.data_jobs\n       SET paused = false`, 'NOTE_REQUIRED')

console.log('── file B applied after A')
db = await build(2)
const q2 = async sql => (await db.query(sql)).rows
const WD = `data-jobs-watchdog`
t('watchdog registry row + cron job', (await q2(`SELECT (SELECT count(*) FROM data_jobs WHERE key='${WD}' AND runner='cron_sql' AND kind='health' AND expected_every = interval '2 hours')::int a, (SELECT count(*) FROM cron.job WHERE jobname='${WD}')::int b`))[0], { a: 1, b: 1 })
t('coverage: every cron job has exactly one registry row', (await q2(`SELECT count(*)::int n FROM cron.job j WHERE (SELECT count(*) FROM data_jobs d WHERE j.jobname = ANY (d.cron_jobnames)) IS DISTINCT FROM 1`))[0].n, 0)
t('table unreachable to anon / authenticated', [(await asRole(db, 'anon', null, `SELECT 1 FROM data_jobs_alert_state`)).msg?.slice(0, 17), (await asRole(db, 'authenticated', ADMIN, `SELECT 1 FROM data_jobs_alert_state`)).msg?.slice(0, 17)], ['permission denied', 'permission denied'])
t('watchdog unreachable to anon / authenticated / service_role', await Promise.all(['anon', 'authenticated', 'service_role'].map(async r => (await asRole(db, r, ADMIN, `SELECT public.data_jobs_watchdog()`)).msg?.slice(0, 17))), ['permission denied', 'permission denied', 'permission denied'])
t('owner can call it (positive control)', (await asRole(db, null, null, `SELECT public.data_jobs_watchdog('2030-03-04 12:00+00') n`)).ok, true)
db.exec(`INSERT INTO cron.job_run_details (jobid, status, start_time, end_time) SELECT jobid, 'succeeded', now() - interval '10 minutes', now() - interval '10 minutes' + interval '1 second' FROM cron.job WHERE jobname = '${WD}'`)
const age = await asRole(db, 'service_role', null, `SELECT public.data_jobs_watchdog_age() a`)
t('watchdog_age as service_role reads cron (DEFINER)', age.ok && age.rows[0].a >= 590 && age.rows[0].a <= 700, true)
t('service_role cannot read cron.job_run_details itself (the DEFINER is load-bearing)', (await asRole(db, 'service_role', null, `SELECT 1 FROM cron.job_run_details`)).ok, false)
t('watchdog_age not callable by authenticated', (await asRole(db, 'authenticated', ADMIN, `SELECT public.data_jobs_watchdog_age()`)).msg?.slice(0, 17), 'permission denied')

console.log('── red-first mutants of file B (each must be refused by the file itself)')
await mutant('B: watchdog callable by service_role', B, 2, `REVOKE ALL ON FUNCTION public.data_jobs_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;`, `REVOKE ALL ON FUNCTION public.data_jobs_watchdog(timestamptz) FROM PUBLIC, anon, authenticated;`, 'EXECUTE-able by a role other than its owner')
await mutant('B: state table readable by authenticated', B, 2, `REVOKE ALL ON TABLE public.data_jobs_alert_state FROM PUBLIC, anon, authenticated, service_role;`, `REVOKE ALL ON TABLE public.data_jobs_alert_state FROM PUBLIC, anon, service_role;`, 'holds a privilege on data_jobs_alert_state')
await mutant('B: RLS off on the state table', B, 2, `ALTER TABLE public.data_jobs_alert_state ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE public.data_jobs_alert_state DISABLE ROW LEVEL SECURITY;`, 'RLS is not enabled')
await mutant('B: age function opened to authenticated', B, 2, `GRANT EXECUTE ON FUNCTION public.data_jobs_watchdog_age() TO service_role;`, `GRANT EXECUTE ON FUNCTION public.data_jobs_watchdog_age() TO service_role, authenticated;`, 'data_jobs_watchdog_age must be EXECUTE for service_role only')
await mutant('B: alerts every tick (not on change only)', B, 2, `IF v_att AND NOT v_last_att THEN`, `IF v_att THEN`, 'probe results differ')
await mutant('B: 24 h re-alert becomes 240 h', B, 2, `v_alerted < p_now - interval '24 hours'`, `v_alerted < p_now - interval '240 hours'`, 'probe results differ')
await mutant('B: no recovery line', B, 2, `v_lines := v_lines || (v_key || ': düzeldi');`, `NULL;`, 'probe results differ')
await mutant('B: Monday slot moved to Tuesday', B, 2, `extract(isodow FROM (p_now AT TIME ZONE 'Asia/Famagusta')) = 1`, `extract(isodow FROM (p_now AT TIME ZONE 'Asia/Famagusta')) = 2`, 'probe results differ')
await mutant('B: customers are notified too', B, 2, `FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP`, `FOR r IN SELECT id, push_token FROM profiles LOOP`, 'probe results differ')
await mutant('B: resumed line dropped', B, 2, `v_lines := v_lines || (v_key || ': yeniden başladı');`, `NULL;`, 'probe results differ')
await mutant('B: weekly reminder every 6 hours not 6 days', B, 2, `v_rem < p_now - interval '6 days'`, `v_rem < p_now - interval '6 hours'`, 'probe results differ')
await mutant('B: second cron job at the watchdog minutes is refused', B, 2, `SELECT cron.schedule('data-jobs-watchdog', '14,44 * * * *', 'SELECT public.data_jobs_watchdog();');`, `SELECT cron.schedule('data-jobs-watchdog', '14,44 * * * *', 'SELECT public.data_jobs_watchdog();');\nSELECT cron.schedule('zz-collide', '44 * * * *', 'SELECT 1');`, 'another cron job fires')
await mutant('B: an ACTIVE every-minute job is still refused (the paused live-scores polls are not)', B, 2, `SELECT cron.schedule('data-jobs-watchdog', '14,44 * * * *', 'SELECT public.data_jobs_watchdog();');`, `SELECT cron.schedule('data-jobs-watchdog', '14,44 * * * *', 'SELECT public.data_jobs_watchdog();');\nSELECT cron.schedule('zz-minute', '* * * * *', 'SELECT 1');`, 'another cron job fires')
await mutant('B: the collision check ignoring `active` refuses the paused polls (the original bug)', B, 2, `WHERE jobname <> 'data-jobs-watchdog' AND active`, `WHERE jobname <> 'data-jobs-watchdog'`, 'live-scores-football-poll (* * * * *)')

console.log('── file B applied while an admin has a REAL job paused (20261210 is live): no false "probe rows leaked"')
{
  const PAUSE = `UPDATE data_jobs SET paused = true, paused_note = 'harness real pause', paused_by = '${ADMIN}', paused_at = now() WHERE key = 'novest-images'`
  const d = await freshDb(SEED)
  assert.ok((await run(d, read(R1).replace(/^NOTIFY pgrst.*$/m, ''))).ok)
  assert.ok((await run(d, read(A).replace(/^NOTIFY pgrst.*$/m, ''))).ok)
  assert.ok((await run(d, PAUSE)).ok)
  const r = await run(d, read(B).replace(/^NOTIFY pgrst.*$/m, ''))
  t('B applies with novest-images paused', r.ok ? 'applied' : r.msg, 'applied')
  t('and the real pause survived the probes', (await d.query(`SELECT string_agg(key, ',' ORDER BY key) k FROM data_jobs WHERE paused`)).rows[0].k, 'novest-images')
}
await mutant('B: the old leak check (any paused job = leak) trips on a real pause', B, 2, `OR (SELECT coalesce(string_agg(key, ',' ORDER BY key), '') FROM public.data_jobs WHERE paused) IS DISTINCT FROM v_paused_keys`, `OR EXISTS (SELECT 1 FROM public.data_jobs WHERE paused)`, 'probe rows leaked',
  `UPDATE data_jobs SET paused = true, paused_note = 'harness real pause', paused_by = '${ADMIN}', paused_at = now() WHERE key = 'novest-images'`)

console.log('── watchdog behaviour measured from outside (own scenario: all admins, a probe-free quiet database)')
// quiet baseline: everything the live-looking seed reads as attention is alerted once, then state is stable
const tick = async (now = 'now()') => { await db.exec(`DELETE FROM notifications; DELETE FROM push_log; DELETE FROM net.calls`); await db.exec(`SELECT public.data_jobs_watchdog(${now})`); return (await q2(`SELECT user_id, title, body, type FROM notifications ORDER BY user_id`)) }
await tick()
t('second tick with no change sends nothing', (await tick()).length, 0)
await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness pause', paused_by = '${ADMIN}', paused_at = now() WHERE key = 'novest-images'`)
const pz = await tick()
t('a pause makes one notice per admin, none to the customer', [pz.length, pz.map(r => r.user_id).sort(), pz[0]?.type, pz[0]?.title], [2, [ADMIN, ADMIN2], 'admin_alert', 'Veri işleri'])
t('the pause line names the job and says why', pz[0]?.body.includes('novest-images') && pz[0]?.body.includes('harness pause'), true)
t('push only for the admin with a token; log has both', [(await q2(`SELECT count(*)::int n FROM net.calls`))[0].n, (await q2(`SELECT user_id, request_id IS NULL AS nulltok FROM push_log ORDER BY user_id`))], [1, [{ user_id: ADMIN, nulltok: false }, { user_id: ADMIN2, nulltok: true }]])
t('push data opens the Data jobs tab', (await q2(`SELECT body->'data' d FROM net.calls`))[0].d, { tab: 'datajobs', screen: 'admin' })

console.log('── watchdog tick sequences on a real job (duyurular-fetch, github), measured as admin notices')
await db.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'novest-images'`)
await tick()
const lines = async (key) => (await q2(`SELECT l FROM notifications n, regexp_split_to_table(n.body, E'\\n') l WHERE n.user_id = '${ADMIN}' AND l LIKE '${key}%' ORDER BY l`)).map(r => r.l)
await db.exec(`INSERT INTO data_job_runs (job_key, started_at, finished_at, outcome, error_class, source) VALUES ('duyurular-fetch', now() - interval '2 minutes', now() - interval '1 minute', 'failed', 'http_500', 'github')`)
await tick()
t('enters attention: one line', await lines('duyurular-fetch'), ['duyurular-fetch: başarısız'])
t('same red state next tick: silent', (await tick()).length, 0)
await db.exec(`UPDATE data_jobs_alert_state SET alerted_at = now() - interval '23 hours' WHERE job_key = 'duyurular-fetch'`)
t('still red after 23 h: silent', (await tick()).length, 0)
await db.exec(`UPDATE data_jobs_alert_state SET alerted_at = now() - interval '25 hours' WHERE job_key = 'duyurular-fetch'`)
await tick()
t('still red after 25 h: daily re-alert', await lines('duyurular-fetch'), ['duyurular-fetch: hâlâ başarısız'])
t('and then silent again (alerted_at restamped)', (await tick()).length, 0)
await db.exec(`INSERT INTO data_job_runs (job_key, started_at, finished_at, outcome, source) VALUES ('duyurular-fetch', now(), now(), 'ok', 'github')`)
await tick()
t('recovery: one line', await lines('duyurular-fetch'), ['duyurular-fetch: düzeldi'])
await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness pause', paused_by = '${ADMIN}', paused_at = '2029-12-31 22:30+00' WHERE key = 'novest-images'`)
await tick()
await db.exec(`UPDATE data_jobs SET paused = false, paused_note = NULL, paused_by = NULL, paused_at = NULL WHERE key = 'novest-images'`)
await tick()
t('resume line', await lines('novest-images'), ['novest-images: yeniden başladı'])
await db.exec(`UPDATE data_jobs SET paused = true, paused_note = 'harness pause', paused_by = '${ADMIN}', paused_at = '2029-12-31 22:30+00' WHERE key = 'novest-images'`)
await tick()
await tick(`timestamptz '2030-01-06 12:00+00'`)   // Sunday: the clock jump itself is recorded as already seen (under 24 h before the Monday ticks)
t('Sunday: no reminder', await lines('novest-images'), [])
t('Monday 08:59 local: no reminder', (await tick(`timestamptz '2030-01-07 06:59+00'`)).length, 0)
await tick(`timestamptz '2030-01-07 07:14+00'`)
t('Monday 09:14 Famagusta: the still-paused reminder (date and note)', await lines('novest-images'), ['novest-images: hâlâ durdurulmuş (01.01, harness pause)'])
t('that reminder pushed once (one admin has a token), opening the Data jobs tab', (await q2(`SELECT body->'data' d FROM net.calls`)).map(r => r.d), [{ tab: 'datajobs', screen: 'admin' }])
const m44 = await tick(`timestamptz '2030-01-07 07:44+00'`)
t('Monday 09:44 (next tick, outside the slot): silent', m44.map(r => r.body), [])
console.log('── supabase/verify_schema.sql QUERY 1 tokens 1205 + 1210 (H-version), evaluated as the file writes them')
{
  const VS = readFileSync(process.env.VERIFY_SCHEMA || rel('../supabase/verify_schema.sql'), 'utf8')
  const slice = (from, to) => { const x = VS.indexOf(from), y = VS.indexOf(to, x + 1); assert.ok(x >= 0 && y > x, 'verify_schema anchors missing: ' + from); return VS.slice(x, y) }
  const tokq = sl => `SELECT m, label, ok FROM (SELECT ''::text m, ''::text label, false ok WHERE false\n${sl}) z`
  const T05 = tokq(slice('    -- 1205-BEGIN', '    -- 1205-END')), T10 = tokq(slice('    -- 1210-BEGIN', '    -- 1210-END'))
  const tokens = async (dbh, label, sql, want) => {
    try {
      const r = (await dbh.query(sql)).rows
      t(`${label}: ${JSON.stringify(r.map(x => x.ok))}`, r.map(x => x.ok), want)
      return r
    } catch (e) { t(`${label} does not error`, String(e.message).split('\n')[0], 'no error') }
  }
  const OV = grab(A, 'CREATE OR REPLACE FUNCTION public.data_jobs_overview(', ['$function$;'])
  const OV1205 = grab(R1, 'CREATE OR REPLACE FUNCTION public.data_jobs_overview(', ['$function$;'])
  const n05 = 4, n10 = 7
  const rep = (n, v) => Array(n).fill(v)
  const d1 = await build(0)
  await tokens(d1, 'R1 only, 1205 tokens (all true)', T05, rep(n05, true))
  await tokens(d1, 'R1 only, 1210/1211 tokens (all false, no error)', T10, rep(n10, false))
  const d2 = await build(2)
  await tokens(d2, 'full R1+1210+1211, 1205 tokens (all true)', T05, rep(n05, true))
  await tokens(d2, 'full R1+1210+1211, 1210/1211 tokens (all true)', T10, rep(n10, true))
  // mutants on the full DB: the overview body goes back to the 1205 one / loses the grace gate on the first stale arm / loses the security pin
  const mutOv = async (label, body, want, want05 = rep(n05, true)) => {
    const d = await build(2)
    const r = await run(d, body)
    assert.ok(r.ok, `${label}: mutant did not apply: ${r.msg}`)
    await tokens(d, `MUTANT ${label}, 1210/1211 tokens`, T10, want)
    await tokens(d, `MUTANT ${label}, 1205 tokens (true unless the mutant breaks a fact 1205 still owns)`, T05, want05)
  }
  const ovIdx = 1
  const oneFalse = i => rep(n10, true).map((v, k) => k === i ? false : v)
  await mutOv('1205-era overview body', OV1205, oneFalse(ovIdx))
  assert.ok(OV.includes(`AND j.l_key IS NULL AND j.grace_over THEN 'stale'`), 'mutant anchor')
  await mutOv('first stale arm without grace', OV.replace(`AND j.l_key IS NULL AND j.grace_over THEN 'stale'`, `AND j.l_key IS NULL THEN 'stale'`), oneFalse(ovIdx))
  assert.ok(OV.includes(`SET search_path TO 'public'`), 'mutant anchor')
  await mutOv('overview without the search_path pin', OV.replace(`SET search_path TO 'public'`, ''), oneFalse(ovIdx))
  assert.ok(OV.includes(`WHERE dj.runner = 'cron_sql' AND`), 'mutant anchor')
  await mutOv('overview reading cron for every runner', OV.replace(`WHERE dj.runner = 'cron_sql' AND`, `WHERE`), oneFalse(ovIdx), [true, true, false, true])
}

console.log(fail ? `FAIL (${fail})` : 'ALL PASS')
process.exit(fail ? 1 : 0)
