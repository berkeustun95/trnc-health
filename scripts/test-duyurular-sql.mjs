// 20261102_duyurular.sql against the PGlite harness (PostgreSQL 18; prod is older — see
// supabase/CLAUDE.md). Evidence about the grants, policies and CHECKs in this file only.
//
//   node scripts/test-duyurular-sql.mjs
//
// Red-first: each MUTANT weakens one guarantee and the file's own assertions must refuse it.
// A mutant that applies cleanly means the in-migration assertion is not measuring anything.

import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261102_duyurular.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

console.log('20261102_duyurular — real file')
const db = await freshDb()
const r = await applyFile(db, FILE)
t('applies cleanly (in-file assertions green)', r, { ok: true, msg: null })
t('re-applies cleanly (idempotent)', await applyFile(db, FILE), { ok: true, msg: null })

await db.exec(`
  INSERT INTO public.announcement_sources (key, name, institution, url, type, parser, category)
  VALUES ('tt', 't', 'tt', 'https://x.invalid/', 'rss', 'rss', 'kamu');
  INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at, is_published)
  SELECT id, 'live row', 'live row', 'https://x.invalid/a', 'inst', 'kamu', now(), now() + interval '1 day', true FROM public.announcement_sources;
  INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at)
  SELECT id, 'hidden row', 'hidden row', 'https://x.invalid/b', 'inst', 'kamu', now(), now() + interval '1 day' FROM public.announcement_sources;`)
const anon = await asRole(db, 'anon', null, 'SELECT title FROM public.announcements ORDER BY title')
t('anon reads the published row only', anon.rows?.map(x => x.title), ['live row'])
const guest = await asRole(db, 'authenticated', 'c0000000-0000-4000-8000-000000000001', 'SELECT title FROM public.announcements')
t('authenticated (guest included) reads the published row only', guest.rows?.map(x => x.title), ['live row'])
t('anon cannot read announcement_sources', (await asRole(db, 'anon', null, 'SELECT 1 FROM public.announcement_sources')).ok, false)
t('authenticated cannot read announcement_sources', (await asRole(db, 'authenticated', 'c0000000-0000-4000-8000-000000000001', 'SELECT 1 FROM public.announcement_sources')).ok, false)
t('publish DEFAULT false', (await db.query(`SELECT publish FROM public.announcement_sources WHERE key = 'tt'`)).rows[0].publish, false)
t('is_published DEFAULT false', (await db.query(`SELECT is_published FROM public.announcements WHERE title = 'hidden row'`)).rows[0].is_published, false)

const MUTANTS = [
  ['policy shows unpublished rows', 'USING (is_published AND expires_at > now());', 'USING (expires_at > now());', /anon sees 2 probe rows/],
  ['policy shows expired rows', 'USING (is_published AND expires_at > now());', 'USING (is_published);', /anon sees 2 probe rows/],
  ['anon granted INSERT', 'GRANT SELECT ON TABLE public.announcements TO anon, authenticated;',
    'GRANT SELECT, INSERT ON TABLE public.announcements TO anon, authenticated;\nCREATE POLICY zz_ins ON public.announcements FOR INSERT TO anon WITH CHECK (true);', /policy set|anon announcements INSERT/],
  ['sources readable by clients', 'GRANT SELECT ON TABLE public.announcements TO anon, authenticated;',
    'GRANT SELECT ON TABLE public.announcements, public.announcement_sources TO anon, authenticated;', /read announcement_sources/],
  ['category CHECK dropped', `CHECK (category IN ('kamu','egitim','kesinti','ihale','belediye','destek','ulasim'));\nALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_region_check;`,
    `CHECK (true);\nALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_region_check;`, /category health was ACCEPTED/],
]
console.log('\nMutants (each must be refused by the file itself)')
const dir = mkdtempSync(join(tmpdir(), 'duyurular-sql-'))
for (const [name, from, to, expect] of MUTANTS) {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name} — anchor not found in the file`); continue }
  const p = join(dir, 'm.sql')
  writeFileSync(p, SQL.replace(from, to))
  const res = await applyFile(await freshDb(), p)
  t(`${name} → refused (${res.msg ?? 'APPLIED'})`, !res.ok && expect.test(res.msg), true)
}

console.log(bad ? `\n✗ ${bad} failure(s).` : '\n✓ all checks pass.')
process.exit(bad ? 1 : 0)
