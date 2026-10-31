// 20261152 (Bidda activate) against the PGlite harness (PostgreSQL 18; prod is older).
// Fixture: tables/CHECKs/RLS/grants of the REAL 20261115 file (sliced, like test-crunchy-launch-sql.mjs) + the later columns the file
// reads (adult_only, order_requires_account, order_method, banner_path, photo_path) + a minimal eatery_item_options with a
// parent-active SELECT policy + a storage.objects stub. Crunchy is seeded ACTIVE (the live state), so "active partners + 1" is real.
// Each refusal is red-first: the same file, only the DB state differs, and the baseline state passes.
//
//   node scripts/test-bidda-badadez-activate-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const M = (f) => fileURLToPath(new URL('../supabase/migrations/' + f, import.meta.url))
const ACT = M('20261152_bidda_badadez_activate.sql')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const BID = 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f', CID = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
const FIXTURE = `
CREATE FUNCTION public.towing_hours_valid(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
${PRIOR.slice(a, b)}
ALTER TABLE public.eatery_partners ADD COLUMN adult_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.eatery_partners ADD COLUMN order_requires_account boolean NOT NULL DEFAULT false;
ALTER TABLE public.eatery_partners ADD COLUMN order_method text NOT NULL CHECK (order_method IN ('whatsapp','phone'));
ALTER TABLE public.eatery_partners ADD COLUMN banner_path text;
ALTER TABLE public.eatery_menu_items ADD COLUMN photo_path text;
CREATE TABLE public.eatery_item_options (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES public.eatery_menu_items (id) ON DELETE CASCADE, label text NOT NULL);
ALTER TABLE public.eatery_item_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.eatery_item_options TO anon, authenticated;
CREATE POLICY eatery_item_options_select_active ON public.eatery_item_options FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE i.id = item_id AND p.is_active));
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (bucket_id text, name text);
`
const SEED = (o = {}) => `
INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, phone, whatsapp, menu_verified_on, order_method, is_active)
 VALUES ('${CID}','crunchy-express','Crunchy','cafe',35.17,33.35,'partner','crunchy/logo.png','+905391161059','+905391161059',current_date - 5,'whatsapp',true);
INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, banner_path, phone, whatsapp, menu_verified_on,
   order_method, adult_only, order_requires_account, is_active)
 VALUES ('${BID}','bidda-badadez','Bidda Badadez','fast_food',${o.noPin ? 'NULL,NULL,NULL' : "35.198,33.355,'partner'"},${o.noLogo ? 'NULL' : "'bidda-badadez/logo-1.png'"},
   'bidda-badadez/banner-1.jpg','${o.phone ?? '+90 392 228 89 28'}',${o.wa ? `'${o.wa}'` : 'NULL'},current_date - ${o.age ?? 1},'${o.method ?? 'phone'}',
   ${o.adult ?? false},${o.account ?? false},${o.active ?? false});
INSERT INTO storage.objects VALUES ('eatery-images','crunchy/logo.png'),('eatery-images','bidda-badadez/logo-1.png'),('eatery-images','bidda-badadez/sade-1.jpg'),
  ('eatery-images','bidda-badadez/gallery-1.jpg')${o.noBannerObj ? '' : ",('eatery-images','bidda-badadez/banner-1.jpg')"};
INSERT INTO public.eatery_menu_items (partner_id, section, name, price, photo_path) VALUES
  ('${BID}','Dürümler','Sade',400,'bidda-badadez/sade-1.jpg'),('${BID}','Dürümler','Hellim',450,NULL)${o.noPrice ? `,('${BID}','Dürümler','Unpriced',NULL,NULL)` : ''};
INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES ('${BID}','gallery','bidda-badadez/gallery-1.jpg');
INSERT INTO public.eatery_item_options (item_id, label) SELECT id, 'domates' FROM public.eatery_menu_items WHERE name = 'Sade';`
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
  t(`${name}: stays inactive, no ledger row`, await q(d, `SELECT (SELECT is_active FROM public.eatery_partners WHERE id='${BID}') a, (SELECT count(*)::int FROM public.schema_migrations_applied) l`), [{ a: false, l: 0 }])
}

console.log('20261152 activate')
{
  const d = await fx()
  t('before: anon sees only Crunchy (positive control: the policy lets active rows through)',
    (await asRole(d, 'anon', null, `SELECT slug FROM public.eatery_partners ORDER BY slug`)).rows, [{ slug: 'crunchy-express' }])
  const r = await applyFile(d, ACT)
  t('baseline applies', r, { ok: true, msg: null }); if (!r.ok) process.exit(1)
  t('both partners active, Crunchy untouched', await q(d, `SELECT slug, is_active FROM public.eatery_partners ORDER BY slug`), [{ slug: 'bidda-badadez', is_active: true }, { slug: 'crunchy-express', is_active: true }])
  t('anon sees Bidda, its 2 items and 1 option', (await asRole(d, 'anon', null,
    `SELECT (SELECT count(*)::int FROM public.eatery_partners WHERE id='${BID}') p, (SELECT count(*)::int FROM public.eatery_menu_items WHERE partner_id='${BID}') i, (SELECT count(*)::int FROM public.eatery_item_options) o`)).rows, [{ p: 1, i: 2, o: 1 }])
  t('ledger row written', (await q(d, `SELECT filename FROM public.schema_migrations_applied`)).map(r => r.filename), ['20261152_bidda_badadez_activate.sql'])
  t('re-run on an active row is a no-op pass', await applyFile(d, ACT), { ok: true, msg: null })
}
await refused('wrong phone', { phone: '+90 392 000 00 00' }, 'phone/whatsapp')
await refused('a whatsapp number set', { wa: '+905330000000' }, 'phone/whatsapp')
await refused('order_method whatsapp', { method: 'whatsapp' }, 'order_method')
await refused('adult_only true', { adult: true }, 'adult_only')
await refused('order_requires_account true', { account: true }, 'order_requires_account')
await refused('no logo', { noLogo: true }, 'logo_path is NULL')
await refused('no pin', { noPin: true }, 'pin missing')
await refused('stale menu (31 days)', { age: 31 }, 'menu_verified_on')
await refused('banner object missing from storage', { noBannerObj: true }, 'bidda-badadez/banner-1.jpg')
await refused('an available dish without a price', { noPrice: true }, 'available without a price')

console.log(bad ? `\n✗ ${bad} failure(s)` : '\n✓ all green')
process.exit(bad ? 1 : 0)
