// 20261245 (pause dovec-sync) and 20261246 (restart) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// By hand: node scripts/test-dovec-sync-pause-sql.mjs
// cron.* is a STUB here (schedule/unschedule/alter_job/job table). NOT evidence of: pg_cron's own parsing of a day/month schedule,
// the real cron.timezone value, a one-shot job unscheduling itself while it runs, pg_cron's alter_job on prod's version.
// The resume command's text IS executed here (run by hand as the job would), so its SQL is proven; the timing is not.
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { freshDb, asRole } from './migration-harness.mjs'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const FILES = readdirSync(MIG)
const find = re => { const f = FILES.find(x => re.test(x)); if (!f) { console.log('  ✗ file missing: ' + re); process.exit(1) } return f }
const read = f => readFileSync(MIG + f, 'utf8')
const nonotify = s => s.replace(/^NOTIFY pgrst.*$/m, '')
const PAUSE = find(/^20261245_dovec_sync_pause\.sql$/), RESTART = find(/^20261246_dovec_sync_restart\.sql$/)
const PAUSE_SQL = read(PAUSE), RESTART_SQL = read(RESTART)
const ADMIN = '00000000-0000-4000-8000-0000000000a1', ADMIN2 = '00000000-0000-4000-8000-0000000000a2', CUST = '00000000-0000-4000-8000-0000000000d1'
const SVC = '00000000-0000-4000-8000-0000000000f1'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const run = async (db, sql) => {
  const notices = []
  try { await db.exec(sql, { onNotice: n => notices.push(n.message) }); return { ok: true, notices } }
  catch (e) { return { ok: false, notices, msg: String(e.message || e).split('\n')[0] } }
}

const r1src = readFileSync(MIG + '20261205_data_jobs.sql', 'utf8')
const r1from = r1src.indexOf('INSERT INTO public.data_jobs (key')
const r1block = r1src.slice(r1from, r1src.indexOf("('purge-data-job-runs',", r1from) + 200)
const cronNames = [...new Set([...r1block.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1])))]
  .filter(n => !['x', 'zz-probe-no-such-cron-job', 'purge-data-job-runs'].includes(n))
