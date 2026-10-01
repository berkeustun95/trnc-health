#!/usr/bin/env node
// ─── fontWeight without an Inter fontFamily ─────────────────────────────────
// A style object that sets `fontWeight` but no `fontFamily` renders in the Android SYSTEM
// font (Inter is a loaded family, not a default), so the screen silently mixes two faces.
// This finds every StyleSheet-style object literal (`{ … }` with no nested braces) that has
// `fontWeight:` and no `fontFamily:` and no spread (a spread may carry the family — those are
// listed separately so a reviewer can judge them, never counted as clean by assumption).
//
//   node scripts/check-font-family.mjs           # fail on any finding outside the allow-list
//   node scripts/check-font-family.mjs --report  # list every finding, exit 0
//
// Scope: screens/, components/, App.js. Provider/admin/organizer screens are OUT of the
// redesign's scope and are listed in ALLOW with the reason; shrink ALLOW, never grow it
// silently.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = process.argv.includes('--report')
const ALLOW = new Set([
  // Role screens: not customer-facing, out of the redesign's scope (redesign-plan.md S6).
  'screens/AdminScreen.js', 'screens/ProviderScreen.js', 'screens/ProviderOnboardingScreen.js',
  'screens/OrganizerScreen.js', 'screens/EstateAgentDashboardScreen.js', 'screens/EstateAgentOnboardingScreen.js',
  'screens/HomeServiceDashboardScreen.js', 'screens/HomeServiceOnboardingScreen.js',
  'screens/InsuranceDashboardScreen.js', 'screens/InsuranceOnboardingScreen.js',
  'screens/GarageOnboardingScreen.js', 'screens/GroomingOnboardingScreen.js',
  'screens/TransportOnboardingScreen.js', 'screens/JobPostOnboardingScreen.js',
])

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (f.endsWith('.js')) out.push(p)
  }
  return out
}
const files = [...walk(join(ROOT, 'screens')), ...walk(join(ROOT, 'components')), join(ROOT, 'App.js')]

const findings = [], spread = []
for (const f of files) {
  const rel = relative(ROOT, f)
  const src = readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
  for (const m of src.matchAll(/\{[^{}]*\}/g)) {
    const body = m[0]
    if (!/\bfontWeight\s*:/.test(body) || /\bfontFamily\s*:/.test(body)) continue
    const line = src.slice(0, m.index).split('\n').length
    ;(/\.\.\./.test(body) ? spread : findings).push({ rel, line, text: body.replace(/\s+/g, ' ').slice(0, 90) })
  }
}
const live = findings.filter(x => !ALLOW.has(x.rel))
const byFile = arr => Object.entries(arr.reduce((a, x) => ((a[x.rel] = (a[x.rel] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])
if (REPORT) {
  console.log(`fontWeight without fontFamily: ${findings.length} (${live.length} outside the allow-list), ${spread.length} with a spread (judge by hand)`)
  for (const [f, n] of byFile(live)) console.log(`  ${String(n).padStart(3)}  ${f}`)
  if (spread.length) { console.log('  with spread:'); for (const [f, n] of byFile(spread)) console.log(`  ${String(n).padStart(3)}  ${f}`) }
  process.exit(0)
}
if (live.length) {
  console.error(`\n  font family: ${live.length} style(s) set fontWeight with no fontFamily — they render in the system font:`)
  for (const x of live.slice(0, 40)) console.error(`    ${x.rel}:${x.line}  ${x.text}`)
  if (live.length > 40) console.error(`    … and ${live.length - 40} more (run with --report)`)
  process.exit(1)
}
console.log(`font family: OK — no customer-facing style sets fontWeight without fontFamily (${findings.length - live.length} in allow-listed role screens)`)
