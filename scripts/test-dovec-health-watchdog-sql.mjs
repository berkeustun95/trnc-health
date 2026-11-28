// 20261241 (Döveç health watchdog) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md). By hand:
//   node scripts/test-dovec-health-watchdog-sql.mjs
// The migration's own DO block carries the behaviour probes (every probe row rolled back); this file adds: the file applies on top
// of 20261205/10/11/29/31/32, re-applies cleanly, the measured state from outside, the dovec edge-function paths still work, and
// red-first mutants proving each assertion can fail (the file itself must REFUSE the mutant).
// NOT evidence of: pg_cron / pg_net / Vault on the real database (cron.* and net.* are stubs), PG 17 renderings, that live
// cron.job holds no job this stub lacks (the file's own collision check reads the live table at apply).
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { freshDb, asRole } from './migration-harness.mjs'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const FILES = readdirSync(MIG)
const find = re => { const f = FILES.find(x => re.test(x)); if (!f) { console.log('  ✗ file missing: ' + re); process.exit(1) } return f }
const read = f => readFileSync(MIG + f, 'utf8')
const nonotify = s => s.replace(/^NOTIFY pgrst.*$/m, '')
const NEW = find(/^20261241_dovec_health_watchdog\.sql$/)
const NEW_SQL = read(NEW)
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
  find(/^20261229_dovec_projects\.sql$/), find(/^20261231_dovec_read_gate\.sql$/), find(/^20261232_dovec_cron\.sql$/), find(/^20261240_dovec_leads_limits_definer\.sql$/)]
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
const mutant = async (label, from, to, want) => {
  if (!NEW_SQL.includes(from)) { bad++; console.log(`  ✗ anchor missing for ${label}: ${from.slice(0, 60)}`); return }
  const d = await base()
  const r = await run(d, nonotify(NEW_SQL.replace(from, () => to)))
  const caught = !r.ok && r.msg.includes(want)
  t(`red-first ${label}`, caught ? 'caught' : `NOT caught: ${r.ok ? 'applied' : r.msg}`, 'caught')
  if (caught) console.log(`      refusal: ${r.msg}`)
}

console.log('── 20261241 applied on top of 20261205/10/11/29/31/32')
const d = await base()
const res = await run(d, nonotify(NEW_SQL))
t('the exact file applies (its own assertions + probes ran clean)', [res.ok, res.msg ?? null], [true, null])
if (!res.ok) { process.exit(1) }
for (const n of res.notices) console.log('    NOTICE ' + n)
t('NOTICEs carry no uuid, e-mail or token', res.notices.every(n => !/[0-9a-f]{8}-[0-9a-f]{4}-|@|ExponentPushToken/i.test(n)), true)
t('final OK notice', res.notices.some(n => n.startsWith('20261241 OK:')), true)
const q = async sql => (await d.query(sql)).rows
t('cron job: one, active, exact schedule and command', await q(`SELECT jobname, schedule, command, active FROM cron.job WHERE jobname='dovec-health-check'`),
  [{ jobname: 'dovec-health-check', schedule: '9,24,39,54 * * * *', command: 'SELECT public.dovec_health_watchdog();', active: true }])
t('registry row', await q(`SELECT runner, kind, cron_jobnames, expected_every::text ee, sort FROM public.data_jobs WHERE key='dovec-health-check'`),
  [{ runner: 'cron_sql', kind: 'health', cron_jobnames: ['dovec-health-check'], ee: '01:00:00', sort: 61 }])
t('state table starts empty (the probes left nothing)', (await q(`SELECT count(*)::int n FROM public.dovec_health_alert_state`))[0].n, 0)
t('no Döveç notice, no health push_log left by the probes', await q(`SELECT (SELECT count(*)::int FROM public.notifications WHERE title='Döveç') n, (SELECT count(*)::int FROM public.push_log WHERE kind='dovec_health_alert') p`), [{ n: 0, p: 0 }])

console.log('── re-apply is safe (files are written re-runnable)')
const again = await run(d, nonotify(NEW_SQL))
t('second apply of the same file', [again.ok, again.msg ?? null], [true, null])

console.log('── the existing paths still work with the trigger in place')
await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p9','P','C','on_sale','https://example.com')`)
const lead = `INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status)
  VALUES ('${CUST}', gen_random_uuid(), repeat('d', 64), 'p9', 'X', '+441234567890', 'English', 'en', true, 'v', 'pending')`
