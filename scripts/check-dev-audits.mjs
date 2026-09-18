#!/usr/bin/env node
// ─── The two crashes this exists to prevent ─────────────────────────────────
//
// The __DEV__ UI audits (utils/devTextAudit.js, utils/devSafeAreaAudit.js, utils/devRoot.js)
// reach into React Native to wrap components. That is what lets them watch all 72 files
// that render text without editing any of them — and it is also why they took the whole
// app down twice in two days, both times in a way no bundle check could see:
//
//   1. `require(path)` with a VARIABLE. Metro resolves dependencies statically, so this
//      did not fail at runtime — it failed the BUNDLE, for the entire app:
//        Error: utils/devSafeAreaAudit.js: Invalid call at line 119: require(path)
//
//   2. `TextModule.default = Audited`. Babel compiles `export default` to an accessor with
//      no setter, so this threw at import time and the app never started:
//        TypeError: Cannot assign to property 'default' which has only a getter
//      (The fix is Object.defineProperty on the PUBLIC react-native export, whose
//      object-literal getter is configurable. See utils/devTextAudit.js.)
//
//   3. Deep imports (`react-native/Libraries/...`) also print four deprecation warnings
//      per launch and drag the module body in even when the audit is switched off.
//
// Each was found by a human launching the app and pasting an error back. This finds all
// three at commit time instead.
//
// ► COMMENTS AND STRINGS ARE STRIPPED BEFORE SCANNING, and that is not a nicety.
//   The files under test QUOTE these exact error messages in their own headers, to explain
//   why the code is shaped the way it is. A naive text scan matches that prose and reports
//   a failure on a correct file — which happened twice while verifying the fixes, and cost
//   real time both times. A checker that cannot tell code from a comment about code is the
//   instrument-versus-system trap this repo has a standing rule about.

import { readFileSync, existsSync } from 'node:fs'

// Accepts paths on the command line so the rules can be pointed at anything — including a
// pre-fix version extracted from git history, which is how they were shown to go red on the
// two real outages rather than only on the snippets in SELF_TEST.
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'utils/devTextAudit.js',
  'utils/devSafeAreaAudit.js',
  'utils/devRoot.js',
  'utils/textAuditVerdict.js',
  'index.js',
]

// Replace comment and string bodies with spaces, preserving offsets so line numbers stay
// true. Hand-rolled rather than regex'd: a regex that "removes comments" also removes the
// contents of any string containing // or /*, which is how these scanners usually break.
export function stripCommentsAndStrings(src) {
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; blank(i, Math.min(j + 2, n)); i = j + 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        j++
      }
      blank(i + 1, j)
      i = j + 1
      continue
    }
    i++
  }
  return out.join('')
}

// Comments only, strings PRESERVED. The deep-import rule looks for a path INSIDE a string
// literal, so it cannot run on source whose string bodies have been blanked — the thing it
// searches for is exactly what that blanking removes. Found by this file's own self-test,
// which is the entire argument for having one.
export function stripCommentsOnly(src) {
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; blank(i, Math.min(j + 2, n)); i = j + 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        j++
      }
      i = j + 1
      continue
    }
    i++
  }
  return out.join('')
}

const RULES = [
  {
    name: 'no dynamic require',
    scan: 'code',
    // require( followed by anything that is not a quote — after stripping, a literal's
    // BODY is blanked but its quotes remain, so `require(' ... ')` still matches a quote.
    re: /\brequire\s*\(\s*[^'"`\s)]/g,
    why: 'Metro resolves dependencies statically. A non-literal require fails the BUNDLE, for the whole app.',
    fix: 'Use a literal path. To keep a table, wrap each literal in a thunk: () => require(\'react-native\').',
  },
  {
    name: 'no assignment to a module export',
    scan: 'code',
    re: /\b(?:require\s*\([^)]*\)|[A-Za-z_$][\w$]*Module)\s*\.\s*default\s*=(?!=)/g,
    why: 'Babel compiles `export default` to an accessor with no setter AND configurable:false. Assigning throws at import time and the app never starts.',
    fix: "Object.defineProperty(require('react-native'), 'Name', { value, configurable: true, ... }) — the public export is an object-literal getter and IS configurable.",
  },
  {
    name: 'no deep import of react-native internals',
    scan: 'strings',
    re: /['"`]react-native\/Libraries\//g,
    why: 'Deep imports are deprecated, print a warning per target on every launch, and pull the module body in even when the audit is switched off.',
    fix: "Use the public export: require('react-native').Pressable.",
  },
]

let failures = 0
console.log('\n── dev UI audits: the three ways they have broken the app ──\n')

for (const rel of FILES) {
  if (!existsSync(rel)) { console.log(`  SKIP  ${rel} (not present)`); continue }
  const raw = readFileSync(rel, 'utf8')
  const sources = { code: stripCommentsAndStrings(raw), strings: stripCommentsOnly(raw) }
  const hits = []
  for (const rule of RULES) {
    const src = sources[rule.scan]
    rule.re.lastIndex = 0
    let m
    while ((m = rule.re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length
      hits.push({ rule, line, text: raw.split('\n')[line - 1].trim() })
    }
  }
  if (hits.length === 0) { console.log(`  OK    ${rel}`); continue }
  failures += hits.length
  console.log(`  FAIL  ${rel}`)
  for (const h of hits) {
    console.log(`          line ${h.line}: ${h.rule.name}`)
    console.log(`            ${h.text}`)
    console.log(`            why: ${h.why ?? h.rule.why}`)
    console.log(`            fix: ${h.rule.fix}`)
  }
}

// A checker that has never been watched go red is a decoration. This one proves, on every
// run, that each rule still fires on the exact code that caused each outage — and that the
// comment-stripping keeps it from firing on prose describing them.
const SELF_TEST = [
  ['no dynamic require',                       'const m = require(path)',                        true],
  ['no dynamic require',                       "const m = require('react-native')",              false],
  ['no assignment to a module export',         'TextModule.default = Audited',                   true],
  ['no assignment to a module export',         "require('react-native/x').default = Audited",    true],
  ['no assignment to a module export',         "Object.defineProperty(RN, 'Text', { value: A })", false],
  ['no deep import of react-native internals', "require('react-native/Libraries/Text/Text')",    true],
  ['no deep import of react-native internals', "require('react-native')",                        false],
  ['no dynamic require',                       '// Error: Invalid call at line 119: require(path)', false],
  ['no assignment to a module export',         '// it threw on TextModule.default = Audited',    false],
  ['no deep import of react-native internals', '// never react-native/Libraries/... again',      false],
]
let selfFail = 0
for (const [ruleName, snippet, shouldFire] of SELF_TEST) {
  const rule = RULES.find(r => r.name === ruleName)
  rule.re.lastIndex = 0
  const prepared = rule.scan === 'strings' ? stripCommentsOnly(snippet) : stripCommentsAndStrings(snippet)
  const fired = rule.re.test(prepared)
  if (fired !== shouldFire) {
    selfFail++
    console.log(`\n  SELF-TEST BROKEN: "${snippet}" should ${shouldFire ? '' : 'NOT '}fire ${ruleName}`)
  }
}

if (selfFail) {
  console.log(`\n  ${selfFail} self-test(s) failed — the CHECKER is wrong, fix it before trusting any result above.\n`)
  process.exit(1)
}
console.log(`\n  self-test: ${SELF_TEST.length}/${SELF_TEST.length} — every rule fires on the real outage and stays silent on prose about it.`)

if (failures) {
  console.log(`\n  ${failures} violation(s). Each one is an app that does not start.\n`)
  process.exit(1)
}
console.log('  clean.\n')
