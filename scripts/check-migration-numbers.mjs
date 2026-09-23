#!/usr/bin/env node
// ─── Migration numbers: no collisions across branches ────────────────────────
//
//   node scripts/check-migration-numbers.mjs          # guard (pre-push): exit 1 on a collision
//   node scripts/check-migration-numbers.mjs --next   # print the next free prefix
//
// Prefixes are SEQUENCE NUMBERS (CLAUDE.md). The old rule — "highest prefix in
// `ls supabase/migrations` + 1" — sees one branch only, which is how 20261046 had to
// skip over a 20261045 that existed on another branch. This reads EVERY local and
// origin/* branch plus the working tree, so two branches cannot take the same number.
//
// GIT ONLY. The prod ledger would be the other half, but schema_migrations_applied is
// not readable by anon (RLS returns [] — measured 2026-09-23), and exposing it for this
// is not worth it. What that leaves unseen: a number applied in prod whose file exists
// on no branch anywhere, i.e. a migration pasted from a file that was never committed.
//
// ─── WHAT COUNTS AS A COLLISION ──────────────────────────────────────────────
// One prefix, two or more DIFFERENT filenames, where at least one of those files is not
// on origin/main. main carries 13 legacy duplicates from before 20260828, when prefixes
// were dates; they are the baseline, not errors. Deriving the exemption from main — not
// listing the 13 — means the guard needs no edit when history is rewritten or extended,
// and a new duplicate is caught while it is still on a branch.

import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'supabase/migrations'
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const prefixOf = f => (f.match(/^(\d{8})_.+\.sql$/) || [])[1]

const refs = git('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')
  .split('\n').filter(r => r && !r.endsWith('/HEAD'))
const seen = new Map()                       // filename -> Set(where)
const add = (f, where) => { if (prefixOf(f)) (seen.get(f) ?? seen.set(f, new Set()).get(f)).add(where) }
for (const r of refs) {
  let out = ''
  try { out = git('ls-tree', '--name-only', r, `${DIR}/`) } catch { continue }
  for (const p of out.split('\n')) if (p) add(p.slice(DIR.length + 1), r.replace(/^refs\/(heads|remotes)\//, ''))
}
if (existsSync(resolve(ROOT, DIR))) for (const f of readdirSync(resolve(ROOT, DIR))) add(f, 'working tree')

const MAIN = refs.includes('refs/remotes/origin/main') ? 'origin/main' : 'main'
const onMain = new Set([...seen].filter(([, w]) => w.has(MAIN)).map(([f]) => f))

if (process.argv.includes('--next')) {
  const max = Math.max(...[...seen.keys()].map(f => Number(prefixOf(f))))
  console.log(String(max + 1))
  process.exit(0)
}

const byPrefix = new Map()
for (const f of seen.keys()) (byPrefix.get(prefixOf(f)) ?? byPrefix.set(prefixOf(f), []).get(prefixOf(f))).push(f)
const collisions = [...byPrefix].filter(([, fs]) => fs.length > 1 && fs.some(f => !onMain.has(f)))

console.log(`migration numbers: ${seen.size} files across ${refs.length} refs + working tree (baseline ${MAIN})`)
if (collisions.length) {
  console.error(`\nCOLLISION — ${collisions.length} prefix(es) taken by more than one file:`)
  for (const [p, fs] of collisions) {
    console.error(`  ${p}`)
    for (const f of fs) console.error(`    ${f}   [${[...seen.get(f)].join(', ')}]`)
  }
  console.error('\nRenumber the file that is not applied yet: `npm run migration:next` prints a free prefix.')
  process.exit(1)
}
console.log('  no collisions')
