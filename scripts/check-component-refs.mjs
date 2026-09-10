#!/usr/bin/env node
// ─── Every <Component> in JSX actually resolves ─────────────────────────────
//
//   npm run refs:check
//
// WHY THIS EXISTS, and it is one specific failure: a file that PARSES but does not RESOLVE.
//
// On 2026-09-10 a scripted edit to screens/DormPartnerScreen.js sliced from one component
// to another and silently deleted three in between — SourceLink, DormServiceRow and
// DormRouteCard — all still referenced in JSX. The file parsed cleanly. `esbuild` reported
// success. Every guard in this repo passed it. It would have thrown a ReferenceError the
// moment the screen rendered, because an undefined component is a RUNTIME error and not a
// syntax one.
//
// PARSING IS NOT RESOLUTION. That is the whole lesson, and it generalises past that file:
// a scripted edit to a component needs a reference check the same way a scripted edit to
// verify_schema.sql needs a paren check.
//
// ⚠ THIS CHECKER NEEDS THE SAME SCRUTINY AS WHAT IT CHECKS. Its first version reported
//   `Marker` as undefined — a false positive, because `import MapView, { Marker } from ...`
//   puts the braces after a default import and the regex required them straight after
//   `import`. A checker that cries wolf gets ignored, and this one is scanning every screen
//   in the app. Run it with --self, which mutates real files in memory and requires each
//   class of break to be caught.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['screens', 'components']
const FILES = ['App.js']

// Lowercase tags are host elements; `<>` is a fragment. Neither needs a binding.
// These are the globals JSX transforms and RN provide without an import.
const AMBIENT = new Set(['React', 'Fragment'])

function walk(d) {
  const abs = resolve(ROOT, d)
  let out = []
  for (const n of readdirSync(abs)) {
    const rel = join(d, n)
    if (statSync(resolve(ROOT, rel)).isDirectory()) out = out.concat(walk(rel))
    else if (/\.jsx?$/.test(n)) out.push(rel)
  }
  return out
}

// Strip comments, string/template literals AND regex literals. All three matter: a comment
// discussing `<Foo />`, a string containing "<Foo", and a regex like
// /<Resmi_Kur>[\s\S]*?<\/Resmi_Kur>/ would each register as a JSX reference that does not
// exist.
//
// ⚠ THE REGEX CASE IS NOT HYPOTHETICAL — it was this checker's second false positive.
//   screens/ExchangeRatesScreen.js parses the KKTC central bank's XML with exactly that
//   pattern, and the first version reported <Resmi_Kur> as an undefined component. Two
//   false positives in a checker whose whole job is to be believed is the argument for
//   --self, not a footnote.
//
// Telling a regex literal from division needs context: a `/` starts a regex only where an
// operand cannot appear. Tracking the previous meaningful character is enough here.
//
// ⚠ `<` AND `>` ARE DELIBERATELY NOT IN THIS SET, and leaving them in was this checker's
//   THIRD false positive — the worst of the three, because it was silent. In JSX, `</` is a
//   CLOSING TAG. Treating `<` as a position where a regex may start made `</SafeAreaView>`
//   look like a regex opening, and the scan then swallowed everything to the next `/`.
//   screens/EstateAgentOnboardingScreen.js lost 5,932 of its 20,583 characters — 29% —
//   including the `function Field` declaration that its own JSX references. The checker
//   then reported <Field> as undefined, which looked exactly like a real bug and was not.
//
//   Three false positives in one afternoon, in a tool whose only value is being believed.
//   That is the argument for --self covering each class, not a footnote to it.
const REGEX_OK_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^'])
function strip(src, trace) {
  let out = '', i = 0, prev = ''
  const prevWord = () => /(?:^|[^\w$])(return|typeof|instanceof|in|of|case|do|else|yield|await)$/.test(out.trimEnd())
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j === -1 ? src.length : j; continue }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j === -1 ? src.length : j + 2; out += ' '; continue }
    // `/>` is a JSX self-closing tag, never a regex — and this was false positive FOUR.
    // `<Ionicons size={16} />` leaves prev === '}', which is a legitimate place for a regex
    // to start, so every self-closing tag opened a phantom regex that swallowed the file to
    // the next '/'. That is what actually ate EstateAgentOnboardingScreen, not the closing
    // tags: removing '<' from the set above was a real fix for a real case, and it was not
    // this case.
    if (c === '/' && src[i + 1] !== '>' && (prev === '' || REGEX_OK_AFTER.has(prev) || prevWord())) {
      let j = i + 1, inClass = false
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) break
        else if (src[j] === '\n') { j = -1; break }
        j++
      }
      if (j > 0 && j < src.length) { trace?.push(['regex', i, j + 1]); i = j + 1; while (/[gimsuyd]/.test(src[i] || '')) i++; out += '//'; prev = '/'; continue }
    }
    // ⚠ AN APOSTROPHE IN JSX TEXT IS NOT A STRING, and this was false positive FIVE — the
    //   one that actually ate EstateAgentOnboardingScreen. `You'll receive a notification`
    //   sits in JSX text, the scanner read the apostrophe as an opening quote, and it ran
    //   510 characters to the next one — straight past the `function Field` declaration its
    //   own JSX references.
    //
    //   The fix is principled rather than a special case: a ' or " literal CANNOT contain a
    //   raw newline in JavaScript. Only a template literal can. So a quote with no partner
    //   before the line ends was never a string, and is emitted as an ordinary character.
    if (c === "'" || c === '"' || c === '`') {
      const q = c; const start = i
      let j = i + 1, closed = false
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === q) { closed = true; break }
        if (src[j] === '\n' && q !== '`') break   // ' and " do not span lines
        j++
      }
      if (!closed) { out += c; prev = c; i++; continue }
      i = j + 1
      trace?.push(['string' + q, start, i])
      out += '""'
      prev = '"'
      continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

