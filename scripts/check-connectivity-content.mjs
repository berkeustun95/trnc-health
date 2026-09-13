#!/usr/bin/env node
// ─── Bağlantı & eSIM content health ──────────────────────────────────────────
//
//   npm run conn:health          # exit 1 if the module has nothing to show
//
// ─── WHY THIS EXISTS, AND WHY IT IS NOT A SCHEMA CHECK ──────────────────────
//
// verify_schema.sql, schema_drift_audit.sql and migration_ledger_check.sql all verify
// SHAPE. An empty connectivity_operators table has a perfectly correct schema and passes
// every one of them. That is exactly how the duty_list roster ran out on 2026-06-30 and
// nobody noticed for two months.
//
// The failure this guards is the dangerous half of the module's error state: the query
// SUCCEEDS and returns zero rows. Nothing is broken, nothing throws, and the user sees a
// screen that looks like a load failure — so they retry, it fails again, and they leave.
// To us it looks like nothing at all. There is no client-side error-logging path in this
// app to catch it (and adding one would need a migration, contact_events.action being
// CHECK-constrained, and would cut against the deliberate anti-telemetry stance in
// utils/moduleUsage.js), so it is caught HERE instead — server-side, on demand, with no
// user data involved.
//
// ⚠ NOT IN pre-push, DELIBERATELY. A push must not be blocked because a partner's package
//   list is being edited; that is data operations, and a guard that blocks unrelated work
//   gets disabled. Same reasoning as check-duty-staleness.mjs and check-novest-staleness.mjs.
//   Run it by hand before flipping CONNECTIVITY_LIVE, and on a cron once the module is live.
//
// ─── WHAT A HEALTHY SYSTEM PRINTS ───────────────────────────────────────────
//
// Asked before the first run, per the house rule: a healthy database prints at least one
// active operator and, for each, at least one active package. A BROKEN one prints a
// different thing — a count of zero, named. The check cannot be green against an empty
// table, which is the one failure it exists to detect.
//
// Reads with the ANON key on purpose: that is the key the app holds, so this measures what
// a USER can actually see. A row hidden from anon by RLS is invisible to the app and is
// therefore a fault here too, even though it exists in Postgres.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// .env is not committed; parse it directly rather than depending on a loader.
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
  console.error('conn health: EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not found (.env or environment)')
  process.exit(2)
}

async function get(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// ─── VERIFICATION ROWS MUST NEVER SURVIVE INTO A LIVE MODULE ────────────────
//
// Temp rows are inserted by hand to exercise the store card (see the slice-5 SQL), and
// NOTHING ELSE IN THIS REPO CAN NOTICE THEM: a store row is legitimate data, so every other
// check here reads a populated store list as healthy. Forgetting the DELETE would ship
// "ZZ_TEMP_ Ercan Havalimanı" to every user of a live module.
//
// This makes that structurally impossible rather than something somebody has to remember —
// and the case it really guards is not today's rows but a temp row inserted for a bug repro
// months from now, by somebody who never read the thread that created this convention.
//
// String.startsWith, not a LIKE-style pattern, for the same reason the DELETE uses
// starts_with(): '_' is a single-character WILDCARD in SQL LIKE, so 'ZZ_TEMP_%' also matches
// ZZXTEMPY..., and escaping it depends on standard_conforming_strings. A literal prefix test
// has no such trap on either side.
const TEMP_PREFIX = 'ZZ_TEMP_'

const problems = []
const notes = []

try {
  const operators = await get('connectivity_operators?select=*&is_active=eq.true&order=sort_order.asc')

  console.log(`  active operators: ${operators.length}`)
  if (operators.length === 0) {
    problems.push('NO ACTIVE OPERATOR. The module would render its error state for every user.')
  }

  for (const op of operators) {
    const pkgs = await get(`connectivity_packages?select=*&operator_id=eq.${op.id}&is_active=eq.true&order=sort_order.asc`)
    const stores = await get(`connectivity_stores?select=*&operator_id=eq.${op.id}&is_active=eq.true`)

    console.log(`  ${op.name}: ${pkgs.length} active package(s), ${stores.length} active store(s)`)

    if (pkgs.length === 0) {
      problems.push(`${op.name} has NO ACTIVE PACKAGES — screen 2 would render its error state.`)
    }

    // A package whose only handoff is the operator's generic page still works (the screen
    // falls back to esim_url), but a package with NEITHER is a dead primary CTA.
    for (const p of pkgs) {
      if (!p.handoff_url && !op.esim_url) {
        problems.push(`package "${p.name}" has no handoff_url and ${op.name} has no esim_url — the primary CTA would be dead.`)
      }
    }

    if (!op.support_phone) {
      problems.push(`${op.name} has no support_phone — the secondary CTA on screen 3 would be dead.`)
    }

    // ⚠ HARD FAILURE, and it is the one store-table condition that IS a fault.
    const temps = stores.filter(st => String(st.name ?? '').startsWith(TEMP_PREFIX))
    if (temps.length) {
      problems.push(
        `${op.name}: ${temps.length} ACTIVE VERIFICATION ROW(S) still in connectivity_stores — `
        + `${temps.map(st => `"${st.name}"`).join(', ')}. These are temp rows from a store-card `
        + `check and would be shown to every user of a live module. Run the DELETE half of the `
        + `slice-5 SQL (starts_with(name, '${TEMP_PREFIX}')).`,
      )
    }

    // Stores legitimately CAN be zero — the whole card hides. Said out loud so an empty
    // result is not read as a fault, and so the day it stops being zero is visible.
    if (stores.length === 0) {
      notes.push(`${op.name} has no active stores — the store card is hidden by design. Expected until KKTCELL sends the branch list.`)
    } else {
      const unmappable = stores.filter(st => typeof st.latitude !== 'number' || typeof st.longitude !== 'number')
      if (unmappable.length === stores.length) {
        problems.push(`${op.name}: all ${stores.length} store(s) lack coordinates — the map would be empty while the list is not.`)
      } else if (unmappable.length) {
        notes.push(`${op.name}: ${unmappable.length} of ${stores.length} store(s) have no coordinates — listed but not pinned.`)
      }
    }

    // Go-live gates. NOT failures: they change nothing a user sees, and the module is
    // shippable without them. Printed so the answer to "are we ready" is on screen rather
    // than in somebody's memory.
    if (op.brand_confirmed === false) notes.push(`${op.name}: brand_confirmed is false — colours/logo are still estimates.`)
    const unconfirmed = pkgs.filter(p => p.price_confirmed === false).length
    if (unconfirmed) notes.push(`${op.name}: ${unconfirmed} of ${pkgs.length} package price(s) not confirmed by the partner.`)
    if (!op.logo_url) notes.push(`${op.name}: logo_url is null — rendering the text wordmark fallback.`)
  }
} catch (e) {
  problems.push(`could not read the connectivity tables: ${e.message}`)
}

if (notes.length) {
  console.log('')
  for (const n of notes) console.log(`  note: ${n}`)
}

if (problems.length) {
  console.error('')
  console.error('  ┌─ CONNECTIVITY CONTENT CHECK FAILED ────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘')
  console.error('')
  console.error('  An empty table has a perfectly correct schema, so no drift check can')
  console.error('  see this. Fix the DATA, then re-run.')
  console.error('')
  process.exit(1)
}

console.log('')
console.log('conn health: OK')
