// Edge probe: the two verify_schema.sql QUERY 2 rows touched by 20261245 (the 20261232 dovec-sync row and the 20261245 row),
// evaluated against a stub cron.job in PGlite in five states. The row SQL is sliced out of verify_schema.sql, not retyped.
// By hand: node scripts/test-dovec-sync-pause-verify-rows.mjs  (needs the suite lock: heavy, loads PGlite)
// NOT evidence of: real pg_cron, real cron.timezone, a resume job actually firing.
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { freshDb } from './migration-harness.mjs'

const V = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const a = V.indexOf("SELECT '20261232_dovec_cron'"), endMark = V.indexOf('UNION ALL', V.indexOf("SELECT '20261245_dovec_sync_pause'"))
if (a < 0 || endMark < 0) { console.log('  ✗ anchors missing in verify_schema.sql'); process.exit(1) }
const rows = V.slice(a, endMark)
const open = (rows.match(/\(/g) || []).length, close = (rows.match(/\)/g) || []).length
const cases = (rows.match(/\bCASE\b/g) || []).length, ends = (rows.match(/\bEND\b/g) || []).length
console.log(`  parens ${open}/${close}, CASE/END ${cases}/${ends}`)
let bad = 0
if (open !== close || cases !== ends) { bad++; console.log('  ✗ unbalanced') }

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const SYNC_CMD = readFileSync(MIG + '20261232_dovec_cron.sql', 'utf8').match(/cron\.schedule\('dovec-sync', '\*\/10 \* \* \* \*', \$job\$([\s\S]*?)\$job\$\)/)[1]
const p = readFileSync(MIG + '20261245_dovec_sync_pause.sql', 'utf8')
const RESUME_CMD = p.match(/v_resume\s+text := \$job\$([\s\S]*?)\$job\$;/)
if (!RESUME_CMD) { console.log('  ✗ resume command not found in 20261245'); process.exit(1) }

const SEED = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS public.schema_migrations_applied (filename text PRIMARY KEY, checksum text, applied_at timestamptz DEFAULT now());`
const db = await freshDb(SEED)
const state = async (label, { syncActive, resume, ageH }, want) => {
  await db.exec(`DELETE FROM cron.job; DELETE FROM public.schema_migrations_applied;`)
  await db.query(`INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('dovec-sync','*/10 * * * *',$1,$2)`, [SYNC_CMD, syncActive])
  if (resume) await db.query(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('dovec-sync-resume','5 1 29 11 *',$1)`, [RESUME_CMD[1]])
  if (ageH !== null) await db.query(`INSERT INTO public.schema_migrations_applied (filename, checksum, applied_at) VALUES ('20261245_dovec_sync_pause.sql','x', now() - ($1 || ' hours')::interval)`, [String(ageH)])
  const r = await db.query(`SELECT * FROM (${rows}) q(name, what, status) ORDER BY name`)
  const got = r.rows.map(x => x.status)
  const ok = got.length === 2 && want.every((w, i) => w === 'OK' ? got[i] === 'OK' : got[i] !== 'OK' && got[i].includes(w))
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${label}: got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`)
}
await state('active, no resume', { syncActive: true, resume: false, ageH: null }, ['OK', 'OK'])
await state('paused, resume, applied now', { syncActive: false, resume: true, ageH: 0 }, ['OK', 'OK'])
await state('paused, resume, applied 4 h ago', { syncActive: false, resume: true, ageH: 4 }, ['IS OFF', 'STALE'])
await state('paused, no resume', { syncActive: false, resume: false, ageH: 0 }, ['IS OFF', 'OK'])
await state('active, leftover resume', { syncActive: true, resume: true, ageH: 0 }, ['OK', 'LEFTOVER'])
await state('paused, resume, no ledger row', { syncActive: false, resume: true, ageH: null }, ['IS OFF', 'STALE'])
console.log(bad ? `\n  ${bad} FAILED` : '\nall green')
process.exit(bad ? 1 : 0)
