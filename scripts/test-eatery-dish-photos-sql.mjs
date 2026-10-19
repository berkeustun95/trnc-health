// 20261116_eatery_dish_photos.sql against the PGlite harness (PostgreSQL 18; prod is older — see
// supabase/CLAUDE.md). The fixture is SLICED FROM THE REAL 20261115 file (tables, CHECKs, RLS, grants,
// policies), not retyped, plus a towing_hours_valid stub (the one dependency outside the slice).
//
//   node scripts/test-eatery-dish-photos-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261116_eatery_dish_photos.sql', import.meta.url))
const PRIOR = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261115_eatery_partners.sql', import.meta.url)), 'utf8')
const SQL = readFileSync(FILE, 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const FIXTURE = `
CREATE FUNCTION public.towing_hours_valid(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
${PRIOR.slice(a, b)}`
// Two partners, two photos each, one path shared across partners and two paths in one partner: a
// correct duplicate query must find 0 here.
const DATA = `
INSERT INTO public.eatery_partners (id, slug, name, category) VALUES
 ('11111111-1111-4111-8111-111111111111','fx-a','fx a','cafe'),('22222222-2222-4222-8222-222222222222','fx-b','fx b','cafe');
INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES
 ('11111111-1111-4111-8111-111111111111','s','i1'),('22222222-2222-4222-8222-222222222222','s','i2');
INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES
 ('11111111-1111-4111-8111-111111111111','gallery','fx/a-1.jpg'),('11111111-1111-4111-8111-111111111111','gallery','fx/a-2.jpg'),
 ('22222222-2222-4222-8222-222222222222','gallery','fx/a-1.jpg'),('22222222-2222-4222-8222-222222222222','menu','fx/b-2.jpg');`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'dish-'))
