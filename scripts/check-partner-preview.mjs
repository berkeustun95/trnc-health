#!/usr/bin/env node
// ─── The dev preview fixture must match the seed migration ──────────────────
//
//   npm run preview:check
//
// constants/partnerPreview.js is a SECOND COPY of the row inserted by
// supabase/migrations/20261011_seed_tadilart_cyprus.sql. That duplication is the price of
// a preview that does not depend on a row RLS forbids the previewer to read — and an
// unchecked second copy is exactly how a preview starts lying: the card on the device
// shows a phone number the database does not have, and every subsequent look at that
// screen is checking the wrong thing.
//
// So this parses the migration and compares FIELD BY FIELD. It reads the SQL, never a
// summary of it, and it fails if the parser finds nothing — a probe that reads zero
// columns and reports no differences is the failure mode this repo has shipped before.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = 'supabase/migrations/20261011_seed_tadilart_cyprus.sql'

const raw = readFileSync(resolve(ROOT, SEED), 'utf8')

// Strip -- comments, honouring '' escapes inside literals, so a comment containing an
// apostrophe or a comma cannot be mistaken for data.
const stripComment = (l) => {
  let inq = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c === "'") { if (inq && l[i+1] === "'") { i++; continue } inq = !inq }
    else if (c === '-' && !inq && l[i+1] === '-') return l.slice(0, i)
  }
  return l
}
const sql = raw.split('\n').map(stripComment).join('\n')

const m = sql.match(/INSERT\s+INTO\s+public\.home_services\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT/i)
if (!m) {
  console.error(`\n  preview: could not find the INSERT in ${SEED}.`)
  console.error('  That is not "no drift" — it is a parser that read nothing. Fix the parser.\n')
  process.exit(1)
}
const cols = m[1].split(',').map(s => s.trim()).filter(Boolean)

// Split the VALUES tuple on TOP-LEVEL commas only: quotes and ARRAY[...] brackets nest.
const splitTop = (s) => {
  const out = []; let cur = '', depth = 0, inq = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inq) { cur += c; if (c === "'") { if (s[i+1] === "'") { cur += s[++i] } else inq = false } continue }
    if (c === "'") { inq = true; cur += c; continue }
    if (c === '[' || c === '(') depth++
    if (c === ']' || c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const lit = (t) => {
  const v = t.trim()
  if (/^NULL$/i.test(v)) return null
  if (/^true$/i.test(v)) return true
  if (/^false$/i.test(v)) return false
  const arr = v.match(/^ARRAY\s*\[([\s\S]*)\]$/i)
  if (arr) return splitTop(arr[1]).map(lit)
  const str = v.match(/^'([\s\S]*)'$/)
  if (str) return str[1].replace(/''/g, "'")
  return v
}
const vals = splitTop(m[2]).map(lit)

if (cols.length !== vals.length) {
  console.error(`\n  preview: ${cols.length} column(s) but ${vals.length} value(s) parsed from ${SEED}.\n`)
  process.exit(1)
}
if (cols.length < 10) {
  console.error(`\n  preview: only ${cols.length} column(s) parsed — too few to be the real INSERT.\n`)
  process.exit(1)
}
const seedRow = Object.fromEntries(cols.map((c, i) => [c, vals[i]]))

const { PREVIEW_PARTNER_ROWS } = await import(resolve(ROOT, 'constants/partnerPreview.js'))
const fixture = PREVIEW_PARTNER_ROWS.find(r => r.id === seedRow.id)

console.log('')
console.log(`  preview fixture vs ${SEED}`)
console.log(`    ${cols.length} column(s) parsed from the migration`)

if (!fixture) {
  console.error(`\n  ✗ no fixture row with id ${seedRow.id} — the seed and the preview disagree about which row this even is\n`)
  process.exit(1)
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const problems = []
for (const c of cols) {
  if (!(c in fixture)) { problems.push(`${c}: absent from the fixture (seed has ${JSON.stringify(seedRow[c])})`); continue }
  if (!eq(fixture[c], seedRow[c])) problems.push(`${c}: fixture ${JSON.stringify(fixture[c])} != seed ${JSON.stringify(seedRow[c])}`)
}
for (const k of Object.keys(fixture)) {
  if (!cols.includes(k)) problems.push(`${k}: in the fixture but not in the seed INSERT`)
}

if (problems.length) {
  console.error('')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\n  The preview would show values the database does not have.')
  console.error('  Fix constants/partnerPreview.js to match the migration.\n')
  process.exit(1)
}
console.log(`    all ${cols.length} field(s) match, including status='${seedRow.status}'`)
console.log('  OK — the preview shows exactly what the seed inserted.')
console.log('')
