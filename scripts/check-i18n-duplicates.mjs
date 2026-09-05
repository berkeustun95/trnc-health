#!/usr/bin/env node
// ─── Duplicate translation keys — the ones that silently shadow ─────────────
//
//   node scripts/check-i18n-duplicates.mjs
//
// WHY. In a JS object literal a later key overwrites an earlier one, with no error and no
// warning. So a key defined twice in one locale renders its SECOND value, and the first is
// dead code that reads exactly like live code. When the two values differ, the app ships a
// string nobody chose.
//
// That was not hypothetical. Found 2026-09-06 while editing tile copy: `getStarted` was
// defined twice in ALL NINE locales, and in three of them the values differed —
// 'Get started'/'Get Started', 'Empezar'/'Comenzar', 'شروع کنید'/'شروع کن'. The Persian
// pair was the one that mattered: the winning value was the informal singular imperative,
// where Persian UI convention is the polite plural. The app had been addressing users
// informally because of a duplicate nobody could see.
//
// ⚠ DEPTH MATTERS, AND A FLAT SCAN GETS THIS WRONG. The first version of this check was a
//   regex over the whole locale block and reported `dat`, `loc` and `locCop` as duplicated
//   seven times in Turkish. They are not: they are the NESTED cityForms table, one set per
//   region, and they are supposed to repeat. A flat matcher cannot tell a sibling key from
//   a grandchild, so this walks the source tracking brace depth and only considers keys
//   that are DIRECT children of a locale object. Anything nested is somebody else's
//   namespace.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the number of locales and the number of top-level keys it
//   actually inspected. A parser that silently stops matching reports "no duplicates",
//   which is indistinguishable from a clean file unless the counts are on screen.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'constants/i18n.js'
const src  = readFileSync(resolve(ROOT, FILE), 'utf8')

const lineOf = i => src.slice(0, i).split('\n').length

// Locale blocks: `  en: {` at exactly two spaces of indent, which is how the file is written.
const blocks = [...src.matchAll(/^ {2}([a-z]{2}): \{$/gm)]
if (blocks.length === 0) {
  console.error(`\n  ${FILE}: found ZERO locale blocks — the scanner's anchor no longer matches `
    + `the file, so this guard was about to pass on nothing.\n`)
  process.exit(1)
}

// Walk from a block's opening brace to its matching close, recording keys at depth 1 only.
// Skips comments and string literals, which is the whole reason this is a walker and not a
// regex — a key name inside a translated sentence must not register as a key.
function topLevelKeys(start) {
  const keys = []
  let i = src.indexOf('{', start)
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === '{' || c === '[') { depth++; i++; continue }
    if (c === '}' || c === ']') { depth--; if (depth === 0) return keys; i++; continue }
    if (depth === 1) {
      // An identifier immediately followed by a colon, at this object's own level.
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(src.slice(i))
      if (m && !/[A-Za-z0-9_$]/.test(src[i - 1] || '')) {
        keys.push({ name: m[1], at: i })
        i += m[0].length
        continue
      }
    }
    i++
  }
  return keys
}

const problems = []
let totalKeys = 0
for (const b of blocks) {
  const code = b[1]
  const keys = topLevelKeys(b.index)
  totalKeys += keys.length
  if (keys.length === 0) {
    problems.push(`${code}: zero top-level keys parsed — the walker lost its place, and an `
      + `empty key list cannot contain a duplicate`)
    continue
  }
  const seen = new Map()
  for (const k of keys) {
    if (!seen.has(k.name)) seen.set(k.name, [])
    seen.get(k.name).push(k.at)
  }
  for (const [name, spots] of seen) {
    if (spots.length < 2) continue
    problems.push(`${code}.${name} is defined ${spots.length} times — at line `
      + `${spots.map(lineOf).join(' and line ')}. The LAST one wins silently; the others are `
      + `dead code that reads exactly like live code. Delete all but one.`)
  }
}

if (problems.length) {
  console.error('\n  ┌─ i18n DUPLICATE KEY CHECK FAILED ──────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(`i18n duplicates: OK (${blocks.length} locales, ${totalKeys} top-level keys inspected, `
  + `nested tables such as tr.cityForms correctly excluded)`)