const fx = async (extra = '') => { const d = await freshDb(FIXTURE); await d.exec(DATA); if (extra) await d.exec(extra); return d }
const notices = []
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}
// A mutant must be refused with the message of the assertion that guards it.
const refused = async (name, p, extra, wantMsg) => {
  if (!p) return
  const d = await fx(extra)
  const r = await applyFile(d, p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261116_eatery_dish_photos — real file on the 20261115-state fixture (2 partners, 4 photos)')
const db = await fx()
const q = async (sql) => (await db.query(sql)).rows
t('applies cleanly (in-file assertions green)', await applyFile(db, FILE), { ok: true, msg: null })
t('applies a SECOND time (re-runnable, columns present)', await applyFile(db, FILE), { ok: true, msg: null })
t('three columns exist', (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='eatery_menu_items' AND column_name LIKE 'photo_%' ORDER BY 1`)).map(r => r.column_name), ['photo_height', 'photo_path', 'photo_width'])
t('ledger row written', (await q(`SELECT filename FROM public.schema_migrations_applied`)).map(r => r.filename), ['20261116_eatery_dish_photos.sql'])
t('4 new constraints', (await q(`SELECT conname FROM pg_constraint WHERE conname IN ('eatery_menu_items_photo_path_check','eatery_menu_items_photo_size_check','eatery_menu_items_photo_size_needs_path_check','eatery_photos_partner_path_key') ORDER BY 1`)).length, 4)
console.log('  renderings (PG 18):')
for (const r of await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname LIKE 'eatery_menu_items_photo_%' OR conname='eatery_photos_partner_path_key' ORDER BY 1`)) console.log(`    ${r.conname}: ${r.d}`)
await db.exec(`UPDATE public.eatery_partners SET lat=35.1,lng=33.3,geocode_source='partner',logo_path='fx/logo.png',menu_verified_on='2026-10-01',is_active=true WHERE slug='fx-a';
 UPDATE public.eatery_menu_items SET photo_path='fx/dish-1.jpg',photo_width=10,photo_height=10 WHERE partner_id='11111111-1111-4111-8111-111111111111';
 UPDATE public.eatery_menu_items SET photo_path='fx/dish-2.jpg' WHERE partner_id='22222222-2222-4222-8222-222222222222'`)
const rd = async (role) => (await asRole(db, role, role === 'authenticated' ? 'c0000000-0000-4000-8000-000000000001' : null, `SELECT photo_path FROM public.eatery_menu_items ORDER BY 1`)).rows?.map(r => r.photo_path)
t('anon reads the ACTIVE partner photo_path only', await rd('anon'), ['fx/dish-1.jpg'])
t('authenticated reads the ACTIVE partner photo_path only', await rd('authenticated'), ['fx/dish-1.jpg'])
t('owner reads both (control)', (await q(`SELECT photo_path FROM public.eatery_menu_items ORDER BY 1`)).map(r => r.photo_path), ['fx/dish-1.jpg', 'fx/dish-2.jpg'])

console.log('MUTANTS / BROKEN PRE-STATES (each must be refused by the guarding assertion)')
await refused('duplicate photo rows before the UNIQUE', FILE, `INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES ('11111111-1111-4111-8111-111111111111','menu','fx/a-1.jpg')`, 'cannot add UNIQUE')
await refused('loosened RLS: extra USING (true) policy on eatery_menu_items', FILE, `CREATE POLICY zz_open ON public.eatery_menu_items FOR SELECT TO anon USING (true)`, 'eatery policy set is not the 20261115 set')
await refused('partial columns (photo_path only)', FILE, `ALTER TABLE public.eatery_menu_items ADD COLUMN photo_path text`, 'PARTIAL set')
await refused('columns present with a default', FILE, `ALTER TABLE public.eatery_menu_items ADD COLUMN photo_path text DEFAULT 'x', ADD COLUMN photo_width int, ADD COLUMN photo_height int`, 'not as this file creates them')
await refused('client UPDATE grant on the table', FILE, `GRANT UPDATE ON public.eatery_menu_items TO anon`, 'client column privileges wrong')
await refused('RLS off on eatery_menu_items', FILE, `ALTER TABLE public.eatery_menu_items DISABLE ROW LEVEL SECURITY`, 'RLS not enabled')
await refused('policy widened to USING (true) (same name)', FILE, `DROP POLICY eatery_menu_items_select_active ON public.eatery_menu_items; CREATE POLICY eatery_menu_items_select_active ON public.eatery_menu_items FOR SELECT TO anon, authenticated USING (true)`, 'qualifier is no longer')
await refused('effectively-open policy that passes the text checks (EXISTS ... is_active IS NOT NULL): only the behavioural probe can catch it', FILE, `DROP POLICY eatery_menu_items_select_active ON public.eatery_menu_items; CREATE POLICY eatery_menu_items_select_active ON public.eatery_menu_items FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.is_active IS NOT NULL))`, `inactive partner's items are visible`)
await refused('photo_path folder class widened to [a-zA-Z0-9-]', mutant('wfold', `CHECK (photo_path IS NULL OR photo_path ~ '^[a-z0-9-]+(`, `CHECK (photo_path IS NULL OR photo_path ~ '^[a-zA-Z0-9-]+(`), '', 'ACCEPTED(uppercase folder)')
await refused('photo_path stem class widened to [a-zA-Z0-9_-]', mutant('wstem', `photo_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+`, `photo_path ~ '^[a-z0-9-]+(/[a-zA-Z0-9][a-zA-Z0-9_-]*)+`), '', 'ACCEPTED(uppercase stem, lowercase extension)')
await refused('photo_path extension made case-insensitive (~*)', mutant('wext', `photo_path ~ '^[a-z0-9-]+(`, `photo_path ~* '^[a-z0-9-]+(`), '', 'ACCEPTED(')
await refused('zero-width allowed (> 0 dropped)', mutant('zero', `(photo_width > 0 AND photo_height > 0)`, `(photo_width >= 0 AND photo_height >= 0)`), '', 'ACCEPTED(zero width)')
await refused('size-without-path CHECK dropped', mutant('sizepath', `CHECK (photo_width IS NULL OR photo_path IS NOT NULL);`, `CHECK (true);`), '', 'ACCEPTED(size without a path)')
await refused('photo_path CHECK dropped', mutant('pathchk', `CHECK (photo_path IS NULL OR photo_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\\.(jpg|jpeg|png|webp)$');`, `CHECK (true);`), '', 'ACCEPTED(path with ../)')
await refused('width/height pairing dropped', mutant('pair', `((photo_width IS NULL) = (photo_height IS NULL)) AND `, ``), '', 'ACCEPTED(width without height)')
await refused('UNIQUE dropped', mutant('uniq', `UNIQUE (partner_id, storage_path);`, `UNIQUE (partner_id, storage_path, kind);`), '', 'a duplicate (partner_id, storage_path) was ACCEPTED')

console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)
