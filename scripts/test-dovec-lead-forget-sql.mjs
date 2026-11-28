// 20261243 (dovec_lead_forget: wipe the personal fields of ONE enquiry by reference) against the PGlite harness (PostgreSQL 18; prod
// is older, see supabase/CLAUDE.md). By hand:  node scripts/test-dovec-lead-forget-sql.mjs
// Evidence of: the file's own assertions + rolled-back probe run clean on top of 20261205/10/11/29/31/32/40/41/42; the function's
// behaviour (decisions 1-6) called as service_role; the ACL with a positive control; that the watchdog (20261241) and the undelivered
// notifier (20261242) see nothing change; the verify_schema tokens; and red-first mutants (each assertion fails when its target is
// broken). NOT evidence of: PostgREST / HTTP, real pg_cron / pg_net, a PG 17 rendering, the live catalogs.
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { freshDb, asRole } from './migration-harness.mjs'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const FILES = readdirSync(MIG)
const find = re => { const f = FILES.find(x => re.test(x)); if (!f) { console.log('  ✗ file missing: ' + re); process.exit(1) } return f }
const read = f => readFileSync(MIG + f, 'utf8')
const nonotify = s => s.replace(/^NOTIFY pgrst.*$/m, '')
const NEW = find(/^20261243_dovec_lead_forget\.sql$/)
const NEW_SQL = read(NEW)
const ADMIN = '00000000-0000-4000-8000-0000000000a1', ADMIN2 = '00000000-0000-4000-8000-0000000000a2', CUST = '00000000-0000-4000-8000-0000000000d1'
const U1 = '00000000-0000-4000-8000-0000000000e1', U2 = '00000000-0000-4000-8000-0000000000e2'
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
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer', push_token text, preferred_language text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  title text, body text, type text, created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (type IN ('admin_alert', 'message', 'other')));
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
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${ADMIN2}'), ('${CUST}'), ('${U1}'), ('${U2}');
INSERT INTO public.profiles (id, role, push_token) VALUES ('${ADMIN}', 'admin', 'ExponentPushToken[aaa]'), ('${ADMIN2}', 'admin', NULL), ('${CUST}', 'customer', 'ExponentPushToken[ccc]'), ('${U1}', 'customer', NULL), ('${U2}', 'customer', NULL);
INSERT INTO cron.job (jobname, schedule, command) SELECT n, '0 3 * * *', 'SELECT 1' FROM unnest(ARRAY[${cronNames.map(n => `'${n}'`).join(',')}]) n;
UPDATE cron.job SET schedule = '0,30 * * * *', command = $dc$${DUTY_CMD_TEXT}$dc$ WHERE jobname = 'duty-push';
UPDATE cron.job SET schedule = '0,30 * * * 5,6', command = $wc$${WEEK_CMD_TEXT}$wc$ WHERE jobname = 'weekend-digest';
`

const CHAIN = [find(/^20261205_data_jobs\.sql$/), find(/^20261210_data_jobs_switches\.sql$/), find(/^20261211_data_jobs_watchdog\.sql$/),
  find(/^20261229_dovec_projects\.sql$/), find(/^20261231_dovec_read_gate\.sql$/), find(/^20261232_dovec_cron\.sql$/), find(/^20261240_dovec_leads_limits_definer\.sql$/),
  find(/^20261241_dovec_health_watchdog\.sql$/)]
const LAST = find(/^20261242_dovec_undelivered_notice\.sql$/)
const base = async () => {
  const d = await freshDb(SEED)
  for (const f of CHAIN) {
    const r = await run(d, nonotify(read(f)))
    if (!r.ok) { console.log(`  ✗ prerequisite ${f} did not apply: ${r.msg}`); process.exit(1) }
  }
  await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p1', 'Fictional Heights', 'Testville', 'on_sale', 'https://example.com/p1')`)
  const r = await run(d, nonotify(read(LAST)))
  if (!r.ok) { console.log(`  ✗ prerequisite ${LAST} did not apply: ${r.msg}`); process.exit(1) }
  return d
}
const BOOLS = ['valid_reference', 'found', 'is_test', 'settled', 'already_wiped', 'wiped', 'applied']
const ans = (...trueKeys) => Object.fromEntries(BOOLS.map(k => [k, trueKeys.includes(k)]))
let n = 5000
const addLead = async (d, status, extra = {}, back = true) => {
  const cols = { external_id: `'ADA-${++n}'`, client_request_id: 'gen_random_uuid()', payload_hash: "repeat('d', 64)", project_id: "'p1'", project_name: "'Fictional Heights'",
    name: "'Probe Person'", phone: "'+441234567890'", email: "'probe@example.invalid'", message: "'probe message'", language: "'English'", language_code: "'en'", consent: 'true',
    consent_text_version: "'v'", status: `'${status}'`, user_id: 'gen_random_uuid()', attempts: '2', send_live: 'true', ...extra }
  const r = (await d.query(`INSERT INTO public.dovec_leads (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')}) RETURNING id, external_id`)).rows[0]
  if (back) await d.exec(`UPDATE public.dovec_leads SET status_changed_at = now() - interval '3 days' WHERE id = ${r.id}`)
  return r
}
const call = async (d, ref, apply, role = 'service_role') => {
  const r = await asRole(d, role, SVC, `SELECT public.dovec_lead_forget($1::text, $2::boolean) AS r`, [ref, apply])
  return r.ok ? r.rows[0].r : { error: r.msg }
}
const rowText = async (d, id) => (await d.query(`SELECT l::text AS x, l.ctid::text AS c FROM public.dovec_leads l WHERE id = ${id}`)).rows[0]
const kept = async (d, id) => (await d.query(`SELECT to_jsonb(l) - 'name' - 'phone' - 'email' - 'message' - 'user_id' - 'pii_wiped_at' AS k FROM public.dovec_leads l WHERE id = ${id}`)).rows[0].k
const pii = async (d, id) => (await d.query(`SELECT (name IS NULL AND phone IS NULL AND email IS NULL AND message IS NULL AND user_id IS NULL) AS gone, pii_wiped_at IS NOT NULL AS stamped FROM public.dovec_leads WHERE id = ${id}`)).rows[0]
const idOf = async (d, ref) => (await d.query(`SELECT id FROM public.dovec_leads WHERE external_id = '${ref}'`)).rows[0].id

