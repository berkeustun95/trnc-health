// 20261157_eatery_order_website.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: test-eatery-order-method-sql.mjs's chain (20261115 state + Crunchy seed + 1120 policies, then the REAL 1125,
// 1132, 1134 and 1144 files) + a contact_events table shaped like prod after 20261123 (12 actions, column INSERT grants,
// the four 0910 policies) + a ledger row for 1123. The file's own probes do the role work; this script adds
//   (a) the end state: CHECK sets, columns, create_eatery_order byte-identical, a re-apply is a no-op;
//   (b) RED-FIRST mutants (every anchor asserted present; the apply must FAIL with the expected message);
//   (c) pre-state drift is refused.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-eatery-order-website-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const CHAIN = ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261144_eatery_order_method.sql', '20261151_eatery_partners_banner_path.sql'].map(M)
const F1157 = M('20261157_eatery_order_website.sql')
const SQL = readFileSync(F1157, 'utf8')
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

const ACTS12 = ['call','whatsapp','call_secondary','website','maps','route_complete','book','instagram','facebook','email','menu','order_whatsapp']
const CE = (acts = ACTS12) => `
CREATE TABLE IF NOT EXISTS public.contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL,
  action text NOT NULL, region text, lang text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN ('towing','eatery','hotels','connectivity')),
  CONSTRAINT contact_events_action_check CHECK (action IN (${acts.map(x => `'${x}'`).join(',')})));
REVOKE ALL ON public.contact_events FROM anon, authenticated;
GRANT INSERT (module, entity_id, action, region, id, lang) ON public.contact_events TO anon, authenticated;
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ce_insert_public" ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "ce_select_admin" ON public.contact_events FOR SELECT TO authenticated USING (false);
CREATE POLICY "ce_no_update" ON public.contact_events AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);
CREATE POLICY "ce_no_delete" ON public.contact_events AS RESTRICTIVE FOR DELETE TO public USING (false);
INSERT INTO public.schema_migrations_applied (filename, checksum) VALUES ('20261123_eatery_dish_tags_order_whatsapp.sql', 'fixture');`
const FIXTURE = BASE + '\n' + PRIOR.slice(s0, s1) + '\n' + KEY.slice(pa, pb)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'ow-'))
const ready = async (ce = CE()) => {
  const d = await freshDb(FIXTURE)
  for (const f of CHAIN) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  await d.exec(ce)
  return d
}
const q = async (d, sql) => (await d.query(sql)).rows
const set = async (d, rel, con) => (await q(d, `SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) a FROM regexp_matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '${rel}'::regclass AND conname = '${con}'), '''([a-z_]+)''::text', 'g') AS m`))[0].a
const createDef = async (d) => (await q(d, `SELECT md5(pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure)) m`))[0].m

console.log('20261157_eatery_order_website — real file after the 1115 → 1144 chain + a post-1123 contact_events')
const db = await ready()
const before = await createDef(db)
t('applies cleanly (pre/post-state, probes, positive controls green)', await applyFile(db, F1157), { ok: true, msg: null })
t('order_method set', await set(db, 'public.eatery_partners', 'eatery_partners_order_method_check'), ['phone', 'website', 'whatsapp'])
t('action set = 12 + order_website', await set(db, 'public.contact_events', 'contact_events_action_check'), [...ACTS12, 'order_website'].sort())
t('create_eatery_order byte-identical', await createDef(db), before)
t('columns', await q(db, `SELECT table_name t, column_name c, data_type ty, is_nullable n FROM information_schema.columns WHERE (table_name, column_name) IN (('eatery_partners','brand_color'),('contact_events','item_id'),('eatery_menu_items','adult_only')) ORDER BY 1`),
  [{ t: 'contact_events', c: 'item_id', ty: 'bigint', n: 'YES' }, { t: 'eatery_menu_items', c: 'adult_only', ty: 'boolean', n: 'NO' }, { t: 'eatery_partners', c: 'brand_color', ty: 'text', n: 'YES' }])
t('no probe row survived', (await q(db, `SELECT (SELECT count(*) FROM public.contact_events)::int ce, (SELECT count(*) FROM public.eatery_partners WHERE slug LIKE 'zz-%')::int p`))[0], { ce: 0, p: 0 })
t('ledger row written', (await q(db, `SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261157_eatery_order_website.sql'`))[0].n, 1)
await db.exec(`DELETE FROM public.schema_migrations_applied WHERE filename = '20261157_eatery_order_website.sql'`)
t('re-apply is clean', await applyFile(db, F1157), { ok: true, msg: null })

