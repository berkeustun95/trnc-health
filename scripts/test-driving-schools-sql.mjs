// 20261108_driving_schools.sql against the PGlite harness (PostgreSQL 18; prod is older — see
// supabase/CLAUDE.md). Evidence about the grants, policies and CHECKs in this file only; it is
// independent of contact_events (see test-contact-events-ehliyet-sql.mjs).
//
//   node scripts/test-driving-schools-sql.mjs
//
// Red-first: each MUTANT weakens one guarantee and the file's own assertions must refuse it.

import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261108_driving_schools.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'ds-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}

console.log('20261108_driving_schools — real file')
const db = await freshDb()
t('applies cleanly (in-file assertions green)', await applyFile(db, FILE), { ok: true, msg: null })

const cnt = async (role, uid, q) => (await asRole(db, role, uid, q)).rows?.[0]?.n
t('anon sees 0 schools while seed is inactive', await cnt('anon', null, 'SELECT count(*)::int n FROM public.driving_schools'), 0)
t('anon sees 0 branches while seed is inactive', await cnt('anon', null, 'SELECT count(*)::int n FROM public.driving_school_branches'), 0)
t('owner sees the seed (control)', (await db.query('SELECT count(*)::int n FROM public.driving_schools')).rows[0].n, 1)
await db.exec(`UPDATE public.driving_schools SET is_active = true`)
t('anon sees the activated school', await cnt('anon', null, 'SELECT count(*)::int n FROM public.driving_schools'), 1)
t('guest (authenticated) sees 2 branches', await cnt('authenticated', 'c0000000-0000-4000-8000-000000000001', 'SELECT count(*)::int n FROM public.driving_school_branches'), 2)
t('anon cannot update', (await asRole(db, 'anon', null, `UPDATE public.driving_schools SET name='x'`)).ok, false)
t('authenticated cannot insert a branch', (await asRole(db, 'authenticated', 'c0000000-0000-4000-8000-000000000001',
  `INSERT INTO public.driving_school_branches (school_id, region) VALUES ('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17','lefke')`)).ok, false)
t('ON DELETE CASCADE', await (async () => { await db.exec(`DELETE FROM public.driving_schools`); return (await db.query('SELECT count(*)::int n FROM public.driving_school_branches')).rows[0].n })(), 0)

console.log('MUTANTS (each must be refused)')
const run = async (name, p) => {
  if (!p) return
  const d = await freshDb()
  const r = await applyFile(d, p)
  t(`${name} refused`, r.ok, false)
  console.log(`      ${r.msg}`)
}
await run('anon INSERT grant', mutant('grant', `GRANT SELECT ON TABLE public.driving_schools, public.driving_school_branches TO anon, authenticated;`,
  `GRANT SELECT, INSERT ON TABLE public.driving_schools, public.driving_school_branches TO anon, authenticated;`))
await run('USING (true) on schools', mutant('using', `USING (is_active);`, `USING (true);`))
await run('is_active DEFAULT true', mutant('default', `is_active     boolean     NOT NULL DEFAULT false`, `is_active     boolean     NOT NULL DEFAULT true`))
await run('branches policy without school check', mutant('brpol', `USING (EXISTS (SELECT 1 FROM public.driving_schools s WHERE s.id = driving_school_branches.school_id AND s.is_active));`, `USING (true);`))
await run('later phone elements need no plus sign', mutant('phones', `(\\\\n\\\\+[0-9]`, `(\\\\n[0-9+]`))
await run('facebook_url accepts http', mutant('fb', `facebook_url ~ '^https://(www\\.)?facebook`, `facebook_url ~ '^https?://(www\\.)?facebook`))
await run('facebook_url start anchor lost (any host)', mutant('fbhost', `facebook_url ~ '^https://(www\\.)?facebook`, `facebook_url ~ 'https://(www\\.)?facebook`))
await run('email shape unchecked', mutant('email', `email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`, `email ~* '.*'`))
await run('email length unchecked', mutant('emlen', `length(email) <= 254`, `length(email) <= 2540`))
await run('licence class vocabulary widened (Z)', mutant('lcv', `<@ ARRAY['A','B','C','D','E','F','G','H','H1','H2','J','K']::text[]`, `<@ ARRAY['A','B','C','D','E','F','G','H','H1','H2','J','K','Z']::text[]`))
await run('licence classes may repeat', mutant('lcdup', `AND array_to_string(licence_classes, ',') !~ '(^|,)([^,]+),(.*,)?\\2(,|$)'`, ``))
// No NULL-element mutant: array_position(...) IS NULL is defence in depth. On PG 18 `ARRAY['B',NULL] <@ ARRAY[...]`
// is already false, so removing the clause is not refused (measured 2026-10-13); the NULL probe still guards the behaviour.
await run('licence classes may be multi-dimensional (ndims + array_position dropped; <@ flattens)', mutant('lcmd', `AND COALESCE(array_ndims(licence_classes), 1) = 1
         AND array_position(licence_classes, NULL) IS NULL`, ``))
await run('branch address length unbounded', mutant('addr', `BETWEEN 5 AND 200`, `BETWEEN 0 AND 20000`))
await run('geocode_source admits google_places', mutant('gsrc', `geocode_source IN ('osm')`, `geocode_source IN ('osm','google_places')`))
await run('provenance: coordinates without a source allowed', mutant('provA', `CHECK ((lat IS NULL) = (geocode_source IS NULL));`, `CHECK (geocode_source IS NULL OR lat IS NOT NULL);`))
await run('provenance: a source without coordinates allowed', mutant('provB', `CHECK ((lat IS NULL) = (geocode_source IS NULL));`, `CHECK (lat IS NULL OR geocode_source IS NOT NULL);`))
await run('seed: licence classes out of order', mutant('seedord', `'H','H1','H2','J','K'], true, 0, false)`, `'H','H2','H1','J','K'], true, 0, false)`))
await run('seed: three phones again', mutant('seedph', `ARRAY['+90 533 887 39 99'], '+90 533 887 39 99',`, `ARRAY['+90 533 887 39 99','+90 533 854 39 99'], '+90 533 887 39 99',`))
await run('seed: Güzelyurt given an address', mutant('seedmor', `('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'morphou', NULL,`, `('7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17', 'morphou', 'Zz Sokak 1, Güzelyurt',`))

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')
