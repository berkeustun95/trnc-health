#!/usr/bin/env node
// ─── Dark-launch flag guard ──────────────────────────────────────────────────
//
//   node scripts/check-module-flags.mjs        # exit 0 if flags match the baseline
//
// WHY: a module is dark-launched by leaving its MODULE_FLAGS entry false. Flipping one
// to true LOCALLY is the only practical way to look at a gated screen — the customer
// route is Home tile -> App.js gate -> screen, and admins never enter that chain at all
// (they short-circuit to AdminScreen), so the `|| isAdmin` bypass cannot be used to
// preview it.
//
// The danger is not the flip. It is forgetting to unflip:
//   • committing it   -> the module is live for everyone on the next release
//   • `eas update`    -> the module is live for everyone IMMEDIATELY, because eas update
//                        bundles the WORKING TREE, not git HEAD. An uncommitted flip
//                        ships. That is the real risk, and it is the one a git hook
//                        cannot see.
//
// THE BASELINE LIVES HERE, IN A COMMITTED FILE, ON PURPOSE. Launching a module for real
// means editing constants/flags.js AND this file in the same commit — two deliberate
// edits instead of one forgettable one. If you flip a flag and this guard fails, that is
// the guard working; do not "fix" it by loosening the baseline unless you are genuinely
// launching.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FLAGS_FILE = 'constants/flags.js'

// ─── EXPECTED STATE — update this ONLY when a module genuinely launches ──────
const EXPECTED_MODULES = {
  homeServices:  false,
  grooming:      false,
  garages:       false,
  transport:     false,
  insurance:     false,
  pets:          true,   // live
  events:        true,   // live
  jobs:          false,
  accommodation: false,  // Slice 3 in progress — flip locally to review, NEVER commit
  studentHub:    false,
  explore:       false,
}
const EXPECTED_SCALARS = {
  FEATURED_LIVE:         false,
  EXPLORE_FEATURED_LIVE: false,
  PRICE_COMPARE_LIVE:    false,
}

const src = readFileSync(resolve(ROOT, FLAGS_FILE), 'utf8')

// Strip // and /* */ comments so a commented-out `accommodation: true` in the prose
// above the object cannot be read as a live value.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

const block = code.match(/export\s+const\s+MODULE_FLAGS\s*=\s*\{([\s\S]*?)\}/)
if (!block) {
  console.error(`FLAG GUARD: could not find MODULE_FLAGS in ${FLAGS_FILE}.`)
  process.exit(1)
}

const actualModules = {}
for (const m of block[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(true|false)/g)) {
  actualModules[m[1]] = m[2] === 'true'
}
const actualScalars = {}
for (const k of Object.keys(EXPECTED_SCALARS)) {
  const m = code.match(new RegExp(`export\\s+const\\s+${k}\\s*=\\s*(true|false)`))
  if (m) actualScalars[k] = m[1] === 'true'
}

const problems = []
for (const [k, want] of Object.entries(EXPECTED_MODULES)) {
  if (!(k in actualModules)) { problems.push(`MODULE_FLAGS.${k} is missing from ${FLAGS_FILE}`); continue }
  if (actualModules[k] !== want) {
    problems.push(`MODULE_FLAGS.${k} is ${actualModules[k]}, baseline says ${want}`
      + (actualModules[k] ? '  <-- a gated module would go LIVE' : ''))
  }
}
for (const k of Object.keys(actualModules)) {
  if (!(k in EXPECTED_MODULES)) problems.push(`MODULE_FLAGS.${k} is new and not in this guard's baseline — add it`)
}
for (const [k, want] of Object.entries(EXPECTED_SCALARS)) {
  if (k in actualScalars && actualScalars[k] !== want) {
    problems.push(`${k} is ${actualScalars[k]}, baseline says ${want}`)
  }
}

if (problems.length) {
  console.error('')
  console.error('  ┌─ FLAG GUARD FAILED ────────────────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘')
  console.error('')
  console.error(`  If you flipped a flag to preview a screen, revert it:`)
  console.error(`      git checkout -- ${FLAGS_FILE}`)
  console.error('')
  console.error(`  If a module is genuinely launching, update BOTH files in one commit:`)
  console.error(`      ${FLAGS_FILE}  and  scripts/check-module-flags.mjs`)
  console.error('')
  process.exit(1)
}

console.log(`flag guard: OK (${Object.values(EXPECTED_MODULES).filter(Boolean).length} module(s) live: `
  + Object.entries(EXPECTED_MODULES).filter(([, v]) => v).map(([k]) => k).join(', ') + ')')