// The behaviour battery: returns the list of things that went wrong (empty = all as agreed). Used on the real file AND on every
// mutant that applies, so a mutant is "caught" by the migration's own probe or by one of these lines.
async function battery(d) {
  const out = []
  const norm = x => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, norm(x[k])])) : x
  const eq = (label, got, want) => { if (JSON.stringify(norm(got)) !== JSON.stringify(norm(want))) out.push(`${label}: got ${JSON.stringify(got)}`) }
  const L = {}
  for (const s of ['sent', 'mock', 'rejected', 'failed', 'pending', 'retry']) L[s] = await addLead(d, s)
  L.nouser = await addLead(d, 'sent', { user_id: 'NULL' })
  L.rem = await addLead(d, 'sent', { pii_wiped_at: "now() - interval '5 days'" })
  let before = await rowText(d, L.sent.id)
  eq('dry answer', await call(d, L.sent.external_id, false), ans('valid_reference', 'found', 'settled'))
  eq('dry leaves the row identical', await rowText(d, L.sent.id), before)
  eq('p_apply omitted = dry', (await asRole(d, 'service_role', SVC, `SELECT public.dovec_lead_forget('${L.sent.external_id}') AS r`)).rows?.[0]?.r?.wiped, false)
  eq('p_apply NULL = dry', (await asRole(d, 'service_role', SVC, `SELECT public.dovec_lead_forget('${L.sent.external_id}', NULL) AS r`)).rows?.[0]?.r?.wiped, false)
  eq('still not wiped after the dry calls', await pii(d, L.sent.id), { gone: false, stamped: false })
  for (const s of ['sent', 'mock', 'rejected', 'failed']) {
    const k0 = await kept(d, L[s].id)
    eq(`apply ${s}`, await call(d, L[s].external_id, true), ans('valid_reference', 'found', 'settled', 'wiped', 'applied'))
    eq(`${s}: five fields gone, stamp set`, await pii(d, L[s].id), { gone: true, stamped: true })
    eq(`${s}: every other column unchanged`, await kept(d, L[s].id), k0)
  }
  before = await rowText(d, L.sent.id)
  eq('second apply answer', await call(d, L.sent.external_id, true), ans('valid_reference', 'found', 'settled', 'already_wiped', 'applied'))
  eq('second apply: no UPDATE at all', await rowText(d, L.sent.id), before)
  for (const s of ['pending', 'retry']) {
    before = await rowText(d, L[s].id)
    eq(`${s} apply refused`, await call(d, L[s].external_id, true), ans('valid_reference', 'found'))
    eq(`${s} dry`, await call(d, L[s].external_id, false), ans('valid_reference', 'found'))
    eq(`${s} untouched`, await rowText(d, L[s].id), before)
  }
  const st0 = (await d.query(`SELECT pii_wiped_at::text s FROM public.dovec_leads WHERE id = ${L.rem.id}`)).rows[0].s
  eq('remainder answer', await call(d, L.rem.external_id, true), ans('valid_reference', 'found', 'settled', 'wiped', 'applied'))
  eq('remainder wiped', (await pii(d, L.rem.id)).gone, true)
  eq('original pii_wiped_at kept', (await d.query(`SELECT pii_wiped_at::text s FROM public.dovec_leads WHERE id = ${L.rem.id}`)).rows[0].s, st0)
  eq('no user_id: wiped by reference', (await call(d, L.nouser.external_id, true)).wiped, true)
  eq('no user_id: fields gone', (await pii(d, L.nouser.id)).gone, true)
  for (const ref of ['ADA-', 'ADA-x', 'ada-1', ' ADA-1', 'ADA-1 ', 'ADA-1\n', "ADA-1'; DROP TABLE x;--", 'TEST-1', '', 'ADA--1', 'ADA-1.0']) {
    eq(`refused outright: ${JSON.stringify(ref)}`, await call(d, ref, true), ans())
  }
  eq('NULL reference refused', (await asRole(d, 'service_role', SVC, `SELECT public.dovec_lead_forget(NULL, true) AS r`)).rows?.[0]?.r, ans())
  eq('unknown reference', await call(d, 'ADA-99999999999999999999', true), ans('valid_reference'))
  await d.exec(`INSERT INTO public.dovec_leads (external_id, client_request_id, payload_hash, name, phone, email, message, language, language_code, consent, consent_text_version, status, is_test)
                VALUES ('TEST-1', gen_random_uuid(), repeat('d', 64), 'Test', '+441234567890', 'x@example.invalid', 'm', 'English', 'en', true, 'v', 'sent', true)`)
  const t1id = await idOf(d, 'TEST-1')
  const t1 = await rowText(d, t1id)
  eq('TEST-1 refused (apply)', await call(d, 'TEST-1', true), ans())
  eq('TEST-1 untouched', await rowText(d, t1id), t1)
  await d.exec(`DELETE FROM public.dovec_leads WHERE external_id = 'TEST-1'`)
  await d.exec(`ALTER TABLE public.dovec_leads DROP CONSTRAINT dovec_leads_external_id_check`)
  const tr = await addLead(d, 'sent', { is_test: 'true' })
  const t2 = await rowText(d, tr.id)
  eq('defence in depth: an is_test row with an ADA-n reference is refused', await call(d, tr.external_id, true), ans('valid_reference', 'found', 'is_test', 'settled'))
  eq('  and untouched', await rowText(d, tr.id), t2)
  return out
}

