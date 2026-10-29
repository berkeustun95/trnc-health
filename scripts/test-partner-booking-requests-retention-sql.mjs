// 20261148_partner_booking_requests_retention.sql on the PGlite harness (PG 18; prod is older, see supabase/CLAUDE.md).
// Fixture: is_admin() stub + profiles + pg_cron stub; 20261143 is applied first (the table is its prerequisite).
//
//   node scripts/test-partner-booking-requests-retention-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const dirOf = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const BASE = dirOf('20261143_partner_booking_requests.sql')
const FILE = dirOf('20261148_partner_booking_requests_retention.sql')
const SQL = readFileSync(FILE, 'utf8')
const FIXTURE = `
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'pbr-ret-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, SQL.replace(from, () => to)); return p
}
const fresh = async () => { const d = await freshDb(FIXTURE); const r = await applyFile(d, BASE); if (!r.ok) throw new Error('base failed: ' + r.msg); return d }
const refused = async (name, p, wantMsg) => {
  if (!p) return
  const d = await fresh()
  const r = await applyFile(d, p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261148_partner_booking_requests_retention — real file on 20261143 + cron stub')
const db = await fresh()
const q = async (sql) => (await db.query(sql)).rows
t('applies cleanly', await applyFile(db, FILE), { ok: true, msg: null })
t('applies a SECOND time (re-runnable)', await applyFile(db, FILE), { ok: true, msg: null })
t('exactly one cron row, 03:53', (await q(`SELECT jobname, schedule, command FROM cron.job`)), [{ jobname: 'purge-partner-booking-requests', schedule: '53 3 * * *', command: 'SELECT public.purge_partner_booking_requests()' }])
t('probe rows cleaned up', (await q(`SELECT count(*)::int n FROM public.partner_booking_requests`))[0].n, 0)
t('anon/authenticated cannot EXECUTE (postgres can)', (await q(`SELECT has_function_privilege('anon','public.purge_partner_booking_requests()','EXECUTE') a, has_function_privilege('authenticated','public.purge_partner_booking_requests()','EXECUTE') u, has_function_privilege('postgres','public.purge_partner_booking_requests()','EXECUTE') p`))[0], { a: false, u: false, p: true })
t('policy count still 4', (await q(`SELECT count(*)::int n FROM pg_policies WHERE tablename='partner_booking_requests'`))[0].n, 4)
console.log('  proacl:', (await q(`SELECT proacl::text p FROM pg_proc WHERE proname='purge_partner_booking_requests'`))[0].p)
// the cron command itself, run as the job would
await db.exec(`INSERT INTO public.partner_booking_requests (partner,apartment,check_in,check_out,guests,created_at) VALUES ('north_houses','yasemin-2plus1',current_date+1,current_date+2,2, now()-interval '400 days'), ('north_houses','yasemin-2plus1',current_date+1,current_date+2,2, now())`)
await db.exec((await q(`SELECT command FROM cron.job`))[0].command)
t('cron command deletes the 400-day row, keeps today\'s', (await q(`SELECT count(*)::int n FROM public.partner_booking_requests`))[0].n, 1)

console.log('MUTANTS (each must be refused by the guarding assertion)')
await refused('wrong schedule', mutant('sched', "'53 3 * * *', $$", "'54 3 * * *', $$"), 'schedule is')
await refused('retention 1 month (deletes 11-month row)', mutant('short', "now() - interval '12 months'", "now() - interval '1 month'"), 'positive control: an 11-month-old row was deleted')
await refused('retention 24 months (keeps 13-month row)', mutant('long', "now() - interval '12 months'", "now() - interval '24 months'"), '13-month-old row survived')
await refused('purge granted to authenticated', mutant('grant', "FROM PUBLIC, anon, authenticated;\n\nCOMMENT ON FUNCTION", "FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.purge_partner_booking_requests() TO authenticated;\n\nCOMMENT ON FUNCTION"), 'authenticated can EXECUTE')
await refused('purge left to PUBLIC', mutant('public', "FROM PUBLIC, anon, authenticated;\n\nCOMMENT ON FUNCTION", "FROM anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.purge_partner_booking_requests() TO PUBLIC;\n\nCOMMENT ON FUNCTION"), 'EXECUTE')
await refused('extra policy added', mutant('pol', "DO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM cron.job", "CREATE POLICY pbr_extra ON public.partner_booking_requests FOR SELECT TO authenticated USING (true);\nDO $$\nBEGIN\n  IF EXISTS (SELECT 1 FROM cron.job"), 'exactly 4 policies')
console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)
