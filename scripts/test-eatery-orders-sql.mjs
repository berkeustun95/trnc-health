// 20261125_eatery_orders.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: tables/CHECKs/RLS of the REAL 20261115 file (sliced, not retyped) + stubs for what lives outside it:
// is_previewer() (header -> private.preview_key_hashes, same logic as 20261120), is_anonymous_session()/auth.jwt()
// (real 20260714 body), towing_hours_valid, and a pg_cron stub. The file's own probes do the role work.
//
//   node scripts/test-eatery-orders-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261125_eatery_orders.sql', import.meta.url))
const PRIOR = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261115_eatery_partners.sql', import.meta.url)), 'utf8')
const SQL = readFileSync(FILE, 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const FIXTURE = `
CREATE FUNCTION public.towing_hours_valid(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
  AS $f$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE, date_of_birth date);
CREATE SCHEMA private;
CREATE TABLE private.preview_key_hashes (hash text PRIMARY KEY, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.is_previewer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
  SELECT COALESCE((SELECT EXISTS (SELECT 1 FROM private.preview_key_hashes h WHERE h.hash = encode(pg_catalog.sha256(pg_catalog.convert_to(k.key, 'UTF8')), 'hex'))
    FROM (SELECT NULLIF(COALESCE(NULLIF(pg_catalog.current_setting('request.headers', true), ''), '{}')::json ->> 'x-ada-preview-key', '') AS key) k WHERE k.key IS NOT NULL), false) $f$;
GRANT EXECUTE ON FUNCTION public.is_previewer() TO anon, authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;
${PRIOR.slice(a, b)}
ALTER TABLE public.eatery_partners ADD COLUMN adult_only boolean NOT NULL DEFAULT false;
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'ord-'))
const fx = async (extra = '') => { const d = await freshDb(FIXTURE); if (extra) await d.exec(extra); return d }
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}
const refused = async (name, p, wantMsg, extra = '') => {
  if (!p) return
  const d = await fx(extra)
  const r = await applyFile(d, p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261125_eatery_orders — real file on the 20261115-state fixture')
const db = await fx()
// The verify_schema.sql tokens for 1125 (sliced from the real file): they must not ERROR before the apply (red/false is
// fine) and must all be true after it.
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const ti = VS.indexOf("    -- ── 1125: WhatsApp order proof."), tj = VS.indexOf("    UNION ALL SELECT '1119_eatery_preview_read','eatery_partners: exactly 2")
if (ti < 0 || tj < ti) throw new Error('verify_schema 1125 token anchors missing')
const TOKQ = `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${VS.slice(ti, tj)}) z`
const tokens = async (when, want) => {
  try {
    const rows = (await db.query(TOKQ)).rows
    t(`verify_schema 1125 tokens ${when}: ${rows.length} tokens, all ${want}`, [rows.length > 0, rows.every(r => r.ok === want)], [true, true])
    if (rows.some(r => r.ok !== want)) console.log(rows.filter(r => r.ok !== want).map(r => '      ' + r.object.slice(0, 90)).join('\n'))
  } catch (e) { t(`verify_schema 1125 tokens ${when} do not error`, String(e.message).split('\n')[0], 'no error') }
}
await tokens('BEFORE apply', false)
const q = async (sql) => (await db.query(sql)).rows
const first = await applyFile(db, FILE)
t('applies cleanly (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) process.exit(1)
t('applies a SECOND time (re-runnable)', await applyFile(db, FILE), { ok: true, msg: null })
await tokens('AFTER apply', true)
t('ledger row written', (await q(`SELECT filename FROM public.schema_migrations_applied`)).map(r => r.filename), ['20261125_eatery_orders.sql'])
t('cron job present once', (await q(`SELECT jobname, schedule FROM cron.job`)), [{ jobname: 'eatery-orders-retention', schedule: '40 3 * * *' }])
t('no probe row survived', (await q(`SELECT (SELECT count(*) FROM public.eatery_orders)::int o, (SELECT count(*) FROM public.eatery_partners WHERE slug LIKE 'zz-%')::int p`)), [{ o: 0, p: 0 }])
console.log('  renderings (PG 18):')
for (const r of await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.eatery_orders'::regclass ORDER BY 1`)) console.log(`    ${r.conname}: ${r.d}`)
// END-TO-END 18+ (needs real profile rows, so harness only — see the migration header).
await db.exec(`INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, adult_only)
   VALUES ('22222222-2222-4222-8222-222222222222','fx-adult','fx adult','cafe',35.1,33.3,'partner','fx/l.png',current_date,true,true);`)