console.log('── 20261243 applied on top of 20261205/10/11/29/31/32/40/41/42')
const d = await base()
const res = await run(d, nonotify(NEW_SQL))
t('the exact file applies (its own assertions + rolled-back probe ran clean)', [res.ok, res.msg ?? null], [true, null])
if (!res.ok) process.exit(1)
for (const m of res.notices) console.log('    NOTICE ' + m)
t('NOTICEs carry no uuid, e-mail, token or phone', res.notices.every(m => !/[0-9a-f]{8}-[0-9a-f]{4}-|@|ExponentPushToken|\+44/i.test(m)), true)
t('final OK notice', res.notices.some(m => m.startsWith('20261243 OK:')), true)
const q = async sql => (await d.query(sql)).rows
t('the probe left nothing behind (no lead, no notification, no push_log)', await q(`SELECT (SELECT count(*)::int FROM public.dovec_leads) l, (SELECT count(*)::int FROM public.notifications) n, (SELECT count(*)::int FROM public.push_log) p`), [{ l: 0, n: 0, p: 0 }])
t('re-applying is safe (re-runnable)', (await run(d, nonotify(NEW_SQL))).ok, true)
t('one function, exact shape from the catalog', await q(`SELECT prosecdef, proconfig = ARRAY['search_path=""'] c, pg_get_function_identity_arguments(oid) a, prorettype::regtype::text r FROM pg_proc WHERE proname = 'dovec_lead_forget'`),
  [{ prosecdef: true, c: true, a: 'p_reference text, p_apply boolean', r: 'jsonb' }])

