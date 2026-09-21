#!/usr/bin/env node
// ─── utils/photoAttribution.js — behaviour lock ──────────────────────────────
//
//   node scripts/validate-photo-attribution.mjs
//
// Exists because the two failure modes here are both SILENT and both legal, not
// cosmetic:
//
//   1. A legacy row (photo_attribution NULL) rendering an EMPTY credit line. Nothing
//      throws, nothing looks broken in review — a blank strip under the photo reads as
//      a styling bug and survives for months.
//   2. photo_credits and photo_attribution DISAGREEING, so the shipped renderer shows
//      one attribution and the new one shows another for the same photo. The round-trip
//      case at the bottom is the guard: the derived legacy string must re-parse to the
//      entry that produced it.
//
// ⚠ THIS FILE IS ONLY EVIDENCE IF IT HAS BEEN SEEN TO GO RED. Three breaks were applied
//   and each was watched to fail, with the exact counts:
//     • resolveAttribution returning {credit:''} instead of null → 7 fail (null-safety)
//     • legacyCreditString dropping the license-URI clause       → 3 fail (en, tr, round-trip)
//     • photo_attribution ignored so photo_credits wins          → 2 fail (url-key precedence)
//     • photo_attribution dropped from BROWSE_COLS                → 1 fail (select coverage)
//     • photo_attribution dropped from HomeScreen's PLACE_COLS    → 1 fail (2026-09-14, after
//       the resolver fix below; before it, this check was red on a CORRECT HomeScreen)
//   A fourth "break" was attempted first and is worth recording: the sed that was
//   supposed to apply break 2 silently did not match, the suite printed 18/18, and that
//   green was almost written down as proof. A break that does not break proves nothing —
//   the patch step now aborts loudly if its replacement finds no match.

import { resolveAttribution, legacyCreditString } from '../utils/photoAttribution.js'

