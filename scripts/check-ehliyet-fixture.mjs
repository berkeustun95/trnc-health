// Drift check: PREVIEW_DRIVING_SCHOOLS[0] (constants/ehliyet.js) against the seed INSERTs in
// supabase/migrations/20261108_driving_schools.sql. Runs from scripts/test-ehliyet-ui.mjs;
// standalone: node scripts/check-ehliyet-fixture.mjs
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREVIEW_DRIVING_SCHOOLS } from '../constants/ehliyet.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SEED_SQL = 'supabase/migrations/20261108_driving_schools.sql'

// "(a, 'b', ARRAY['c','d'], NULL, true, 0), (...)" -> [[...], [...]] with SQL literals decoded.
const parseTuples = (body) => {
  const tuples = []
  let i = 0
  const lit = () => {
    while (/\s/.test(body[i])) i++
    if (body[i] === "'") {
      let v = ''
      for (i++; ; i++) {
        if (i >= body.length) throw new Error('unterminated string literal')
        if (body[i] === "'") { if (body[i + 1] === "'") { v += "'"; i++; continue } i++; break }
        v += body[i]
      }
      return v
    }
    if (body.slice(i, i + 6).toUpperCase() === 'ARRAY[') {
      i += 6
      const arr = []
      for (;;) {
        arr.push(lit())
        while (/\s/.test(body[i])) i++
        if (body[i] === ',') { i++; continue }
        if (body[i] === ']') { i++; break }
        throw new Error(`bad ARRAY at ${i}`)
      }
      return arr
    }
    const m = body.slice(i).match(/^[A-Za-z0-9_.+-]+/)
    if (!m) throw new Error(`cannot parse literal at "${body.slice(i, i + 20)}"`)
    i += m[0].length
    if (/^null$/i.test(m[0])) return null
    if (/^true$/i.test(m[0])) return true
    if (/^false$/i.test(m[0])) return false
    if (/^-?\d+$/.test(m[0])) return Number(m[0])
    throw new Error(`unexpected token ${m[0]}`)
  }
  for (;;) {
    while (i < body.length && /[\s,]/.test(body[i])) i++
    if (i >= body.length) break
    if (body[i] !== '(') throw new Error(`expected "(" at "${body.slice(i, i + 20)}"`)
    i++
    const row = []
    for (;;) {
      row.push(lit())
      while (/\s/.test(body[i])) i++
      if (body[i] === ',') { i++; continue }
      if (body[i] === ')') { i++; break }
      throw new Error(`expected "," or ")" at "${body.slice(i, i + 20)}"`)
    }
    tuples.push(row)
  }
  return tuples
}

// Anchored on the seed column lists only (the verification block inserts probe rows with other column lists).
// Whitespace, including line breaks, inside the column list is free.
const cols = (list) => list.split(',').map(c => c.trim())
const SCHOOL_COLS = cols('id, name, logo_key, phones, whatsapp, instagram_url, facebook_url, email, licence_classes, featured, sort_order, is_active')
const BRANCH_COLS = cols('school_id, region, address, lat, lng, geocode_source, sort_order')
const insertRe = (table, columns) =>
  new RegExp(`INSERT INTO public\\.${table}\\s*\\(\\s*${columns.join('\\s*,\\s*')}\\s*\\)\\s*VALUES([\\s\\S]*?)ON CONFLICT`, 'g')
const SCHOOL_RE = insertRe('driving_schools', SCHOOL_COLS)
const BRANCH_RE = insertRe('driving_school_branches', BRANCH_COLS)
const byCols = (columns, row) => {
  if (row.length !== columns.length) throw new Error(`seed row has ${row.length} values for ${columns.length} columns`)
  return Object.fromEntries(columns.map((c, i) => [c, row[i]]))
}

export const parseSeed = (sql) => {
  const schools = [...sql.matchAll(SCHOOL_RE)]
  if (schools.length !== 1) throw new Error(`want exactly 1 driving_schools seed INSERT, found ${schools.length}`)
  const rows = parseTuples(schools[0][1])
  if (rows.length !== 1) throw new Error(`want exactly 1 seed school row, found ${rows.length}`)
  const branches = [...sql.matchAll(BRANCH_RE)]
  if (branches.length !== 1) throw new Error(`want exactly 1 driving_school_branches seed INSERT, found ${branches.length}`)
  const brows = parseTuples(branches[0][1])
  if (brows.length < 1) throw new Error('seed branch INSERT has no rows')
  return { school: byCols(SCHOOL_COLS, rows[0]), branches: brows.map(r => byCols(BRANCH_COLS, r)) }
}

// Returns a list of human-readable differences (empty = no drift). Throws if the seed cannot be parsed.
export const diffFixture = (sql, fixture) => {
  const { school, branches } = parseSeed(sql)
  const out = []
  const cmp = (label, seedVal, fixVal) => {
    if (JSON.stringify(seedVal) !== JSON.stringify(fixVal)) out.push(`${label}: seed ${JSON.stringify(seedVal)} vs fixture ${JSON.stringify(fixVal)}`)
  }
  // Array columns (phones, licence_classes) compare in stored order: the chips render in that order.
  for (const k of SCHOOL_COLS.filter(c => c !== 'is_active')) cmp(k, school[k], fixture[k])
  // The one deliberate difference: the seed is inactive, the fixture is readable on purpose.
  cmp('is_active (seed false, fixture true by design)', [school.is_active, fixture.is_active], [false, true])
  for (const b of branches) if (b.school_id !== school.id) out.push(`branch school_id ${b.school_id} is not the seed school id ${school.id}`)
  const fixB = [...(fixture.driving_school_branches || [])].sort((a, b) => a.sort_order - b.sort_order)
  const BC = BRANCH_COLS.filter(c => c !== 'school_id')
  cmp(`branches (${BC.join(', ')})`, branches.map(b => BC.map(c => b[c])), fixB.map(b => BC.map(c => b[c] ?? null)))
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const diffs = diffFixture(readFileSync(resolve(ROOT, SEED_SQL), 'utf8'), PREVIEW_DRIVING_SCHOOLS[0])
    if (diffs.length) { console.error(`✗ fixture drifted from ${SEED_SQL}:\n  ` + diffs.join('\n  ')); process.exit(1) }
    console.log(`✓ fixture matches the ${SEED_SQL} seed`)
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
}
