// 20261141_duty_push_runs.sql against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Fixture: a pg_cron stub only (the table depends on nothing else). The file's own probes do the role work;
// this adds red-first mutants (each weakening must be REFUSED by the in-file assertion that guards it),
// a re-run, and the retention command run for real.
//
//   node scripts/test-duty-push-runs-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261141_duty_push_runs.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const FIXTURE = `
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
const dir = mkdtempSync(join(tmpdir(), 'dpr-'))
const mutant = (name, from, to) => {
  if (!SQL.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name + '.sql'); writeFileSync(p, SQL.replace(from, to)); return p
}
const refused = async (name, p, wantMsg) => {
  if (!p) return
  const r = await applyFile(await freshDb(FIXTURE), p)
  t(`${name} refused`, r.ok, false)
  t(`  message mentions "${wantMsg}"`, (r.msg || '').includes(wantMsg), true)
  console.log(`      ${r.msg}`)
}

console.log('20261141_duty_push_runs — real file on a cron-stub fixture')
const db = await freshDb(FIXTURE)
const q = async (sql) => (await db.query(sql)).rows
t('applies cleanly (in-file assertions green)', await applyFile(db, FILE), { ok: true, msg: null })
await db.exec(`INSERT INTO public.duty_push_runs (finished_at, outcome, push_attempted, push_ok) VALUES (now(), 'sent', 3, 3), (now(), 'sent', 2, 2)`)
t('applies a SECOND time with real rows present (re-runnable)', await applyFile(db, FILE), { ok: true, msg: null })
t('  ...and leaves those 2 rows alone', (await q(`SELECT count(*)::int n FROM public.duty_push_runs`))[0].n, 2)
await db.exec(`DELETE FROM public.duty_push_runs`)
t('one purge job, 03:47 daily', (await q(`SELECT schedule FROM cron.job WHERE jobname='purge-duty-push-runs'`)).map(r => r.schedule), ['47 3 * * *'])
t('RLS on, zero policies', (await q(`SELECT (SELECT relrowsecurity FROM pg_class WHERE oid='public.duty_push_runs'::regclass) rls, (SELECT count(*)::int FROM pg_policies WHERE tablename='duty_push_runs') pol`))[0], { rls: true, pol: 0 })

// Roles, asked rather than reasoned about; each denial beside its positive control.
const ins = `INSERT INTO public.duty_push_runs (duty_date) VALUES (current_date)`
const as = async (role, sql) => asRole(db, role, null, sql)
t('service_role INSERT works (positive control)', (await as('service_role', ins)).ok, true)
const ai = await as('anon', ins)
t('anon INSERT denied (permission denied)', [ai.ok, /permission denied/.test(ai.msg || '')], [false, true])
const au = await as('authenticated', `SELECT * FROM public.duty_push_runs`)
t('authenticated SELECT denied (permission denied)', [au.ok, /permission denied/.test(au.msg || '')], [false, true])
t('service_role reads the row it wrote (positive control)', (await as('service_role', `SELECT outcome FROM public.duty_push_runs`)).rows?.map(x => x.outcome), ['running'])

// Retention command, run for real: 100-day row goes, 10-day row stays.
await db.exec(`DELETE FROM public.duty_push_runs;
  INSERT INTO public.duty_push_runs (started_at, duty_date) VALUES (now() - interval '100 days', current_date), (now() - interval '10 days', current_date)`)
await db.exec((await q(`SELECT command FROM cron.job WHERE jobname='purge-duty-push-runs'`))[0].command)
t('retention keeps 1 of 2 (the 10-day row)', (await q(`SELECT count(*)::int n FROM public.duty_push_runs`))[0].n, 1)

console.log('mutants (each must be refused by the in-file assertion)')
await refused('RLS off', mutant('rls', 'ALTER TABLE public.duty_push_runs ENABLE ROW LEVEL SECURITY;', ''), 'RLS is not enabled')
await refused('authenticated granted SELECT', mutant('grant', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_push_runs TO service_role;', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_push_runs TO service_role;\nGRANT SELECT ON public.duty_push_runs TO authenticated;'), 'holds SELECT')
await refused('a policy added', mutant('pol', 'CREATE INDEX IF NOT EXISTS', 'ALTER TABLE public.duty_push_runs ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON public.duty_push_runs FOR SELECT TO authenticated USING (true);\nCREATE INDEX IF NOT EXISTS'), 'ZERO policies')
await refused('service_role grant dropped', mutant('svc', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_push_runs TO service_role;', 'REVOKE ALL ON TABLE public.duty_push_runs FROM service_role;'), 'service_role lost')
await refused('outcome vocabulary widened', mutant('out', "'no_profiles','duty_query_failed'", "'no_profiles','duty_query_failed','banana'"), "outcome 'banana'")
await refused('ok+errors<=attempted dropped', mutant('cnt', 'AND push_ok + push_errors <= push_attempted', ''), 'push_ok > push_attempted')
await refused('retention widened to 900 days', mutant('ret', "interval '90 days'", "interval '900 days'"), 'purge-duty-push-runs')

{
  // red-first for the re-run rule: with the leak check pinned to 0, a populated table must break the apply
  const p = mutant('leak', 'IS DISTINCT FROM v_before THEN', 'IS DISTINCT FROM 0 THEN')
  const d = await freshDb(FIXTURE)
  await applyFile(d, FILE)
  await d.exec(`INSERT INTO public.duty_push_runs (outcome) VALUES ('sent')`)
  const r = p ? await applyFile(d, p) : { ok: true }
  t('leak check pinned to 0 refuses a populated table (the check does notice)', r.ok, false)
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