const U = 'https://x/1.jpg'
let pass = 0, fail = 0
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`) }
}

console.log('\n— null / legacy safety: must not crash, must not render a blank line —')
is('null place',           resolveAttribution(null, U, 0), null)
is('undefined everything', resolveAttribution({}, undefined, undefined), null)
is('legacy row, no data',  resolveAttribution({ photo_attribution: null, photo_credits: [] }, U, 0), null)
is('whitespace credit',    resolveAttribution({ photo_credits: ['   '] }, U, 0), null)
is('empty attribution {}', resolveAttribution({ photo_attribution: { [U]: {} }, photo_credits: [] }, U, 0), null)
is('non-object entry',     resolveAttribution({ photo_attribution: { [U]: 'nope' } }, U, 0), null)
is('index out of range',   resolveAttribution({ photo_credits: ['a / b'] }, U, 9), null)

console.log('\n— legacy photo_credits fallback (by index) —')
is('classic format',
  resolveAttribution({ photo_credits: ['Photo: Julian Nyča / CC BY-SA 3.0'] }, U, 0),
  { credit: 'Julian Nyča', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', sourceUrl: null, source: null })
is('full-notice, Turkish',
  resolveAttribution({ photo_credits: ['Fotoğraf: Michal Klajban / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0'] }, U, 0),
  { credit: 'Michal Klajban', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: null, source: null })
is('bare name, no license',
  resolveAttribution({ photo_credits: ['Berke Üstün'] }, U, 0),
  { credit: 'Berke Üstün', license: null, licenseUrl: null, sourceUrl: null, source: null })

console.log('\n— photo_attribution wins, and is keyed by URL not index —')
const P = {
  photos: [U, 'https://x/2.jpg'],
  photo_credits: ['Photo: WRONG / CC BY 2.0'],
  photo_attribution: { [U]: {
    credit: 'Mike McBey', license: 'CC BY 2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    source_url: 'https://commons.wikimedia.org/wiki/File:X', source: 'commons' } },
}
is('url key beats index',
  resolveAttribution(P, U, 0),
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X', source: 'commons' })
is('unkeyed photo falls to index',
  resolveAttribution(P, 'https://x/2.jpg', 0),
  { credit: 'WRONG', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: null, source: null })
is('missing license_url is backfilled',
  resolveAttribution({ photo_attribution: { [U]: { credit: 'A', license: 'CC BY 4.0' } } }, U, 0),
  { credit: 'A', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: null, source: null })

console.log('\n— legacyCreditString: creator + license + license URI, no source page —')
is('en', legacyCreditString({ credit: 'Zairon', license: 'CC BY-SA 4.0' }, 'en'),
  'Photo: Zairon / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0')
is('tr', legacyCreditString({ credit: 'Zairon', license: 'CC BY-SA 4.0' }, 'tr'),
  'Fotoğraf: Zairon / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0')
is('own photography (no deed URL)', legacyCreditString({ credit: 'Berke Üstün', license: '© ADA' }, 'en'),
  'Photo: Berke Üstün / © ADA')
is('nothing to say', legacyCreditString({}, 'en'), null)

console.log('\n— ROUND TRIP: the two columns must never disagree —')
const e = { credit: 'Mike McBey', license: 'CC BY 2.0' }
is('derived string re-parses to its source entry',
  resolveAttribution({ photo_credits: [legacyCreditString(e, 'tr')] }, U, 0),
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', sourceUrl: null, source: null })


// ─── The column must actually be SELECTED, or none of the above ever runs ────
//
// ExploreProfileScreen takes `place` as a PROP and never re-queries, so the attribution
// renderer can only see what the feeding select asked for. Omit photo_attribution and
// every code path above still passes while the app silently renders the legacy fallback
// and drops the source link — a populated branch that is never once executed.
//
// This is not hypothetical. It is what happened to PropertyDetailScreen's contact bar:
// built, shipped and verified against an embed that selected none of its columns. The
// bug surfaced only when real data arrived. Asserting the select text is crude, but it
// is the difference between a guard and a hope.
//
// ⚠ IT READS THE ARGUMENT OF THE SELECT, NOT THE TEXT NEAR IT. The first version scanned
//   1400 chars after a marker for the two column names. HomeScreen.js then moved its column
//   list into a PLACE_COLS constant declared ~180 lines above the query, the scan window no
//   longer contained it, and from 2026-09-03 (28a0f32) the check reported "select omits
//   photo_attribution" against a select that included it. Two journal entries recorded that
//   as an app defect. It was a frame-of-reference failure in this check: the window read
//   one place, the query read another. (Fixed 2026-09-14.)
//
//   So: anchor on the query, require `.select(` to follow it directly, and resolve the
//   argument. A string literal is tested as written. A bare identifier is resolved to a
//   `const` in the same file whose initializer is string literals joined by `+`. ANYTHING
//   ELSE — an import, a call, a template with ${} — FAILS and prints what it read. An
//   argument this check cannot see through is not evidence the column is selected.
import { readFileSync as _read } from 'node:fs'
import { resolve as _resolve, dirname as _dirname } from 'node:path'
import { fileURLToPath as _url } from 'node:url'

const ANCHOR = "supabase.from('places')"

// Reads `'a' + "b" + `c`` starting at s[0]. Returns the joined text, or null for anything
// that is not purely string literals.
function readLiteralChain(s) {
  let i = 0, out = ''
  for (;;) {
    while (/\s/.test(s[i] ?? '')) i++
    const q = s[i]
    if (q !== "'" && q !== '"' && q !== '`') return null
    let j = i + 1, lit = ''
    while (j < s.length && s[j] !== q) {
      if (s[j] === '\\') { lit += s[j + 1]; j += 2; continue }
      lit += s[j++]
    }
    if (j >= s.length) return null
    if (q === '`' && lit.includes('${')) return null
    out += lit
    i = j + 1
    while (/\s/.test(s[i] ?? '')) i++
    if (s[i] !== '+') return out
    i++
  }
}