const adItem = (await q(`INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('22222222-2222-4222-8222-222222222222','s','adult dish',9) RETURNING id`))[0].id
const mkUser = async (n, dobExpr) => {
  const id = `00000000-0000-4000-8000-0000000000${n}`
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${id}'); INSERT INTO public.profiles (id, date_of_birth) VALUES ('${id}', ${dobExpr})`)
  return id
}
const tdy = `(now() AT TIME ZONE 'Europe/Istanbul')::date`
const call = (uid) => asRole(db, 'authenticated', uid, `SELECT public.create_eatery_order('22222222-2222-4222-8222-222222222222', '[{"item_id":${adItem},"qty":1}]'::jsonb) AS r`)
const u = {
  nodob: await mkUser(31, 'NULL'), tom: await mkUser(32, `((${tdy} - interval '18 years')::date + 1)`),
  today: await mkUser(33, `((${tdy} - interval '18 years')::date)`), adult: await mkUser(34, `((${tdy} - interval '30 years')::date)`) }
const r1 = await call(u.nodob), r2 = await call(u.tom), r3 = await call(u.today), r4 = await call(u.adult)
t('18+ e2e: NULL dob refused', [r1.ok, r1.msg], [false, 'adult_only'])
t('18+ e2e: 18th birthday tomorrow refused', [r2.ok, r2.msg], [false, 'adult_only'])
t('18+ e2e: 18th birthday today ACCEPTED', r3.ok, true)
t('18+ e2e: 30-year-old ACCEPTED', r4.ok, true)
t('18+ e2e: refusals wrote no rows', (await q(`SELECT count(*)::int n FROM public.eatery_orders WHERE created_by IN ('${u.nodob}','${u.tom}')`))[0].n, 0)
await db.exec(`DELETE FROM public.eatery_orders WHERE partner_id='22222222-2222-4222-8222-222222222222'`)
// The retention job's command really deletes only > 30 days.
await db.exec(`INSERT INTO public.eatery_partners (id, slug, name, category) VALUES ('11111111-1111-4111-8111-111111111111','fx','fx','cafe');
 INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_at, expires_at) VALUES
  ('AAAAAAA2','11111111-1111-4111-8111-111111111111','[1]',1,'TRY',gen_random_uuid(), now()-interval '31 days', now()-interval '31 days' + interval '2 hours'),
  ('AAAAAAA3','11111111-1111-4111-8111-111111111111','[1]',1,'TRY',gen_random_uuid(), now()-interval '29 days', now()-interval '29 days' + interval '2 hours')`)
await db.exec((await q(`SELECT command FROM cron.job`))[0].command)
t('retention command keeps the 29-day row, deletes the 31-day row', (await q(`SELECT code FROM public.eatery_orders`)).map(r => r.code), ['AAAAAAA3'])
// Code generator: 2000 codes via the real function are all valid and (near-)unique.
await db.exec(`INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('11111111-1111-4111-8111-111111111111','s','d',1)`)
const gen = await q(`SELECT count(*)::int n, count(DISTINCT c)::int u, bool_and(c ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$') ok
  FROM (SELECT (SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', ((x.v >> (5*(7-i))) & 31)::int + 1, 1), '' ORDER BY i)
                  FROM generate_series(0,7) i) c
          FROM (SELECT ((((get_byte(b,0)::bigint*256+get_byte(b,1))*256+get_byte(b,2))*256+get_byte(b,3))*256+get_byte(b,10)) v
                  FROM (SELECT decode(replace(gen_random_uuid()::text,'-',''),'hex') b FROM generate_series(1,2000)) y) x) z`)
t('2000 generated codes: alphabet ok, all distinct', [gen[0].ok, gen[0].n === gen[0].u], [true, true])

