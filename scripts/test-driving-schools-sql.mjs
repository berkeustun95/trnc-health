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

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')