// → { cols } on success, { why } on failure. Never guesses.
function resolveSelectedCols(src) {
  const a = src.indexOf(ANCHOR)
  if (a === -1) return { why: `anchor ${ANCHOR} not found` }
  const after = src.slice(a + ANCHOR.length)
  const m = /^\s*\.select\(\s*/.exec(after)
  if (!m) return { why: `no .select( directly after the anchor — read: ${JSON.stringify(after.slice(0, 60))}` }
  const arg = after.slice(m[0].length)
  if (/^['"`]/.test(arg)) {
    const cols = readLiteralChain(arg)
    return cols == null ? { why: `unreadable literal — read: ${JSON.stringify(arg.slice(0, 60))}` } : { cols }
  }
  const id = /^([A-Za-z_$][\w$]*)\s*\)/.exec(arg)
  if (!id) return { why: `select argument is neither a literal nor a bare identifier — read: ${JSON.stringify(arg.slice(0, 60))}` }
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${id[1]}\\s*=`).exec(src)
  if (!decl) return { why: `${id[1]} is not declared as a const in this file` }
  const cols = readLiteralChain(src.slice(decl.index + decl[0].length))
  return cols == null ? { why: `${id[1]} is not a plain string-literal initializer` } : { cols, via: id[1] }
}

const hasCol = (cols, c) => new RegExp(`(^|[\\s,(])${c}($|[\\s,)])`).test(cols)
const coverage = src => {
  const r = resolveSelectedCols(src)
  if (r.why) return { ok: false, why: r.why }
  const missing = ['photo_credits', 'photo_attribution'].filter(c => !hasCol(r.cols, c))
  return missing.length
    ? { ok: false, why: `select${r.via ? ` (via ${r.via})` : ''} omits ${missing.join(', ')} — read: ${JSON.stringify(r.cols)}` }
    : { ok: true, via: r.via }
}

// The resolver must be seen to go red on every shape it refuses, every run — not once, in
// a session nobody can replay. A fixture that gets the wrong verdict is a failure.
console.log('\n— select resolver: fixtures (each must get the verdict on the left) —')
for (const [want, name, src] of [
  [true,  'inline literal',                    "supabase.from('places').select('id, photo_credits, photo_attribution')"],
  [true,  'const, concatenated, declared above', "const C =\n  'id, photo_credits, ' +\n  'photo_attribution'\n\nx = supabase.from('places')\n  .select(C).eq('s', 1)"],
  [false, 'const that omits photo_attribution',  "const C = 'id, photo_credits'\nsupabase.from('places').select(C)"],
  [false, 'column only in a nearby comment',     "// photo_credits photo_attribution\nsupabase.from('places').select('id')"],
  [false, 'look-alike column name',              "supabase.from('places').select('id, photo_credits, photo_attribution_old')"],
  [false, 'identifier not declared here',        "import { C } from './x'\nsupabase.from('places').select(C)"],
  [false, 'template with interpolation',         "const C = `id, ${extra}, photo_credits, photo_attribution`\nsupabase.from('places').select(C)"],
  [false, 'anchor absent',                       "supabase.from('events').select('photo_credits, photo_attribution')"],
]) {
  const got = coverage(src).ok
  if (got === want) { pass++; console.log(`  ok   ${want ? 'pass' : 'FAIL'} ← ${name}`) }
  else { fail++; console.log(`  FAIL ${name}: expected ${want ? 'pass' : 'FAIL'}, got ${got ? 'pass' : 'FAIL'} (${coverage(src).why ?? 'resolved'})`) }
}

const _root = _resolve(_dirname(_url(import.meta.url)), '..')
console.log('\n— photo_attribution must be in every select that feeds the detail screen —')
for (const file of ['screens/ExploreScreen.js', 'screens/HomeScreen.js']) {
  const r = coverage(_read(_resolve(_root, file), 'utf8'))
  if (r.ok) { pass++; console.log(`  ok   ${file} selects photo_attribution${r.via ? ` (via ${r.via})` : ''}`) }
  else {
    fail++
    console.log(`  FAIL ${file} — ${r.why}`)
    console.log('       The detail screen never re-queries; an omitted column can never render.')
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