console.log('── ACL, with a positive control')
const sql = `SELECT public.dovec_lead_forget('ADA-1', false) AS r`
t('anon and authenticated cannot call it', [(await asRole(d, 'anon', null, sql)).ok, (await asRole(d, 'authenticated', CUST, sql)).ok], [false, false])
t('positive control: service_role and the owner can', [(await asRole(d, 'service_role', SVC, sql)).ok, (await asRole(d, null, null, sql)).ok], [true, true])
t('ACL grantees from aclexplode: only the owner and service_role hold EXECUTE', await q(`SELECT array_agg(g ORDER BY g) g FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
  FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'dovec_lead_forget' AND a.privilege_type = 'EXECUTE') x`), [{ g: ['postgres', 'service_role'] }])
t('dovec_leads: no policy, no app-role read (positive control: service_role reads)',
  [(await q(`SELECT count(*)::int n FROM pg_policies WHERE tablename = 'dovec_leads'`))[0].n, (await asRole(d, 'authenticated', U1, `SELECT 1 FROM public.dovec_leads`)).ok, (await asRole(d, 'service_role', SVC, `SELECT 1 FROM public.dovec_leads`)).ok], [0, false, true])

console.log('── behaviour battery on the real file (decisions 1-6)')
{
  const bd = await base()
  t('applies on a fresh chain', (await run(bd, nonotify(NEW_SQL))).ok, true)
  t('every behaviour line holds', await battery(bd), [])
}

console.log('── watchdog and notifier see nothing')
{
  const w = await base()
  await run(w, nonotify(NEW_SQL))
  await w.exec(`UPDATE public.dovec_settings SET last_run_at = now(), last_run_status = 'ok', last_good_sync_at = now() WHERE id = 1`)
  await w.exec(`CREATE TABLE public.zz_trig (kind text)`)
  await w.exec(`CREATE FUNCTION public.zz_trig_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN INSERT INTO public.zz_trig VALUES (TG_ARGV[0]); RETURN NEW; END $f$`)
  await w.exec(`CREATE TRIGGER zz_of_status AFTER UPDATE OF status ON public.dovec_leads FOR EACH ROW EXECUTE FUNCTION public.zz_trig_fn('of_status')`)
  await w.exec(`CREATE TRIGGER zz_any AFTER UPDATE ON public.dovec_leads FOR EACH ROW EXECUTE FUNCTION public.zz_trig_fn('any')`)
  const notified = await addLead(w, 'rejected', { user_id: `'${U1}'` }, false)
  const fresh = await addLead(w, 'failed', { user_id: `'${U2}'` }, false)
  const ticks = async () => { await w.exec(`SELECT public.dovec_notify_undelivered()`); await w.exec(`SELECT public.dovec_health_watchdog()`) }
  await ticks()
  await ticks()
  const state = async () => (await w.query(`SELECT
    (SELECT count(*)::int FROM public.notifications) n, (SELECT count(*)::int FROM public.push_log) p, (SELECT count(*)::int FROM net.calls) c,
    (SELECT coalesce(string_agg(condition || ':' || last_red || ':' || coalesce(alerted_at::text, '') || ':' || coalesce(last_failure_at::text, ''), ',' ORDER BY condition), '') FROM public.dovec_health_alert_state) s`)).rows[0]
  const leadState = async id => (await w.query(`SELECT status, status_changed_at::text sc, undelivered_notified_at::text un, send_live, attempts, external_id FROM public.dovec_leads WHERE id = ${id}`)).rows[0]
  const undeliv = async () => (await w.query(`SELECT count(*)::int n FROM public.notifications WHERE type = 'dovec_undelivered'`)).rows[0].n
  const s0 = await state()
  t('baseline: both ticks announced (a notice per lead, alert state written)', [await undeliv(), s0.s !== ''], [2, true])
  await ticks()
  t('  a further tick changes nothing', await state(), s0)
  const l0 = await leadState(notified.id), f0 = await leadState(fresh.id)
  t('baseline: both enquiries are stamped as notified', [l0.un !== null, f0.un !== null], [true, true])
  await w.exec(`DELETE FROM public.zz_trig`)
  t('apply on the first (notified, settled) enquiry', (await call(w, notified.external_id, true)).wiped, true)
  t('apply on the second one', (await call(w, fresh.external_id, true)).wiped, true)
  await ticks()
  t('after the wipes and two more ticks: no new notification / push_log / net call, alert state identical', await state(), s0)
  t('status, status_changed_at, undelivered_notified_at, send_live, attempts, reference unchanged', [await leadState(notified.id), await leadState(fresh.id)], [l0, f0])
  t('the UPDATE OF status trigger never fired; the any-update trigger fired once per wipe (positive control)',
    (await w.query(`SELECT kind, count(*)::int n FROM public.zz_trig GROUP BY kind ORDER BY kind`)).rows, [{ kind: 'any', n: 2 }])
  await w.exec(`UPDATE public.dovec_leads SET status = 'sent' WHERE id = ${notified.id}`)
  t('positive control: a real status change DOES fire the OF-status trigger and restamps', [(await w.query(`SELECT count(*)::int n FROM public.zz_trig WHERE kind = 'of_status'`)).rows[0].n,
    (await leadState(notified.id)).sc !== l0.sc], [1, true])
  const early = await addLead(w, 'rejected', { user_id: `'${U1}'` }, false)
  const u0 = await undeliv()
  t('an enquiry wiped BEFORE the notifier saw it: apply works', (await call(w, early.external_id, true)).wiped, true)
  await ticks()
  t('  and no notice is ever written for it (the notifier skips wiped rows)', [await undeliv(), (await leadState(early.id)).un], [u0, null])
}

