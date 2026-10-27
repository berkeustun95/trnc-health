// 20261142_duty_push_runs_partial_retries.sql against the PGlite harness (PostgreSQL 18; prod is older).
// Fixture: cron stub, then the REAL 20261141 file applied, then the file under test. Red-first mutants:
// each weakening must be refused by the in-file assertion that guards it.
//
//   node scripts/test-duty-push-runs-retries-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const rel = (f) => fileURLToPath(new URL('../supabase/migrations/' + f, import.meta.url))
const FILE = rel('20261142_duty_push_runs_partial_retries.sql')
const PRIOR = rel('20261141_duty_push_runs.sql')
const SQL = readFileSync(FILE, 'utf8')
const FIXTURE = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;`
const base = async () => { const d = await freshDb(FIXTURE); const r = await applyFile(d, PRIOR); if (!r.ok) throw new Error('20261141 fixture failed: ' + r.msg); return d }

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'dprr-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}
const refused = async (name, p, wantMsg) => {
  if (!p) return
  const r = await applyFile(await base(), p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261142 — real file on top of the real 20261141')
const db = await base()
const q = async (sql) => (await db.query(sql)).rows
await db.exec(`INSERT INTO public.duty_push_runs (outcome, push_attempted, push_ok) VALUES ('sent', 3, 3)`)
t('BEFORE: partial is refused by the 20261141 CHECK (red-first: the migration is needed)',
  (await asRole(db, 'service_role', null, `INSERT INTO public.duty_push_runs (outcome) VALUES ('partial')`)).ok, false)
t('applies cleanly with a row present', await applyFile(db, FILE), { ok: true, msg: null })
t('applies a SECOND time', await applyFile(db, FILE), { ok: true, msg: null })
t('existing row kept, push_retries defaulted to 0', (await q(`SELECT push_retries FROM public.duty_push_runs`)).map(r => r.push_retries), [0])
t('13 columns', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='duty_push_runs'`))[0].n, 13)
t('service_role can write partial + retries (positive control)',
  (await asRole(db, 'service_role', null, `INSERT INTO public.duty_push_runs (outcome, push_attempted, push_ok, push_retries) VALUES ('partial', 110, 10, 3)`)).ok, true)
const an = await asRole(db, 'anon', null, `INSERT INTO public.duty_push_runs (outcome) VALUES ('partial')`)
t('anon INSERT denied', [an.ok, /permission denied/.test(an.msg || '')], [false, true])
const au = await asRole(db, 'authenticated', null, `SELECT push_retries FROM public.duty_push_runs`)
t('authenticated SELECT of the new column denied', [au.ok, /permission denied/.test(au.msg || '')], [false, true])
t('RLS on, zero policies', (await q(`SELECT (SELECT relrowsecurity FROM pg_class WHERE oid='public.duty_push_runs'::regclass) rls, (SELECT count(*)::int FROM pg_policies WHERE tablename='duty_push_runs') pol`))[0], { rls: true, pol: 0 })

console.log('mutants (each must be refused by the in-file assertion)')
await refused('partial missing from the outcome CHECK', mutant('nopartial', "'running','sent','partial',", "'running','sent',"), 'partial:rejected')
await refused('push_failed missing from the outcome CHECK', mutant('nopf', "'profiles_query_failed','push_failed']", "'profiles_query_failed']"), 'push_failed:rejected')
await refused('outcome CHECK widened (banana)', mutant('banana', "'push_failed']::text[]", "'push_failed','banana']::text[]"), 'banana:accepted')
await refused('negative retries accepted', mutant('neg', 'CHECK (push_retries >= 0)', 'CHECK (true)'), 'retries-1:accepted')
await refused('authenticated granted SELECT', mutant('grant', 'COMMENT ON COLUMN', 'GRANT SELECT ON public.duty_push_runs TO authenticated;\nCOMMENT ON COLUMN'), 'holds SELECT')
await refused('column-level grant to anon', mutant('colgrant', 'COMMENT ON COLUMN', 'GRANT SELECT (push_retries) ON public.duty_push_runs TO anon;\nCOMMENT ON COLUMN'), 'anon')

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
