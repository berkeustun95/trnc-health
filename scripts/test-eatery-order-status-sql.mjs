// 20261193_eatery_order_status.sql + 20261194_eatery_order_status_partner.sql (+ 20261195 / 20261197 / 20261198) against the PGlite harness (PostgreSQL 18; prod is older).
// Fixture: the SAME fixture text as scripts/test-eatery-orders-sql.mjs (sliced out of that file, not retyped) + the Crunchy seed row +
// the 20261120 preview-key policies + stubs for what the real files only reference (profiles.role / push_token / preferred_language,
// is_admin(), push_log, pg_net's net.http_post), then the REAL 20261125, 20261132, 20261134 and 20261144 files.
// The two files' own sentinel probes do the role work; this script adds
//   (a) "identical except": pg_get_functiondef of create after 1144 vs after 1193, and verify after 1134 vs after 1193, line-diffed;
//   (b) behaviour the in-file probes leave out (push sent / not sent / swallowed, tokens cleared, caps and windows, device limit,
//       PIN renewal, admin positive control, retention command, 20-row cap);
//   (c) RED-FIRST mutants of both files (every anchor asserted present): either the apply FAILS with the expected message, or it
//       applies and the named behaviour check goes red;
//   (d) the verify_schema.sql tokens of 1193 / 1194 and every older token that names the changed functions: never an error before
//       1193, all true after 1194.
// HARNESS-ONLY EVIDENCE: PG 18, a stubbed pg_net / pg_cron, no PostgREST. Not wired into package.json / pre-push / CI, like its
// siblings: run by hand.
//
//   node scripts/test-eatery-order-status-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F = (n) => M(n)
const F1125 = M('20261125_eatery_orders.sql'), F1132 = M('20261132_eatery_orders_is_test.sql'), F1134 = M('20261134_eatery_item_options.sql'), F1144 = M('20261144_eatery_order_method.sql')
const FA = M('20261193_eatery_order_status.sql'), FB = M('20261194_eatery_order_status_partner.sql')
const SA = readFileSync(FA, 'utf8'), SB = readFileSync(FB, 'utf8')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners'), b = PRIOR.indexOf('-- ─── Storage bucket')
const s0 = PRIOR.indexOf('-- ─── Seed: Crunchy Express, INACTIVE'), s1 = PRIOR.indexOf('-- ─── contact_events: module')
if (a < 0 || b < a || s0 < 0 || s1 < s0) throw new Error('fixture anchors missing in 20261115')
const SIB = readFileSync(fileURLToPath(new URL('./test-eatery-orders-sql.mjs', import.meta.url)), 'utf8')
const fa = SIB.indexOf('const FIXTURE = `'), fb = SIB.indexOf('`\n\nlet bad', fa)
if (fa < 0 || fb < fa) throw new Error('FIXTURE anchors missing in test-eatery-orders-sql.mjs')
const BASE = new Function('PRIOR', 'a', 'b', 'return ' + SIB.slice(fa + 'const FIXTURE = '.length, fb + 1))(PRIOR, a, b)
const KEY = readFileSync(M('20261120_eatery_preview_key.sql'), 'utf8')
const pa = KEY.indexOf('DROP POLICY IF EXISTS eatery_partners_select_preview'), pb = KEY.indexOf('-- ─── Post-state + proof')
if (pa < 0 || pb < pa) throw new Error('policy anchors missing in 20261120')
const STUBS = `
ALTER TABLE public.profiles ADD COLUMN role text NOT NULL DEFAULT 'customer', ADD COLUMN push_token text, ADD COLUMN preferred_language text;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $f$;
CREATE TABLE public.push_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL, request_id bigint, sent_at timestamptz NOT NULL DEFAULT now());
-- Supabase's default privileges grant new tables / sequences in schema private to anon + authenticated BY NAME, and 20261068 granted them USAGE
-- on the schema (20261120's note): modelled here so that "revoke by name" is load-bearing in this suite, not a no-op.
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $f$
BEGIN
  IF current_setting('zz.net_fail', true) = 'on' THEN RAISE EXCEPTION 'net down'; END IF;
  INSERT INTO net.calls (url, body, headers) VALUES (url, body, headers);
  RETURN currval(pg_get_serial_sequence('net.calls', 'id'));
END $f$;
`
const ACTS12 = ['call','whatsapp','call_secondary','website','maps','route_complete','book','instagram','facebook','email','menu','order_whatsapp']
const CE12 = `
CREATE TABLE IF NOT EXISTS public.contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL,
  action text NOT NULL, region text, lang text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN ('towing','eatery','hotels','connectivity')),
  CONSTRAINT contact_events_action_check CHECK (action IN (${ACTS12.map(x => `'${x}'`).join(',')})));
REVOKE ALL ON public.contact_events FROM anon, authenticated;
GRANT INSERT (module, entity_id, action, region, id, lang) ON public.contact_events TO anon, authenticated;
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ce_insert_public" ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "ce_select_admin" ON public.contact_events FOR SELECT TO authenticated USING (false);
CREATE POLICY "ce_no_update" ON public.contact_events AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);
CREATE POLICY "ce_no_delete" ON public.contact_events AS RESTRICTIVE FOR DELETE TO public USING (false);
INSERT INTO public.schema_migrations_applied (filename, checksum) VALUES ('20261123_eatery_dish_tags_order_whatsapp.sql', 'fixture');`
const FIXTURE = BASE + '\n' + PRIOR.slice(s0, s1) + '\n' + KEY.slice(pa, pb) + '\n' + STUBS

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  return ok
}
const dir = mkdtempSync(join(tmpdir(), 'os-'))
const q = async (d, sql) => (await d.query(sql)).rows
const after1144 = async () => {
  const d = await freshDb(FIXTURE)
  for (const f of [F1125, F1132, F1134, F1144]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  return d
}
const stamped = async (d, f) => { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg); return r }
const full = async (fa = FA, fbp = FB) => { const d = await after1144(); const r1 = await applyFile(d, fa); if (!r1.ok) return { d, r1 }; const r2 = await applyFile(d, fbp); return { d, r1, r2 } }

// mutant: list of [from, to, all?]; every anchor is asserted present (once, unless all).
const mutant = (name, src, pairs) => {
  let text = src
  for (const [from, to, all] of pairs) {
    const n = text.split(from).length - 1
    if (n < 1 || (!all && n !== 1)) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = all ? text.split(from).join(to) : text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}

// Calls as a role with JWT claims and request headers (what PostgREST would set).
const WORKER_KEY = 'zz-harness-worker-key-not-a-secret'
const sha = async (d, s) => (await q(d, `SELECT encode(sha256(convert_to('${s}', 'UTF8')), 'hex') h`))[0].h
const UID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const as = async (d, who, sql, { key = true } = {}) => {
  const role = who === 'anon' ? 'anon' : who === 'pg' ? null : who === 'sr' ? 'service_role' : 'authenticated'
  const claims = who === 'anon' || who === 'pg' ? '' : who === 'sr' ? JSON.stringify({ role: 'service_role' })
    : who.startsWith('guest:') ? JSON.stringify({ sub: UID(who.split(':')[1]), role: 'authenticated', is_anonymous: true })
    : JSON.stringify({ sub: UID(who.split(':')[1]), role: 'authenticated' })
  await d.exec('RESET ROLE;')
  await d.query(`SELECT set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`, [claims, key ? JSON.stringify({ 'x-ada-worker-key': WORKER_KEY }) : ''])
  if (role) await d.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await d.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0], code: e.code } }
  finally { await d.exec('RESET ROLE;') }
}
const val = (r) => (r.ok ? Object.values(r.rows[0] ?? {})[0] : `ERR ${r.msg}`)
const OK = (c) => `'${c}'`
// A partner, its orders (inserted directly as the owner) and the probe Worker key.
const seed = async (d) => {
  await d.exec(`INSERT INTO private.eatery_worker_key_hashes (key_sha256, note) VALUES ('${await sha(d, WORKER_KEY)}', 'harness') ON CONFLICT DO NOTHING`)
  await d.exec(`INSERT INTO auth.users (id) VALUES ('${UID(1)}'), ('${UID(2)}'), ('${UID(3)}'), ('${UID(9)}') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, role, push_token, preferred_language) VALUES
      ('${UID(1)}', 'customer', 'ExponentPushToken[profileTokenAAAA]', 'German'),
      ('${UID(2)}', 'customer', 'ExponentPushToken[guestProfileTok1]', 'French'),
      ('${UID(3)}', 'customer', NULL, NULL),
      ('${UID(9)}', 'admin', NULL, NULL) ON CONFLICT DO NOTHING;
    INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method, order_status_enabled)
      VALUES ('11111111-1111-4111-8111-111111111111', 'zz-h-a', 'Harness A', 'cafe', 35.1, 33.3, 'partner', 'zz-h-a/logo.png', current_date, true, 'whatsapp', true),
             ('22222222-2222-4222-8222-222222222222', 'zz-h-b', 'Harness B', 'cafe', 35.1, 33.3, 'partner', 'zz-h-b/logo.png', current_date, true, 'whatsapp', true) ON CONFLICT DO NOTHING;`)
}
const PA = '11111111-1111-4111-8111-111111111111', PB = '22222222-2222-4222-8222-222222222222'
let codeN = 0
const CH = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const nextCode = () => { let n = ++codeN, s = ''; for (let i = 0; i < 8; i++) { s = CH[n % 32] + s; n = Math.floor(n / 32) } return s }
const order = async (d, o = {}) => {
  const code = o.code ?? nextCode()
  await d.query(`INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_as_guest, is_test, fulfilment, created_at, expires_at, notify_token, notify_lang)
    VALUES ($1, $2, '[{"name":"zz","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', $3, $4, $5, $6, now() - $7::interval, now() - $7::interval + interval '2 hours', $8, $9)`,
    [code, o.partner ?? PA, o.by ?? UID(1), o.guest ?? false, o.test ?? false, o.mode ?? null, o.age ?? '0 seconds', o.token ?? null, o.lang ?? null])
  return code
}
const issue = async (d, partner, scope = 'partner') => (await q(d, `SELECT public.eatery_pin_issue(${partner ? `'${partner}'` : 'NULL'}, '${scope}') AS r`))[0].r
const enrol = async (d, code, pin) => (await as(d, 'anon', `SELECT public.eatery_partner_enrol('${code}', ${pin == null ? 'NULL' : `'${pin}'`}) AS r`)).rows?.[0]?.r
const setst = async (d, code, st, reason, dev) => (await as(d, 'anon', `SELECT public.eatery_order_set_status('${code}', '${st}', ${reason ? `'${reason}'` : 'NULL'}, ${dev ? `'${dev}'` : 'NULL'}) AS r`)).rows?.[0]?.r
const device = async (d, partner, scope = 'partner', testOrderScope = false) => {
  const pin = (await issue(d, partner, scope)).pin
  const c = await order(d, { partner: partner ?? PA, test: scope === 'test' })
  const r = await enrol(d, c, pin)
  return { pin, token: r.device_token, status: r.status }
}

console.log('20261193 + 20261194 eatery order status — real files on the 20261144-state fixture')
const defsOf = async (d) => ({
  create3: (await q(d, `SELECT to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NOT NULL AS x`))[0].x ? (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure) d`))[0].d : null,
  create4: (await q(d, `SELECT to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)') IS NOT NULL AS x`))[0].x ? (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text,text)'::regprocedure) d`))[0].d : null,
  verify1: (await q(d, `SELECT to_regprocedure('public.verify_eatery_order(text)') IS NOT NULL AS x`))[0].x ? (await q(d, `SELECT pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure) d`))[0].d : null,
  verify2: (await q(d, `SELECT to_regprocedure('public.verify_eatery_order(text,text)') IS NOT NULL AS x`))[0].x ? (await q(d, `SELECT pg_get_functiondef('public.verify_eatery_order(text,text)'::regprocedure) d`))[0].d : null })
const lineDiff = (x, y) => {
  const A = x.split('\n'), B = y.split('\n')
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const removed = [], added = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(A[i++]); else added.push(B[j++])
  }
  while (i < A.length) removed.push(A[i++])
  while (j < B.length) added.push(B[j++])
  return { removed: removed.map(s => s.trim()), added: added.map(s => s.trim()) }
}

const db = await after1144()
const d0 = await defsOf(db)
const m0 = await (async () => q(db, `SELECT p.proname, pg_get_userbyid(p.proowner) o, p.prosecdef sd, p.proconfig cfg,
    (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee WHERE x.privilege_type = 'EXECUTE') grants
  FROM pg_proc p WHERE p.proname IN ('create_eatery_order','verify_eatery_order') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`))()
const ra = await applyFile(db, FA)
t('20261193 applies cleanly on the 1144 state (in-file probes green)', ra, { ok: true, msg: null })
if (!ra.ok) process.exit(1)
t('20261193 applies a SECOND time (re-runnable)', await applyFile(db, FA), { ok: true, msg: null })
const d1 = await defsOf(db)
t('no old create / verify signature remains, exactly one of each name', [d1.create3, d1.verify1, (await q(db, `SELECT count(*)::int n FROM pg_proc WHERE proname IN ('create_eatery_order','verify_eatery_order') AND pronamespace = 'public'::regnamespace`))[0].n], [null, null, 2])
const dc = lineDiff(d0.create3, d1.create4)
t('create: identical except the signature, the p_mode check, and the stored fulfilment', dc, {
  removed: ['CREATE OR REPLACE FUNCTION public.create_eatery_order(p_partner uuid, p_items jsonb, p_client_id text DEFAULT NULL::text)',
    'INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest, is_test)',
    'VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test)'],
  added: ['CREATE OR REPLACE FUNCTION public.create_eatery_order(p_partner uuid, p_items jsonb, p_client_id text DEFAULT NULL::text, p_mode text DEFAULT NULL::text)',
    '-- 20261193: the fulfilment the customer chose; NULL = an order from an older app. Checked before anything is written or counted.',
    "IF p_mode IS NOT NULL AND p_mode NOT IN ('pickup','delivery') THEN", "RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mode';", 'END IF;', '',
    'INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest, is_test, fulfilment)',
    'VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test, p_mode)'] })
const dv = lineDiff(d0.verify1, d1.verify2)
t('verify: identical except the signature, three variables, the partner read, and the added keys', dv, {
  removed: ['CREATE OR REPLACE FUNCTION public.verify_eatery_order(p_code text)', 'SELECT name INTO v_name FROM public.eatery_partners WHERE id = v_o.partner_id;', "'is_test',                v_o.is_test);"],
  added: ['CREATE OR REPLACE FUNCTION public.verify_eatery_order(p_code text, p_device text DEFAULT NULL::text)', 'v_enabled boolean;', 'v_open    boolean;', 'v_can     boolean;',
    'SELECT name, order_status_enabled INTO v_name, v_enabled FROM public.eatery_partners WHERE id = v_o.partner_id;',
    "v_open := now() < v_o.created_at + interval '12 hours' AND v_o.status NOT IN ('on_the_way','ready','cancelled');",
    'v_can  := public.eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device);',
    "'is_test',                v_o.is_test,", "'fulfilment',             v_o.fulfilment,", "'order_status',           v_o.status,", "'status_at',              v_o.status_at,",
    "'cancel_reason',          v_o.cancel_reason,", "'status_open',            v_open,", "'status_enabled',         COALESCE(v_enabled, false),", "'can_manage',             COALESCE(v_can, false),",
    "'next',                   CASE WHEN COALESCE(v_can, false) AND v_open AND (v_o.is_test OR COALESCE(v_enabled, false))",
    'THEN to_jsonb(public.eatery_order_next_statuses(v_o.status, v_o.fulfilment))', "ELSE '[]'::jsonb END);"] })
const meta = async (d) => q(d, `SELECT p.proname, pg_get_userbyid(p.proowner) o, p.prosecdef sd, p.proconfig cfg,
    (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee WHERE x.privilege_type = 'EXECUTE') grants
  FROM pg_proc p WHERE p.proname IN ('create_eatery_order','verify_eatery_order') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`)
t('create / verify: owner, DEFINER, search_path and EXECUTE grants exactly as before 1193', await meta(db), m0)
const rb = await applyFile(db, FB)
t('20261194 applies cleanly on the 1193 state (in-file probes green)', rb, { ok: true, msg: null })
if (!rb.ok) process.exit(1)
t('20261194 applies a SECOND time (re-runnable)', await applyFile(db, FB), { ok: true, msg: null })
t('the Worker key store is EMPTY after a first apply', (await q(db, `SELECT count(*)::int n FROM private.eatery_worker_key_hashes`))[0].n, 0)
t('ledger rows', (await q(db, `SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).map(r => r.filename),
  ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261144_eatery_order_method.sql', '20261193_eatery_order_status.sql', '20261194_eatery_order_status_partner.sql'])