const grab = (file, start, ends) => {
  const x = read(file)
  const i = x.indexOf(start)
  if (i < 0) { console.log(`  ✗ ${file}: ${start} not found`); process.exit(1) }
  const hits = ends.map(e => [x.indexOf(e, i + start.length), e]).filter(([j]) => j >= 0).sort((a, b) => a[0] - b[0])
  return x.slice(i, hits[0][0] + hits[0][1].length)
}
const cap = FILES.find(f => f.startsWith('20260718_capture_3_functions'))
const DUTY = FILES.find(f => f.startsWith('20261103_duty_push_famagusta'))
const WEEK = FILES.find(f => f.startsWith('20261177_weekend_digest_schedule'))
const F196 = '20261196_marketplace_photo_review_reminder.sql'
const DUTY_CMD_TEXT = read('20261139_duty_push_places_refresh_cron_timeout.sql').match(/SELECT cron\.schedule\('duty-push', '0,30 \* \* \* \*', \$job\$([\s\S]*?)\$job\$\);/)?.[1]
const WEEK_CMD_TEXT = read('20261187_weekend_digest_resume.sql').match(/SELECT cron\.schedule\('weekend-digest', '0,30 \* \* \* 5,6', \$job\$([\s\S]*?)\$job\$\);/)?.[1]
if (!DUTY_CMD_TEXT || !WEEK_CMD_TEXT) { console.log('  gate command texts not found'); process.exit(1) }
const SEED = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid serial PRIMARY KEY, jobid int, status text, start_time timestamptz, end_time timestamptz, return_message text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule), command = coalesce(alter_job.command, cron.job.command), active = coalesce(alter_job.active, cron.job.active) WHERE jobid = job_id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id serial PRIMARY KEY, name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
INSERT INTO vault.secrets (name, secret) VALUES ('novest_sync_key', 'test-not-a-real-key');
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.role() TO anon, authenticated, service_role;
CREATE TABLE public.contact_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  region text, lang text, item_id text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news')),
  CONSTRAINT contact_events_action_check CHECK (action IN ('call','whatsapp','call_secondary','website')));
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, module, entity_id, action, region, item_id, lang) ON public.contact_events TO anon, authenticated;
CREATE POLICY ce_insert_public ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer', push_token text);
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
CREATE TABLE public.marketplace_photo_reminder_state (id boolean NOT NULL DEFAULT true PRIMARY KEY, last_sent_at timestamptz);
${grab(F196, 'CREATE OR REPLACE FUNCTION public.marketplace_photo_review_reminder()', ['$function$;'])}
REVOKE ALL ON FUNCTION public.marketplace_photo_review_reminder() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_photo_review_reminder() TO service_role;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${ADMIN2}'), ('${CUST}');
INSERT INTO public.profiles (id, role, push_token) VALUES ('${ADMIN}', 'admin', 'ExponentPushToken[aaa]'), ('${ADMIN2}', 'admin', NULL), ('${CUST}', 'customer', 'ExponentPushToken[ccc]');
INSERT INTO cron.job (jobname, schedule, command) SELECT n, '0 3 * * *', 'SELECT 1' FROM unnest(ARRAY[${cronNames.map(n => `'${n}'`).join(',')}]) n;
UPDATE cron.job SET schedule = '0,30 * * * *', command = $dc$${DUTY_CMD_TEXT}$dc$ WHERE jobname = 'duty-push';
UPDATE cron.job SET schedule = '0,30 * * * 5,6', command = $wc$${WEEK_CMD_TEXT}$wc$ WHERE jobname = 'weekend-digest';
`
const CHAIN = [find(/^20261205_data_jobs\.sql$/), find(/^20261210_data_jobs_switches\.sql$/), find(/^20261211_data_jobs_watchdog\.sql$/),
  find(/^20261229_dovec_projects\.sql$/), find(/^20261231_dovec_read_gate\.sql$/), find(/^20261232_dovec_cron\.sql$/), find(/^20261240_dovec_leads_limits_definer\.sql$/), find(/^20261241_dovec_health_watchdog\.sql$/)]
const base = async () => {
  const d = await freshDb(SEED)
  // the cron names 20261205 lists as existing jobs, so the coverage assertion has something real to hold
  for (const f of CHAIN) {
    if (f.startsWith('20261232')) {
      // 20261232 needs its three jobs not yet scheduled; it schedules them itself
    }
    const r = await run(d, nonotify(read(f)))
    if (!r.ok) { console.log(`  ✗ prerequisite ${f} did not apply: ${r.msg}`); process.exit(1) }
  }
  return d
}
const mutant = async (label, sqlText, from, to, want, setup = '') => {
  if (!sqlText.includes(from)) { bad++; console.log(`  ✗ anchor missing for ${label}: ${from.slice(0, 60)}`); return }
  const d = await base()
  if (setup) await d.exec(setup)
  const r = await run(d, nonotify(sqlText.replace(from, () => to)))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}
const syncRow = async d => (await d.query(`SELECT active, schedule FROM cron.job WHERE jobname='dovec-sync'`)).rows
const resumeRows = async d => (await d.query(`SELECT schedule, active FROM cron.job WHERE jobname='dovec-sync-resume'`)).rows
const registry = async d => (await d.query(`SELECT (SELECT count(*)::int FROM public.data_jobs WHERE key='dovec-sync-resume') j,
  (SELECT count(*)::int FROM public.data_job_runs WHERE job_key='dovec-sync-resume') r,
  (SELECT count(*)::int FROM public.data_jobs_alert_state WHERE job_key='dovec-sync-resume') a`)).rows[0]
// the schedule's wall-clock fields read back as a timestamp (current year; December -> January wrap handled), compared to now() + 2 h .. + 3 h
const windowOf = async (d, tz) => (await d.query(`
  WITH s AS (SELECT string_to_array(schedule, ' ') f FROM cron.job WHERE jobname='dovec-sync-resume'),
  c AS (SELECT make_timestamp(extract(year FROM now() AT TIME ZONE '${tz}')::int, f[4]::int, f[3]::int, f[2]::int, f[1]::int, 0) AS ts, f FROM s)
  SELECT f[5] AS dow, f[1]::int AS minute,
         (SELECT (ts AT TIME ZONE '${tz}') - now() FROM c) AS delta_raw,
         ((ts AT TIME ZONE '${tz}') - now() >= interval '2 hours' AND (ts AT TIME ZONE '${tz}') - now() <= interval '3 hours') AS in_window FROM c`)).rows[0]
const covered = async d => (await d.query(`SELECT (SELECT count(*)::int FROM cron.job j WHERE (SELECT count(*) FROM public.data_jobs x WHERE j.jobname = ANY (x.cron_jobnames)) IS DISTINCT FROM 1) u,
  (SELECT count(*)::int FROM public.data_jobs x, unnest(x.cron_jobnames) n WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n)) g`)).rows[0]
const RESUME_CMD = async d => (await d.query(`SELECT command FROM cron.job WHERE jobname='dovec-sync-resume'`)).rows[0]?.command

console.log('── 20261245 pause on top of 20261205/10/11/29/31/32/40/41')
const d = await base()
const pubBefore = (await d.query(`SELECT published FROM public.dovec_settings WHERE id=1`)).rows[0].published
t('before: dovec-sync active, */10', await syncRow(d), [{ active: true, schedule: '*/10 * * * *' }])
const res = await run(d, nonotify(PAUSE_SQL))
t('the exact file applies (its own assertions ran clean)', [res.ok, res.msg ?? null], [true, null])
if (!res.ok) process.exit(1)
for (const n of res.notices) console.log('    NOTICE ' + n)
t('NOTICEs carry no uuid, e-mail or token', res.notices.every(n => !/[0-9a-f]{8}-[0-9a-f]{4}-|@|ExponentPushToken/i.test(n)), true)
t('dovec-sync inactive, schedule unchanged', await syncRow(d), [{ active: false, schedule: '*/10 * * * *' }])
const rr = await resumeRows(d)
t('exactly one active dovec-sync-resume', [rr.length, rr[0]?.active], [1, true])
const win = await windowOf(d, 'GMT')
console.log('    schedule ' + rr[0].schedule)
t('fire time is 2..3 h from now (GMT) and the minute is not 0', [win.in_window, win.minute !== 0, win.dow], [true, true, '*'])
t('registry row for the resume job exists', await registry(d), { j: 1, r: 0, a: 0 })
t('coverage holds while paused', await covered(d), { u: 0, g: 0 })
t('published unchanged', (await d.query(`SELECT published FROM public.dovec_settings WHERE id=1`)).rows[0].published, pubBefore)
const ov = (await d.query(`SELECT e->>'key' k, e->>'state' s, e->>'attention' a FROM jsonb_array_elements(public.data_jobs_overview(now())) e WHERE e->>'key' IN ('dovec-sync','dovec-sync-resume') ORDER BY 1`)).rows
t('data_jobs_overview: dovec-sync reads inactive + attention (the data-jobs watchdog will say "kapalı"), resume reads no attention', ov, [{ k: 'dovec-sync', s: 'inactive', a: 'true' }, { k: 'dovec-sync-resume', s: ov[1]?.s, a: 'false' }])

console.log('── re-apply is safe')
const again = await run(d, nonotify(PAUSE_SQL))
t('second apply', [again.ok, again.msg ?? null], [true, null])
t('still exactly one resume job and one registry row', [(await resumeRows(d)).length, (await registry(d)).j], [1, 1])

console.log('── the resume command, run by hand as pg_cron would')
const rc = await RESUME_CMD(d)
const fired = await run(d, rc)
t('the command runs as ONE statement', [fired.ok, fired.msg ?? null], [true, null])
t('dovec-sync active again, schedule untouched', await syncRow(d), [{ active: true, schedule: '*/10 * * * *' }])
t('nothing left: no resume job, no registry rows', [await resumeRows(d), await registry(d)], [[], { j: 0, r: 0, a: 0 }])
t('coverage holds after the resume', await covered(d), { u: 0, g: 0 })

console.log('── 20261246 restart: after the fallback fired / never paused / mid-pause')
const r1 = await run(d, nonotify(RESTART_SQL))
t('after the fallback fired (nothing to remove): applies', [r1.ok, r1.msg ?? null], [true, null])
for (const n of r1.notices) console.log('    NOTICE ' + n)
const dn = await base()
const r2 = await run(dn, nonotify(RESTART_SQL))
t('20261245 never applied: applies', [r2.ok, r2.msg ?? null], [true, null])
const dm = await base()
await run(dm, nonotify(PAUSE_SQL))
await dm.exec(`INSERT INTO public.data_job_runs (job_key, outcome, source) VALUES ('dovec-sync-resume', 'ok', 'test')`).catch(() => {})
await dm.exec(`INSERT INTO public.data_jobs_alert_state (job_key, last_attention) VALUES ('dovec-sync-resume', false)`).catch(() => {})
const pre = await registry(dm)
const r3 = await run(dm, nonotify(RESTART_SQL))
t('mid-pause: applies', [r3.ok, r3.msg ?? null], [true, null])
t('mid-pause: dovec-sync active at */10, resume job and all registry rows gone', [await syncRow(dm), await resumeRows(dm), await registry(dm)], [[{ active: true, schedule: '*/10 * * * *' }], [], { j: 0, r: 0, a: 0 }])
console.log(`    (registry rows before the restart: j=${pre.j}, r=${pre.r}, a=${pre.a}; the FK children, when the harness accepted them, were removed)`)
t('mid-pause: coverage holds, published unchanged', [await covered(dm), (await dm.query(`SELECT published FROM public.dovec_settings WHERE id=1`)).rows[0].published], [{ u: 0, g: 0 }, pubBefore])
const r4 = await run(dm, nonotify(RESTART_SQL))
t('restart twice: applies', [r4.ok, r4.msg ?? null], [true, null])
const dx = await base()
await dx.exec(`DELETE FROM cron.job WHERE jobname='dovec-sync'; DELETE FROM public.data_jobs WHERE key='dovec-sync'`)
const r5 = await run(dx, nonotify(RESTART_SQL))
t('restart REFUSES when dovec-sync is missing (never recreates it)', [r5.ok, (r5.msg || '').includes('exactly one dovec-sync cron job')], [false, true])
const dp = await base()
await dp.exec(`DELETE FROM cron.job WHERE jobname='dovec-sync'; DELETE FROM public.data_jobs WHERE key='dovec-sync'`)
const r6 = await run(dp, nonotify(PAUSE_SQL))
t('pause REFUSES when dovec-sync is missing', [r6.ok, (r6.msg || '').includes('exactly one dovec-sync cron job')], [false, true])

console.log('── time zone: the fields follow cron.timezone, not UTC')
const dz = await base()
await dz.exec(`SELECT set_config('cron.timezone', 'Asia/Famagusta', false)`)
const rz = await run(dz, nonotify(PAUSE_SQL))
t('applies with cron.timezone = Asia/Famagusta', [rz.ok, rz.msg ?? null], [true, null])
const wz = await windowOf(dz, 'Asia/Famagusta')
t('fire time is 2..3 h from now when read in Asia/Famagusta', wz.in_window, true)
console.log('    ' + rz.notices.find(n => n.startsWith('20261245 OK')))

console.log('── a minute another active job uses is skipped')
const dc = await base()
await run(dc, nonotify(PAUSE_SQL))
const first = (await resumeRows(dc))[0].schedule.split(' ')[0]
await dc.exec(`UPDATE cron.job SET active = true WHERE jobname = 'dovec-sync'`)
await run(dc, nonotify(RESTART_SQL))
await dc.exec(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('zz-collide', '${first} 3 * * *', 'SELECT 1'); INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, sort) VALUES ('zz-collide','cron_sql','maintenance',ARRAY['zz-collide'],99)`)
const rc2 = await run(dc, nonotify(PAUSE_SQL))
const second = (await resumeRows(dc))[0]?.schedule.split(' ')[0]
t('a job at the minute the first run chose pushes the resume to a later minute', [rc2.ok, second !== first], [true, true])
const dall = await base()
await dall.exec(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('zz-all', '* * * * *', 'SELECT 1'); INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, sort) VALUES ('zz-all','cron_sql','maintenance',ARRAY['zz-all'],99)`)
const ra = await run(dall, nonotify(PAUSE_SQL))
await dall.exec('ROLLBACK')
t('every minute taken: REFUSES, nothing applied', [ra.ok, (ra.msg || '').includes('no free minute'), (await syncRow(dall))[0].active], [false, true, true])

console.log('── red-first: each assertion fails when its target is broken')
await mutant('collision search skipped (every minute taken)', PAUSE_SQL, "    EXIT WHEN v_min <> 0 AND NOT EXISTS (", "    EXIT WHEN true OR NOT EXISTS (", 'fires at the resume minute',
  "INSERT INTO cron.job (jobname, schedule, command) VALUES ('zz-all', '* * * * *', 'SELECT 1'); INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, sort) VALUES ('zz-all','cron_sql','maintenance',ARRAY['zz-all'],99)")
await mutant('dovec-sync left active', PAUSE_SQL, 'PERFORM cron.alter_job(job_id := v_jobid, active := false);', 'NULL;', 'INACTIVE')
await mutant('resume command without the self-unschedule', PAUSE_SQL, "    PERFORM cron.unschedule('dovec-sync-resume');\n", '', 'command shape')
await mutant('resume command without the re-activation', PAUSE_SQL, "active := true);\n    DELETE FROM public.data_job_runs", ");\n    DELETE FROM public.data_job_runs", 'command shape')
await mutant('registry row lists the wrong cron name', PAUSE_SQL, "ARRAY['dovec-sync-resume'], NULL, NULL, false, 62", "ARRAY['zz-none'], NULL, NULL, false, 62", 'not covered')
await mutant('fire time only 1 hour out', PAUSE_SQL, "v_target := now() + interval '2 hours';", "v_target := now() + interval '1 hour';", 'between 2 h and 3 h')
await mutant('dovec-sync command altered by the pause', PAUSE_SQL, "PERFORM cron.alter_job(job_id := v_jobid, active := false);", "PERFORM cron.alter_job(job_id := v_jobid, schedule := '*/5 * * * *', active := false);", 'INACTIVE')
await mutant('pause flips published', PAUSE_SQL, "-- ─── 1. switch dovec-sync off", "UPDATE public.dovec_settings SET published = NOT published WHERE id = 1;\n  -- ─── 1. switch dovec-sync off", 'published changed')
await mutant('restart without the alter_job', RESTART_SQL, "PERFORM cron.alter_job(job_id := v_jobid, schedule := '*/10 * * * *', active := true);", 'NULL;', 'not exactly one active job', nonotify(PAUSE_SQL))
await mutant('restart leaves the resume job', RESTART_SQL, "IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-sync-resume') THEN PERFORM cron.unschedule('dovec-sync-resume'); END IF;", '', 'still exists', nonotify(PAUSE_SQL))
await mutant('restart leaves the registry row', RESTART_SQL, "DELETE FROM public.data_jobs WHERE key = 'dovec-sync-resume';", '', 'row for dovec-sync-resume still exists', nonotify(PAUSE_SQL))

console.log(bad ? `\n${bad} FAILED` : '\nall green')
process.exit(bad ? 1 : 0)