console.log('── verify_schema.sql registration')
{
  const vs = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
  const a = vs.indexOf('-- 1243-BEGIN'), b = vs.indexOf('-- 1243-END')
  t('the 1243 H block exists', a > 0 && b > a, true)
  const h = a > 0 ? vs.slice(a, b) : ''
  const want = (h.match(/UNION ALL SELECT/g) || []).length
  const runTok = () => d.query(`SELECT 'x'::text AS m, 'x'::text AS o, true AS ok WHERE false ${h}`).then(r => r.rows, e => ({ err: e.message }))
  const tok = await runTok()
  t('H tokens run and are all true', Array.isArray(tok) ? [tok.length === want && want > 0, tok.every(r => r.ok === true)] : tok, [true, true])
  await d.exec(`GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) TO authenticated`)
  const tok2 = await runTok()
  t('red: a stray EXECUTE grant turns a token false', Array.isArray(tok2) ? tok2.filter(r => r.ok !== true).length > 0 : tok2, true)
  await d.exec(`REVOKE ALL ON FUNCTION public.dovec_lead_forget(text, boolean) FROM PUBLIC, anon, authenticated`)
  t('green again after the revoke', (await runTok()).every(r => r.ok === true), true)
  const c = [...vs.matchAll(/\('20261243_dovec_lead_forget','([a-z0-9_]+)'\)/g)].map(m => m[1])
  const fns = (await q(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).map(r => r.proname)
  t('registered C function(s) exist in the catalog', [c, c.every(x => fns.includes(x))], [['dovec_lead_forget'], true])
}

console.log('── red-first mutants: the migration must refuse, or the battery must notice')
const mutate = async (label, from, to, want) => {
  if (!NEW_SQL.includes(from)) { bad++; console.log(`  ✗ anchor missing for ${label}: ${from.slice(0, 60)}`); return }
  const mutated = NEW_SQL.replace(from, () => to)
  if (mutated === NEW_SQL) { bad++; console.log(`  ✗ mutation did not change the file: ${label}`); return }
  const dd = await base()
  const r = await run(dd, nonotify(mutated))
  let how
  if (!r.ok) how = (want && !r.msg.includes(want)) ? `refused for another reason: ${r.msg}` : `caught by the migration: ${r.msg}`
  else { const problems = await battery(dd); how = problems.length ? `caught by the battery: ${problems[0]}` : 'NOT CAUGHT (applied and every battery line held)' }
  t(`mutant "${label}"`, how.startsWith('caught'), true)
  console.log(`      ${how}`)
}
const UPD_END = 'pii_wiped_at = COALESCE(pii_wiped_at, now())\n     WHERE id = v_id;'
await mutate('wipe also sets status', UPD_END, "pii_wiped_at = COALESCE(pii_wiped_at, now()), status = 'failed'\n     WHERE id = v_id;")
await mutate('wipe also restamps status_changed_at', UPD_END, 'pii_wiped_at = COALESCE(pii_wiped_at, now()), status_changed_at = now()\n     WHERE id = v_id;')
await mutate('wipe also clears undelivered_notified_at', UPD_END, 'pii_wiped_at = COALESCE(pii_wiped_at, now()), undelivered_notified_at = NULL\n     WHERE id = v_id;')
await mutate('skips the is_test refusal', 'v_ok      := v_valid AND v_found AND NOT v_is_test AND v_settled;', 'v_ok      := v_valid AND v_found AND v_settled;')
await mutate('skips the is_test refusal, anchor kept in a comment', 'v_ok      := v_valid AND v_found AND NOT v_is_test AND v_settled;', 'v_ok      := v_valid AND v_found AND v_settled; -- NOT v_is_test')
await mutate('wipes pending and retry, anchor kept in a comment', "v_settled := v_found AND COALESCE(v_status = ANY (ARRAY['sent','rejected','failed','mock']::text[]), false);", "v_settled := v_found; -- 'sent','rejected','failed','mock'")
await mutate('reference check loosened, anchor kept in a comment', "v_valid := p_reference IS NOT NULL AND p_reference ~ '^ADA-[0-9]+$';", "v_valid := p_reference IS NOT NULL AND p_reference ~ '^ADA-'; -- p_reference ~ '^ADA-[0-9]+$'")
await mutate('wipes pending and retry too', "v_settled := v_found AND COALESCE(v_status = ANY (ARRAY['sent','rejected','failed','mock']::text[]), false);", 'v_settled := v_found;')
await mutate('settled list loses mock', "ARRAY['sent','rejected','failed','mock']::text[]), false);", "ARRAY['sent','rejected','failed']::text[]), false);")
await mutate('user_id is not cleared', 'message = NULL, user_id = NULL,', 'message = NULL,')
await mutate('email is not cleared', 'phone = NULL, email = NULL, message = NULL, user_id = NULL,\n           pii_wiped_at', 'phone = NULL, message = NULL, user_id = NULL,\n           pii_wiped_at')
await mutate('original pii_wiped_at overwritten', UPD_END, 'pii_wiped_at = now()\n     WHERE id = v_id;')
await mutate('already-wiped row is updated again (no-op UPDATE)', 'IF v_apply AND v_ok AND NOT v_already THEN', 'IF v_apply AND v_ok THEN')
await mutate('the dry run writes', 'IF v_apply AND v_ok AND NOT v_already THEN', 'IF v_ok AND NOT v_already THEN')
await mutate('p_apply NULL is not treated as dry', 'v_apply   boolean := COALESCE(p_apply, false);', 'v_apply   boolean := p_apply IS DISTINCT FROM false;')
await mutate('loose reference check (any ADA- prefix)', "p_reference ~ '^ADA-[0-9]+$'", "p_reference ~ '^ADA-'")
await mutate('reference check also matches TEST-1', "p_reference ~ '^ADA-[0-9]+$'", "p_reference ~ '^(ADA-[0-9]+|TEST-1)$'")
await mutate('answer carries a field value', "'applied',         v_apply AND v_ok\n", "'applied',         v_apply AND v_ok,\n    'name', (SELECT l.name FROM public.dovec_leads l WHERE l.id = v_id)\n")
await mutate('granted to authenticated', 'GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) TO service_role, authenticated;', 'anon or authenticated')
await mutate('left executable by PUBLIC', 'REVOKE ALL ON FUNCTION public.dovec_lead_forget(text, boolean) FROM PUBLIC, anon, authenticated;', 'REVOKE ALL ON FUNCTION public.dovec_lead_forget(text, boolean) FROM anon, authenticated;', 'EXECUTE-able')
await mutate('service_role not granted (positive control)', 'GRANT EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) TO service_role;', 'REVOKE EXECUTE ON FUNCTION public.dovec_lead_forget(text, boolean) FROM service_role;', 'service_role')
await mutate('search_path not pinned', " SET search_path TO ''\nAS $function$\nDECLARE\n  v_apply", " SET search_path TO 'public'\nAS $function$\nDECLARE\n  v_apply", 'search_path')
await mutate('not SECURITY DEFINER', " SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nDECLARE\n  v_apply", " SET search_path TO ''\nAS $function$\nDECLARE\n  v_apply", 'SECURITY DEFINER')
await mutate('the row is not locked on apply', 'FROM public.dovec_leads l WHERE l.external_id = p_reference FOR UPDATE;', 'FROM public.dovec_leads l WHERE l.external_id = p_reference;', 'row lock')
await mutate('writes a notification', 'v_wiped := true;', "v_wiped := true;\n    INSERT INTO public.notifications (user_id, title, body, type) SELECT id, 'x', 'y', 'other' FROM public.profiles LIMIT 1;")

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
