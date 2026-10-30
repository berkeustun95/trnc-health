// 20261151_eatery_partners_banner_path.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// The fixture is SLICED FROM THE REAL 20261115 file (tables, CHECKs, RLS, grants, policies), not retyped, plus a
// towing_hours_valid stub and 3 partners: one active (with a logo), one inactive, one inactive "bidda-badadez".
// Checks: the apply; a re-apply is a no-op; positive controls (valid path, NULL); privileges printed; RED-FIRST mutants
// (file mutants anchor-asserted exactly once; pre-state mutants seeded before the apply); the NOTIFY text check (applyFile
// strips NOTIFY, so it is a text assertion on the file); the verify_schema.sql 1151 token (vacuous before, true after, red on a mutated state).
//
//   node scripts/test-eatery-partners-banner-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261151_eatery_partners_banner_path.sql', import.meta.url))
const PRIOR = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261115_eatery_partners.sql', import.meta.url)), 'utf8')
const SQL = readFileSync(FILE, 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const FIXTURE = `
CREATE FUNCTION public.towing_hours_valid(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
${PRIOR.slice(a, b)}`
const DATA = `
INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active) VALUES
 ('fx-active','fx active','cafe',35.1,33.3,'partner','fx/logo.png','2026-10-01',true);
INSERT INTO public.eatery_partners (slug, name, category) VALUES ('fx-inactive','fx inactive','cafe'),('bidda-badadez','Bidda','fast_food');`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'banner-'))
const fx = async (extra = '') => { const d = await freshDb(FIXTURE); await d.exec(DATA); if (extra) await d.exec(extra); return d }
const mutant = (name, pairs, text = SQL) => {
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const refused = async (name, p, extra, wantMsg) => {
  if (!p) return
  const d = await fx(extra)
  const r = await applyFile(d, p)
  t(`${name}: refused`, r.ok, false)
  t(`    message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261151_eatery_partners_banner_path — real file on the 20261115-state fixture (3 partners)')
const db = await fx()
const q = async (sql, d = db) => (await d.query(sql)).rows
const before = await q(`SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) m FROM public.eatery_partners p`)
t('column absent before', (await q(`SELECT 1 FROM information_schema.columns WHERE table_name='eatery_partners' AND column_name='banner_path'`)).length, 0)
t('applies cleanly (in-file assertions green)', await applyFile(db, FILE), { ok: true, msg: null })
t('applies a SECOND time (no-op)', await applyFile(db, FILE), { ok: true, msg: null })
t('column: text, nullable, no default', await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='eatery_partners' AND column_name='banner_path'`), [{ data_type: 'text', is_nullable: 'YES', column_default: null }])
t('ledger row written once', (await q(`SELECT filename FROM public.schema_migrations_applied`)).map(r => r.filename), ['20261151_eatery_partners_banner_path.sql'])
t('rows unchanged apart from the new NULL column', (await q(`SELECT md5(string_agg((to_jsonb(p) - 'banner_path')::text, ',' ORDER BY id)) m FROM public.eatery_partners p`)), before)
t('every banner_path NULL', (await q(`SELECT count(*)::int n FROM public.eatery_partners WHERE banner_path IS NOT NULL`)), [{ n: 0 }])
t('COMMENT names eatery-images', (await q(`SELECT col_description('public.eatery_partners'::regclass, a.attnum) ~ 'eatery-images' ok FROM pg_attribute a WHERE a.attrelid='public.eatery_partners'::regclass AND a.attname='banner_path'`)), [{ ok: true }])
console.log('  renderings (PG 18):')
const defs = await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname IN ('eatery_partners_banner_path_check','eatery_partners_logo_path_check') ORDER BY 1`)
for (const r of defs) console.log(`    ${r.conname}: ${r.d}`)
console.log('  privileges (has_column_privilege, printed):')
for (const r of await q(`SELECT r, c, has_column_privilege(r,'public.eatery_partners',c,'SELECT') s, has_column_privilege(r,'public.eatery_partners',c,'INSERT') i, has_column_privilege(r,'public.eatery_partners',c,'UPDATE') u
  FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['logo_path','banner_path']) c ORDER BY r, c`)) console.log(`    ${r.r}.${r.c}: S=${r.s} I=${r.i} U=${r.u}`)
t('banner_path has no column-level ACL', (await q(`SELECT attacl IS NULL ok FROM pg_attribute WHERE attrelid='public.eatery_partners'::regclass AND attname='banner_path'`)), [{ ok: true }])
t('anon / authenticated SELECT true, INSERT/UPDATE false; service_role all (control)', (await q(`SELECT string_agg(r || has_column_privilege(r,'public.eatery_partners','banner_path','SELECT')::text || has_column_privilege(r,'public.eatery_partners','banner_path','INSERT')::text || has_column_privilege(r,'public.eatery_partners','banner_path','UPDATE')::text, ' ' ORDER BY r) s FROM unnest(ARRAY['anon','authenticated','service_role']) r`))[0].s,
  'anontruefalsefalse authenticatedtruefalsefalse service_roletruetruetrue')
const CHECK_MSG = (v) => db.query(`UPDATE public.eatery_partners SET banner_path='${v}' WHERE slug='fx-inactive'`).then(() => 'accepted', () => 'refused')
t('positive control: valid path accepted', await CHECK_MSG('bidda-badadez/banner.jpg'), 'accepted')
t('positive control: NULL accepted', await db.query(`UPDATE public.eatery_partners SET banner_path=NULL WHERE slug='fx-inactive'`).then(() => 'accepted', () => 'refused'), 'accepted')
for (const v of ['../x.jpg', 'http://x/y.jpg', 'x/y.gif', 'X/Y.jpg', '/x/y.jpg', 'x.jpg']) t(`CHECK refuses ${v}`, await CHECK_MSG(v), 'refused')
await db.exec(`UPDATE public.eatery_partners SET banner_path='fx/banner.webp' WHERE slug='fx-active'`)
const rd = async (role) => (await asRole(db, role, role === 'authenticated' ? 'c0000000-0000-4000-8000-000000000001' : null, `SELECT slug, banner_path FROM public.eatery_partners ORDER BY 1`)).rows
t('anon reads banner_path of the ACTIVE partner only (read positive control)', await rd('anon'), [{ slug: 'fx-active', banner_path: 'fx/banner.webp' }])
t('authenticated likewise', await rd('authenticated'), [{ slug: 'fx-active', banner_path: 'fx/banner.webp' }])
t('anon cannot UPDATE banner_path (control: postgres can)', [(await asRole(db, 'anon', null, `UPDATE public.eatery_partners SET banner_path=NULL`)).ok, (await db.query(`UPDATE public.eatery_partners SET banner_path=banner_path`).then(() => true))], [false, true])
t('authenticated cannot UPDATE banner_path', (await asRole(db, 'authenticated', 'c0000000-0000-4000-8000-000000000001', `UPDATE public.eatery_partners SET banner_path=NULL`)).ok, false)

console.log('NOTIFY text check (applyFile strips NOTIFY, so this is a text assertion)')
const notifyOk = (s) => { const i = s.lastIndexOf('COMMIT;'), j = s.indexOf('RESET ROLE;', i), k = s.indexOf("NOTIFY pgrst, 'reload schema';", j); return i > 0 && j > i && k > j }
t('real file ends COMMIT; RESET ROLE; NOTIFY', notifyOk(SQL), true)
const noNotify = mutant('nonotify', [["NOTIFY pgrst, 'reload schema';", '']])
t('mutant without NOTIFY: check goes RED', noNotify ? notifyOk(readFileSync(noNotify, 'utf8')) : null, false)

console.log('MUTANTS / BROKEN PRE-STATES (each must be refused by the guarding assertion)')
await refused('column missing (ADD COLUMN removed)', mutant('nocol', [['ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;', '']]), '', 'banner_path')
await refused('CHECK missing', mutant('nocheck', [['CHECK (banner_path IS NULL OR banner_path ~ \'^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\\.(jpg|jpeg|png|webp)$\');', 'CHECK (true);']]), '', 'differs from logo_path CHECK')
await refused('CHECK too loose (accepts ../, http, gif)', mutant('loose', [['banner_path ~ \'^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\\.(jpg|jpeg|png|webp)$\'', 'banner_path ~ \'^.*\\.(jpg|jpeg|png|webp|gif)$\'']]), '', 'differs from logo_path CHECK')
await refused('CHECK pre-existing but loose (the IF NOT EXISTS skip path)', FILE, `ALTER TABLE public.eatery_partners ADD COLUMN banner_path text; ALTER TABLE public.eatery_partners ADD CONSTRAINT eatery_partners_banner_path_check CHECK (true)`, 'differs from logo_path CHECK')
await refused('column-level ACL added', FILE, `ALTER TABLE public.eatery_partners ADD COLUMN banner_path text; GRANT SELECT (banner_path) ON public.eatery_partners TO anon`, 'column-level ACL')
await refused('SELECT revoked from anon', FILE, `REVOKE SELECT ON public.eatery_partners FROM anon`, 'column privileges wrong')
await refused('UPDATE granted to authenticated', FILE, `GRANT UPDATE ON public.eatery_partners TO authenticated`, 'column privileges wrong')
await refused('inactive partner made visible (extra USING (true) policy)', FILE, `CREATE POLICY zz_open ON public.eatery_partners FOR SELECT TO anon, authenticated USING (true)`, 'inactive partner visible')
await refused('another column changed on an existing row', mutant('othercol', [["ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;", "ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;\nUPDATE public.eatery_partners SET sort_order = sort_order + 1;"]]), '', 'existing eatery_partners rows changed')
await refused('Bidda activated by the file (a complete Bidda, so the launch CHECK allows it: only the active-set assertion can refuse)', mutant('biddaon', [["ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;", "ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;\nUPDATE public.eatery_partners SET is_active = true WHERE slug = 'bidda-badadez';"]]), `UPDATE public.eatery_partners SET lat=35.2,lng=33.4,geocode_source='partner',logo_path='bb/logo.png',menu_verified_on='2026-10-01' WHERE slug='bidda-badadez'`, 'active partner set changed')
await refused('active set changed by deactivating fx-active', mutant('actoff', [["ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;", "ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;\nUPDATE public.eatery_partners SET is_active = false WHERE slug = 'fx-active';"]]), '', 'active partner set changed')
await refused('launch_complete_check altered', mutant('launch', [["ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;", "ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;\nALTER TABLE public.eatery_partners DROP CONSTRAINT eatery_partners_launch_complete_check;\nALTER TABLE public.eatery_partners ADD CONSTRAINT eatery_partners_launch_complete_check CHECK (NOT is_active OR (lat IS NOT NULL AND logo_path IS NOT NULL));"]]), '', 'launch_complete_check changed')
await refused('banner data written (a banner set by the file)', mutant('dataw', [["ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;", "ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS banner_path text NULL;\nUPDATE public.eatery_partners SET banner_path = 'fx/b.jpg' WHERE slug = 'fx-inactive';"]]), '', 'this file writes no data')

console.log('verify_schema.sql 1151 tokens')
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const ta = VS.indexOf('    -- 1151: eatery_partners.banner_path.'), tb = VS.indexOf('    -- 1150: free options.')
if (ta < 0 || tb < ta) throw new Error('verify_schema 1151 anchors missing')
const slice = VS.slice(ta, tb)
if ((slice.match(/UNION ALL SELECT/g) || []).length !== 1) throw new Error('verify_schema 1151 slice must hold exactly 1 token')
const TOK = `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${slice}) z`
const token = async (d) => { try { const r = (await d.query(TOK)).rows; return r.length === 1 ? r[0].ok : `rows=${r.length}` } catch (e) { return 'ERROR ' + e.message.split('\n')[0] } }
{
  const d = await fx()
  t('token before the apply (never errors; vacuously true until the ledger records it)', await token(d), true)
  await applyFile(d, FILE)
  t('token after the apply', await token(d), true)
  for (const [n, sql] of [
    ['column-level ACL', `GRANT SELECT (banner_path) ON public.eatery_partners TO anon`],
    ['CHECK loosened', `ALTER TABLE public.eatery_partners DROP CONSTRAINT eatery_partners_banner_path_check; ALTER TABLE public.eatery_partners ADD CONSTRAINT eatery_partners_banner_path_check CHECK (true)`],
    ['COMMENT lost', `COMMENT ON COLUMN public.eatery_partners.banner_path IS NULL`],
    ['launch_complete_check names banner_path', `ALTER TABLE public.eatery_partners DROP CONSTRAINT eatery_partners_launch_complete_check; ALTER TABLE public.eatery_partners ADD CONSTRAINT eatery_partners_launch_complete_check CHECK (NOT is_active OR (lat IS NOT NULL AND logo_path IS NOT NULL AND menu_verified_on IS NOT NULL AND banner_path IS NOT NULL)) NOT VALID`],
    ['UPDATE granted to authenticated', `GRANT UPDATE ON public.eatery_partners TO authenticated`],
    ['SELECT revoked from anon', `REVOKE SELECT ON public.eatery_partners FROM anon`],
  ]) {
    const m = await fx(); await applyFile(m, FILE); await m.exec(sql)
    t(`token RED on: ${n}`, await token(m), false)
  }
}

console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)
