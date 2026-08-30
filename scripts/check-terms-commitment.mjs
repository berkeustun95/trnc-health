#!/usr/bin/env node
// ─── Terms 24h-commitment guard ──────────────────────────────────────────────
//
//   node scripts/check-terms-commitment.mjs          # exit 1 if the promise is unbacked
//   node scripts/check-terms-commitment.mjs --self   # prove the matcher can fail
//
// ─── THE FAILURE CLASS THIS CLOSES ──────────────────────────────────────────
//
// docs/terms.html and the TERMS const in screens/LegalScreen.js are TWO copies of the
// same document, and they drifted: the hosted copy sat at June 2026 with no user-content
// section at all, while the in-app copy had been publishing a 24-hour removal commitment
// to every production user since July. Nobody noticed, because nothing compared them.
//
// Meanwhile the thing that commitment describes did not work. Admin "Remove" on a review,
// question or answer is a client-side .update() on a table with NO permissive UPDATE
// policy — reviews, questions and answers each carry exactly five policies and the only
// UPDATE entry is a RESTRICTIVE no_anon_update_*. With no permissive policy the command
// is denied outright, and supabase-js .update() without .select() returns
// {data:null, error:null} on zero rows. The removal was a silent no-op, and the app was
// promising it would happen within 24 hours.
//
// So: if EITHER copy carries the promise, a migration granting admins a real UPDATE path
// on all three tables must exist in the repo. Neither copy can carry it alone.
//
// ─── WHAT IT CANNOT SEE, AND WHY THAT IS STATED HERE ────────────────────────
//
// This checks COMMITTED, not APPLIED. Only EXPO_PUBLIC_SUPABASE_ANON_KEY is available to
// the repo, and pg_policies is not reachable through PostgREST as anon, so no script here
// can ask the live database what policies exist. "Committed but never applied" stays the
// standing manual-apply gap and is closed the usual way — the Tier 1 migration registers
// a DERIVED policy count in supabase/verify_schema.sql (5 -> 6 per table, printed), which
// is checked against the live DB by hand after the apply.
//
// It also reads migrations as TEXT. A policy created here and dropped by a later file
// still counts as present. That is deliberate: this guard answers "has the fix been
// written", not "is the fix live". The second question belongs to verify_schema.sql.
//
// ─── WHY IT IS IN pre-push ──────────────────────────────────────────────────
//
// docs/ is published by GitHub Pages on push, so `git push` IS the publish action for the
// hosted copy. Unlike a staleness check, this guard cannot fire spuriously on unrelated
// work: it only trips when someone edits a terms copy, which is never accidental.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const UGC_TABLES = ['reviews', 'questions', 'answers']

// The promise, not the words around it: "remove ... within 24 hours" in either voice.
// Matched against text with tags and newlines flattened, so markup cannot hide it.
const COMMITMENT = /remov\w*[^.]{0,160}within 24 hours|within 24 hours[^.]{0,160}remov\w*/i

const TERMS_COPIES = [
  { label: 'docs/terms.html',       path: 'docs/terms.html',       extract: (s) => s },
  { label: 'LegalScreen.js TERMS',  path: 'screens/LegalScreen.js',
    extract: (s) => {
      const m = s.match(/const TERMS = `([\s\S]*?)`\s*\n/)
      if (!m) throw new Error('could not locate the TERMS template literal in LegalScreen.js')
      return m[1]
    } },
]

const flatten = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// SQL comments must go BEFORE any policy scan. 20260815 carries a commented-out
// CREATE POLICY block as documentation; counting it would be a false green of exactly
// the kind this repo has been bitten by.
const stripSqlComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

function adminUpdatePathFor(table, files) {
  const hits = []
  for (const { name, sql } of files) {
    for (const stmt of sql.match(/CREATE\s+POLICY[\s\S]*?;/gi) ?? []) {
      if (/AS\s+RESTRICTIVE/i.test(stmt)) continue                 // restrictive never grants
      if (!new RegExp(`\\bON\\s+(?:public\\.)?${table}\\b`, 'i').test(stmt)) continue
      if (!/\bFOR\s+(UPDATE|ALL)\b/i.test(stmt)) continue
      hits.push(name)
    }
  }
  return [...new Set(hits)]
}

function run({ self = false } = {}) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: stripSqlComments(readFileSync(join(MIGRATIONS, name), 'utf8')) }))

  // --self: pretend a copy carries the promise, to prove the failure path is reachable
  // even on a repo where both copies are clean.
  const carrying = self
    ? [{ label: '(--self synthetic copy)', line: 'we remove violating content within 24 hours' }]
    : TERMS_COPIES.flatMap(({ label, path, extract }) => {
        const text = flatten(extract(readFileSync(join(ROOT, path), 'utf8')))
        const m = text.match(COMMITMENT)
        return m ? [{ label, line: m[0].trim() }] : []
      })

  console.log('terms 24h-commitment guard')
  console.log('  scope: COMMITTED migrations only — cannot see the live database (anon key)\n')

  console.log(`  copies carrying the 24h removal commitment: ${carrying.length}/${TERMS_COPIES.length}`)
  for (const c of carrying) console.log(`    • ${c.label} — "${c.line}"`)
  if (!carrying.length) console.log('    (none)')

  console.log('\n  admin UPDATE path in committed migrations, per UGC table:')
  const missing = []
  for (const table of UGC_TABLES) {
    const hits = adminUpdatePathFor(table, files)
    console.log(`    ${hits.length ? '✓' : '✗'} ${table.padEnd(10)} ${hits.length ? hits.join(', ') : 'NO permissive FOR UPDATE/ALL policy in any migration'}`)
    if (!hits.length) missing.push(table)
  }

  if (!carrying.length) {
    console.log('\n  PASS — no copy makes the promise, so nothing needs to back it.')
    return 0
  }
  if (!missing.length) {
    console.log('\n  PASS — the promise is made and a Tier 1 migration backing it is committed.')
    console.log('  REMINDER: committed is not applied. Run supabase/verify_schema.sql against the live DB.')
    return 0
  }

  console.error('\n  FAIL — the Terms promise removal within 24 hours, but admin removal cannot work.')
  console.error(`  No committed migration grants admins a permissive UPDATE on: ${missing.join(', ')}.`)
  console.error('  Admin "Remove" is a silent no-op on those tables (RLS denies, supabase-js returns no error).')
  console.error('\n  Fix EITHER side, not the guard:')
  console.error('    • write the Tier 1 migration (permissive admin UPDATE on all three), or')
  console.error('    • remove the 24-hour commitment from every terms copy listed above.')
  return 1
}

const self = process.argv.includes('--self')
const code = run({ self })
if (self) {
  console.log(`\n  --self exit code: ${code} (expected 1 — the matcher can fail)`)
  process.exit(code === 1 ? 0 : 1)
}
process.exit(code)
