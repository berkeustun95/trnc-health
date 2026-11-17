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
import { creditParts } from '../utils/photoCreditParts.js'

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
  { credit: 'Julian Nyča', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', sourceUrl: null, source: null, edited: true })
is('full-notice, Turkish',
  resolveAttribution({ photo_credits: ['Fotoğraf: Michal Klajban / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0'] }, U, 0),
  { credit: 'Michal Klajban', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: null, source: null, edited: true })
is('bare name, no license',
  resolveAttribution({ photo_credits: ['Berke Üstün'] }, U, 0),
  { credit: 'Berke Üstün', license: null, licenseUrl: null, sourceUrl: null, source: null, edited: true })

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
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X', source: 'commons', edited: true })
is('unkeyed photo falls to index',
  resolveAttribution(P, 'https://x/2.jpg', 0),
  { credit: 'WRONG', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: null, source: null, edited: true })
is('missing license_url is backfilled',
  resolveAttribution({ photo_attribution: { [U]: { credit: 'A', license: 'CC BY 4.0' } } }, U, 0),
  { credit: 'A', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: null, source: null, edited: true })

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
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', sourceUrl: null, source: null, edited: true })

console.log('\n— edited: the seed pipeline re-encodes every third-party photo —')
const ent = x => ({ photo_attribution: { [U]: { credit: 'A', license: 'CC BY 4.0', ...x } } })
is('commons entry -> edited',      resolveAttribution(ent({ source: 'commons' }), U, 0)?.edited, true)
is('unsplash entry -> edited',     resolveAttribution(ent({ source: 'unsplash' }), U, 0)?.edited, true)
is('no source on entry -> edited', resolveAttribution(ent({}), U, 0)?.edited, true)
is('own -> not edited',            resolveAttribution(ent({ source: 'own' }), U, 0)?.edited, false)
is('own + modified:true -> edited', resolveAttribution(ent({ source: 'own', modified: true }), U, 0)?.edited, true)
is('commons + modified:false -> not edited', resolveAttribution(ent({ source: 'commons', modified: false }), U, 0)?.edited, false)
is('legacy string -> edited',      resolveAttribution({ photo_credits: ['Photo: A / CC BY 4.0'] }, U, 0)?.edited, true)
is('null attribution stays null',  resolveAttribution({ photo_attribution: null, photo_credits: [] }, U, 0), null)


console.log('\n— malformed data: resolver returns null or a fully typed object, never throws —')
const SRC = ['commons', 'unsplash', 'pexels', 'own']
const httpsOrNull = v => v === null || (typeof v === 'string' && /^https:\/\/\S/.test(v) && v.length <= 2048)
const shapeOk = r => r === null || (
  Object.keys(r).join() === 'credit,license,licenseUrl,sourceUrl,source,edited' && typeof r.edited === 'boolean' &&
  typeof r.credit === 'string' && r.credit.length > 0 && r.credit.length <= 120 &&
  (r.license === null || (typeof r.license === 'string' && r.license.length <= 40)) &&
  httpsOrNull(r.licenseUrl) && httpsOrNull(r.sourceUrl) && (r.source === null || SRC.includes(r.source)))
const partsOk = p => Object.keys(p).join() === 'line,license,licenseUrl,sourceLabel,sourceUrl' &&
  Object.values(p).every(v => v === null || typeof v === 'string') && httpsOrNull(p.licenseUrl) && httpsOrNull(p.sourceUrl)
const safe = fn => { try { return { r: fn() } } catch (err) { return { err: String(err) } } }
const check = (name, place, url = U, index = 0) => {
  const o = safe(() => resolveAttribution(place, url, index))
  const ok = !o.err && shapeOk(o.r)
  const p = ok && o.r ? safe(() => creditParts(o.r, 'Turkish')) : { r: {} }
  const pOk = !p.err && (o.r === null || partsOk(p.r))
  if (ok && pOk) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       ${(o.err ?? JSON.stringify(o.r)).slice(0, 160)} ${(p.err ?? JSON.stringify(p.r)).slice(0, 160)}`) }
  return o
}
const nullFor = (name, place, url, index) => { const o = check(name, place, url, index); is(`${name} → null`, o.err ? 'threw' : o.r, null) }
const one = e => ({ photo_attribution: { [U]: e } })

for (const [n, v] of [['array', []], ['string', 'x'], ['number', 7], ['null', null]])
  nullFor(`attribution as ${n}`, { photo_attribution: v, photo_credits: [] })
for (const [n, v] of [['array', ['a']], ['string', 'nope'], ['null', null]])
  nullFor(`entry as ${n}`, one(v))
for (const [n, v] of [['number', 5], ['object', { a: 1 }], ['empty', '  ']])
  nullFor(`credit as ${n}`, one({ credit: v }))
is('entry as string falls to legacy', resolveAttribution({ photo_attribution: { [U]: 'x' }, photo_credits: ['Photo: A / CC BY 4.0'] }, U, 0)?.credit, 'A')

for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  const o = check(`license names inherited member ${k}`, one({ credit: 'A', license: k }))
  is(`  licenseUrl null for ${k}`, o.r?.licenseUrl, null)
  const l = check(`legacy licence part names inherited member ${k}`, { photo_credits: [`Photo: A / ${k}`] })
  is(`  legacy licenseUrl null for ${k}`, l.r?.licenseUrl, null)
  const q = check(`source names inherited member ${k}`, one({ credit: 'A', source: k }))
  is(`  source null for ${k}`, q.r?.source, null)
  const sp = creditParts({ credit: 'A', license: null, licenseUrl: null, sourceUrl: null, source: k }, 'Turkish')
  is(`  creditParts sourceLabel null for ${k}`, sp.sourceLabel, null)
}
for (const k of ['__proto__', 'constructor', 'toString']) {
  const pa = JSON.parse(`{"${k}": {"credit": "A"}}`)
  nullFor(`photo URL key ${k} not in data`, { photo_attribution: {} }, k, 0)
  const o = check(`photo URL key ${k} present as own key`, { photo_attribution: pa }, k, 0)
  is(`  own key ${k} resolves`, o.r?.credit, 'A')
}
nullFor('photo URL key __proto__ on empty plain object', { photo_attribution: {} }, '__proto__', 0)

const BAD_URLS = [
  ['http://', 'http://example.org/x'], ['other scheme', 'javascript:alert(1)'], ['other scheme 2', 'data:text/plain,x'],
  ['relative', '/licenses/by/4.0/'], ['scheme-relative', '//example.org/x'], ['number', 5], ['newline', 'https://example.org/a\nb'],
  ['space', 'https://example.org/a b'], ['5000 chars', 'https://example.org/' + 'a'.repeat(5000)], ['object', { a: 1 }], ['array', ['https://example.org/']],
]
for (const [n, v] of BAD_URLS) {
  const o = check(`license_url ${n}`, one({ credit: 'A', license: 'X', license_url: v, source_url: v }))
  is(`  licenseUrl null (${n})`, o.r?.licenseUrl, null)
  is(`  sourceUrl null (${n})`, o.r?.sourceUrl, null)
}
is('https URL survives', resolveAttribution(one({ credit: 'A', source_url: 'https://example.org/x' }), U, 0)?.sourceUrl, 'https://example.org/x')
is('2048 chars survives', resolveAttribution(one({ credit: 'A', source_url: 'https://e.org/' + 'a'.repeat(2048 - 14) }), U, 0)?.sourceUrl?.length, 2048)

const LONG = resolveAttribution(one({ credit: 'Ü'.repeat(5000), license: 'L'.repeat(500) }), U, 0)
check('very long credit and licence', one({ credit: 'Ü'.repeat(5000), license: 'L'.repeat(500) }))
is('credit capped at 120 (ellipsis)', [LONG?.credit.length, LONG?.credit.endsWith('…')], [120, true])
is('over-long licence dropped', LONG?.license, null)
is('credit exactly 120 untouched', resolveAttribution(one({ credit: 'a'.repeat(120) }), U, 0)?.credit.length, 120)
is('licence exactly 40 untouched', resolveAttribution(one({ credit: 'a', license: 'l'.repeat(40) }), U, 0)?.license.length, 40)
check('legacy very long string', { photo_credits: ['Photo: ' + 'x'.repeat(100000) + ' / ' + 'y'.repeat(100000)] })

for (const [n, v] of [['number', 5], ['object', { credit: 'x' }], ['array', ['a']], ['null', null], ['boolean', true]])
  nullFor(`legacy photo_credits element as ${n}`, { photo_credits: [v] })
nullFor('photo_credits as string', { photo_credits: 'Photo: A / B' })
nullFor('photo_credits as object', { photo_credits: { 0: 'Photo: A / B' } })
for (const [n, str] of [
  ['http uri', 'Photo: A / CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/'],
  ['other scheme uri', 'Photo: A / CC BY 4.0 — ftp://creativecommons.org/licenses/by/4.0/'],
]) {
  const o = check(`legacy ${n}`, { photo_credits: [str] })
  is(`  legacy licenseUrl null (${n})`, o.r?.licenseUrl, null)
}
is('legacy no-scheme uri still gets https', resolveAttribution({ photo_credits: ['Photo: A / CC BY 4.0 — creativecommons.org/licenses/by/4.0'] }, U, 0)?.licenseUrl, 'https://creativecommons.org/licenses/by/4.0')

console.log('\n— malformed data: creditParts on unexpected input —')
for (const [n, a] of [
  ['extra fields', { credit: 'A', license: 'L', licenseUrl: 'https://e.org/', sourceUrl: 'https://e.org/', source: 'commons', extra: { x: 1 }, fn() {} }],
  ['non-string fields', { credit: 5, license: {}, licenseUrl: 5, sourceUrl: [], source: {} }],
  ['non-https links', { credit: 'A', license: 'L', licenseUrl: 'http://e.org/', sourceUrl: 'javascript:x', source: 'pexels' }],
]) {
  const p = safe(() => creditParts(a, 'Turkish'))
  const ok = !p.err && partsOk(p.r)
  if (ok) { pass++; console.log(`  ok   creditParts ${n}`) } else { fail++; console.log(`  FAIL creditParts ${n}\n       ${p.err ?? JSON.stringify(p.r)}`) }
}
is('creditParts well-formed (en)',
  creditParts({ credit: 'A', license: 'CC BY 4.0', licenseUrl: 'https://e.org/l', sourceUrl: 'https://e.org/s', source: 'commons' }, 'English'),
  { line: 'Photo: A', license: 'CC BY 4.0', licenseUrl: 'https://e.org/l', sourceLabel: 'Wikimedia Commons', sourceUrl: 'https://e.org/s' })
is('creditParts own source (en)', creditParts({ credit: 'A', source: 'own' }, 'English').sourceLabel, 'ADA original photo')


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
//
//   Since 2026-11-15 two more shapes resolve (ExploreScreen's `review ? \`${BROWSE_COLS}, status\` :
//   BROWSE_COLS` failed this check from e3b1c0b1, 2026-09-23, although both branches select the column):
//   - `cond ? A : B` — BOTH branches must resolve and BOTH must carry the columns, because either
//     one can be the query that runs. The condition is not read.
//   - a template literal whose every ${…} is a bare identifier resolving to a const as above.
//   Any other interpolation, a call, an import or an unbalanced argument still FAILS.
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

// The const NAME's initializer, if it is plain string literals joined by `+`; else null.
function constLiteral(src, name) {
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=`).exec(src)
  return decl ? readLiteralChain(src.slice(decl.index + decl[0].length)) : undefined
}

// The text of the first argument of a call whose `(` is just before s[0]: up to the top-level `,`
// or the matching `)`, skipping strings and nesting. null if it never closes.
function firstArg(s) {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      for (; j < s.length && s[j] !== c; j++) {
        if (s[j] === '\\') j++
        else if (c === '`' && s[j] === '$' && s[j + 1] === '{') {
          let d = 1; j += 2
          for (; j < s.length && d; j++) { if (s[j] === '{') d++; else if (s[j] === '}') d-- }
          j--
        }
      }
      if (j >= s.length) return null
      i = j; continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return s.slice(0, i); depth-- }
    else if (c === ',' && depth === 0) return s.slice(0, i)
  }
  return null
}