const si = await asRole(d, 'service_role', SVC, lead)
t('service_role insert (edge function path) works', [si.ok, si.msg ?? null], [true, null])
const age = `UPDATE public.dovec_leads SET status_changed_at = now() - interval '3 days'`
const fresh = async () => (await d.query(`SELECT (status_changed_at >= now() - interval '1 minute') f FROM public.dovec_leads`)).rows.map(r => r.f)
t('stamp is set on insert', await fresh(), [true])
await d.exec(age)
const su = await asRole(d, 'service_role', SVC, `UPDATE public.dovec_leads SET attempts = 1, next_attempt_at = now()`)
t('service_role non-status update works and does NOT restamp', [su.ok, await fresh()], [true, [false]])
const su2 = await asRole(d, 'service_role', SVC, `UPDATE public.dovec_leads SET status = 'retry'`)
t('service_role status change works and restamps', [su2.ok, await fresh()], [true, [true]])
await d.exec(`UPDATE public.dovec_leads SET created_at = now() - interval '8 days'`)
await d.exec(age)
const w = await asRole(d, 'service_role', null, `SELECT public.dovec_leads_wipe_pii() AS n`)
t('dovec_leads_wipe_pii runs, settles the 8-day retry to failed and restamps', [w.ok, (await d.query(`SELECT status FROM public.dovec_leads`)).rows[0].status, await fresh()], [true, 'failed', [true]])
await d.exec(`UPDATE public.dovec_leads SET status = 'retry', status_changed_at = now() - interval '3 days', created_at = now()`)
const del = await run(d, `DELETE FROM auth.users WHERE id='${CUST}'`)
t('account deletion (dovec_leads_forget_user) works, settles to failed, restamps', [del.ok, (await d.query(`SELECT status, user_id IS NULL u FROM public.dovec_leads`)).rows[0], await fresh()], [true, { status: 'failed', u: true }, [true]])
t('the stamp trigger function is not executable by service_role (inserts above still work: positive control)', (await asRole(d, 'service_role', SVC, `SELECT public.dovec_leads_stamp_status()`)).ok, false)

