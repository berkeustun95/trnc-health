#!/usr/bin/env node
// ─── Apply ONE migration to production — the engine of .github/workflows/supabase-migrate.yml ─
//
//   gh workflow run supabase-migrate -f file=<full file name>.sql              # dry: show SQL, check ledger
//   gh workflow run supabase-migrate -f file=<full file name>.sql -f apply=true
//
// Keyed on the FULL file name: 13 prefixes repeat, so a prefix names nothing.
//
// ATOMICITY IS A PROPERTY OF THE FILE, and this script refuses a file that lacks it.
// `migration-ledger.mjs --verify` must pass: the file carries its own ledger stamp as
// the last statement inside its single BEGIN/COMMIT. The file is sent to the Management
// API UNCHANGED, so the migration and its schema_migrations_applied row commit together
// or not at all. Measured 2026-10-01: a statement failing mid-transaction through this
// endpoint returns HTTP 400 and leaves nothing behind (probe table absent afterwards).
//
// REFUSES, in both modes: a name that is not a file in supabase/migrations/, a file the
// verifier rejects, and a file production's ledger already records.
// After an apply: the ledger row must carry the file's checksum, and QUERY 1 of
// supabase/verify_schema.sql must return its PASS verdict — otherwise this exits 1.
// (A red verdict after a COMMITTED apply means the migration is IN; the red is the alarm.)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const file = args.find(a => !a.startsWith('--'))
const unknown = args.filter(a => a.startsWith('--') && a !== '--apply')
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
if (unknown.length) fail(`Unknown argument(s): ${unknown.join(' ')} — usage: <file.sql> [--apply]`)
prodWriteGuard({ wouldWrite: apply, workflow: 'supabase-migrate' })

if (!file || !/^[0-9]+_[a-z0-9_]+\.sql$/.test(file)) fail(`Not a migration file name: ${JSON.stringify(file ?? '')} (want e.g. 20261066_x.sql)`)
const path = resolve(ROOT, 'supabase/migrations', file)
if (!existsSync(path)) fail(`REFUSED: supabase/migrations/${file} is not in this commit.`)

const v = spawnSync(process.execPath, [resolve(ROOT, 'scripts/migration-ledger.mjs'), '--verify', file], { encoding: 'utf8' })
process.stdout.write(v.stdout); process.stderr.write(v.stderr)
if (v.status !== 0) fail('REFUSED: the file is not safe to apply as one transaction (see above).')

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token) fail('SUPABASE_ACCESS_TOKEN is not set (repository secret).')
if (!ref) fail('Could not derive the project ref from SUPABASE_URL.')

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) return { error: `HTTP ${r.status}: ${text.slice(0, 2000)}` }
  try { return { rows: JSON.parse(text) } } catch { return { error: `unparseable response: ${text.slice(0, 500)}` } }
}

// The file name passed the regex above, so it is safe as a literal.
const ledgerRow = async () => {
  const r = await sql(`SELECT filename, checksum, applied_at, applied_by FROM public.schema_migrations_applied WHERE filename = '${file}'`)
  if (r.error) fail(`Could not read the ledger: ${r.error}`)
  return r.rows[0] ?? null
}

const before = await ledgerRow()
if (before) fail(`REFUSED: production's ledger already records ${file}`,
  `  applied ${before.applied_at} by ${before.applied_by}, checksum ${before.checksum.slice(0, 12)}…`,
  '  An applied migration is never re-run or edited; corrections go in a new file.')
console.log(`ledger: ${file} is not recorded in production — it is pending.`)

const text = readFileSync(path, 'utf8')
const stampSum = /VALUES \('[^']+', '([0-9a-f]{64})'\)/.exec(text.slice(text.indexOf('-- ─── ledger:stamp:begin')))[1]

if (!apply) {
  console.log(`\n── DRY RUN: this SQL would be sent unchanged (${text.length} chars) ──────────────────\n`)
  console.log(text)
  console.log('── end of SQL. Nothing was sent. Re-run with apply=true to apply. ──')
  process.exit(0)
}

console.log(`\n── APPLY ${file} ──`)
const res = await sql(text)
if (res.error) fail(`✗ APPLY FAILED — the transaction rolled back, nothing was applied and no ledger row was written.`, `  ${res.error}`)
console.log('✓ the transaction committed.')

const after = await ledgerRow()
if (!after) fail('✗ the file committed but its ledger row is missing — the stamp did not run. Investigate before anything else.')
if (after.checksum !== stampSum) fail(`✗ ledger checksum ${after.checksum.slice(0, 12)}… ≠ the file's ${stampSum.slice(0, 12)}…`)
console.log(`✓ ledger row: ${after.filename} · ${after.checksum.slice(0, 12)}… · ${after.applied_at} · ${after.applied_by}`)

// QUERY 1 of verify_schema.sql, sliced between its banners exactly as a human selects it.
const vs = readFileSync(resolve(ROOT, 'supabase/verify_schema.sql'), 'utf8')
const a = vs.indexOf('═══ QUERY 1 / 5'), b = vs.indexOf('═══ QUERY 2 / 5')
if (a < 0 || b < 0) fail('verify_schema.sql: QUERY 1 / QUERY 2 banners not found.')
const q1 = vs.slice(vs.lastIndexOf('\n', a), vs.lastIndexOf('\n', vs.lastIndexOf('\n', b) - 1))
const check = await sql(q1)
if (check.error) fail(`✗ verify_schema QUERY 1 could not run: ${check.error}`, '  The migration IS applied. Run QUERY 1 by hand.')
const [verdict, ...rest] = check.rows
console.log(`\nverify_schema QUERY 1: ${verdict?.object} [${verdict?.status}]`)
if (verdict?.section !== 'Z-VERDICT' || verdict.status !== 'OK') {
  for (const r of rest.filter(r => !['OK', 'ON'].includes(r.status))) console.error(`  ✗ ${r.section} | ${r.migration} | ${r.object} | ${r.status}`)
  fail(`::error::${file} is APPLIED but the schema check is RED — see the rows above.`)
}
console.log(`✓ ${file} applied, recorded, and the schema check is green.`)
