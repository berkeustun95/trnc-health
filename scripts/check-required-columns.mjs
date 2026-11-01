#!/usr/bin/env node
// ─── Columns the bundle selects must exist in production BEFORE it ships ─────
//
//   node scripts/check-required-columns.mjs      (in `npm run ota` and `npm run ota:preview`)
//
// `eas update` ships JS in seconds; a migration ships when Berke approves production-db.
// When an OTA selects a column the database does not have yet, PostgREST answers 42703 and
// the whole select fails — for BROWSE_COLS that is an empty Explore for every user. Order
// (Berke, 2026-11-01): migration applied first, then Preview, then production. This makes
// the order a gate instead of a memory.
//
// Asks production with the ANON key (the key the app holds) for each column, one row.
// Fails closed: no answer is a refusal, never a pass. A column leaves this list only when
// the bundle stops selecting it.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED = [
  // 20261155 — BROWSE_COLS (ExploreScreen) + PLACE_COLS (HomeScreen)
  ['places', 'official_visit', '20261155_places_official_visit.sql'],
]
const PROD_REF = 'jeihxnwqytnxtytgkzgf'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function env() {
  const out = {}
  try {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fall through to process.env */ }
  return { ...out, ...process.env }
}

const E = env()
const URL_ = E.EXPO_PUBLIC_SUPABASE_URL
const KEY  = E.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('required columns: EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not found (.env or environment) — refusing')
  process.exit(1)
}
if (!URL_.includes(PROD_REF)) {
  console.error(`required columns: ${URL_} is not the production project (${PROD_REF}) — refusing, a green answer from another database proves nothing`)
  process.exit(1)
}

let bad = 0
for (const [table, column, migration] of REQUIRED) {
  try {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=${column}&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (res.ok) { console.log(`  ok   ${table}.${column}`); continue }
    const body = (await res.text()).slice(0, 200)
    bad++
    console.error(`  FAIL ${table}.${column} — HTTP ${res.status}: ${body}`)
    console.error(`       Apply ${migration} (supabase-migrate) before publishing a bundle that selects it.`)
  } catch (e) {
    bad++
    console.error(`  FAIL ${table}.${column} — no answer from production (${e.message}); refusing rather than guessing`)
  }
}
if (bad) process.exit(1)
console.log('required columns: OK')