console.log('── red-first: each assertion fails when its target is broken')
await mutant('column not NOT NULL', 'ALTER TABLE public.dovec_leads ALTER COLUMN status_changed_at SET NOT NULL;', '', 'missing, not timestamptz or nullable')
await mutant('column without DEFAULT now()', 'ALTER TABLE public.dovec_leads ALTER COLUMN status_changed_at SET DEFAULT now();', '', 'no DEFAULT now()')
await mutant('trigger on every column (not UPDATE OF status)', 'BEFORE INSERT OR UPDATE OF status ON', 'BEFORE INSERT OR UPDATE ON', 'wrong shape')
await mutant('trigger function left executable by service_role', 'REVOKE ALL ON FUNCTION public.dovec_leads_stamp_status() FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.dovec_leads_stamp_status() FROM PUBLIC, anon, authenticated;', 'EXECUTE-able')
await mutant('watchdog left executable by authenticated', 'REVOKE ALL ON FUNCTION public.dovec_health_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.dovec_health_watchdog(timestamptz) FROM PUBLIC, anon, service_role;', 'EXECUTE-able')
await mutant('watchdog left executable by PUBLIC', 'REVOKE ALL ON FUNCTION public.dovec_health_watchdog(timestamptz) FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.dovec_health_watchdog(timestamptz) FROM anon, authenticated, service_role;', 'EXECUTE-able')
await mutant('state table granted to service_role', 'REVOKE ALL ON TABLE public.dovec_health_alert_state FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON TABLE public.dovec_health_alert_state FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.dovec_health_alert_state TO service_role;', 'holds a privilege')
await mutant('state table without RLS', 'ALTER TABLE public.dovec_health_alert_state ENABLE ROW LEVEL SECURITY;', '', 'RLS is not enabled')
await mutant('state table with a policy', 'ALTER TABLE public.dovec_health_alert_state ENABLE ROW LEVEL SECURITY;', 'ALTER TABLE public.dovec_health_alert_state ENABLE ROW LEVEL SECURITY; CREATE POLICY zz ON public.dovec_health_alert_state FOR SELECT TO authenticated USING (true);', 'ZERO policies')
for (const [label, sched] of [['a listed minute', '24 3 * * *'], ['a */8 step (0,8,16,24...)', '*/8 * * * *'], ['a 20-30 range', '20-30 * * * *']]) {
  const dd = await base()
  await dd.query(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('zz-collide', '${sched}', 'SELECT 1')`)
  const rr = await run(dd, nonotify(NEW_SQL))
  const caught = !rr.ok && rr.msg.includes('another active cron job fires at')
  t(`red-first collision with ${label}`, caught ? 'caught' : `NOT caught: ${rr.ok ? 'applied' : rr.msg}`, 'caught')
}
{
  const dd = await base()
  await dd.query(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('zz-fine', '*/5 3 * * *', 'SELECT 1'), ('zz-paused', '24 * * * *', 'SELECT 1')`)
  await dd.query(`UPDATE cron.job SET active = false WHERE jobname = 'zz-paused'`)
  await dd.query(`INSERT INTO public.data_jobs (key, runner, kind, cron_jobnames, expected_every, sort) VALUES ('zz1','cron_sql','health',ARRAY['zz-fine','zz-paused'],interval '1 day',99)`)
  const rr = await run(dd, nonotify(NEW_SQL))
  t('positive control: */5 (0,5,10..) and an INACTIVE job at :24 do not collide', [rr.ok, rr.msg ?? null], [true, null])
}
await mutant('registry row missing (coverage)', "('dovec-health-check', 'cron_sql', 'health', ARRAY['dovec-health-check'], NULL, interval '1 hour', 61)\nON CONFLICT (key) DO NOTHING;", "('zz-other', 'cron_sql', 'health', ARRAY['zz-other'], NULL, interval '1 hour', 61) ON CONFLICT (key) DO NOTHING;", 'not covered')
// behaviour mutants: the probes inside the file must notice
await mutant('stuck threshold 1 hour -> 2 hours', "l.created_at < p_now - interval '1 hour'", "l.created_at < p_now - interval '2 hours'", 'probe results differ')
await mutant('stale threshold 30 -> 60 minutes', "s.last_good_sync_at < p_now - interval '30 minutes'", "s.last_good_sync_at < p_now - interval '60 minutes'", 'probe results differ')
await mutant('failed window read from created_at, not status_changed_at', 'AND l.status_changed_at > p_now - interval \'24 hours\'', 'AND l.created_at > p_now - interval \'24 hours\'', 'probe results differ')
await mutant('armed while never run', 'IF s.last_run_at IS NULL THEN\n    RETURN 0;\n  END IF;', '', 'probe results differ')
await mutant('test enquiries counted', "WHERE NOT l.is_test AND l.status = ANY (ARRAY['rejected', 'failed']::text[])", "WHERE l.status = ANY (ARRAY['rejected', 'failed']::text[])", 'probe results differ')
await mutant('repeat every 24 h removed', "v_alerted < p_now - interval '24 hours'", "v_alerted < p_now - interval '240 hours'", 'probe results differ')
await mutant('second failure while red stays silent', "ELSIF v_red AND v_key = 'failed' AND v_failed_at > coalesce(v_lf, '-infinity'::timestamptz) THEN", "ELSIF false THEN", 'probe results differ')
await mutant('recovery line dropped', "ELSIF NOT v_red AND v_last_red THEN\n      v_lines := v_lines || v_done;", "ELSIF NOT v_red AND v_last_red THEN\n      v_lines := v_lines;", 'probe results differ')
await mutant('alerts go to every profile, not admins only', "FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP", 'FOR r IN SELECT id, push_token FROM profiles LOOP', 'probe results differ')
await mutant('trigger stamps on every update', 'ELSIF NEW.status IS DISTINCT FROM OLD.status THEN\n    NEW.status_changed_at := now();', 'ELSE\n    NEW.status_changed_at := now();', 'probe results differ')
await mutant('a probe insert takes a generated external_id (sequence burnt)', "VALUES ('ADA-9000000005', gen_random_uuid()", 'VALUES (DEFAULT, gen_random_uuid()', 'moved dovec_lead_external_seq')
await mutant('a probe insert as the postgres owner takes a generated external_id', "VALUES ($3, gen_random_uuid()", "VALUES ('ADA-' || nextval('public.dovec_lead_external_seq')::text || left($3, 0), gen_random_uuid()", 'moved dovec_lead_external_seq')

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
