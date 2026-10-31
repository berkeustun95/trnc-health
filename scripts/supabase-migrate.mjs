#!/usr/bin/env node
// ─── Apply migrations to production — the engine of .github/workflows/supabase-migrate.yml ─
//
//   gh workflow run supabase-migrate -f file=<full file name>.sql              # dry: show SQL, check ledger
//   gh workflow run supabase-migrate -f file=<full file name>.sql -f apply=true
//   gh workflow run supabase-migrate -f files="<a>.sql <b>.sql" -f apply=true   # a release: ONE approval
//
// Keyed on the FULL file name: 13 prefixes repeat, so a prefix names nothing.
//
// ATOMICITY IS A PROPERTY OF THE FILE, and this script refuses a file that lacks it.
// `migration-ledger.mjs --verify` must pass: the file carries its own ledger stamp as
// the last statement inside its single BEGIN/COMMIT. Each file is sent to the Management
// API UNCHANGED and ALONE, so a migration and its schema_migrations_applied row commit
// together or not at all. Measured 2026-10-01: a statement failing mid-transaction through
// this endpoint returns HTTP 400 and leaves nothing behind (probe table absent afterwards).
// A LIST IS NOT ONE TRANSACTION: files apply in the given order, the first failure stops
// the run, and the log names which files committed and which were never sent.
//
// The list is explicit, never "everything the ledger lacks": the repo holds files that are
// deliberately unapplied (proposals, retired branches). Given order = apply order, and it
// must be ascending by name (a reordered list is a typo, not a plan).
//
// REFUSES, in both modes and before anything is sent: a name that is not a file in
// supabase/migrations/, a duplicate, a non-ascending list, a file the verifier rejects,
// and a file production's ledger already records (no silent skipping).
// After each file: its ledger row must carry the file's checksum. After the LAST file:
// QUERY 1 of supabase/verify_schema.sql must return its PASS verdict — once, because
// verify_schema describes the state after the whole release and is red in between.
// (A red verdict after COMMITTED applies means the migrations are IN; the red is the alarm.)

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
// --dry is what the workflow's dry job passes, so an `--apply` smuggled into the file list there is a refusal,
// not an apply that skips production-db (security review of #258).
const apply = args.includes('--apply')
const dry = args.includes('--dry')
const files = args.filter(a => !a.startsWith('--'))
const unknown = args.filter(a => a.startsWith('--') && a !== '--apply' && a !== '--dry')
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
if (unknown.length) fail(`Unknown argument(s): ${unknown.join(' ')} — usage: <file.sql> [<file.sql> …] [--dry | --apply]`)
if (apply && dry) fail('REFUSED: --dry and --apply together. Nothing was sent.')
if (args.filter(a => a === '--apply').length > 1) fail('REFUSED: --apply given more than once. Nothing was sent.')
prodWriteGuard({ wouldWrite: apply, workflow: 'supabase-migrate' })

if (!files.length) fail('No migration file given (want e.g. 20261066_x.sql).')
for (const f of files) if (!/^[0-9]+_[a-z0-9_]+\.sql$/.test(f)) fail(`Not a migration file name: ${JSON.stringify(f)} (want e.g. 20261066_x.sql)`)
const dupes = files.filter((f, i) => files.indexOf(f) !== i)
if (dupes.length) fail(`REFUSED: listed more than once: ${[...new Set(dupes)].join(', ')}`)
for (let i = 1; i < files.length; i++) {
  if (files[i - 1] >= files[i]) fail(`REFUSED: the list is not ascending: ${files[i - 1]} comes before ${files[i]}.`, '  Given order = apply order; list the files in name order.')
}
for (const f of files) {
  if (!existsSync(resolve(ROOT, 'supabase/migrations', f))) fail(`REFUSED: supabase/migrations/${f} is not in this commit.`)
}

for (const f of files) {
  const v = spawnSync(process.execPath, [resolve(ROOT, 'scripts/migration-ledger.mjs'), '--verify', f], { encoding: 'utf8' })
  process.stdout.write(v.stdout); process.stderr.write(v.stderr)
  if (v.status !== 0) fail(`REFUSED: ${f} is not safe to apply as one transaction (see above).`)
}

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