function bindings(src) {
  const b = new Set(AMBIENT)
  // import Foo from '...'   /   import Foo, { A, B as C } from '...'
  for (const m of src.matchAll(/^\s*import\s+([A-Za-z_$][\w$]*)/gm)) b.add(m[1])
  // any { ... } that precedes a `from` — covers both `import {A}` and `import D, {A}`
  for (const m of src.matchAll(/\{([^{}]*)\}\s*from\s*['"]/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (n) b.add(n)
    }
  }
  // import * as NS from '...'
  for (const m of src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) b.add(m[1])
  // local declarations, at any indent: function Foo / const Foo = / class Foo
  for (const m of src.matchAll(/(?:^|\s)(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) b.add(m[1])
  for (const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) b.add(m[1])
  // destructured locals: const { Foo, Bar } = ... — no `from`, so the import rule misses it
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':').pop().trim()
      if (n) b.add(n)
    }
  }
  // function parameters, including destructured props that are rendered as components
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const n = part.trim().split(':').pop().split('=')[0].trim()
      if (n) b.add(n)
    }
  }
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const n = part.trim().split(':').pop().split('=')[0].trim()
      if (n) b.add(n)
    }
  }
  return b
}

// A JSX reference: `<Name` or `<Name.Member`. Only the root binding must exist.
function references(src) {
  const r = new Map()
  for (const m of src.matchAll(/<\s*([A-Z][\w$]*)(\.[\w$]+)*/g)) {
    const name = m[1]
    if (!r.has(name)) r.set(name, src.slice(0, m.index).split('\n').length)
  }
  return r
}

function analyse(rel, raw) {
  const src = strip(raw)
  const have = bindings(src)
  const missing = []
  for (const [name, line] of references(src)) if (!have.has(name)) missing.push({ name, line })
  return missing
}

// --debug <file> <needle>: show whether a token survives strip(), and what consumed it.
// The checker's own code path, not a re-implementation — the whole reason its four false
// positives took as long as they did was diagnosing them against a copy.
if (process.argv[2] === '--debug') {
  const file = process.argv[3], needle = process.argv[4] || 'function Field'
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  const st = strip(raw)
  console.log(`raw has ${JSON.stringify(needle)}:`, raw.includes(needle))
  console.log(`stripped has it:`, st.includes(needle))
  if (!st.includes(needle)) {
    // Walk forward comparing, to find the first offset where the output stops tracking.
    const at = raw.indexOf(needle)
    console.log('raw offset of the needle:', at)
    let lo = 0, hi = raw.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (strip(raw.slice(0, mid)).includes(needle)) hi = mid
      else lo = mid + 1
    }
    console.log('smallest prefix that still contains it:', lo, lo > at ? '(so something BEFORE it consumes it)' : '')
    console.log('context at the loss point:', JSON.stringify(raw.slice(Math.max(0, at - 120), at + 20)))
    const tr = []
    strip(raw, tr)
    const eating = tr.filter(([, a, b]) => a < at && b > at)
    console.log('\nspans that swallow the needle:', eating.length)
    for (const [kind, a, b] of eating) {
      console.log(`  ${kind}  ${a}..${b}  (${b - a} chars)`)
      console.log(`    opens: ${JSON.stringify(raw.slice(a, a + 90))}`)
    }
  }
  process.exit(0)
}