t('no old signature, no overload after both files', (await q(db, `SELECT proname, count(*)::int n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('create_eatery_order','verify_eatery_order','eatery_order_can_manage') GROUP BY 1 ORDER BY 1`)),
  [{ proname: 'create_eatery_order', n: 1 }, { proname: 'eatery_order_can_manage', n: 1 }, { proname: 'verify_eatery_order', n: 1 }])

// B refuses to run without A.
{
  const d = await after1144()
  const r = await applyFile(d, FB)
  t('20261194 REFUSES to run when 20261193 is not applied', [r.ok, (r.msg || '').includes('20261193_eatery_order_status.sql is not in the ledger')], [false, true])
}

// ── verify_schema.sql tokens ──
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const slice = (from, to) => { const x = VS.indexOf(from), y = VS.indexOf(to, x + 1); if (x < 0 || y < x) throw new Error('verify_schema anchors missing: ' + from.slice(0, 50)); return VS.slice(x, y) }
const tokq = (s) => `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
const T93 = tokq(slice('    -- 1193-BEGIN', '    -- 1193-END')), T94 = tokq(slice('    -- 1194-BEGIN', '    -- 1194-END'))
const T44 = tokq(slice('    -- ── 1144: eatery_partners.order_method', '    -- 1135 Crunchy per-dish options (data).'))
const T34 = tokq(slice('    -- ── 1134: per-dish options', '    -- ── 1132: server-marked TEST orders'))
const T32 = tokq(slice('    -- ── 1132: server-marked TEST orders', '    -- ── 1125: WhatsApp order proof.'))
const T25 = tokq(slice('    -- ── 1125: WhatsApp order proof.', "    UNION ALL SELECT '1119_eatery_preview_read','eatery_partners: exactly 2"))
const tokens = async (d, label, sql, want, n) => {
  try {
    const rows = (await d.query(sql)).rows
    const okAll = want === null ? true : rows.every(r => r.ok === want)
    t(`verify_schema ${label}: ${rows.length} tokens${want === null ? '' : `, all ${want}`}`, [rows.length > 0 && (n === undefined || rows.length === n), okAll], [true, true])
    if (want !== null && rows.some(r => r.ok !== want)) console.log(rows.filter(r => r.ok !== want).map(r => '      ' + r.object.slice(0, 110)).join('\n'))
    return rows
  } catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}
{
  const d = await after1144()
  await tokens(d, '1193 tokens BEFORE 1193 (must not error; red is fine)', T93, false)
  await tokens(d, '1194 tokens BEFORE 1193', T94, false)
  // The OLDER tokens that name create / verify resolve whichever signature is live, so on the 1144 state (before 1193) they are exactly as green as before.
  for (const [n, s] of [['1144', T44], ['1134', T34], ['1132', T32]]) await tokens(d, `older ${n} block BEFORE 1193 (the 1144 state)`, s, true)
  await applyFile(d, FA)
  await tokens(d, '1193 tokens AFTER 1193', T93, true)
  await tokens(d, '1194 tokens AFTER 1193 only (must not error)', T94, false)
  await applyFile(d, FB)
  await tokens(d, '1193 tokens AFTER 1194', T93, true)
  await tokens(d, '1194 tokens AFTER 1194', T94, true)
  for (const [n, s] of [['1144', T44], ['1134', T34], ['1132', T32]]) await tokens(d, `older ${n} block AFTER 1194`, s, true)
  // The 1125 slice (as in test-eatery-orders-sql.mjs) now runs over a token that names public.places, absent from this fixture: take its rows one by one.
  const rows25 = T25.split('\n    UNION ALL SELECT ').slice(1).map(x => 'UNION ALL SELECT ' + x).filter(x => /create_eatery_order|verify_eatery_order/.test(x))
  let n25 = 0, ok25 = 0
  for (const r of rows25) { try { const rr = (await d.query(tokq('    ' + r))).rows; n25 += rr.length; ok25 += rr.filter(x => x.ok).length } catch (e) { console.log('      1125 row error:', String(e.message).split('\n')[0]) } }
  t('verify_schema older 1125 rows naming create / verify AFTER 1194: all true', [n25 > 0, ok25 === n25], [true, true])
}

// ── 20261195: the Worker key hash (data) ──
{
  const FC = M('20261195_eatery_worker_key.sql'), HASH = 'e2521b10b0c909008d587b61f84f134b2626c05702f3b57d2029ad5b128195b4'
  const T95 = tokq(slice('    -- 20261195 Worker key hash (data).', '      END, false)\n') + '      END, false)\n')
  const hashes = async (d) => (await q(d, `SELECT key_sha256 FROM private.eatery_worker_key_hashes ORDER BY 1`)).map(r => r.key_sha256)
  { const z = await after1144(); await applyFile(z, FA)
    const r0 = await applyFile(z, FC)
    t('20261195 REFUSES before 20261194 (nothing applied)', [r0.ok, (r0.msg || '').includes('20261194 is not applied')], [false, true]) }
  const d = await after1144()
  await applyFile(d, FA)
  await applyFile(d, FB)
  await tokens(d, '1195 token BEFORE 1195 (red, no error)', T95, false, 1)
  const r1 = await applyFile(d, FC)
  t('20261195 applies on the 1194 state', r1, { ok: true, msg: null })
  t('20261195: the store holds exactly the one hash', await hashes(d), [HASH])
  await tokens(d, '1195 token AFTER 1195', T95, true, 1)
  t('20261195 re-runs as a no-op', [(await applyFile(d, FC)).ok, await hashes(d)], [true, [HASH]])
  t('a wrong key in the header is still refused (as the DEFINER callers see it)', val(await as(d, 'pg', `SELECT public.eatery_worker_key_ok() AS c`)), false)
  const e = await after1144(); await applyFile(e, FA); await applyFile(e, FB)
  await e.exec(`INSERT INTO private.eatery_worker_key_hashes (key_sha256, note) VALUES ('${'a'.repeat(64)}', 'other')`)
  const r2 = await applyFile(e, FC)
  await e.exec('ROLLBACK;').catch(() => {})
  t('20261195 REFUSES when another hash is already stored, and adds nothing', [r2.ok, (r2.msg || '').includes('already holds another hash'), await hashes(e)], [false, true, ['a'.repeat(64)]])
}
// ── 20261197: admin clears ONE bucket's PIN lock counters (attempt rows only; PIN + devices untouched), 3 per bucket per 24 h, logged ──
// Three buckets: partner A, partner B, test. Each has a PIN row and an enrolled device (A + test) and two attempt rows, inserted as postgres.
// checks97 returns named booleans; the real file must turn every one true, and each 1197 mutant must turn its named one false.
const F97 = M('20261197_eatery_pin_attempts_reset.sql'), S97 = readFileSync(F97, 'utf8')
const after1194 = async () => { const d = await after1144(); await stamped(d, FA); await stamped(d, FB); return d }
const setup97 = async (d) => {
  await seed(d)
  await device(d, PA); await device(d, null, 'test'); await issue(d, PB)
}
// fill97 refills every bucket's attempts; by default it also empties the reset log (each scenario starts under the cap).
const fill97 = async (d, { keepLog = false } = {}) => {
  if (!keepLog) await d.exec(`DELETE FROM private.eatery_pin_resets;`)
  await d.exec(`DELETE FROM private.eatery_pin_attempts;
    INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok) VALUES
      ('partner', '${PA}', 'ZZAAAAA1', false), ('partner', '${PA}', 'ZZAAAAA2', false),
      ('partner', '${PB}', 'ZZBBBBB1', false), ('partner', '${PB}', 'ZZBBBBB2', true),
      ('test', NULL, 'ZZTTTTT1', false), ('test', NULL, 'ZZTTTTT2', false);`)
}
// Bucket -> attempt count, as postgres (the role allowed to read the private table).
const buckets97 = async (d) => {
  await d.exec('RESET ROLE;')
  const r = await q(d, `SELECT CASE WHEN scope = 'test' THEN 'T' WHEN partner_id = '${PA}' THEN 'A' WHEN partner_id = '${PB}' THEN 'B' ELSE '?' END k, count(*)::int n
    FROM private.eatery_pin_attempts GROUP BY 1 ORDER BY 1`)
  return Object.fromEntries(r.map(x => [x.k, x.n]))
}
const keep97 = async (d) => { await d.exec('RESET ROLE;'); return JSON.stringify([
  await q(d, `SELECT scope, partner_id, salt, pin_sha256, set_at FROM private.eatery_partner_pins ORDER BY scope, partner_id NULLS FIRST`),
  await q(d, `SELECT id, scope, partner_id, token_sha256, created_at, last_used_at, revoked_at FROM private.eatery_partner_devices ORDER BY id`)]) }
const log97 = async (d) => { await d.exec('RESET ROLE;'); return q(d, `SELECT id, scope, partner_id, admin_id, at FROM private.eatery_pin_resets ORDER BY id`) }
const reset97 = (d, who, partner, scope) => as(d, who, `SELECT public.admin_reset_eatery_pin_attempts(${partner ? `'${partner}'` : 'NULL'}, ${scope == null ? 'NULL' : `'${scope}'`}) AS r`, { key: false })
const ALL3 = { A: 2, B: 2, T: 2 }
const checks97 = async (d) => {
  const res = []
  const ck = (name, ok, detail) => { res.push([name, ok === true]); if (ok !== true) console.log(`      (${name}) ${String(JSON.stringify(detail) ?? '').replace(/[0-9a-f]{32,}/g, '<hex>').slice(0, 200)}`) }
  await setup97(d)
  const keep = await keep97(d)
  const pinsDevs = await q(d, `SELECT (SELECT count(*)::int FROM private.eatery_partner_pins) p, (SELECT count(*)::int FROM private.eatery_partner_devices WHERE revoked_at IS NULL) v`)
  ck('setup: 3 PIN rows and 2 live devices exist (so "unchanged" is not vacuous)', pinsDevs[0].p === 3 && pinsDevs[0].v === 2, pinsDevs)

  await fill97(d)
  const rA = await reset97(d, 'admin:9', PA, 'partner')
  ck('admin resets partner A: returns {status ok, scope partner, partner_id A}', rA.ok && JSON.stringify(rA.rows[0].r) === JSON.stringify({ scope: 'partner', status: 'ok', partner_id: PA }), rA)
  const bA = await buckets97(d)
  ck('partner A reset: A attempts gone', bA.A === undefined, bA)
  ck('partner A reset: B and test attempts untouched', bA.B === 2 && bA.T === 2, bA)
  ck('partner A reset: PIN rows and devices unchanged', (await keep97(d)) === keep, null)
  const lgA = await log97(d)
  ck('partner A reset: ONE log row, carrying the calling admin\'s id, scope partner, partner A', lgA.length === 1 && lgA[0].admin_id === UID(9) && lgA[0].scope === 'partner' && lgA[0].partner_id === PA, lgA)

  await fill97(d)
  const rT = await reset97(d, 'admin:9', null, 'test')
  ck('admin resets the test bucket: returns {status ok, scope test, partner_id null}', rT.ok && JSON.stringify(rT.rows[0].r) === JSON.stringify({ scope: 'test', status: 'ok', partner_id: null }), rT)
  const bT = await buckets97(d)
  ck('test reset: test attempts gone, A and B untouched', bT.T === undefined && bT.A === 2 && bT.B === 2, bT)
  ck('test reset: PIN rows and devices unchanged', (await keep97(d)) === keep, null)

  // Denials, each beside its positive control in the same setup (the admin call on the same bucket succeeds right after).
  for (const [who, label, want] of [['customer:1', 'customer', 'P0001 forbidden'], ['guest:9', 'guest session of the admin account', 'P0001 forbidden'], ['anon', 'anon', '42501']]) {
    await fill97(d)
    const r = await reset97(d, who, PA, 'partner')
    const got = r.ok ? 'ok' : r.code === 'P0001' ? `P0001 ${r.msg}` : r.code
    const b = await buckets97(d), lg = await log97(d)
    ck(`${label} denied (${want}), nothing deleted, nothing logged`, got === want && JSON.stringify(b) === JSON.stringify(ALL3) && lg.length === 0, { got, b, lg: lg.length })
    const pc = await reset97(d, 'admin:9', PA, 'partner')
    const b2 = await buckets97(d)
    ck(`positive control after the ${label} denial: admin clears A in the same setup`, pc.ok && b2.A === undefined && b2.B === 2 && b2.T === 2, { pc, b2 })
  }

  // Invalid scope / partner: refused before anything is deleted.
  for (const [partner, scope, want, label] of [[null, 'x', 'invalid_scope', 'scope x'], [PA, null, 'invalid_scope', 'scope NULL'], [PA, 'test', 'invalid_partner', 'test scope WITH a partner'],
    [null, 'partner', 'invalid_partner', 'partner scope, partner NULL'], ['99999999-9999-4999-8999-999999999999', 'partner', 'invalid_partner', 'partner scope, unknown partner']]) {
    await fill97(d)
    const r = await reset97(d, 'admin:9', partner, scope)
    const b = await buckets97(d)
    ck(`${label}: P0001 ${want}, nothing deleted`, !r.ok && r.code === 'P0001' && r.msg === want && JSON.stringify(b) === JSON.stringify(ALL3), { r, b })
  }

  // The cap: 3 resets per bucket per rolling 24 hours; the 4th is refused and changes nothing.
  await fill97(d)
  const three = []
  for (let i = 0; i < 3; i++) { await fill97(d, { keepLog: true }); three.push((await reset97(d, 'admin:9', PA, 'partner')).ok) }
  ck('cap: three resets of partner A in a row succeed', JSON.stringify(three) === '[true,true,true]', three)
  await fill97(d, { keepLog: true })
  const logBefore = JSON.stringify(await log97(d))
  const r4 = await reset97(d, 'admin:9', PA, 'partner')
  ck('cap: the 4th reset of A is refused with P0001 reset_limit', !r4.ok && r4.code === 'P0001' && r4.msg === 'reset_limit', r4)
  const b4 = await buckets97(d)
  ck('cap: the refused 4th reset leaves A\'s attempts (and every bucket) in place', JSON.stringify(b4) === JSON.stringify(ALL3), b4)
  ck('cap: the refused 4th reset writes and prunes no log row', JSON.stringify(await log97(d)) === logBefore, null)
  const rB = await reset97(d, 'admin:9', PB, 'partner')
  const bB = await buckets97(d)
  ck('cap: partner B is not capped by A\'s resets (B cleared, A untouched)', rB.ok && bB.B === undefined && bB.A === 2 && bB.T === 2, { rB, bB })
  const rTc = await reset97(d, 'admin:9', null, 'test')
  ck('cap: the test bucket is not capped by A\'s resets', rTc.ok, rTc)
  // The window rolls: one of A's three resets moved to 25 hours ago no longer counts.
  await d.exec(`UPDATE private.eatery_pin_resets SET at = now() - interval '25 hours' WHERE id = (SELECT min(id) FROM private.eatery_pin_resets WHERE partner_id = '${PA}')`)
  await fill97(d, { keepLog: true })
  const r5 = await reset97(d, 'admin:9', PA, 'partner')
  ck('cap window: with one reset backdated 25 h, A can be reset again', r5.ok && (await buckets97(d)).A === undefined, r5)
  const r6 = await reset97(d, 'admin:9', PA, 'partner')
  ck('cap window: ... and is then at the cap again (reset_limit)', !r6.ok && r6.msg === 'reset_limit', r6)

  // The 90-day prune (any bucket), in the same call.
  await fill97(d)
  await d.exec(`INSERT INTO private.eatery_pin_resets (scope, partner_id, admin_id, at) VALUES
    ('test', NULL, '${UID(9)}', now() - interval '91 days'), ('partner', '${PB}', '${UID(9)}', now() - interval '89 days')`)
  const rp = await reset97(d, 'admin:9', PA, 'partner')
  const lgp = (await log97(d)).map(x => `${x.scope}:${x.partner_id === PA ? 'A' : x.partner_id === PB ? 'B' : '-'}`)
  ck('prune: a log row over 90 days old (another bucket) is deleted, an 89-day one kept, the new one added', rp.ok && JSON.stringify(lgp) === JSON.stringify(['partner:B', 'partner:A']), { rp, lgp })

  ck('after every call: PIN rows and devices unchanged', (await keep97(d)) === keep, null)
  return res
}
{
  const T97 = tokq(slice('    -- 1197-BEGIN', '    -- 1197-END'))
  { const z = await after1144(); await stamped(z, FA)
    const r0 = await applyFile(z, F97); await z.exec('ROLLBACK;').catch(() => {})
    t('20261197 REFUSES before 20261194 (nothing applied)', [r0.ok, (r0.msg || '').includes('20261194_eatery_order_status_partner.sql is not in the ledger'),
      (await q(z, `SELECT to_regprocedure('public.admin_reset_eatery_pin_attempts(uuid,text)') IS NULL AS x`))[0].x], [false, true, true]) }
  { const z = await after1144(); await tokens(z, '1197 token on the 1144 state (red, no error)', T97, false, 2) }
  const d = await after1194()
  await tokens(d, '1197 token AFTER 1194, BEFORE 1197 (red, no error)', T97, false, 2)
  t('20261197 applies on the 1194 state (in-file post-state green)', await applyFile(d, F97), { ok: true, msg: null })
  t('20261197 applies a SECOND time (re-runnable)', await applyFile(d, F97), { ok: true, msg: null })
  await tokens(d, '1197 token AFTER 1197', T97, true, 2)
  t('20261197: grants as stated (authenticated yes; anon, PUBLIC no)', (await q(d, `SELECT has_function_privilege('authenticated', 'public.admin_reset_eatery_pin_attempts(uuid,text)', 'EXECUTE') au,
      has_function_privilege('anon', 'public.admin_reset_eatery_pin_attempts(uuid,text)', 'EXECUTE') an,
      EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = 'public.admin_reset_eatery_pin_attempts(uuid,text)'::regprocedure)) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') pu`))[0], { au: true, an: false, pu: false })
  const res = await checks97(d)
  t(`20261197 behaviour: ${res.length} named checks, all true`, [res.length, res.filter(r => !r[1]).map(r => r[0])], [30, []])
  t('verify_schema registers 20261197 (C and G rows; E rows for the log)', [VS.split("('20261197_eatery_pin_attempts_reset','admin_reset_eatery_pin_attempts')").length - 1,
    ['eatery_pin_resets_pkey', 'eatery_pin_resets_scope_check', 'eatery_pin_resets_scope_partner_check'].every(c => VS.includes(`('20261197_eatery_pin_attempts_reset','${c}')`))], [2, true])
  t('20261197: the log table is unreachable for anon / authenticated (table + sequence), RLS on, 0 policies', (await q(d, `SELECT
      has_table_privilege('anon', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', 'private.eatery_pin_resets', 'SELECT,INSERT,UPDATE,DELETE') reach,
      has_sequence_privilege('authenticated', pg_get_serial_sequence('private.eatery_pin_resets', 'id'), 'USAGE') seq,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.eatery_pin_resets'::regclass) rls,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private' AND tablename = 'eatery_pin_resets') pol`))[0], { reach: false, seq: false, rls: true, pol: 0 })
  t('20261197: an authenticated session cannot read the log directly (42501), postgres can (positive control)',
    [(await as(d, 'admin:9', `SELECT count(*) FROM private.eatery_pin_resets`, { key: false })).code, (await as(d, 'pg', `SELECT count(*)::int >= 0 AS x FROM private.eatery_pin_resets`)).ok], ['42501', true])
}
// The rewritten retention row (cron section): WRONG until 20261194 runs, OK after it (a newline-exact match of the whole command).
{
  const cslice = slice('-- ─── 1132 (command rewritten by 20261194', '\nUNION ALL\n-- ─── 20261148')
  const cq = `SELECT migration, object, status FROM (${cslice.replace(/^--.*\n/, '')}) z(migration, object, status)`
  const d = await after1144(); await applyFile(d, FA)
  const r1 = (await d.query(cq)).rows[0]
  await applyFile(d, FB)
  const r2 = (await d.query(cq)).rows[0]
  t('verify_schema retention row (labelled 20261194): not OK after 1193 only, OK after 1194', [r1.migration, r1.status !== 'OK', r2.status], ['20261194_eatery_order_status_partner', true, 'OK'])
}
// A fuller chain: the later eatery migrations that touch the same tables (banner path 1151, order_method website 1157) before 1193 / 1194.
{
  const d = await freshDb(FIXTURE)
  for (const f of ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261144_eatery_order_method.sql', '20261151_eatery_partners_banner_path.sql']) { const r = await applyFile(d, M(f)); if (!r.ok) throw new Error(f + ': ' + r.msg) }
  await d.exec(CE12)
  const r57 = await applyFile(d, M('20261157_eatery_order_website.sql'))
  t('fuller chain: 1151 + 1157 apply before 1193', r57, { ok: true, msg: null })
  if (r57.ok) {
    t('fuller chain: 20261193 applies (sentinels green)', await applyFile(d, FA), { ok: true, msg: null })
    t('fuller chain: 20261194 applies (sentinels green)', await applyFile(d, FB), { ok: true, msg: null })
  }
}
t('verify_schema registers the new objects (A, B, C, E, F, G rows present)', [
  VS.includes("('20261193_eatery_order_status','eatery_order_events')"), VS.includes("('20261193_eatery_order_status','eatery_orders','fulfilment')"),
  VS.includes("('20261194_eatery_order_status_partner','eatery_order_set_status')"), VS.includes("('20261194_eatery_order_status_partner','eatery_partner_pins_scope_partner_check')"),
  VS.includes("('20261193_eatery_order_status','eatery_order_events_order_id_idx')"), VS.includes("('20261194_eatery_order_status_partner','eatery_partner_enrol')")], [true, true, true, true, true, true])

// ── behaviour checks the in-file probes leave out (harness only: stubbed pg_net / pg_cron, PG 18) ──
// Each check is a named boolean. The green run needs all of them true; a mutant that applies must turn its named check red.
const checks = async (d) => {
  const res = []
  const ck = (name, ok, detail) => { res.push([name, ok === true]); if (ok !== true) console.log(`      (${name}) ${String(JSON.stringify(detail) ?? '').replace(/[0-9a-f]{32,}/g, '<hex>').slice(0, 160)}`) }
  await seed(d)
  const calls = async () => (await q(d, `SELECT count(*)::int n FROM net.calls`))[0].n
  const lastCall = async () => (await q(d, `SELECT body FROM net.calls ORDER BY id DESC LIMIT 1`))[0]?.body
  const row = async (code) => (await q(d, `SELECT status, cancel_reason, notify_token, notify_lang FROM public.eatery_orders WHERE code = '${code}'`))[0]
  const dev = (await device(d, PA)).token

  // push
  {
    const o = await order(d, { token: 'ExponentPushToken[orderTokenAAAA]', lang: 'Turkish' })
    const n0 = await calls(); const r = await setst(d, o, 'received', null, dev); const b = await lastCall()
    ck('push sent with the order token, Turkish text, partner title, deep-link data',
      r?.changed === true && (await calls()) === n0 + 1 && b?.to === 'ExponentPushToken[orderTokenAAAA]' && b?.body === 'Siparişin alındı.' && b?.title === 'Harness A'
        && b?.data?.screen === 'eatery_order' && b?.data?.code === o && Object.keys(b?.data ?? {}).length === 2, { r, b })
    const lg = await q(d, `SELECT kind, request_id FROM public.push_log WHERE user_id = '${UID(1)}' ORDER BY id DESC LIMIT 1`)
    ck('push_log row with kind order_status and the request id', lg[0]?.kind === 'order_status' && lg[0]?.request_id != null, lg)
  }
  {
    const o = await order(d, { test: true, token: 'ExponentPushToken[orderTokenBBBB]', lang: 'English' })
    await setst(d, o, 'preparing', null, dev); const b = await lastCall()
    ck('push title is prefixed TEST · for a test order', b?.title === 'TEST \u00b7 Harness A' && b?.body === 'Your order is being prepared.', b)
  }
  {
    const o = await order(d, { by: UID(2), guest: true })
    const n0 = await calls(); const r = await setst(d, o, 'received', null, dev)
    ck('no order token on a guest order: NO http call even though the profile has a token; the status still changes', r?.changed === true && (await calls()) === n0 && (await row(o)).status === 'received', r)
    const lg = await q(d, `SELECT request_id FROM public.push_log WHERE user_id = '${UID(2)}' AND kind = 'order_status'`)
    ck('the no-token change is still logged, with a NULL request id', lg.length === 1 && lg[0].request_id === null, lg)
  }
  {
    const o = await order(d, { by: UID(1), guest: false })
    const n0 = await calls(); await setst(d, o, 'received', null, dev); const b = await lastCall()
    ck('signed-in order without an order token: profile token and profile language (German) are used', (await calls()) === n0 + 1 && b?.to === 'ExponentPushToken[profileTokenAAAA]' && b?.body === 'Deine Bestellung ist eingegangen.', b)
  }
  {
    const o = await order(d, { by: UID(3), guest: false })
    const n0 = await calls(); const r = await setst(d, o, 'received', null, dev)
    ck('signed-in order whose profile has no token: no http call, status changes', r?.changed === true && (await calls()) === n0, r)
  }
  {
    await d.exec(`SELECT set_config('zz.net_fail', 'on', false)`)
    const o = await order(d, { token: 'ExponentPushToken[orderTokenCCCC]', lang: 'Greek' })
    const r = await setst(d, o, 'received', null, dev)
    const ev = (await q(d, `SELECT count(*)::int n FROM public.eatery_order_events e JOIN public.eatery_orders x ON x.id = e.order_id WHERE x.code = '${o}'`))[0].n
    ck('a push that FAILS (pg_net down) never undoes or fails the status change', r?.status === 'ok' && r?.changed === true && (await row(o)).status === 'received' && ev === 1, { r, ev })
    const lg = (await q(d, `SELECT count(*)::int n FROM public.push_log WHERE request_id IS NULL AND kind = 'order_status' AND user_id = '${UID(1)}'`))[0].n
    ck('a failed push is still logged (NULL request id) for this order\'s user', lg === 1, lg)
    await d.exec(`SELECT set_config('zz.net_fail', 'off', false)`)
  }
  {
    const o = await order(d, { token: 'ExponentPushToken[orderTokenDDDD]', lang: 'French', mode: 'pickup' })
    await setst(d, o, 'received', null, dev)
    const mid = await row(o)
    await setst(d, o, 'ready', null, dev)
    const end = await row(o)
    ck('push token + language kept on a non-final status, cleared on a final one', mid.notify_token !== null && mid.notify_lang === 'French' && end.notify_token === null && end.notify_lang === null, { mid, end })
    const o2 = await order(d, { token: 'ExponentPushToken[orderTokenEEEE]', lang: 'French' })
    await setst(d, o2, 'cancelled', 'busy', dev)
    const c = await row(o2)
    ck('cancelled is final too: token cleared, reason stored', c.notify_token === null && c.status === 'cancelled' && c.cancel_reason === 'busy', c)
    const b = await lastCall()
    ck('cancel push text carries the reason in the language', b?.body === 'Ta commande a été annulée : Le restaurant est trop occupé pour le moment.', b)
  }

  // caps and windows
  {
    const free = async () => d.exec(`UPDATE private.eatery_partner_devices SET revoked_at = now() WHERE revoked_at IS NULL`)
    const pin = (await issue(d, PA)).pin
    const ins = async (n, ago, prefix) => { for (let i = 0; i < n; i++) await d.query(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('partner', $1, $2, false, now() - $3::interval)`, [PA, prefix + String(i).padStart(2, '0'), ago]) }
    await ins(9, '1 minute', 'ZB')
    await free(); let c1 = await order(d); let r = await enrol(d, c1, pin)
    ck('cap: 9 failures in 15 minutes do not lock', r?.status === 'ok', r)
    await ins(1, '1 minute', 'ZC')
    let c2 = await order(d); r = await enrol(d, c2, pin)
    ck('cap: 10 failures in 15 minutes lock (even with the correct PIN)', r?.status === 'locked', r)
    await d.exec(`UPDATE private.eatery_pin_attempts SET at = now() - interval '20 minutes'`)
    await free(); r = await enrol(d, c2, pin)
    ck('cap: the 15-minute window rolls (the same attempts 20 minutes old no longer lock)', r?.status === 'ok', r)
    await d.exec(`DELETE FROM private.eatery_pin_attempts`)
    await ins(29, '2 hours', 'ZD')
    await free(); let c3 = await order(d); r = await enrol(d, c3, pin)
    ck('cap: 29 failures in 24 hours do not lock', r?.status === 'ok', r)
    await ins(1, '2 hours', 'ZE')
    let c4 = await order(d); r = await enrol(d, c4, pin)
    ck('cap: 30 failures in 24 hours lock', r?.status === 'locked', r)
    await d.exec(`UPDATE private.eatery_pin_attempts SET at = now() - interval '25 hours'`)
    await free(); r = await enrol(d, c4, pin)
    ck('cap: the 24-hour window rolls', r?.status === 'ok', r)
    await d.exec(`DELETE FROM private.eatery_pin_attempts`)
    for (let i = 0; i < 5; i++) await d.query(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('partner', $1, $2, false, now() - interval '2 hours')`, [PA, 'ZZZZZZZ2'])
    await free(); const c5 = await order(d, { code: 'ZZZZZZZ2' }); r = await enrol(d, c5, pin)
    ck('cap: 5 failures on ONE code older than an hour do not lock that code', r?.status === 'ok', r)
    await d.exec(`DELETE FROM private.eatery_pin_attempts`)
    for (let i = 0; i < 5; i++) await d.query(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('partner', $1, $2, false, now() - interval '10 minutes')`, [PA, 'ZZZZZZZ3'])
    const c6 = await order(d, { code: 'ZZZZZZZ3' }); r = await enrol(d, c6, pin)
    ck('cap: 5 failures on one code in the last hour lock that code', r?.status === 'locked', r)
    await free(); const c7 = await order(d); r = await enrol(d, c7, pin)
    ck('cap: ... but another order of the same partner still enrols', r?.status === 'ok', r)
    await d.exec(`DELETE FROM private.eatery_pin_attempts`)
    for (let i = 0; i < 10; i++) await d.query(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('test', NULL, $1, false, now())`, ['ZT' + String(i).padStart(2, '0')])
    await free(); const c8 = await order(d); r = await enrol(d, c8, pin)
    ck('test-bucket failures never lock a real partner', r?.status === 'ok', r)
    const tp = (await issue(d, null, 'test')).pin
    for (let i = 0; i < 10; i++) await d.query(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('test', NULL, $1, false, now())`, ['ZU' + String(i).padStart(2, '0')])
    const t1 = await order(d, { test: true }); r = await enrol(d, t1, tp)
    ck('... and the test bucket locks by its own failures', r?.status === 'locked', r)
  }
  // device limit and renewal
  {
    const pin = (await issue(d, PB)).pin
    const toks = []
    for (let i = 0; i < 5; i++) { const r = await enrol(d, await order(d, { partner: PB }), pin); if (r?.status === 'ok') toks.push(r.device_token) }
    ck('device limit: five devices enrol', toks.length === 5, toks.length)
    const r6 = await enrol(d, await order(d, { partner: PB }), pin)
    ck('device limit: the sixth is refused with device_limit', r6?.status === 'device_limit', r6)
    await d.exec(`UPDATE private.eatery_partner_devices SET revoked_at = now() WHERE token_sha256 = encode(sha256(convert_to('${toks[0]}', 'UTF8')), 'hex')`)
    const r7 = await enrol(d, await order(d, { partner: PB }), pin)
    ck('device limit: a revoked device frees a slot', r7?.status === 'ok', r7)
    // renewing the TEST PIN revokes only test devices
    const pd = await device(d, PA), td = await device(d, null, 'test')
    const po = await order(d, { partner: PA }), to = await order(d, { partner: PA, test: true })
    const can = async (code, token) => val(await as(d, 'anon', `SELECT public.verify_eatery_order('${code}', '${token}') -> 'can_manage' AS c`))
    ck('device scopes: partner device manages its own real and test orders; test device only a test order',
      (await can(po, pd.token)) === true && (await can(to, pd.token)) === true && (await can(po, td.token)) === false && (await can(to, td.token)) === true, null)
    await issue(d, null, 'test')
    ck('renewing the test PIN revokes the test devices only', (await can(to, td.token)) === false && (await can(po, pd.token)) === true, null)
    await issue(d, PA, 'partner')
    ck('renewing a partner PIN revokes that partner\'s devices', (await can(po, pd.token)) === false, null)
    const wb = await order(d, { partner: PB }); ck('... and not another partner\'s', (await can(wb, toks[1])) === true, null)
  }
  // admin RPC: positive control and the refusals
  {
    const r = await as(d, `user:9`, `SELECT public.admin_set_eatery_partner_pin('${PA}', 'partner') AS r`)
    const pin = r.rows?.[0]?.r?.pin
    ck('admin RPC: an admin session gets a six-digit PIN', r.ok && /^[0-9]{6}$/.test(pin ?? ''), r.msg)
    const e = await enrol(d, await order(d, { partner: PA }), pin)
    ck('admin RPC: the PIN it returned enrols a device', e?.status === 'ok', e)
    const g = await as(d, 'guest:9', `SELECT public.admin_set_eatery_partner_pin('${PA}', 'partner') AS r`)
    ck('admin RPC: the same identity as a GUEST session is refused (forbidden)', !g.ok && g.msg === 'forbidden', g)
    const c = await as(d, 'user:1', `SELECT public.admin_set_eatery_partner_pin('${PA}', 'partner') AS r`)
    ck('admin RPC: a customer is refused (forbidden)', !c.ok && c.msg === 'forbidden', c)
    const a = await as(d, 'anon', `SELECT public.admin_set_eatery_partner_pin('${PA}', 'partner') AS r`)
    ck('admin RPC: anon has no EXECUTE (42501)', !a.ok && a.code === '42501', a)
    const tp = await as(d, 'user:9', `SELECT public.admin_set_eatery_partner_pin(NULL, 'test') AS r`)
    ck('admin RPC: the test scope works with no partner', tp.ok && /^[0-9]{6}$/.test(tp.rows[0].r.pin), tp.msg)
    const bad = await as(d, 'user:9', `SELECT public.admin_set_eatery_partner_pin('${PA}', 'test') AS r`)
    ck('admin RPC: test scope with a partner is refused', !bad.ok && bad.msg === 'invalid_partner', bad)
    const bad2 = await as(d, 'user:9', `SELECT public.admin_set_eatery_partner_pin(NULL) AS r`)
    ck('admin RPC: the default partner scope needs a partner', !bad2.ok && bad2.msg === 'invalid_partner', bad2)
    const clear = await q(d, `SELECT (SELECT count(*) FROM (SELECT to_jsonb(t) j FROM private.eatery_partner_pins t UNION ALL SELECT to_jsonb(t) FROM private.eatery_partner_devices t UNION ALL SELECT to_jsonb(t) FROM private.eatery_pin_attempts t
        UNION ALL SELECT to_jsonb(t) FROM public.eatery_orders t UNION ALL SELECT to_jsonb(t) FROM public.eatery_order_events t UNION ALL SELECT to_jsonb(t) FROM public.push_log t UNION ALL SELECT to_jsonb(t) FROM net.calls t) x, LATERAL jsonb_each_text(x.j) e
        WHERE e.value IN ('${pin}', '${tp.rows[0].r.pin}'))::int n`)
    ck('no table (incl. push_log and the push calls) holds an issued PIN in the clear', clear[0].n === 0, clear)
    const ctrl = await q(d, `SELECT (SELECT count(*) FROM (SELECT to_jsonb(t) j FROM private.eatery_partner_pins t) x, LATERAL jsonb_each_text(x.j) e WHERE e.key = 'scope')::int n`)
    ck('POSITIVE CONTROL: the same scan does see stored values', ctrl[0].n > 0, ctrl)
  }
  // PIN generator
  {
    const g = (await q(d, `SELECT public.eatery_pin_generate() p FROM generate_series(1, 3000)`)).map(r => r.p)
    ck('PIN generator: 3000 PINs, all six digits, almost all distinct, a leading zero about one time in ten',
      g.every(x => /^[0-9]{6}$/.test(x)) && new Set(g).size > 2900 && g.filter(x => x[0] === '0').length > 200 && g.filter(x => x[0] === '0').length < 400, [new Set(g).size, g.filter(x => x[0] === '0').length])
  }
  // PIN table shape
  {
    const err = async (sql) => { try { await d.exec(sql); return 'no error' } catch (e) { return e.code } }
    await issue(d, null, 'test'); await issue(d, PA, 'partner')
    const salt = "repeat('a', 32)", hash = "repeat('b', 64)"
    ck('PIN rows: a second test-scope row is refused (one test PIN)', (await err(`INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256) VALUES ('test', NULL, ${salt}, ${hash})`)) === '23505', null)
    ck('PIN rows: a second row for one partner is refused', (await err(`INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256) VALUES ('partner', '${PA}', ${salt}, ${hash})`)) === '23505', null)
    ck('PIN rows: scope partner without a partner is refused', (await err(`INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256) VALUES ('partner', NULL, ${salt}, ${hash})`)) === '23514', null)
    ck('PIN rows: a non-hex PIN hash is refused (plaintext cannot be stored)', (await err(`INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256) VALUES ('partner', '${PB}', ${salt}, '123456')`)) === '23514', null)
    ck('PIN rows: CONTROL a well-formed row for another partner is accepted', (await err(`DELETE FROM private.eatery_partner_pins WHERE partner_id = '${PB}'; INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256) VALUES ('partner', '${PB}', ${salt}, ${hash})`)) === 'no error', null)
    ck('worker key store: a non-hex hash is refused', (await err(`INSERT INTO private.eatery_worker_key_hashes (key_sha256) VALUES ('NOT-HEX')`)) === '23514', null)
  }
  // customer-side extras
  {
    const own = []
    for (let i = 0; i < 25; i++) own.push(await order(d, { by: UID(3), age: `${i + 1} minutes` }))
    const r = await as(d, 'user:3', `SELECT public.my_eatery_orders() AS r`)
    const list = r.rows?.[0]?.r ?? []
    const times = list.map(x => Date.parse(x.created_at))
    ck('my_eatery_orders: at most 20, newest first', list.length === 20 && times.every((x, i) => i === 0 || times[i - 1] >= x), list.length)
    ck('my_eatery_orders: never returns the push token or the user id', !JSON.stringify(list).includes('PushToken') && !JSON.stringify(list).includes(UID(3)), null)
  }
  {
    const r = await as(d, 'user:4', `SELECT public.create_eatery_order(p_partner => '${PA}', p_items => '[{"item_id":${(await (async () => { await d.exec(`INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ('${PA}', 'zz', 'zz dish', 10, 'TRY') ON CONFLICT DO NOTHING`); return (await q(d, `SELECT id FROM public.eatery_menu_items WHERE partner_id = '${PA}' LIMIT 1`))[0].id })())},"qty":1}]'::jsonb) AS r`)
    ck('an older app (only p_partner, p_items, as PostgREST sends named arguments) still orders', r.ok && typeof r.rows[0].r.code === 'string', r.msg)
    const v = await as(d, 'anon', `SELECT public.verify_eatery_order(p_code => '${r.rows?.[0]?.r?.code}') ->> 'status' AS s`)
    ck('an older client calling verify with only p_code (named) still works', v.ok && v.rows[0].s === 'ok', v.msg)
  }
  // retention command
  {
    const cmd = (await q(d, `SELECT command FROM cron.job WHERE jobname = 'eatery-orders-retention'`))[0].command
    const young = await order(d, { age: '1 hour', token: 'ExponentPushToken[retYoung0001]', lang: 'German' })
    const old = await order(d, { age: '13 hours', token: 'ExponentPushToken[retOld000001]', lang: 'German' })
    const real29 = await order(d, { age: '29 days' }), real31 = await order(d, { age: '31 days' })
    const t23 = await order(d, { age: '23 hours', test: true }), t25 = await order(d, { age: '25 hours', test: true })
    await d.exec(`DELETE FROM private.eatery_pin_attempts`)
    await d.exec(`INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok, at) VALUES ('partner', '${PA}', 'ZZRET001', false, now() - interval '8 days'), ('partner', '${PA}', 'ZZRET002', false, now() - interval '6 days')`)
    await d.exec(cmd)
    const ex = async (c) => (await q(d, `SELECT count(*)::int n FROM public.eatery_orders WHERE code = '${c}'`))[0].n
    ck('retention: the 30-day real / 24-hour test deletes are unchanged', (await ex(real31)) === 0 && (await ex(real29)) === 1 && (await ex(t25)) === 0 && (await ex(t23)) === 1, null)
    ck('retention: push tokens older than 12 hours are cleared, younger ones stay', (await row(old)).notify_token === null && (await row(old)).notify_lang === null && (await row(young)).notify_token !== null, null)
    ck('retention: PIN attempts older than 7 days are deleted, younger ones stay', (await q(d, `SELECT array_agg(order_code ORDER BY order_code) a FROM private.eatery_pin_attempts`))[0].a?.join() === 'ZZRET002', null)
  }
  return res
}
const run = async (d) => { const r = await checks(d); return r }
{
  const d = (await full()).d
  const res = await run(d)
  for (const [n, ok] of res) t('behaviour: ' + n, ok, true)
  // A re-applied AFTER B must not put the can_manage stub back
  const dv = await device(d, PA)
  const co = await order(d, { partner: PA })
  const before = val(await as(d, 'anon', `SELECT public.verify_eatery_order('${co}', '${dv.token}') -> 'can_manage' AS c`))
  const again = await applyFile(d, FA)
  if (!again.ok) console.log('      A re-run after B:', again.msg)
  await d.exec('ROLLBACK;').catch(() => {})
  const after = val(await as(d, 'anon', `SELECT public.verify_eatery_order('${co}', '${dv.token}') -> 'can_manage' AS c`))
  t('re-running 20261193 AFTER 20261194 keeps the real can_manage (no stub put back)', [again.ok, before, after], [true, true, true])
  t('re-running 20261194 keeps a key row added after the first apply', await (async () => { await d.exec(`INSERT INTO private.eatery_worker_key_hashes (key_sha256, note) VALUES ('${'ab'.repeat(32)}', 'x') ON CONFLICT DO NOTHING`); const r = await applyFile(d, FB); if (!r.ok) { console.log('      B re-run:', r.msg); await d.exec('ROLLBACK;').catch(() => {}) } return [r.ok, (await q(d, `SELECT count(*)::int n FROM private.eatery_worker_key_hashes WHERE key_sha256 = '${'ab'.repeat(32)}'`))[0].n] })(), [true, 1])
}

// ── RED-FIRST mutants: break the thing, see the suite go red (the anchor is asserted present, so the break landed) ──
const table = []
// A static body / catalog assertion inside the migration would catch many of these before any behaviour ran. `neut` turns that one
// assertion's RAISE EXCEPTION into RAISE NOTICE (the house pattern of test-eatery-orders-is-test-sql.mjs), so what goes red is the
// BEHAVIOUR probe (a named sentinel STEP or a harness check), not the shape check. Mutants without `neut` are shape / catalog facts.
const S = {
  C: 'create_eatery_order body: a carried-forward', MY: 'my_eatery_orders body: owner filter', SUB: 'eatery_order_subscribe body: owner filter',
  VER: 'verify_eatery_order body: new keys', GR: '% has the wrong owner', ISO: '% accepts an ISO code', EVG: '% grants: anon/authenticated must hold nothing',
  DEF: 'create must default p_client_id + p_mode', ENR: 'eatery_partner_enrol body: worker key', DEV: 'eatery_order_device_id body: worker key',
  SET: 'eatery_order_set_status body: a required shape', ADM: 'admin pin function: the admin / guest gate', RET: 'the retention command is not the 20261132',
  ISS: 'eatery_pin_issue body: it must generate', CAN: 'eatery_order_can_manage still is not the real body', PRIV: 'private.% is reachable by anon / authenticated' }
const MUTANTS = [
  // 20261193
  { n: 'A1 p_mode check dropped (any mode accepted)', f: 'A', pairs: [[`  IF p_mode IS NOT NULL AND p_mode NOT IN ('pickup','delivery') THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mode';\n  END IF;\n`, '']], neut: [S.C], fail: 'STEP "p_mode carryout refused"' },
  { n: 'A2 delivery ends on ready instead of on_the_way', f: 'A', pairs: [[`WHEN 'delivery' THEN ARRAY['on_the_way']`, `WHEN 'delivery' THEN ARRAY['ready']`]], fail: 'STEP "next: sent / delivery"' },
  { n: 'A3 skipping forward removed (sent -> received only)', f: 'A', pairs: [[`WHEN 'sent'      THEN ARRAY['received','preparing'] || f.fin || ARRAY['cancelled']`, `WHEN 'sent'      THEN ARRAY['received'] || ARRAY['cancelled']`]], fail: 'STEP "next: sent / delivery"' },
  { n: 'A4 cancel no longer allowed from preparing', f: 'A', pairs: [[`WHEN 'preparing' THEN f.fin || ARRAY['cancelled']`, `WHEN 'preparing' THEN f.fin`]], fail: 'STEP "next: preparing / delivery"' },
  { n: 'A5 my_eatery_orders owner filter removed (another user sees my orders)', f: 'A', pairs: [[`WHERE o.created_by = v_uid AND o.created_at > now() - interval '24 hours'`, `WHERE o.created_at > now() - interval '24 hours'`]], neut: [S.MY], fail: 'STEP "my orders:' },
  { n: 'A6 subscribe ownership removed', f: 'A', pairs: [[`WHERE code = v_c AND created_by = v_uid FOR UPDATE`, `WHERE code = v_c FOR UPDATE`]], neut: [S.SUB], fail: 'STEP "subscribe: another user gets not_found"' },
  { n: 'A7 my_eatery_orders granted to anon', f: 'A', pairs: [[`GRANT  EXECUTE ON FUNCTION public.my_eatery_orders() TO authenticated;`, `GRANT  EXECUTE ON FUNCTION public.my_eatery_orders() TO anon, authenticated;`]], neut: [S.GR], fail: 'STEP "my orders: anon refused"' },
  { n: 'A8 notify_lang CHECK also accepts the ISO code tr', f: 'A', pairs: [[`CHECK (notify_lang IN ('English',`, `CHECK (notify_lang IN ('tr','English',`]], neut: [S.ISO], fail: 'STEP "CHECK: ISO language tr refused"' },
  { n: 'A9 order events readable by authenticated', f: 'A', pairs: [[`REVOKE ALL ON TABLE public.eatery_order_events FROM PUBLIC, anon, authenticated;`, `REVOKE ALL ON TABLE public.eatery_order_events FROM PUBLIC, anon, authenticated;\nGRANT SELECT ON public.eatery_order_events TO authenticated;`]], neut: [S.EVG], fail: 'STEP "authenticated cannot SELECT eatery_order_events"' },
  { n: 'A10 the 3-argument create_eatery_order is NOT dropped (overload left) [catalog fact]', f: 'A', pairs: [[`DROP FUNCTION IF EXISTS public.create_eatery_order(uuid, jsonb, text);\n`, '']], fail: 'an old create/verify signature survived' },
  { n: 'A11 verify ignores the 12-hour window for status_open', f: 'A', pairs: [[`v_open := now() < v_o.created_at + interval '12 hours' AND `, `v_open := `]], fail: 'STEP "verify: 13 h old order status_open false"' },
  { n: 'A12 verify returns the push token', f: 'A', pairs: [[`    'fulfilment',             v_o.fulfilment,`, `    'notify_token', v_o.notify_token,\n    'fulfilment',             v_o.fulfilment,`]], neut: [S.VER], fail: 'STEP "verify: 18 keys"' },
  { n: 'A13 re-running 20261193 puts the can_manage stub back', f: 'A', pairs: [[`  IF to_regprocedure('public.eatery_order_can_manage(uuid,boolean,text)') IS NULL\n     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261194_eatery_order_status_partner.sql') THEN`, `  IF true THEN`]], rerun: true },
  { n: 'A14 create stores no fulfilment', f: 'A', pairs: [[`VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test, p_mode)`, `VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test, NULL)`]], neut: [S.C], fail: 'STEP "fulfilment of the delivery order is stored"' },
  { n: 'A15 an older-app order (NULL fulfilment) offers only on_the_way as a final', f: 'A', pairs: [[`ELSE ARRAY['on_the_way','ready'] END AS fin`, `ELSE ARRAY['on_the_way'] END AS fin`]], fail: 'STEP "next: sent / unknown mode offers both finals"' },
  { n: 'A16 my_eatery_orders counts a view', f: 'A', pairs: [[`RETURNS jsonb\n  LANGUAGE plpgsql\n  STABLE`, `RETURNS jsonb\n  LANGUAGE plpgsql\n  VOLATILE`], [`  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC, x.code), '[]'::jsonb) INTO v_res`, `  UPDATE public.eatery_orders SET view_count = view_count + 1 WHERE created_by = v_uid;\n  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC, x.code), '[]'::jsonb) INTO v_res`]], neut: [S.MY], fail: 'STEP "my orders: no view counted' },
  { n: 'A17 create loses its defaults (an older app calling with 2 arguments breaks)', f: 'A', pairs: [[`p_client_id text DEFAULT NULL, p_mode text DEFAULT NULL)`, `p_client_id text, p_mode text)`]], neut: [S.DEF], fail: 'STEP "create, no p_mode (older app): accepted"' },
  { n: 'A18 verify loses the p_device default (a one-argument caller breaks)', f: 'A', pairs: [[`verify_eatery_order(p_code text, p_device text DEFAULT NULL)`, `verify_eatery_order(p_code text, p_device text)`]], neut: [S.DEF], fail: 'STEP "verify (anon): order_status sent"' },
  // 20261194
  { n: 'B1 enrol does not need the Worker key', f: 'B', pairs: [[`never an exception: a RAISE would roll back the attempt row just written.\n  IF NOT public.eatery_worker_key_ok() THEN`, `never an exception: a RAISE would roll back the attempt row just written.\n  IF false THEN`]], neut: [S.ENR], fail: 'STEP "enrol with NO Worker key: forbidden"' },
  { n: 'B2 the device gate ignores the Worker key', f: 'B', pairs: [[`   WHERE public.eatery_worker_key_ok()\n     AND p_device IS NOT NULL`, `   WHERE p_device IS NOT NULL`]], neut: [S.DEV], fail: 'STEP "device WITHOUT the Worker key: can_manage false"' },
  { n: 'B3 per-code cap 5 -> 50', f: 'B', pairs: [[`a.at > now() - interval '1 hour') >= 5`, `a.at > now() - interval '1 hour') >= 50`]], fail: 'STEP "6th attempt WITH THE CORRECT PIN: locked"' },
  { n: 'B4 per-bucket 15-minute cap 10 -> 100', f: 'B', pairs: [[`interval '15 minutes') >= 10`, `interval '15 minutes') >= 100`]], red: 'cap: 10 failures in 15 minutes lock' },
  { n: 'B5 per-bucket 24-hour cap 30 -> 300', f: 'B', pairs: [[`interval '24 hours') >= 30`, `interval '24 hours') >= 300`]], red: 'cap: 30 failures in 24 hours lock' },
  { n: 'B6 the lock never fires', f: 'B', pairs: [[`  IF (SELECT count(*) FROM private.eatery_pin_attempts a WHERE a.order_code = v_c`, `  IF false AND (SELECT count(*) FROM private.eatery_pin_attempts a WHERE a.order_code = v_c`]], fail: 'STEP "6th attempt WITH THE CORRECT PIN: locked"' },
  { n: 'B7 a test order is judged against the real partner PIN and bucket', f: 'B', pairs: [[`  v_scope   := CASE WHEN v_o.is_test THEN 'test' ELSE 'partner' END;\n  v_partner := CASE WHEN v_o.is_test THEN NULL ELSE v_o.partner_id END;`, `  v_scope   := 'partner';\n  v_partner := v_o.partner_id;`]], fail: 'STEP "test order with the REAL wa PIN: wrong_pin"' },
  { n: 'B8 a test-scope device may manage a REAL order', f: 'B', pairs: [[`(d.scope = 'test' AND p_is_test IS TRUE)`, `(d.scope = 'test')`]], neut: [S.DEV], fail: 'STEP "test device on a REAL order: can_manage false"' },
  { n: 'B9 a revoked device still works', f: 'B', pairs: [[`     AND d.revoked_at IS NULL\n     AND ((d.scope`, `     AND ((d.scope`]], neut: [S.DEV], fail: 'STEP "the old device is revoked: set_status forbidden"' },
  { n: 'B10 the freeze follows expires_at (2 h) instead of 12 h', f: 'B', pairs: [[`  IF now() >= v_o.created_at + interval '12 hours' THEN\n    RETURN jsonb_build_object('status', 'frozen');`, `  IF now() >= v_o.expires_at THEN\n    RETURN jsonb_build_object('status', 'frozen');`]], neut: [S.SET], fail: 'STEP "3 h old order (expires_at passed): change works"' },
  { n: 'B11 the same status is not a no-op', f: 'B', pairs: [[`  IF p_status IS NOT DISTINCT FROM v_o.status THEN\n    RETURN jsonb_build_object('status', 'ok', 'changed', false);\n  END IF;\n`, '']], fail: 'STEP "same status again: ok, changed false"' },
  { n: 'B12 a push failure is NOT swallowed', f: 'B', pairs: [[`    EXCEPTION WHEN OTHERS THEN\n      v_req := NULL;\n    END;\n  END IF;\n  BEGIN\n    INSERT INTO public.push_log`, `    END;\n  END IF;\n  BEGIN\n    INSERT INTO public.push_log`]], red: 'a push that FAILS (pg_net down)' },
  { n: 'B13 push tokens are not cleared on a final status', f: 'B', pairs: [[`  IF p_status IN ('on_the_way','ready','cancelled') THEN\n    UPDATE public.eatery_orders SET notify_token`, `  IF false THEN\n    UPDATE public.eatery_orders SET notify_token`]], red: 'push token + language kept on a non-final status, cleared on a final one' },
  { n: 'B14 a guest order falls back to the profile push token', f: 'B', pairs: [[`IF v_tok IS NULL AND NOT v_o.created_as_guest THEN`, `IF v_tok IS NULL THEN`]], red: 'no order token on a guest order: NO http call' },
  { n: 'B15 the admin gate is removed', f: 'B', pairs: [[`IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN`, `IF false THEN`]], neut: [S.ADM], fail: 'STEP "admin RPC: a signed-in non-admin is refused"' },
  { n: 'B16 a guest session passes the admin gate', f: 'B', pairs: [[`IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN`, `IF auth.uid() IS NULL OR NOT public.is_admin() THEN`]], neut: [S.ADM], red: 'admin RPC: the same identity as a GUEST session is refused' },
  { n: 'B17 retention no longer clears push tokens', f: 'B', pairs: [[String.raw`E';\nUPDATE public.eatery_orders SET notify_token = NULL, notify_lang = NULL WHERE created_at < now() - interval ''12 hours'' AND (notify_token IS NOT NULL OR notify_lang IS NOT NULL);\nDELETE`, String.raw`E';\nDELETE`]], neut: [S.RET], red: 'retention: push tokens older than 12 hours are cleared' },
  { n: 'B18 the PIN is stored in plaintext', f: 'B', pairs: [[`VALUES ('partner', p_partner, v_salt, encode(sha256(convert_to(v_salt || ':' || v_pin, 'UTF8')), 'hex'))`, `VALUES ('partner', p_partner, v_salt, v_pin)`]], fail: 'STEP "issue a partner PIN for wa' },
  { n: 'B19 the PIN is raised in a notice [shape fact: no behaviour probe can see a log line]', f: 'B', pairs: [[`  RETURN jsonb_build_object('pin', v_pin,`, `  RAISE NOTICE 'pin %', v_pin;\n  RETURN jsonb_build_object('pin', v_pin,`]], fail: 'eatery_pin_issue body' },
  { n: 'B20 device limit 5 -> 50', f: 'B', pairs: [[`d.revoked_at IS NULL) >= 5 THEN`, `d.revoked_at IS NULL) >= 50 THEN`]], red: 'device limit: the sixth is refused' },
  { n: 'B21 enrol RAISES on a wrong PIN (the attempt row would roll back)', f: 'B', pairs: [[`VALUES (v_scope, v_partner, v_c, false);\n    RETURN jsonb_build_object('status', 'wrong_pin');`, `VALUES (v_scope, v_partner, v_c, false);\n    RAISE EXCEPTION 'wrong_pin';`]], neut: [S.ENR], fail: 'STEP "malformed PIN: wrong_pin (returned, not raised)"' },
  { n: 'B22 a test order push has no TEST prefix', f: 'B', pairs: [[`'TEST ' || U&'\\00B7' || ' ' || v_pname`, `v_pname`]], red: 'push title is prefixed TEST' },
  { n: 'B23 enrol ignores the 12-hour closing', f: 'B', pairs: [[`  IF now() >= v_o.created_at + interval '12 hours' THEN\n    RETURN jsonb_build_object('status', 'closed');`, `  IF false THEN\n    RETURN jsonb_build_object('status', 'closed');`]], fail: 'STEP "13 h old order: closed even with the right PIN"' },
  { n: 'B24 the private tables are not revoked from anon / authenticated', f: 'B', pairs: [[`REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated`, `REVOKE ALL ON TABLE private.%I FROM PUBLIC`]], neut: [S.PRIV], fail: 'STEP "private tables: authenticated denied (pins)"' },
  { n: 'B25 the Worker key hash store is seeded with a value [the empty-start fact]', f: 'B', pairs: [[`-- ─── (2) PINs, devices, attempts`, `INSERT INTO private.eatery_worker_key_hashes (key_sha256, note) VALUES ('${'ab'.repeat(32)}', 'x');\n-- ─── (2) PINs, devices, attempts`]], fail: 'the worker key store changed during this file' },
  { n: 'B26 can_manage always true', f: 'B', pairs: [[`AS $fn$ SELECT public.eatery_order_device_id(p_partner, p_is_test, p_device) IS NOT NULL $fn$;`, `AS $fn$ SELECT true $fn$;`]], neut: [S.CAN], fail: 'STEP "device WITHOUT the Worker key: can_manage false"' },
  { n: 'B27 a device of partner X manages partner Y', f: 'B', pairs: [[`(d.scope = 'partner' AND d.partner_id = p_partner)`, `(d.scope = 'partner')`]], neut: [S.DEV], fail: 'STEP "wa device on a wb order: can_manage false"' },
  { n: 'B28 a new PIN does not revoke the bucket\'s devices', f: 'B', pairs: [[`  UPDATE private.eatery_partner_devices SET revoked_at = now()\n   WHERE revoked_at IS NULL AND scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n`, '']], neut: [S.ISS], fail: 'STEP "the old device is revoked: set_status forbidden"' },
  { n: 'B29 a reason is accepted on a non-cancel status', f: 'B', pairs: [[`  ELSIF p_reason IS NOT NULL THEN\n    RETURN jsonb_build_object('status', 'invalid_reason');\n  END IF;`, `  END IF;`]], fail: 'STEP "a reason on a non-cancel status: invalid_reason"' },
  { n: 'B30 a cancel with an unknown reason is accepted', f: 'B', pairs: [[`IF p_reason IS NULL OR p_reason NOT IN ('closed','busy','item_out','no_delivery_there','unreachable','other') THEN`, `IF p_reason IS NULL THEN`]], fail: 'STEP "cancelled with an unknown reason: invalid_reason"' },
  { n: 'B31 a wrong PIN leaves no attempt row', f: 'B', pairs: [[`    INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok) VALUES (v_scope, v_partner, v_c, false);\n    RETURN jsonb_build_object('status', 'wrong_pin');`, `    RETURN jsonb_build_object('status', 'wrong_pin');`]], fail: 'STEP "the failed attempts were recorded (not rolled back)"' },
  { n: 'B32 renewing a PIN does not clear the lock counters', f: 'B', pairs: [[`  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n`, '']], neut: [S.ISS], fail: 'STEP "the lock counters of wa were cleared"' },
]
if (process.argv.includes('--no-mutants')) console.log('\n(mutants skipped)')
else {
  console.log('\nRED-FIRST mutants')
  for (const m of MUTANTS) {
    const src = m.f === 'A' ? SA : SB
    const neutPairs = (m.neut ?? []).map(x => [`RAISE EXCEPTION '${x}`, `RAISE NOTICE '${x}`])
    const p = mutant(m.n, src, [...m.pairs, ...neutPairs])
    if (!p) { table.push([m.n, 'ANCHOR MISSING', '']); continue }
    const fa = m.f === 'A' ? p : FA, fb = m.f === 'B' ? p : FB
    const d = await after1144()
    const rA = await applyFile(d, fa)
    if (m.f === 'A' && m.fail) {
      const hit = !rA.ok && rA.msg.includes(m.fail)
      t(`${m.n}: apply FAILS with "${m.fail}"`, [rA.ok, hit], [false, true]); if (!hit) console.log(`      ${rA.ok ? '(applied!)' : rA.msg}`)
      table.push([m.n, rA.ok ? 'GREEN (BAD)' : hit ? 'RED' : 'RED, wrong message', rA.ok ? '' : rA.msg.slice(0, 120)]); continue
    }
    if (!rA.ok) { bad++; console.log(`  ✗ ${m.n}: 20261193 did not apply: ${rA.msg}`); table.push([m.n, 'A FAILED', rA.msg.slice(0, 100)]); continue }
    const rB = await applyFile(d, fb)
    if (m.fail) {
      const hit = !rB.ok && rB.msg.includes(m.fail)
      t(`${m.n}: apply FAILS with "${m.fail}"`, [rB.ok, hit], [false, true]); if (!hit) console.log(`      ${rB.ok ? '(applied!)' : rB.msg}`)
      table.push([m.n, rB.ok ? 'GREEN (BAD)' : hit ? 'RED' : 'RED, wrong message', rB.ok ? '' : rB.msg.slice(0, 120)]); continue
    }
    if (!rB.ok) { bad++; console.log(`  ✗ ${m.n}: 20261194 did not apply: ${rB.msg}`); table.push([m.n, 'B FAILED', rB.msg.slice(0, 100)]); continue }
    if (m.rerun) {
      await seed(d)
      const dv = await device(d, PA), co = await order(d, { partner: PA })
      const again = await applyFile(d, fa)
      const can = val(await as(d, 'anon', `SELECT public.verify_eatery_order('${co}', '${dv.token}') -> 'can_manage' AS c`))
      t(`${m.n}: after the re-run the enrolled device can no longer manage (the suite goes red)`, [again.ok, can], [true, false])
      table.push([m.n, can === false ? 'RED' : 'GREEN (BAD)', 'verify can_manage after the re-run: ' + can]); continue
    }
    const res = await checks(d)
    const hit = res.find(([n]) => n.includes(m.red))
    t(`${m.n}: the check "${m.red}" goes red`, [hit !== undefined, hit?.[1]], [true, false])
    table.push([m.n, hit && hit[1] === false ? 'RED' : 'GREEN (BAD)', m.red])
  }
  // 20261197: each body mutant is run twice — as written (the in-file post-state must refuse it) and with that one shape assertion
  // neutralised (RAISE EXCEPTION -> NOTICE), where the named harness check must go red. Catalog mutants: the apply must fail.
  const GATE97 = `  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';\n  END IF;\n`
  const DEL97 = `  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n  INSERT`
  const CAP97 = `  IF (SELECT count(*) FROM private.eatery_pin_resets r\n       WHERE r.scope = p_scope AND r.partner_id IS NOT DISTINCT FROM p_partner AND r.at > now() - interval '24 hours') >= 3 THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reset_limit';\n  END IF;\n`
  const BODY97 = 'admin_reset_eatery_pin_attempts body'
  const MUT97 = [
    { n: 'C1 the admin gate is dropped', pairs: [[GATE97, '']], red: 'customer denied' },
    { n: 'C2 a guest session passes the admin gate', pairs: [[`  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';`, `  IF auth.uid() IS NULL OR NOT public.is_admin() THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';`]], red: 'guest session of the admin account denied' },
    { n: 'C3 every bucket is deleted', pairs: [[DEL97, `  DELETE FROM private.eatery_pin_attempts;\n  INSERT`]], red: 'partner A reset: B and test attempts untouched' },
    { n: 'C4 the bucket\'s devices are deleted too', pairs: [[DEL97, `  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n  DELETE FROM private.eatery_partner_devices WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n  INSERT`]], red: 'partner A reset: PIN rows and devices unchanged' },
    { n: 'C5 partner_id = (NULL never matches: the test bucket is never cleared)', pairs: [[DEL97, `  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id = p_partner;\n  INSERT`]], red: 'test reset: test attempts gone' },
    { n: 'C7 the reset cap is removed', pairs: [[CAP97, '']], red: 'cap: the 4th reset of A is refused' },
    { n: 'C8 the cap counts every bucket\'s resets', pairs: [[`\n       WHERE r.scope = p_scope AND r.partner_id IS NOT DISTINCT FROM p_partner AND r.at >`, `\n       WHERE r.at >`]], red: 'cap: partner B is not capped' },
    { n: 'C9 a refused (capped) call still deletes the attempts (delete moved before the cap, refusal returned)', pairs: [[DEL97, '  INSERT'], [CAP97, `  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;\n` + CAP97],
      [`    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reset_limit';`, `    RETURN jsonb_build_object('status', 'reset_limit');`]], red: 'cap: the refused 4th reset leaves A' },
    { n: 'C10 the reset is not logged', pairs: [[`  INSERT INTO private.eatery_pin_resets (scope, partner_id, admin_id) VALUES (p_scope, p_partner, auth.uid());\n`, '']], red: 'partner A reset: ONE log row' },
    { n: 'C11 the 90-day prune is removed', pairs: [[`  DELETE FROM private.eatery_pin_resets WHERE at < now() - interval '90 days';\n`, '']], red: 'prune: a log row over 90 days old' },
    { n: 'C12 the log table is left readable by authenticated [catalog fact]', pairs: [[`  REVOKE ALL ON TABLE private.eatery_pin_resets FROM PUBLIC, anon, authenticated;`, `  REVOKE ALL ON TABLE private.eatery_pin_resets FROM PUBLIC, anon, authenticated;\n  GRANT SELECT ON TABLE private.eatery_pin_resets TO authenticated;`]], fail: 'private.eatery_pin_resets is reachable' },
    { n: 'C6 granted to anon [catalog fact]', pairs: [[`GRANT  EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) TO authenticated;`, `GRANT  EXECUTE ON FUNCTION public.admin_reset_eatery_pin_attempts(uuid, text) TO anon, authenticated;`]], fail: 'admin_reset_eatery_pin_attempts grants' },
  ]
  for (const m of MUT97) {
    if (m.fail) {
      const p = mutant(m.n, S97, m.pairs)
      if (!p) { table.push([m.n, 'ANCHOR MISSING', '']); continue }
      const d = await after1194(); const r = await applyFile(d, p); await d.exec('ROLLBACK;').catch(() => {})
      const hit = !r.ok && r.msg.includes(m.fail)
      t(`${m.n}: apply FAILS with "${m.fail}"`, [r.ok, hit], [false, true]); if (!hit) console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
      table.push([m.n, r.ok ? 'GREEN (BAD)' : hit ? 'RED' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 120)]); continue
    }
    const p1 = mutant(m.n + ' shape', S97, m.pairs)
    const p2 = mutant(m.n + ' neut', S97, [...m.pairs, [`RAISE EXCEPTION '${BODY97}`, `RAISE NOTICE '${BODY97}`]])
    if (!p1 || !p2) { table.push([m.n, 'ANCHOR MISSING', '']); continue }
    const d1 = await after1194(); const r1 = await applyFile(d1, p1); await d1.exec('ROLLBACK;').catch(() => {})
    const shapeHit = !r1.ok && r1.msg.includes(BODY97)
    t(`${m.n}: as written, the in-file post-state refuses it`, [r1.ok, shapeHit], [false, true]); if (!shapeHit) console.log(`      ${r1.ok ? '(applied!)' : r1.msg}`)
    const d2 = await after1194(); const r2 = await applyFile(d2, p2)
    if (!r2.ok) { bad++; console.log(`  ✗ ${m.n}: neutralised mutant did not apply: ${r2.msg}`); table.push([m.n, 'NEUT FAILED', r2.msg.slice(0, 100)]); continue }
    const res = await checks97(d2)
    const hit = res.find(([n]) => n.includes(m.red))
    t(`${m.n}: the check "${m.red}" goes red`, [hit !== undefined, hit?.[1]], [true, false])
    table.push([m.n, shapeHit && hit && hit[1] === false ? 'RED' : 'GREEN (BAD)', `in-file: ${shapeHit ? 'refused' : 'MISSED'}; harness: ${m.red}`])
  }
  console.log('\nMUTANT TABLE'); for (const r of table) console.log(`  ${r[1].padEnd(18)} ${r[0]}  ${r[2] ? '→ ' + r[2] : ''}`)
}
// ── 20261198 (slice 3 DB): (a) a managing restaurant phone's verify is not a view, (b) eatery_partner_device_revoke frees a slot,
// (c) create_eatery_order's 18+ "today" in Europe/Nicosia. checks98 returns named booleans; the real file turns every one true,
// each 1198 mutant must turn its named one false (or be refused by the in-file post-state, then neutralised and seen red here).
// HARNESS-ONLY: now() cannot be moved in Postgres, so the age-gate checks run on a copy of the LIVE create body (read with
// pg_get_functiondef) whose ONE age-gate "(now() AT TIME ZONE" is replaced by "(current_setting('zz.now')::timestamptz AT TIME ZONE"
// (anchor asserted exactly once). The zone name is not touched, so a zone mutant passes through to the check.
{
  const F98 = M('20261198_eatery_order_status_slice3.sql'), S98 = readFileSync(F98, 'utf8')
  const T98 = tokq(slice('    -- 1198-BEGIN', '    -- 1198-END'))
  const PC = '33333333-3333-4333-8333-333333333333'
  const VC = async (d, code) => { await d.exec('RESET ROLE;'); return (await q(d, `SELECT view_count, first_viewed_at FROM public.eatery_orders WHERE code = '${code}'`))[0] }
  const ver = async (d, who, code, dev, key) => (await as(d, who, `SELECT public.verify_eatery_order('${code}', ${dev ? `'${dev}'` : 'NULL'}) AS r`, { key })).rows?.[0]?.r
  const revoke = async (d, who, dev, key = true) => { const r = await as(d, who, `SELECT public.eatery_partner_device_revoke(${dev == null ? 'NULL' : `'${dev}'`}) AS r`, { key }); return r.ok ? r.rows[0].r : `ERR ${r.code} ${r.msg}` }
  const devRows = async (d) => { await d.exec('RESET ROLE;'); return q(d, `SELECT id, scope, partner_id, token_sha256, created_at, last_used_at, revoked_at FROM private.eatery_partner_devices ORDER BY id`) }
  const live = async (d, tok) => { await d.exec('RESET ROLE;'); return (await q(d, `SELECT revoked_at IS NULL AS l, revoked_at::text AS revoked_at FROM private.eatery_partner_devices WHERE token_sha256 = encode(sha256(convert_to('${tok}', 'UTF8')), 'hex')`))[0] }
  const canM = async (d, code, tok) => (await ver(d, 'anon', code, tok, true))?.can_manage
  const createDef = async (d) => (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text,text)'::regprocedure) d`))[0].d
  const verifyDef = async (d) => (await q(d, `SELECT pg_get_functiondef('public.verify_eatery_order(text,text)'::regprocedure) d`))[0].d

  const checks98 = async (d, before) => {
    const res = []
    const ck = (name, ok, detail) => { res.push([name, ok === true]); if (ok !== true) console.log(`      (${name}) ${String(JSON.stringify(detail) ?? '').replace(/[0-9a-f]{32,}/g, '<hex>').slice(0, 220)}`) }
    // "identical except": create differs from the 1194 state by the zone line only; verify by the view rule only.
    const dc = lineDiff(before.create, await createDef(d))
    ck('create lineDiff vs the 1194 state: only the age-gate line, Istanbul -> Nicosia', JSON.stringify(dc) === JSON.stringify({
      removed: ["v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE 'Europe/Istanbul')::date);"],
      added: ["v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE 'Europe/Nicosia')::date);"] }), dc)
    const dv = lineDiff(before.verify, await verifyDef(d))
    ck('verify lineDiff vs the 1194 state: can_manage moved above a wrapped view UPDATE, nothing else', JSON.stringify(dv) === JSON.stringify({
      removed: ['UPDATE public.eatery_orders', 'SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1', 'WHERE id = v_o.id;',
        'v_can  := public.eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device);'],
      added: ['-- 20261198: a phone that can manage this order (Worker key + its enrolled device) re-reading the page is not a view.',
        'v_can  := public.eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device);', 'IF NOT COALESCE(v_can, false) THEN',
        'UPDATE public.eatery_orders', 'SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1', 'WHERE id = v_o.id;', 'END IF;'] }), dv)

    await seed(d)
    // One PIN per bucket, issued ONCE (a re-issue revokes the bucket). Devices: A1..A5 (partner A), B1 (partner B), T1 (test scope).
    const pinA = (await issue(d, PA)).pin, pinB = (await issue(d, PB)).pin, pinT = (await issue(d, null, 'test')).pin
    const enA = async () => enrol(d, await order(d, { partner: PA }), pinA)
    const A = []
    for (let i = 0; i < 5; i++) A.push(await enA())
    const B1 = (await enrol(d, await order(d, { partner: PB }), pinB)).device_token
    const T1 = (await enrol(d, await order(d, { partner: PA, test: true }), pinT)).device_token
    ck('setup: five partner-A phones, one B phone, one test phone enrolled', A.every(x => x?.status === 'ok') && /^[0-9a-f]{96}$/.test(B1 ?? '') && /^[0-9a-f]{96}$/.test(T1 ?? ''), A.map(x => x?.status))
    const [A1, A2, A3, A4, A5] = A.map(x => x.device_token)

    // (a) view counting. Each case starts from a fresh, never-viewed order and reads the two columns as postgres.
    const viewCase = async (label, o, who, dev, key, wantCounted, wantCan) => {
      const code = await order(d, o)
      const before = await VC(d, code)
      const r = await ver(d, who, code, dev, key)
      const after = await VC(d, code)
      const counted = after.view_count === before.view_count + 1 && after.first_viewed_at !== null
      const untouched = after.view_count === before.view_count && after.first_viewed_at === null
      ck(label, r?.status === 'ok' && (wantCounted ? counted : untouched) && r?.can_manage === wantCan && r?.view_count_before === 0 && r?.first_viewed_at_before === null, { r: r && { can: r.can_manage, vcb: r.view_count_before }, before, after })
      return r
    }
    const rMan = await viewCase('managing device call (key + partner-A phone on an A order) not counted', { partner: PA }, 'anon', A1, true, false, true)
    const rCust = await viewCase('anonymous customer call (no key, no device) counted', { partner: PA }, 'anon', null, false, true, false)
    await viewCase('signed-in customer call counted', { partner: PA }, 'customer:1', null, false, true, false)
    await viewCase('the Worker\'s customer call (key, no device) counted', { partner: PA }, 'anon', null, true, true, false)
    await viewCase('device token without the Worker key counted', { partner: PA }, 'anon', A1, false, true, false)
    await viewCase('partner-B phone on an A order counted', { partner: PA }, 'anon', B1, true, true, false)
    await viewCase('test-scope phone on a REAL order counted', { partner: PA }, 'anon', T1, true, true, false)
    await viewCase('test-scope phone on a TEST order not counted', { partner: PA, test: true }, 'anon', T1, true, false, true)
    ck('managing and customer calls return the same keys', JSON.stringify(Object.keys(rMan ?? {}).sort()) === JSON.stringify(Object.keys(rCust ?? {}).sort()), [Object.keys(rMan ?? {}).length, Object.keys(rCust ?? {}).length])
    {
      const code = await order(d, { partner: PA })
      await ver(d, 'anon', code, null, false); await ver(d, 'anon', code, null, false)
      const v0 = await VC(d, code)
      const r = await ver(d, 'anon', code, A2, true)
      const v1 = await VC(d, code)
      ck('a managing call on a viewed order: view_count_before / first_viewed_at_before report the customer views, and stay put', r?.view_count_before === 2 && r?.first_viewed_at_before !== null && v1.view_count === 2 && String(v1.first_viewed_at) === String(v0.first_viewed_at), { r: r && r.view_count_before, v0, v1 })
    }

    // (b) revoke. At the cap: the 6th A enrol is refused (control) ...
    const six0 = await enA()
    ck('cap control: a 6th partner-A phone is refused (device_limit) before any revoke', six0?.status === 'device_limit', six0?.status)
    // wrong key: forbidden, nothing changed; then the same call with the key (positive control).
    const snap0 = JSON.stringify(await devRows(d))
    const rNoKey = await revoke(d, 'anon', A1, false)
    ck('revoke without the Worker key: {status forbidden}, every device row unchanged', JSON.stringify(rNoKey) === '{"status":"forbidden"}' && JSON.stringify(await devRows(d)) === snap0, rNoKey)
    const rWrong = await (async () => { await d.exec('RESET ROLE;'); await d.query(`SELECT set_config('request.jwt.claims', '', false), set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-ada-worker-key': 'zz-wrong-key' })]); await d.exec('SET ROLE anon;'); try { return (await d.query(`SELECT public.eatery_partner_device_revoke('${A1}') AS r`)).rows[0].r } finally { await d.exec('RESET ROLE;') } })()
    ck('revoke with a WRONG Worker key: {status forbidden}, every device row unchanged', JSON.stringify(rWrong) === '{"status":"forbidden"}' && JSON.stringify(await devRows(d)) === snap0, rWrong)
    // unknown / malformed tokens: ok, nothing changed.
    const unknown = 'ab'.repeat(48)
    const rUnk = await revoke(d, 'anon', unknown)
    ck('unknown (well-formed) token: {status ok}, every device row unchanged', JSON.stringify(rUnk) === '{"status":"ok"}' && JSON.stringify(await devRows(d)) === snap0, rUnk)
    const mal = [A1.toUpperCase(), A1.slice(0, 95), A1 + '0', '', null]
    const rMal = []
    for (const m of mal) rMal.push(await revoke(d, 'anon', m))
    ck('malformed tokens (upper case, 95 / 97 chars, empty, NULL): {status ok}, every device row unchanged', rMal.every(x => JSON.stringify(x) === '{"status":"ok"}') && JSON.stringify(await devRows(d)) === snap0, rMal)
    // ... the real revoke (anon with the key, as the Worker calls it).
    const rOk = await revoke(d, 'anon', A1)
    const rowsAfter = await devRows(d)
    const a1 = await live(d, A1)
    ck('revoke with the key: {status ok}, the A1 row revoked', JSON.stringify(rOk) === '{"status":"ok"}' && a1?.l === false, { rOk, a1: a1 && a1.l })
    const snap0rows = JSON.parse(snap0)
    const a1hash = await sha(d, A1)
    const changed = rowsAfter.filter((r, i) => JSON.stringify(r) !== JSON.stringify(snap0rows[i]))
    ck('revoke changed exactly ONE row (A1); the other A phones, the B phone and the test phone are untouched', changed.length === 1 && changed[0].token_sha256 === a1hash && rowsAfter.length === snap0rows.length, changed.length)
    ck('the revoked A1 can no longer manage; A2 still can (positive control)', (await canM(d, await order(d, { partner: PA }), A1)) === false && (await canM(d, await order(d, { partner: PA }), A2)) === true, null)
    const six1 = await enA()
    ck('revoke frees a slot: the 6th partner-A phone now enrols (ok)', six1?.status === 'ok' && /^[0-9a-f]{96}$/.test(six1?.device_token ?? ''), six1?.status)
    const seven = await enA()
    ck('... and the cap holds again at five live phones (device_limit)', seven?.status === 'device_limit', seven?.status)
    // double revoke keeps the first revoked_at.
    const t1 = (await live(d, A1))?.revoked_at
    const rAgain = await revoke(d, 'anon', A1)
    const t2 = (await live(d, A1))?.revoked_at
    ck('a second revoke of A1: {status ok}, revoked_at keeps its first value', JSON.stringify(rAgain) === '{"status":"ok"}' && t1 != null && t2 === t1, { t1, t2 })
    // authenticated (with the key) may call it too; another partner's / the test phone revoke only themselves.
    const rB = await revoke(d, 'customer:1', B1)
    ck('authenticated caller with the key revokes the B phone; partner-A phones unaffected', JSON.stringify(rB) === '{"status":"ok"}' && (await live(d, B1))?.l === false && (await live(d, A2))?.l === true && (await live(d, T1))?.l === true, rB)
    ck('grants: anon + authenticated EXECUTE, no PUBLIC', JSON.stringify((await q(d, `SELECT has_function_privilege('anon', 'public.eatery_partner_device_revoke(text)', 'EXECUTE') an,
        has_function_privilege('authenticated', 'public.eatery_partner_device_revoke(text)', 'EXECUTE') au,
        EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = 'public.eatery_partner_device_revoke(text)'::regprocedure)) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') pu`))[0]) === '{"an":true,"au":true,"pu":false}', null)

    // (c) the 18+ gate on Nicosia date boundaries (see the block header for the now() substitution).
    await d.exec(`INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method, adult_only)
      VALUES ('${PC}', 'zz-h-c', 'Harness C', 'cafe', 35.1, 33.3, 'partner', 'zz-h-c/logo.png', current_date, true, 'whatsapp', true) ON CONFLICT DO NOTHING;
      INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ('${PC}', 'zz', 'zz adult dish', 10, 'TRY');
      INSERT INTO auth.users (id) VALUES ('${UID(6)}'), ('${UID(7)}') ON CONFLICT DO NOTHING;
      INSERT INTO public.profiles (id, role, date_of_birth) VALUES ('${UID(6)}', 'customer', '2008-01-16'), ('${UID(7)}', 'customer', '2008-07-16') ON CONFLICT DO NOTHING;`)
    const item = (await q(d, `SELECT id FROM public.eatery_menu_items WHERE partner_id = '${PC}' LIMIT 1`))[0].id
    const def = await createDef(d)
    const ANCH = '(now() AT TIME ZONE'
    const gateLine = def.split('\n').filter(l => l.includes('v_gate := public.eatery_order_age_gate(v_dob, ' + ANCH))
    ck('age-gate anchor "(now() AT TIME ZONE" found exactly once in the live create body', gateLine.length === 1 && def.split(ANCH).length === 2, gateLine.length)
    if (gateLine.length === 1 && def.split(ANCH).length === 2) {
      await d.exec('RESET ROLE;')
      await d.exec(def.replace(ANCH, `(current_setting('zz.now')::timestamptz AT TIME ZONE`))
      const at = async (uid, ts) => {
        await d.query(`SELECT set_config('zz.now', $1, false)`, [ts])
        const r = await as(d, `user:${uid}`, `SELECT public.create_eatery_order('${PC}', '[{"item_id":${item},"qty":1}]'::jsonb) AS r`, { key: false })
        return r.ok ? 'ok' : `${r.code} ${r.msg}`
      }
      // Winter (Cyprus UTC+2, Istanbul UTC+3): 18th birthday 2026-01-16.
      const w1 = await at(6, '2026-01-15 21:30:00+00'), w2 = await at(6, '2026-01-15 22:30:00+00')
      ck('winter: 21:30 UTC = 23:30 Cyprus on the day BEFORE the 18th birthday -> refused (Istanbul would already say the 16th)', w1 === 'P0001 adult_only', w1)
      ck('winter: 22:30 UTC = 00:30 Cyprus on the birthday -> accepted (positive control)', w2 === 'ok', w2)
      // Summer (Cyprus UTC+3 = Istanbul): 18th birthday 2026-07-16. Here Istanbul agrees; this pair catches a FIXED UTC+2 zone.
      const s1 = await at(7, '2026-07-15 20:30:00+00'), s2 = await at(7, '2026-07-15 21:30:00+00')
      ck('summer: 20:30 UTC = 23:30 Cyprus on the day before -> refused', s1 === 'P0001 adult_only', s1)
      ck('summer: 21:30 UTC = 00:30 Cyprus on the birthday -> accepted (a fixed UTC+2 would still refuse)', s2 === 'ok', s2)
      await d.exec(def)
    }
    return res
  }

  // Tokens, apply, re-run.
  { const z = await after1144(); await tokens(z, '1198 tokens on the 1144 state (red, no error)', T98, false, 3) }
  { const z = await after1144(); await stamped(z, FA)
    const r0 = await applyFile(z, F98); await z.exec('ROLLBACK;').catch(() => {})
    t('20261198 REFUSES before 20261194 (nothing applied)', [r0.ok, (r0.msg || '').includes('20261193 / 20261194 are not both in the ledger'),
      (await q(z, `SELECT to_regprocedure('public.eatery_partner_device_revoke(text)') IS NULL AS x`))[0].x], [false, true, true]) }
  const d = await after1194()
  await stamped(d, F97)
  const before = { create: await createDef(d), verify: await verifyDef(d) }
  await tokens(d, '1198 tokens AFTER 1197, BEFORE 1198 (red, no error)', T98, false, 3)
  t('20261198 applies on the 1197 state (in-file pre/post-state green)', await applyFile(d, F98), { ok: true, msg: null })
  t('20261198 applies a SECOND time (re-runnable)', await applyFile(d, F98), { ok: true, msg: null })
  await tokens(d, '1198 tokens AFTER 1198', T98, true, 3)
  for (const [n, s] of [['1193', T93], ['1194', T94], ['1144', T44], ['1134', T34], ['1132', T32], ['1197', tokq(slice('    -- 1197-BEGIN', '    -- 1197-END'))]]) await tokens(d, `older ${n} block AFTER 1198`, s, true)
  {
    const rows25 = T25.split('\n    UNION ALL SELECT ').slice(1).map(x => 'UNION ALL SELECT ' + x).filter(x => /create_eatery_order|verify_eatery_order/.test(x))
    let n25 = 0, ok25 = 0
    for (const r of rows25) { try { const rr = (await d.query(tokq('    ' + r))).rows; n25 += rr.length; ok25 += rr.filter(x => x.ok).length } catch (e) { console.log('      1125 row error:', String(e.message).split('\n')[0]) } }
    t('verify_schema older 1125 rows naming create / verify AFTER 1198: all true', [n25 > 0, ok25 === n25], [true, true])
  }
  t('verify_schema registers 20261198 (C and G rows)', VS.split("('20261198_eatery_order_status_slice3','eatery_partner_device_revoke')").length - 1, 2)
  t('ledger rows end with 20261197, 20261198', (await q(d, `SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).map(r => r.filename).slice(-2), ['20261197_eatery_pin_attempts_reset.sql', '20261198_eatery_order_status_slice3.sql'])
  const res = await checks98(d, before)
  t(`20261198 behaviour: ${res.length} named checks, all true`, [res.length, res.filter(r => !r[1]).map(r => r[0])], [31, []])

  // RED-FIRST mutants of 20261198.
  const table98 = []
  const IFNOT = 'IF NOT COALESCE(v_can, false) THEN'
  const NEUT = [['RAISE EXCEPTION \'verify_eatery_order body', 'RAISE NOTICE \'verify_eatery_order body'], ['RAISE EXCEPTION \'eatery_partner_device_revoke body', 'RAISE NOTICE \'eatery_partner_device_revoke body'],
    ['RAISE EXCEPTION \'create_eatery_order body', 'RAISE NOTICE \'create_eatery_order body']]
  const GATE98 = `  IF NOT public.eatery_worker_key_ok() THEN\n    RETURN jsonb_build_object('status', 'forbidden');\n  END IF;\n  IF p_device IS NULL OR p_device !~`
  const MUT98 = [
    { n: 'D1 every call counts again (IF true)', pairs: [[`  ${IFNOT}\n    UPDATE`, '  IF true THEN\n    UPDATE']], red: 'managing device call (key + partner-A phone on an A order) not counted' },
    { n: 'D2 no call counts (IF false)', pairs: [[`  ${IFNOT}\n    UPDATE`, '  IF false THEN\n    UPDATE']], red: 'anonymous customer call (no key, no device) counted' },
    { n: 'D3 any p_device skips the count', pairs: [[`  ${IFNOT}\n    UPDATE`, '  IF p_device IS NULL THEN\n    UPDATE']], red: 'device token without the Worker key counted' },
    { n: 'D4 any live device of ANY partner skips the count', pairs: [[`  ${IFNOT}\n    UPDATE`, `  IF NOT EXISTS (SELECT 1 FROM private.eatery_partner_devices x WHERE x.token_sha256 = encode(sha256(convert_to(COALESCE(p_device, ''), 'UTF8')), 'hex') AND x.revoked_at IS NULL) THEN\n    UPDATE`]], red: 'partner-B phone on an A order counted' },
    { n: 'D5 the Worker key gate is dropped from revoke', pairs: [[GATE98, '  IF p_device IS NULL OR p_device !~']], red: 'revoke without the Worker key' },
    { n: 'D6 revoke hits every live device', pairs: [[`   WHERE d.token_sha256 = encode(sha256(convert_to(p_device, 'UTF8')), 'hex')\n     AND d.revoked_at IS NULL;`, `   WHERE d.revoked_at IS NULL AND (d.token_sha256 = encode(sha256(convert_to(p_device, 'UTF8')), 'hex') OR true);`]], red: 'revoke changed exactly ONE row' },
    { n: 'D7 revoke answers an oracle (not_found when nothing matched)', pairs: [[`     AND d.revoked_at IS NULL;\n  RETURN jsonb_build_object('status', 'ok');`, `     AND d.revoked_at IS NULL;\n  RETURN jsonb_build_object('status', CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END);`]], red: 'unknown (well-formed) token' },
    { n: 'D8 a second revoke overwrites revoked_at', pairs: [[`\n     AND d.revoked_at IS NULL;`, ';']], red: 'a second revoke of A1' },
    { n: 'D9 revoke deletes the row instead (slot freed, history lost)', pairs: [[`  UPDATE private.eatery_partner_devices d\n     SET revoked_at = now()\n   WHERE`, `  DELETE FROM private.eatery_partner_devices d\n   WHERE`]], red: 'revoke with the key: {status ok}, the A1 row revoked' },
    { n: 'D10 age gate back on Europe/Istanbul', pairs: [[`(now() AT TIME ZONE 'Europe/Nicosia')::date);`, `(now() AT TIME ZONE 'Europe/Istanbul')::date);`]], red: 'winter: 21:30 UTC' },
    { n: 'D11 age gate on a FIXED UTC+2 (Etc/GMT-2)', pairs: [[`(now() AT TIME ZONE 'Europe/Nicosia')::date);`, `(now() AT TIME ZONE 'Etc/GMT-2')::date);`]], red: 'summer: 21:30 UTC' },
    { n: 'D12 another line of create changes (user cap 5 -> 6)', pairs: [['IF v_user_n >= 5 THEN', 'IF v_user_n >= 6 THEN']], red: 'create lineDiff' },
    { n: 'D13 revoke granted to PUBLIC [catalog fact]', pairs: [['GRANT  EXECUTE ON FUNCTION public.eatery_partner_device_revoke(text) TO anon, authenticated;', 'GRANT  EXECUTE ON FUNCTION public.eatery_partner_device_revoke(text) TO PUBLIC;']], fail: 'post-state grants' },
  ]
  for (const m of MUT98) {
    const p1 = mutant('98 ' + m.n, S98, m.pairs)
    if (!p1) { table98.push([m.n, 'ANCHOR MISSING', '']); continue }
    const fresh = async () => { const z = await after1194(); await stamped(z, F97); return z }
    const d1 = await fresh(); const b1 = { create: await createDef(d1), verify: await verifyDef(d1) }
    const r1 = await applyFile(d1, p1)
    if (m.fail) {
      await d1.exec('ROLLBACK;').catch(() => {})
      const hit = !r1.ok && r1.msg.includes(m.fail)
      t(`${m.n}: apply FAILS with "${m.fail}"`, [r1.ok, hit], [false, true]); if (!hit) console.log(`      ${r1.ok ? '(applied!)' : r1.msg}`)
      table98.push([m.n, hit ? 'RED' : r1.ok ? 'GREEN (BAD)' : 'RED, wrong message', 'in-file: ' + (r1.ok ? 'applied' : r1.msg.slice(0, 90))]); continue
    }
    let dd = d1, bb = b1, inFile = 'applied'
    if (!r1.ok) {
      await d1.exec('ROLLBACK;').catch(() => {})
      inFile = /body/.test(r1.msg) ? 'refused' : 'FAILED: ' + r1.msg.slice(0, 80)
      const p2 = mutant('98 ' + m.n + ' neut', S98, [...m.pairs, ...NEUT.map(([a, b]) => [a, b, true])])
      dd = await fresh(); bb = { create: await createDef(dd), verify: await verifyDef(dd) }
      const r2 = await applyFile(dd, p2)
      if (!r2.ok) { bad++; console.log(`  ✗ ${m.n}: neutralised mutant did not apply: ${r2.msg}`); table98.push([m.n, 'NEUT FAILED', r2.msg.slice(0, 100)]); continue }
    }
    const rr = await checks98(dd, bb)
    const hit = rr.find(([n]) => n.includes(m.red))
    t(`${m.n}: the check "${m.red}" goes red`, [hit !== undefined, hit?.[1]], [true, false])
    table98.push([m.n, hit && hit[1] === false ? 'RED' : 'GREEN (BAD)', `in-file: ${inFile}; harness: ${m.red}`])
  }
  console.log('\nMUTANT TABLE 20261198'); for (const r of table98) console.log(`  ${r[1].padEnd(18)} ${r[0]}  ${r[2] ? '→ ' + r[2] : ''}`)
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
