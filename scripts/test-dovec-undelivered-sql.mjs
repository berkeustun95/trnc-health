// 20261242 (dovec_notify_undelivered: one notice per enquiry that could not be delivered) against the PGlite harness
// (PostgreSQL 18; prod is older, see supabase/CLAUDE.md). pg_cron / pg_net are stubs: net.http_post records its call in net.calls.
// Evidence of: the file's own assertions + rolled-back probe run clean, the picker rules, one notice per lead, the push payload,
// the text for 9 languages, the owner-only ACL, and red-first mutants. NOT evidence of: real pg_cron / pg_net / Expo, prod renderings.
//   node scripts/test-dovec-undelivered-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const A = rel('../supabase/migrations/20261229_dovec_projects.sql')
const GATE = rel('../supabase/migrations/20261231_dovec_read_gate.sql')
const LIM = rel('../supabase/migrations/20261240_dovec_leads_limits_definer.sql')
const FILE = rel('../supabase/migrations/20261242_dovec_undelivered_notice.sql')
const SQL = readFileSync(FILE, 'utf8')
const U1 = '00000000-0000-4000-8000-000000000011', U2 = '00000000-0000-4000-8000-000000000012', U3 = '00000000-0000-4000-8000-000000000013'
const U4 = '00000000-0000-4000-8000-000000000014', U5 = '00000000-0000-4000-8000-000000000015', U6 = '00000000-0000-4000-8000-000000000016'
const ADMIN = '00000000-0000-4000-8000-000000000001'

const MODS = ['accommodation','events','explore','garages','grooming','homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news']
const FIXTURE = `
CREATE TABLE public.contact_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  region text, lang text, item_id text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN (${MODS.map(m => `'${m}'`).join(',')})),
  CONSTRAINT contact_events_action_check CHECK (action IN ('call','whatsapp','call_secondary','website')));
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, module, entity_id, action, region, item_id, lang) ON public.contact_events TO anon, authenticated;
CREATE POLICY ce_insert_public ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer',
  push_token text, preferred_language text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') $f$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id serial PRIMARY KEY, name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE TABLE public.data_jobs (key text PRIMARY KEY, runner text NOT NULL, kind text NOT NULL, cron_jobnames text[] NOT NULL DEFAULT '{}', schedule_note text, expected_every interval, sort int NOT NULL DEFAULT 0);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  title text, body text, type text, created_at timestamptz DEFAULT now(), read boolean DEFAULT false,
  CONSTRAINT notifications_type_check CHECK (type IN ('message', 'admin_alert', 'other')));
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notifications ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TABLE public.push_log (id bigserial PRIMARY KEY, user_id uuid REFERENCES public.profiles ON DELETE CASCADE, kind text NOT NULL, request_id bigint, sent_at timestamptz DEFAULT now());
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${U1}'), ('${U2}'), ('${U3}'), ('${U4}'), ('${U5}'), ('${U6}');
INSERT INTO public.profiles (id, role, push_token, preferred_language) VALUES ('${ADMIN}', 'admin', NULL, NULL),
  ('${U1}', 'customer', NULL, 'Turkish'), ('${U2}', 'customer', NULL, 'German'), ('${U3}', 'customer', NULL, NULL),
  ('${U4}', 'customer', 'ExponentPushToken[abc]', 'Turkish'), ('${U5}', 'customer', NULL, 'Persian'), ('${U6}', 'customer', NULL, 'tr');
`
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const ready = async () => {
  const d = await freshDb(FIXTURE)
  for (const f of [A, GATE, LIM]) { const r = await applyFile(d, f); if (!r.ok) { console.log('  prerequisite failed:', r.msg); process.exit(1) } }
  await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES ('p1', 'Fictional Heights', 'Testville', 'on_sale', 'https://example.com/p1'), ('p2', 'Other Place', 'Testville', 'on_sale', 'https://example.com/p2')`)
  return d
}
const mutantFile = (from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ mutant anchor missing: ${from.slice(0, 60)}`); return null }
  const p = join(mkdtempSync(join(tmpdir(), 'dovec-')), 'm.sql')
  writeFileSync(p, SQL.replace(from, () => to))
  return p
}
let seq = 100
const lead = (user, status, ago, extra = {}) => {
  const cols = { client_request_id: `'00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}'`, payload_hash: "repeat('d', 64)", project_id: "'p1'", project_name: "'Fictional Heights'", name: "'Probe'",
    phone: "'+441234567890'", language: "'English'", language_code: "'en'", consent: 'true', consent_text_version: "'v'", status: `'${status}'`,
    user_id: user ? `'${user}'` : 'NULL', created_at: `now() - interval '${ago}'`, send_live: 'true', ...extra }
  return `INSERT INTO public.dovec_leads (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')}) RETURNING id, external_id`
}
const add = async (d, ...a) => (await d.query(lead(...a))).rows[0]
const tick = d => d.exec(`SELECT public.dovec_notify_undelivered()`)
const stamped = async (d, id) => (await d.query(`SELECT undelivered_notified_at IS NOT NULL AS s FROM public.dovec_leads WHERE id = ${id}`)).rows[0].s
const notices = async (d, user) => (await d.query(`SELECT title, body, type FROM public.notifications WHERE type = 'dovec_undelivered' AND user_id = '${user}' ORDER BY created_at, id`)).rows