const targets = [...DIRS.flatMap(walk), ...FILES]
const SELF = process.argv.includes('--self')

if (!SELF) {
  let problems = 0, refs = 0
  for (const rel of targets) {
    const raw = readFileSync(resolve(ROOT, rel), 'utf8')
    refs += references(strip(raw)).size
    for (const { name, line } of analyse(rel, raw)) {
      console.error(`  ✗ ${rel}:${line}  <${name}> is referenced but never defined or imported`)
      problems++
    }
  }
  if (problems) {
    console.error(`\n  component refs: ${problems} unresolved reference(s).`)
    console.error(`  These PARSE. An undefined component is a runtime ReferenceError, so the screen`)
    console.error(`  crashes on first render and no syntax check sees it coming.\n`)
    process.exit(1)
  }
  console.log(`component refs: OK (${targets.length} files · ${refs} JSX component reference(s) all resolve)`)
  process.exit(0)
}

// ─── --self: every class of break must be caught ────────────────────────────
const probe = 'screens/DormPartnerScreen.js'
const base = readFileSync(resolve(ROOT, probe), 'utf8')
const CASES = [
  ['a defined component is deleted',
   s => s.replace(/function DormRouteCard\([\s\S]*?\n\}\n/, ''), 'DormRouteCard'],
  ['a default import is removed',
   s => s.replace(/^import BackButton from .*$/m, ''), 'BackButton'],
  ['a NAMED import beside a default is removed (the Marker false-positive case)',
   s => s.replace("import MapView, { Marker } from 'react-native-maps'", "import MapView from 'react-native-maps'"), 'Marker'],
  ['a named import from a braces list is removed',
   s => s.replace(/import \{ Ionicons \} from '@expo\/vector-icons'/, "import { } from '@expo/vector-icons'"), 'Ionicons'],
]

// ─── The FALSE-POSITIVE cases. A checker is only worth running if it is believed, and
//     these are the three ways this one has already cried wolf. Each must stay clean.
const NEGATIVES = [
  ['a JSX closing tag is not a regex (</SafeAreaView> ate 29% of a file)',
   'screens/EstateAgentOnboardingScreen.js'],
  ['an XML tag inside a regex literal is not a component (<Resmi_Kur>)',
   'screens/ExchangeRatesScreen.js'],
  ['a named import beside a default binds (import MapView, { Marker })',
   'screens/DormPartnerScreen.js'],
  ['a self-closing tag is not a regex (`size={16} />` ate a file)',
   'screens/PropertyDetailScreen.js'],
  ["an apostrophe in JSX text is not a string (You'll … ate 510 chars)",
   'screens/EstateAgentOnboardingScreen.js'],
]
let ok = 0
console.log('\n  ── --self: each break must be caught ──')
for (const [label, mutate, expect] of CASES) {
  const mutated = mutate(base)
  if (mutated === base) { console.log(`  ✗ ${label}: THE BREAK DID NOT LAND — this case proves nothing`); continue }
  const found = analyse(probe, mutated).map(m => m.name)
  const caught = found.includes(expect)
  console.log(`  ${caught ? 'ok' : '✗ '} ${label}${caught ? '' : `  (expected <${expect}>, found ${JSON.stringify(found)})`}`)
  if (caught) ok++
}
// And the control: the UNMUTATED file must be clean, or every result above is noise.
const clean = analyse(probe, base)
console.log(`  ${clean.length === 0 ? 'ok' : '✗ '} control: the real file resolves${clean.length ? ` (found ${JSON.stringify(clean)})` : ''}`)

console.log('\n  ── the five false positives this checker has already produced ──')
let negOk = 0
for (const [label, file] of NEGATIVES) {
  const found = analyse(file, readFileSync(resolve(ROOT, file), 'utf8'))
  const good = found.length === 0
  console.log(`  ${good ? 'ok' : '✗ '} ${label}${good ? '' : `  -> ${JSON.stringify(found)}`}`)
  if (good) negOk++
}
const pass = ok === CASES.length && clean.length === 0 && negOk === NEGATIVES.length
console.log(`\n  ${pass ? `${CASES.length} break classes caught, ${NEGATIVES.length} false-positive classes stay clean.` : 'SELF-TEST FAILED'}\n`)
process.exit(pass ? 0 : 1)