// Splits `cond ? A : B` at its top-level ? and : (outside strings and brackets). null if not a ternary.
function splitTernary(e) {
  let depth = 0, q = -1
  for (let i = 0; i < e.length; i++) {
    const c = e[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      for (; j < e.length && e[j] !== c; j++) if (e[j] === '\\') j++
      i = j; continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '?' && e[i + 1] !== '.' && e[i + 1] !== '?' && q === -1) q = i
    else if (depth === 0 && c === ':' && q !== -1) return [e.slice(q + 1, i), e.slice(i + 1)]
  }
  return null
}

// One select expression → { cols, via } or { why }. Literal, const, const-only template, or ternary.
function resolveExpr(src, raw) {
  const e = raw.trim()
  const t = splitTernary(e)
  if (t) {
    const sides = t.map(b => resolveExpr(src, b))
    const bad = sides.find(r => r.why)
    if (bad) return { why: `ternary branch unreadable: ${bad.why}` }
    return { branches: sides, via: sides.map(r => r.via || 'literal').join(' | ') }
  }
  if (e.startsWith('`')) {
    if (!e.endsWith('`')) return { why: `unreadable template — read: ${JSON.stringify(e.slice(0, 60))}` }
    let bad = null
    const cols = e.slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, inner) => {
      const name = inner.trim()
      const v = /^[A-Za-z_$][\w$]*$/.test(name) ? constLiteral(src, name) : null
      if (v == null) { bad ??= name; return '' }
      return v
    })
    if (bad != null) return { why: `template interpolates ${JSON.stringify(bad)}, which is not a plain string-literal const in this file` }
    return { cols, via: 'template' }
  }
  if (/^['"]/.test(e)) {
    const cols = readLiteralChain(e)
    return cols == null ? { why: `unreadable literal — read: ${JSON.stringify(e.slice(0, 60))}` } : { cols }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const cols = constLiteral(src, e)
    if (cols === undefined) return { why: `${e} is not declared as a const in this file` }
    return cols == null ? { why: `${e} is not a plain string-literal initializer` } : { cols, via: e }
  }
  return { why: `select argument is not a literal, a const, a const-only template or a ternary of those — read: ${JSON.stringify(e.slice(0, 60))}` }
}