console.log('MUTANTS (each must be refused)')
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const refused = async (name, p, want, ce) => {
  if (!p) return
  const r = await applyFile(await ready(ce), p)
  t(`${name}: FAILS with "${want}"`, [r.ok, (r.msg || '').includes(want)], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
}
await refused('order_method CHECK without website', mutant('om', [[`CHECK (order_method IN ('whatsapp','phone','website'));`, `CHECK (order_method IN ('whatsapp','phone'));`]]), 'after: order_method CHECK allows')
await refused('action CHECK without order_website', mutant('act', [[`'order_whatsapp','order_website'));`, `'order_whatsapp'));`]]), 'after: contact_events action CHECK allows')
await refused('action CHECK loses book (survival)', mutant('book', [[`'route_complete','book',`, `'route_complete',`]]), 'after: contact_events action CHECK allows')
await refused('item_id grant dropped', mutant('grant', [[`GRANT INSERT (item_id) ON public.contact_events TO anon, authenticated;`, ``]]), 'item_id is not insertable')
await refused('item_id CHECK loosened to any module', mutant('itemchk', [[`CHECK (item_id IS NULL OR (module = 'eatery' AND item_id > 0));`, `CHECK (item_id IS NULL OR item_id > 0);`]]), 'item_id on a non-eatery tap was ACCEPTED')
await refused('brand_color CHECK allows upper case', mutant('color', [[`brand_color ~ '^#[0-9a-f]{6}$'`, `brand_color ~* '^#[0-9a-f]{6}$'`]]), 'upper-case brand_color was ACCEPTED')
await refused('brand_color writable by anon', mutant('colgrant', [[`COMMENT ON COLUMN public.eatery_partners.brand_color IS`, `GRANT UPDATE (brand_color) ON public.eatery_partners TO anon;\nCOMMENT ON COLUMN public.eatery_partners.brand_color IS`]]), 'client privileges on brand_color are not SELECT-only')
await refused('create_eatery_order touched', mutant('fn', [[`-- ─── Post-state + rolled-back probes`, `ALTER FUNCTION public.create_eatery_order(uuid,jsonb,text) SET work_mem = '64kB';\n-- ─── Post-state + rolled-back probes`]]), 'create_eatery_order changed')
await refused('an existing partner row changed', mutant('row', [[`-- ─── Post-state + rolled-back probes`, `UPDATE public.eatery_partners SET name = name || ' x';\n-- ─── Post-state + rolled-back probes`]]), 'an existing eatery_partners row changed')
await refused('menu adult_only defaults to true', mutant('adflt', [[`ADD COLUMN IF NOT EXISTS adult_only boolean NOT NULL DEFAULT false;`, `ADD COLUMN IF NOT EXISTS adult_only boolean NOT NULL DEFAULT true;`]]), 'eatery_menu_items.adult_only is not boolean NOT NULL DEFAULT false')
await refused('menu adult_only writable by authenticated', mutant('adgrant', [[`COMMENT ON COLUMN public.eatery_menu_items.adult_only IS`, `GRANT UPDATE (adult_only) ON public.eatery_menu_items TO authenticated;\nCOMMENT ON COLUMN public.eatery_menu_items.adult_only IS`]]), 'eatery_menu_items.adult_only are not SELECT-only')
await refused('a contact_events policy added', mutant('pol', [[`-- ─── Post-state + rolled-back probes`, `CREATE POLICY zz ON public.contact_events FOR SELECT TO anon USING (true);\n-- ─── Post-state + rolled-back probes`]]), 'contact_events policies changed')

console.log('PRE-STATE DRIFT (each must be refused)')
await refused('action set drifted (book missing)', F1157, 'pre-state: contact_events_action_check', CE(ACTS12.filter(x => x !== 'book')))
await refused('action set drifted (extra action)', F1157, 'pre-state: contact_events_action_check', CE([...ACTS12, 'zz']))
await refused('1123 not in the ledger', F1157, 'pre-state: 20261123 and 20261144', CE().replace(/INSERT INTO public\.schema_migrations_applied[^;]*;/, ''))

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')