// Every file name passed the regex above, so it is safe as a literal.
const ledgerRow = async file => {
  const r = await sql(`SELECT filename, checksum, applied_at, applied_by FROM public.schema_migrations_applied WHERE filename = '${file}'`)
  if (r.error) fail(`Could not read the ledger: ${r.error}`)
  return r.rows[0] ?? null
}

for (const f of files) {
  const before = await ledgerRow(f)
  if (before) fail(`REFUSED: production's ledger already records ${f}`,
    `  applied ${before.applied_at} by ${before.applied_by}, checksum ${before.checksum.slice(0, 12)}…`,
    '  An applied migration is never re-run or edited; corrections go in a new file. Nothing was sent.')
  console.log(`ledger: ${f} is not recorded in production — it is pending.`)
}

const texts = files.map(f => readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8'))
const stampSums = texts.map(t => /VALUES \('[^']+', '([0-9a-f]{64})'\)/.exec(t.slice(t.indexOf('-- ─── ledger:stamp:begin')))[1])

if (!apply) {
  files.forEach((f, i) => {
    console.log(`\n── DRY RUN ${i + 1}/${files.length}: ${f} would be sent unchanged (${texts[i].length} chars) ──────────────────\n`)
    console.log(texts[i])
    console.log(`── end of ${f}. Nothing was sent. ──`)
  })
  console.log(`\n${files.length} file(s), in this order: ${files.join(' → ')}. Re-run with apply=true to apply.`)
  process.exit(0)
}

const committed = []
for (const [i, f] of files.entries()) {
  console.log(`\n── APPLY ${i + 1}/${files.length}: ${f} ──`)
  const res = await sql(texts[i])
  if (res.error) fail(`✗ APPLY FAILED for ${f} — its transaction rolled back, nothing of it was applied and no ledger row was written.`,
    `  ${res.error}`,
    `  committed before it: ${committed.length ? committed.join(', ') : 'none'}`,
    `  never sent: ${files.slice(i + 1).join(', ') || 'none'}`)
  console.log('✓ the transaction committed.')

  const after = await ledgerRow(f)
  if (!after) fail(`✗ ${f} committed but its ledger row is missing — the stamp did not run. Investigate before anything else.`, `  never sent: ${files.slice(i + 1).join(', ') || 'none'}`)
  if (after.checksum !== stampSums[i]) fail(`✗ ${f}: ledger checksum ${after.checksum.slice(0, 12)}… ≠ the file's ${stampSums[i].slice(0, 12)}…`, `  never sent: ${files.slice(i + 1).join(', ') || 'none'}`)
  console.log(`✓ ledger row: ${after.filename} · ${after.checksum.slice(0, 12)}… · ${after.applied_at} · ${after.applied_by}`)
  committed.push(f)
}

// QUERY 1 of verify_schema.sql, sliced between its banners exactly as a human selects it.
const applied = committed.join(', ')
const vs = readFileSync(resolve(ROOT, 'supabase/verify_schema.sql'), 'utf8')
const a = vs.indexOf('═══ QUERY 1 / 5'), b = vs.indexOf('═══ QUERY 2 / 5')
if (a < 0 || b < 0) fail('verify_schema.sql: QUERY 1 / QUERY 2 banners not found.')
const q1 = vs.slice(vs.lastIndexOf('\n', a), vs.lastIndexOf('\n', vs.lastIndexOf('\n', b) - 1))
const check = await sql(q1)
if (check.error) fail(`✗ verify_schema QUERY 1 could not run: ${check.error}`, `  APPLIED: ${applied}. Run QUERY 1 by hand.`)
const [verdict, ...rest] = check.rows
console.log(`\nverify_schema QUERY 1: ${verdict?.object} [${verdict?.status}]`)
if (verdict?.section !== 'Z-VERDICT' || verdict.status !== 'OK') {
  for (const r of rest.filter(r => !['OK', 'ON'].includes(r.status))) console.error(`  ✗ ${r.section} | ${r.migration} | ${r.object} | ${r.status}`)
  fail(`::error::${applied} APPLIED but the schema check is RED — see the rows above.`)
}
console.log(`✓ ${applied} applied, recorded, and the schema check is green.`)