// → { cols } / { branches } on success, { why } on failure. Never guesses.
function resolveSelectedCols(src) {
  const a = src.indexOf(ANCHOR)
  if (a === -1) return { why: `anchor ${ANCHOR} not found` }
  const after = src.slice(a + ANCHOR.length)
  const m = /^\s*\.select\(\s*/.exec(after)
  if (!m) return { why: `no .select( directly after the anchor — read: ${JSON.stringify(after.slice(0, 60))}` }
  const arg = firstArg(after.slice(m[0].length))
  if (arg == null) return { why: `select( never closes — read: ${JSON.stringify(after.slice(m[0].length, m[0].length + 60))}` }
  return resolveExpr(src, arg)
}

const hasCol = (cols, c) => new RegExp(`(^|[\\s,(])${c}($|[\\s,)])`).test(cols)
const coverage = src => {
  const r = resolveSelectedCols(src)
  if (r.why) return { ok: false, why: r.why }
  const flat = x => x.branches ? x.branches.flatMap(flat) : [x]
  for (const b of flat(r)) {
    const missing = ['photo_credits', 'photo_attribution'].filter(c => !hasCol(b.cols, c))
    if (missing.length) return { ok: false, why: `select${r.via ? ` (via ${r.via})` : ''} omits ${missing.join(', ')} in ${r.branches ? 'a ternary branch' : 'its columns'} — read: ${JSON.stringify(b.cols)}` }
  }
  return { ok: true, via: r.via }
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
  [true,  'ternary, both branches carry both',   "const C = 'id, photo_credits, photo_attribution'\nsupabase.from('places').select(r ? `${C}, status` : C).in('s', x)"],
  [false, 'ternary, one branch omits a column',  "const C = 'id, photo_credits, photo_attribution'\nsupabase.from('places').select(r ? `${C}, status` : 'id, photo_credits')"],
  [false, 'ternary branch is a call',            "const C = 'id, photo_credits, photo_attribution'\nsupabase.from('places').select(r ? cols() : C)"],
  [false, 'template interpolates an expression', "const C = 'id, photo_credits, photo_attribution'\nsupabase.from('places').select(`${r ? C : ''}, status`)"],
  [true,  'inline template of a const',          "const C = 'id, photo_credits, photo_attribution'\nsupabase.from('places').select(`${C}, status`, { count: 'exact' })"],
  // unpaged-ok: a test fixture string, not a query
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

// A render-time ReferenceError is not caught by the defensive parsing above: PhotoCredit once
// called t() after its import was swapped out, which throws on every well-formed licence/source link.
console.log('\n— PhotoCredit.js: every t( call has its import —')
{
  const src = _read(_resolve(_root, 'components/PhotoCredit.js'), 'utf8')
  const calls = /(?<![\w.])t\(/.test(src)
  const imported = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"]\.\.\/constants\/i18n(\.js)?['"]/.test(src)
  if (!calls || imported) { pass++; console.log(`  ok   PhotoCredit.js ${calls ? 'calls t( and imports it' : 'does not call t('}`) }
  else { fail++; console.log("  FAIL components/PhotoCredit.js calls t( but does not import { t } from '../constants/i18n'") }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
