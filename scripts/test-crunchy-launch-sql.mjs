// 20261127 (activate) and 20261128 (test-order cleanup) against the PGlite harness (PostgreSQL 18; prod is older).
// Fixture: tables/CHECKs/RLS of the REAL 20261115 file (sliced) + adult_only + a minimal eatery_orders + a storage.objects stub.
// Each refusal is red-first: the same file, only the DB state differs, and the baseline state passes.
//
//   node scripts/test-crunchy-launch-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (f) => fileURLToPath(new URL('../supabase/migrations/' + f, import.meta.url))
const ACT = M('20261127_crunchy_express_activate.sql'), CLN = M('20261128_eatery_orders_test_cleanup.sql')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const CID = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434', OID = '22222222-2222-4222-8222-222222222222'
const FIXTURE = `
CREATE FUNCTION public.towing_hours_valid(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
${PRIOR.slice(a, b)}
ALTER TABLE public.eatery_partners ADD COLUMN adult_only boolean NOT NULL DEFAULT false;
CREATE TABLE public.eatery_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  partner_id uuid NOT NULL REFERENCES public.eatery_partners (id) ON DELETE CASCADE, lines jsonb NOT NULL DEFAULT '[1]',
  total numeric NOT NULL DEFAULT 1, currency text NOT NULL DEFAULT 'TRY', created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT gen_random_uuid());
ALTER TABLE public.eatery_orders ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (bucket_id text, name text);
`
const SEED = (o = {}) => `
INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, phone, whatsapp, address, menu_verified_on, adult_only, is_active)
 VALUES ('${CID}','crunchy-express','Crunchy','cafe',35.17,33.35,'partner','crunchy/logo.png','${o.phone ?? '+905391161059'}','+905391161059','Test Street 12, Nicosia',
   current_date - ${o.age ?? 2}, ${o.adult ?? false}, ${o.active ?? false});
INSERT INTO public.eatery_partners (id, slug, name, category) VALUES ('${OID}','other','Other','cafe');
${o.noObj ? '' : `INSERT INTO storage.objects VALUES ('eatery-images','crunchy/logo.png');`}
${o.noItems ? '' : `INSERT INTO public.eatery_menu_items (partner_id, section, name, price) SELECT '${CID}','s','d'||g,5 FROM generate_series(1,3) g;`}
${o.noPrice ? `INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('${CID}','s','free',NULL);` : ''}
${o.extraActive ? `UPDATE public.eatery_partners SET lat=35.1, lng=33.3, geocode_source='partner', logo_path='o/l.png', menu_verified_on=current_date, is_active=true WHERE id='${OID}';` : ''}`
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const fx = async (o) => { const d = await freshDb(FIXTURE); await d.exec(SEED(o)); return d }
const q = async (d, sql) => (await d.query(sql)).rows
const refused = async (name, o, msg) => {
  const d = await fx(o); const r = await applyFile(d, ACT)
  t(`${name}: refused`, [r.ok, (r.msg || '').includes(msg)], [false, true]); console.log(`      ${r.msg}`)
  await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t(`${name}: stays inactive, no ledger row`, await q(d, `SELECT (SELECT is_active FROM public.eatery_partners WHERE id='${CID}') a, (SELECT count(*)::int FROM public.schema_migrations_applied) l`), [{ a: false, l: 0 }])
}

console.log('20261127 activate')
{
  const d = await fx({ active: false })
  const r = await applyFile(d, ACT)
  t('baseline applies', r, { ok: true, msg: null }); if (!r.ok) process.exit(1)
  t('exactly Crunchy active; other still inactive', await q(d, `SELECT slug, is_active FROM public.eatery_partners ORDER BY slug`), [{ slug: 'crunchy-express', is_active: true }, { slug: 'other', is_active: false }])
  t('re-run on an active row is a no-op pass', await applyFile(d, ACT), { ok: true, msg: null })
}
await refused('adult_only true', { adult: true }, 'adult_only')
await refused('stale menu (40 days)', { age: 40 }, 'menu_verified_on')
await refused('logo object missing from storage', { noObj: true }, 'logo object not found')
await refused('wrong phone', { phone: '+905390000000' }, 'phone/whatsapp')
await refused('no menu items', { noItems: true }, 'no available priced')
await refused('another partner already active', { extraActive: true }, 'active eatery partners')

console.log('20261128 cleanup')
const ACT_ROW = (ago) => `INSERT INTO public.schema_migrations_applied (filename, checksum, applied_at) VALUES ('20261127_crunchy_express_activate.sql','x', now() - interval '${ago}')`
const ORD = (n, p) => `INSERT INTO public.eatery_orders (code, partner_id) SELECT '${p}'||lpad(g::text,7,'A'), '${p === 'C' ? CID : OID}' FROM generate_series(1,${n}) g;`
{
  const d = await fx({ active: true })
  await d.exec(ACT_ROW('1 hour'))
  await d.exec(ORD(8, 'C') + ORD(2, 'O'))
  const r = await applyFile(d, CLN)
  t('8 Crunchy test orders deleted', r, { ok: true, msg: null })
  t('0 Crunchy remain, 2 other-partner rows untouched', await q(d, `SELECT (SELECT count(*)::int FROM public.eatery_orders WHERE partner_id='${CID}') c, (SELECT count(*)::int FROM public.eatery_orders WHERE partner_id='${OID}') o`), [{ c: 0, o: 2 }])
}
{
  const d = await fx({ active: true })
  await d.exec(ACT_ROW('1 hour'))
  await d.exec(ORD(51, 'C'))
  const r = await applyFile(d, CLN)
  t('51 Crunchy rows refused (limit 50)', [r.ok, (r.msg || '').includes('limit 50')], [false, true])
  await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t('refusal deleted nothing', (await q(d, `SELECT count(*)::int n FROM public.eatery_orders`))[0].n, 51)
}
{
  const d = await fx({ active: true })
  await d.exec(ACT_ROW('1 hour'))
  const r = await applyFile(d, CLN)
  t('0 rows: passes', r, { ok: true, msg: null })
}
for (const [name, ago, msg] of [['1127 missing', null, 'is not applied'], ['1127 applied 25 h ago', '25 hours', 'within 24 hours']]) {
  const d = await fx({ active: true })
  if (ago) await d.exec(ACT_ROW(ago))
  await d.exec(ORD(3, 'C'))
  const r = await applyFile(d, CLN)
  t(`${name}: refused`, [r.ok, (r.msg || '').includes(msg)], [false, true])
  await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t(`${name}: nothing deleted`, (await q(d, `SELECT count(*)::int n FROM public.eatery_orders`))[0].n, 3)
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); process.exit(bad ? 1 : 0)