console.log('MUTANTS (each must be refused by the guarding probe/assertion)')
await refused('client price trusted', mutant('price', `'unit_price', m.price)`, `'unit_price', COALESCE((p_items -> 0 ->> 'unit_price')::numeric, m.price))`), 'stored lines are not the database lines')
await refused('item-belongs-to-partner join dropped', mutant('join', `m.id = x.item_id AND m.partner_id = p_partner AND`, `m.id = x.item_id AND`), 'item_unavailable')
await refused('is_available dropped', mutant('avail', `AND m.is_available AND m.price IS NOT NULL`, `AND m.price IS NOT NULL`), 'item_unavailable')
await refused('preview gate opened (OR true)', mutant('prev', `NOT (v_partner.is_active OR public.is_previewer())`, `NOT (v_partner.is_active OR true)`), 'partner_unavailable')
await refused('order_requires_account check dropped', mutant('acct', `IF v_partner.order_requires_account AND public.is_anonymous_session() THEN`, `IF false THEN`), 'order_requires_account')
await refused('user rate limit 5 -> 6', mutant('rl', `IF v_user_n >= 5 THEN`, `IF v_user_n >= 6 THEN`), 'rate_limited')
await refused('partner cap counts NON-guest rows too', mutant('pcg', `WHERE partner_id = p_partner AND created_as_guest AND created_at`, `WHERE partner_id = p_partner AND created_at`), 'do not block a guest')
await refused('partner cap applies to signed-in users too', mutant('pcu', `IF v_guest AND v_part_n >= 60 THEN`, `IF v_part_n >= 60 THEN`), 'NOT blocked by the guest cap')
await refused('created_as_guest never stored true', mutant('gst', `p_client_id, v_guest)`, `p_client_id, false)`), 'created_as_guest not stored')
await refused('create ignores the age helper', mutant('adh', `IF v_gate IS NOT NULL THEN`, `IF false THEN`), 'no profile row')
await refused('18+ gate removed', mutant('adg', `IF v_partner.adult_only THEN`, `IF false THEN`), 'adult_only')
await refused('under-18 comparison off by one (>=)', mutant('adb', `WHEN p_dob > (p_today - interval '18 years')::date`, `WHEN p_dob >= (p_today - interval '18 years')::date`), 'age gate')
await refused('missing DOB treated as adult', mutant('add', `WHEN p_dob IS NULL THEN 'no_dob'`, `WHEN false THEN 'no_dob'`), 'age gate')
await refused('guest allowed on adult_only partner', mutant('adgu', `    IF v_guest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'adult_only', DETAIL = 'guest';`, `    IF false THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'adult_only', DETAIL = 'guest';`), 'adult_only')
await refused('partner rate limit dropped', mutant('rlp', `IF v_guest AND v_part_n >= 60 THEN`, `IF false THEN`), 'rate_limited')
await refused('rate-limit window widened to 3 h (old orders count)', mutant('win', `created_by = v_uid AND created_at > now() - interval '1 hour'`, `created_by = v_uid AND created_at > now() - interval '3 hours'`), 'user 7')
await refused('verify leaks created_by', mutant('leak', `'view_count_before',      v_o.view_count);`, `'view_count_before',      v_o.view_count, 'created_by', v_o.created_by);`), 'verify_eatery_order body')
await refused('verify does not count views', mutant('views', `view_count = view_count + 1`, `view_count = view_count`), 'second verify must show')
await refused('anon may call create', mutant('anon', `GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO authenticated;`, `GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO anon, authenticated;`), 'EXECUTE grantees')
await refused('table privileges left to authenticated', mutant('tbl', `REVOKE ALL ON TABLE public.eatery_orders FROM PUBLIC, anon, authenticated;`, `REVOKE ALL ON TABLE public.eatery_orders FROM PUBLIC, anon;`), 'holds a privilege')
await refused('RLS not enabled', mutant('rls', `ALTER TABLE public.eatery_orders ENABLE ROW LEVEL SECURITY;`, ``), 'RLS is not enabled')
await refused('search_path unpinned', mutant('sp', `SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_alpha`, `AS $fn$
DECLARE
  c_alpha`), 'config=')
await refused('a policy exists', mutant('pol', `COMMENT ON TABLE public.eatery_orders IS`, `CREATE POLICY zz_open ON public.eatery_orders FOR SELECT TO authenticated USING (true);\nCOMMENT ON TABLE public.eatery_orders IS`), 'policies')
await refused('created_by given an FK', mutant('fk', `created_by      uuid          NOT NULL,`, `created_by      uuid          NOT NULL REFERENCES auth.users (id) ON DELETE SET NULL,`), 'exactly ONE foreign key')
await refused('pg_cron missing', SQL.length ? FILE : null, 'pg_cron is not installed', `DROP SCHEMA cron CASCADE`)

console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)