console.log('20261242 — real file')
{
  const d = await ready()
  const pre = await d.query(`SELECT 1 FROM public.dovec_leads LIMIT 1`)
  t('prerequisites applied, no leads', pre.rows.length, 0)
  const r = await applyFile(d, FILE)
  t('applies, including its own assertions and rolled-back probe', r, { ok: true, msg: null })
  if (!r.ok) { console.log(r.msg); process.exit(1) }
  t('the in-migration probe left nothing behind', [(await d.query(`SELECT count(*)::int n FROM public.notifications`)).rows[0].n,
    (await d.query(`SELECT count(*)::int n FROM public.dovec_leads`)).rows[0].n, (await d.query(`SELECT count(*)::int n FROM net.calls`)).rows[0].n], [0, 0, 0])
  t('re-applying is clean (idempotent)', (await applyFile(d, FILE)).ok, true)
  t('one cron job, one data_jobs row, exact schedule', [(await d.query(`SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'dovec-notify-undelivered'`)).rows,
    (await d.query(`SELECT count(*)::int n FROM public.data_jobs WHERE 'dovec-notify-undelivered' = ANY (cron_jobnames)`)).rows[0].n],
    [[{ jobname: 'dovec-notify-undelivered', schedule: '7,17,27,37,47,57 * * * *', command: 'SELECT public.dovec_notify_undelivered();' }], 1])
  t('column defaults: send_live false, undelivered_notified_at null',
    (await d.query(`SELECT column_name c, column_default d, is_nullable n FROM information_schema.columns WHERE table_name = 'dovec_leads' AND column_name IN ('send_live','undelivered_notified_at') ORDER BY 1`)).rows,
    [{ c: 'send_live', d: 'false', n: 'NO' }, { c: 'undelivered_notified_at', d: null, n: 'YES' }])
  t('type check keeps old types and adds the new one',
    (await d.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'notifications_type_check'`)).rows[0].d,
    `CHECK ((type = ANY (ARRAY['message'::text, 'admin_alert'::text, 'other'::text, 'dovec_undelivered'::text])))`)

  const L = {}
  L.rej = await add(d, U1, 'rejected', '5 minutes')
  L.fail = await add(d, U1, 'failed', '30 minutes')
  L.p25 = await add(d, U2, 'pending', '25 hours')
  L.p23 = await add(d, U2, 'pending', '23 hours')
  L.r25 = await add(d, U3, 'retry', '25 hours')
  L.r23 = await add(d, U3, 'retry', '23 hours')
  L.sent = await add(d, U5, 'sent', '25 hours')
  L.mock = await add(d, U5, 'mock', '25 hours')
  L.dark = await add(d, U5, 'rejected', '25 hours', { send_live: 'false' })
  L.test = await add(d, U5, 'rejected', '25 hours', { is_test: 'true', external_id: "'TEST-1'" })
  L.nouser = await add(d, null, 'rejected', '25 hours')
  L.old = await add(d, U6, 'rejected', '9 days')
  L.wiped = await add(d, U6, 'rejected', '25 hours')
  await d.exec(`UPDATE public.dovec_leads SET pii_wiped_at = now() WHERE id = ${L.wiped.id}`)
  await tick(d)
  const expectStamped = { rej: true, fail: true, p25: true, p23: false, r25: true, r23: false, sent: false, mock: false, dark: false, test: false, nouser: false, old: false, wiped: false }
  const got = {}
  for (const k of Object.keys(expectStamped)) got[k] = await stamped(d, L[k].id)
  t('first tick picks exactly: rejected, failed, pending/retry >= 24 h', got, expectStamped)
  t('one notice per picked lead (U1 has 2, U2 1, U3 1, others 0)', [(await notices(d, U1)).length, (await notices(d, U2)).length, (await notices(d, U3)).length, (await notices(d, U5)).length, (await notices(d, U6)).length], [2, 1, 1, 0, 0])
  await tick(d)
  t('a second tick adds nothing', [(await notices(d, U1)).length, (await notices(d, U2)).length, (await notices(d, U3)).length], [2, 1, 1])
  await d.exec(`UPDATE public.dovec_leads SET status = 'sent' WHERE id = ${L.rej.id}`)
  await tick(d)
  t('notified then delivered: still one notice, nothing more', (await notices(d, U1)).length, 2)
  await d.exec(`UPDATE public.dovec_leads SET created_at = now() - interval '25 hours' WHERE id = ${L.p23.id}`)
  await tick(d)
  t('a pending lead that crosses 24 h is picked on a later tick', await stamped(d, L.p23.id), true)

  const tr = (await notices(d, U1)).find(n => n.body.includes(`(${L.rej.external_id})`))
  t('Turkish user gets the approved Turkish text', [tr.title, tr.body], ['Talebiniz iletilemedi',
    `Fictional Heights projesi için gönderdiğiniz talep (${L.rej.external_id}) Döveç'e iletilemedi. Lütfen talebinizi yeniden gönderin veya Döveç'e WhatsApp'tan ulaşın.`])
  const de = (await notices(d, U2))[0]
  t('German user gets German', de.title, 'Anfrage nicht zugestellt')
  t('no language set -> English (approved string)', (await notices(d, U3)).find(n => n.body.includes(`(${L.r25.external_id})`))?.body, `Your enquiry about Fictional Heights (${L.r25.external_id}) couldn't be delivered to Döveç. Please send it again or contact Döveç on WhatsApp.`)
  t('type is dovec_undelivered', tr.type, 'dovec_undelivered')

  const lp = await add(d, U4, 'failed', '10 minutes')
  await tick(d)
  const calls = (await d.query(`SELECT url, body FROM net.calls`)).rows
  t('exactly one push queued (the one token holder)', calls.length, 1)
  t('push goes to Expo with data {screen: notifications} and the user language', [calls[0]?.url, calls[0]?.body?.to, calls[0]?.body?.data, calls[0]?.body?.title],
    ['https://exp.host/--/api/v2/push/send', 'ExponentPushToken[abc]', { screen: 'notifications' }, 'Talebiniz iletilemedi'])
  t('push_log: token holder has a request id, tokenless users NULL',
    (await d.query(`SELECT user_id = '${U4}' AS tok, request_id IS NOT NULL AS has, count(*)::int n FROM public.push_log WHERE kind = 'dovec_undelivered' GROUP BY 1, 2 ORDER BY 1, 2`)).rows,
    [{ tok: false, has: false, n: 5 }, { tok: true, has: true, n: 1 }])
  t('the new lead is stamped', await stamped(d, lp.id), true)

  await d.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pg_net down'; END $$`)
  const lq = await add(d, U4, 'rejected', '1 minute')
  await tick(d)
  t('pg_net failing: notice written, lead stamped, push_log request_id NULL', [(await notices(d, U4)).length, await stamped(d, lq.id),
    (await d.query(`SELECT count(*)::int n FROM public.push_log WHERE user_id = '${U4}' AND request_id IS NULL`)).rows[0].n], [2, true, 1])

  const denied = []
  for (const ro of ['anon', 'authenticated', 'service_role']) {
    for (const q of [`SELECT public.dovec_notify_undelivered()`, `SELECT * FROM public.dovec_undelivered_text('English','p','r')`]) {
      denied.push((await asRole(d, ro, ro === 'anon' ? null : U1, q)).ok)
    }
  }
  t('anon / authenticated / service_role cannot run the notifier or the text function', denied, [false, false, false, false, false, false])
  t('positive control: the owner can run both', [(await asRole(d, null, null, `SELECT public.dovec_notify_undelivered()`)).ok, (await asRole(d, null, null, `SELECT * FROM public.dovec_undelivered_text('English','p','r')`)).ok], [true, true])
  t('a customer cannot read dovec_leads (new columns included); service_role can',
    [(await asRole(d, 'authenticated', U1, `SELECT send_live FROM public.dovec_leads`)).ok, (await asRole(d, 'anon', null, `SELECT undelivered_notified_at FROM public.dovec_leads`)).ok,
     (await asRole(d, 'service_role', ADMIN, `SELECT send_live, undelivered_notified_at FROM public.dovec_leads`)).ok], [false, false, true])
  t('a customer reads only their own notice', [(await asRole(d, 'authenticated', U2, `SELECT count(*)::int n FROM public.notifications WHERE type = 'dovec_undelivered'`)).rows?.[0]?.n,
    (await asRole(d, 'authenticated', U5, `SELECT count(*)::int n FROM public.notifications WHERE type = 'dovec_undelivered'`)).rows?.[0]?.n], [2, 0])
  {
    const vs = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')
    const h = vs.slice(vs.indexOf('-- 1242-BEGIN'), vs.indexOf('-- 1242-END'))
    const run = x => d.query(`SELECT 'x'::text AS m, 'x'::text AS o, true AS ok WHERE false ${h}`).then(r => r.rows, e => ({ err: e.message }))
    const tok = await run()
    t('verify_schema H tokens run and are all true', Array.isArray(tok) ? [tok.length, tok.every(r => r.ok === true)] : tok, [2, true])
    await d.exec(`GRANT EXECUTE ON FUNCTION public.dovec_notify_undelivered() TO authenticated`)
    const tok2 = await run()
    t('red: a stray EXECUTE grant turns a token false', Array.isArray(tok2) ? tok2.filter(r => r.ok !== true).length : tok2, 1)
    await d.exec(`REVOKE ALL ON FUNCTION public.dovec_notify_undelivered() FROM PUBLIC, anon, authenticated, service_role`)
    t('green again after the revoke', (await run()).every(r => r.ok === true), true)
    const regs = [...vs.matchAll(/\('20261242_dovec_undelivered_notice','([a-z0-9_]+)'(?:,'([a-z0-9_]+)')?\)/g)].map(m => [m[1], m[2]])
    const fns = (await d.query(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).rows.map(r => r.proname)
    const cols = new Set((await d.query(`SELECT table_name || '.' || column_name c FROM information_schema.columns WHERE table_schema = 'public'`)).rows.map(r => r.c))
    t('four registrations found (2 columns, 2 functions)', regs.length, 4)
    t('registered C functions and B columns exist', [regs.filter(([a, b]) => !b && !fns.includes(a)), regs.filter(([a, b]) => b && !cols.has(`${a}.${b}`))], [[], []])
  }
  const dd = (await d.query(`SELECT pg_get_functiondef('public.dovec_notify_undelivered()'::regprocedure) AS d`)).rows[0].d
  t('is_test is excluded in the function body', /NOT l\.is_test/.test(dd), true)
}

console.log('20261242 — pre-flight and red-first mutants')
{
  const fail = async (label, from, to, want) => {
    const p = mutantFile(from, to); if (!p) return
    const d = await ready()
    const r = await applyFile(d, p)
    const hit = new RegExp(want).test(r.msg || '')
    t(`${label} -> refused (${want})`, [r.ok, hit], [false, true])
    if (!hit) console.log('    msg:', r.msg)
  }
  {
    const d = await freshDb(FIXTURE)
    const r = await applyFile(d, FILE)
    t('without 20261229 the file refuses', [r.ok, /REFUSING: 20261229/.test(r.msg || '')], [false, true])
  }
  await fail('picker drops the is_test filter', 'WHERE NOT l.is_test AND l.send_live', 'WHERE l.send_live', 'body lost its picker')
  await fail('picker drops send_live', 'AND l.send_live AND', 'AND', 'body lost its picker')
  await fail('picker 24 h -> 1 h (pending23h would be notified)', "interval '24 hours'", "interval '1 hour'", 'first tick')
  await fail('picker includes sent', "l.status IN ('rejected', 'failed')", "l.status IN ('rejected', 'failed', 'sent')", 'first tick')
  await fail('stamp removed (second tick duplicates)', 'UPDATE public.dovec_leads SET undelivered_notified_at = now() WHERE id = r.id;', '', 'stamped|second tick|changed the number')
  await fail('window 8 days -> 30 days (old9d notified)', "interval '8 days'", "interval '30 days'", 'first tick')
  await fail('function granted to authenticated', 'REVOKE ALL ON FUNCTION public.dovec_notify_undelivered() FROM PUBLIC, anon, authenticated, service_role;', 'GRANT EXECUTE ON FUNCTION public.dovec_notify_undelivered() TO authenticated;', 'EXECUTE-able by a role other than its owner|can execute')
  await fail('Turkish approved string altered', 'Talebiniz iletilemedi', 'Talebiniz iletilemedi.', 'Turkish text differs')
  await fail('English approved string altered', 'Enquiry not delivered', 'Enquiry not delivered!', 'English text differs')
  await fail('wrong cron schedule', "'7,17,27,37,47,57 * * * *', 'SELECT", "'*/5 * * * *', 'SELECT", 'wrong schedule')
  await fail('data_jobs row names another job', "ARRAY['dovec-notify-undelivered'], NULL", "ARRAY['x-other'], NULL", 'data_jobs row')
  await fail('a policy appears on dovec_leads', '-- ─── 1. Columns', 'CREATE POLICY zz ON public.dovec_leads FOR SELECT TO authenticated USING (true);\n-- ─── 1. Columns', 'policies')
  await fail('app role granted the table', '-- ─── 1. Columns', 'GRANT SELECT ON public.dovec_leads TO authenticated;\n-- ─── 1. Columns', 'holds a privilege')
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
