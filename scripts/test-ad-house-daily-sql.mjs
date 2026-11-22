// 20261227 (ad_house_daily) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Seeds ad_modules, profiles and is_admin() only. Says nothing about prod's Postgres version or PostgREST.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-ad-house-daily-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261227_ad_house_daily.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const ADMIN = '00000000-0000-4000-8000-000000000001', GUEST = '00000000-0000-4000-8000-000000000003'
const fixture = (adminRole = 'admin') => `
CREATE TABLE public.ad_modules (module text PRIMARY KEY, note text, added_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.ad_modules (module) VALUES ('home'), ('events'), ('accommodation'), ('explore');
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$f$;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${GUEST}');
INSERT INTO public.profiles (id, role) VALUES ('${ADMIN}', '${adminRole}'), ('${GUEST}', 'customer');
`
const FIXTURE = fixture()
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const mutant = (from, to) => {
  if (!SQL.includes(from)) throw new Error(`anchor not found: ${from}`)
  const p = join(mkdtempSync(join(tmpdir(), 'adh-')), '20261227_ad_house_daily.sql')
  writeFileSync(p, SQL.replace(from, to)); return p
}

console.log('20261227 — real file')
{
  const d = await freshDb(FIXTURE)
  t('applies, including its own assertions', await applyFile(d, FILE), { ok: true, msg: null })
  t('table is empty after the run (checks rolled back)', (await asRole(d, null, null, 'SELECT count(*)::int n FROM public.ad_house_daily')).rows[0].n, 0)
  t('re-run is safe', await applyFile(d, FILE), { ok: true, msg: null })
  await asRole(d, 'anon', null, "SELECT public.bump_house_ad_counter('list_top','events','tap')")
  await asRole(d, 'authenticated', GUEST, "SELECT public.bump_house_ad_counter('list_top','events','tap')")
  t('admin reads the two taps', (await asRole(d, 'authenticated', ADMIN, 'SELECT sum(tap_count)::int n FROM public.ad_house_daily')).rows[0].n, 2)
  t('guest reads nothing', (await asRole(d, 'authenticated', GUEST, 'SELECT count(*)::int n FROM public.ad_house_daily')).rows[0].n, 0)
  t('anon read refused', (await asRole(d, 'anon', null, 'SELECT 1 FROM public.ad_house_daily')).ok, false)
  t('re-run with real rows present leaves them', await applyFile(d, FILE), { ok: true, msg: null })
  t('rows unchanged by the re-run', (await asRole(d, 'authenticated', ADMIN, 'SELECT sum(tap_count)::int n FROM public.ad_house_daily')).rows[0].n, 2)
  t('Famagusta day', (await asRole(d, null, null, "SELECT (day = (now() AT TIME ZONE 'Asia/Famagusta')::date) ok FROM public.ad_house_daily LIMIT 1")).rows[0].ok, true)
}

console.log('red-first mutants (each must be refused)')
for (const [name, from, to] of [
  ['extra permissive policy', 'COMMENT ON TABLE public.ad_house_daily', 'CREATE POLICY x ON public.ad_house_daily FOR SELECT TO authenticated USING (true);\nCOMMENT ON TABLE public.ad_house_daily'],
  ['anon granted SELECT', 'GRANT SELECT ON public.ad_house_daily TO authenticated;', 'GRANT SELECT ON public.ad_house_daily TO authenticated, anon;'],
  ['authenticated granted INSERT', 'GRANT SELECT ON public.ad_house_daily TO authenticated;', 'GRANT SELECT, INSERT ON public.ad_house_daily TO authenticated;'],
  ['pair allow-list widened', "OR (p_position = 'list_top' AND p_module = 'events'))", "OR (p_position = 'list_top' AND p_module = 'events') OR p_module = 'explore')"],
  ['kind guard removed (taps count as views)', "ELSIF p_kind = 'tap' THEN", "ELSE"],
  ['search_path unpinned', 'SET search_path = public, pg_temp\nAS $fn$', 'AS $fn$'],
  ['PUBLIC keeps EXECUTE', 'REVOKE ALL ON FUNCTION public.bump_house_ad_counter(text, text, text) FROM PUBLIC;', ''],
  ['policy is true, not admin', 'USING ((select public.is_admin()))', 'USING (true)'],
]) {
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, mutant(from, to))
  t(`${name}: refused`, r.ok, false)
}
{
  const d = await freshDb(fixture('customer'))
  const r = await applyFile(d, FILE)
  t('no admin: fails loudly', [r.ok, r.msg], [false, 'no admin profile to run the positive control with'])
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
