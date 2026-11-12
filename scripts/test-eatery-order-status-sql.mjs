// 20261193_eatery_order_status.sql + 20261194_eatery_order_status_partner.sql against the PGlite harness (PostgreSQL 18; prod is older).
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
    INSERT INTO public.eatery_partners (id, slug, name, category, is_active, order_method, order_status_enabled)
      VALUES ('11111111-1111-4111-8111-111111111111', 'zz-h-a', 'Harness A', 'cafe', true, 'whatsapp', true),
             ('22222222-2222-4222-8222-222222222222', 'zz-h-b', 'Harness B', 'cafe', true, 'whatsapp', true) ON CONFLICT DO NOTHING;`)
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
