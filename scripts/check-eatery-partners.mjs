#!/usr/bin/env node
// ─── Eatery (Yeme-İçme) partner guard ───────────────────────────────────────
//
//   --strict-staleness: menu_verified_on older than 30 days FAILS (daily-health); default = warning only
//   npm run eatery:check               full: offline half + DB half (only when a flag is true)
//   node scripts/check-eatery-partners.mjs --offline    offline half only (pre-push; no .env, no network)
//
// OFFLINE: (a) EATERY_LIVE / CRUNCHY_EXPRESS_LIVE declared, never partner-live in a dark section,
//   and baselined in check-module-flags.mjs with the same value; (b) the redesign.js gate
//   expressions have their canonical shape (EATERY_PREVIEW_DATA = dev || Preview build, nothing
//   else); (c) constants/eateryPreview.js placeholders are reachable only through a require()
//   guarded by EATERY_PREVIEW_DATA; (d) every EATERY_GATES key is a seeded slug.
// DB (full mode, a flag true only): the live partner is visible to anon, active, complete and its
//   menu is verified within MENU_MAX_AGE_DAYS. Fails closed on a missing key or any HTTP error.
//
// Every check is a FUNCTION; each run feeds it a synthetic bad input that must fail (and a good one
// that must pass). A control that misbehaves fails the guard. Counts of what was checked are printed.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OFFLINE = process.argv.includes('--offline')
// daily-health calls this: a stale menu is a hard failure there, a warning in the ota chain (a hotfix OTA must not be blocked by it)
const STRICT = process.argv.includes('--strict-staleness')
const MENU_MAX_AGE_DAYS = 30
const problems = []
const warnings = []
let assertions = 0
let controls = 0

const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
const norm = s => s.replace(/\s+/g, ' ').trim()
const assert = (list, label) => { assertions++; for (const p of list) problems.push(`${label}: ${p}`) }
// A control: `bad` must produce problems, `good` must produce none.
const mustFail = (name, list) => { controls++; if (!list.length) problems.push(`CONTROL ${name}: a bad input passed — this check is dead`) }
const mustPass = (name, list) => { controls++; if (list.length) problems.push(`CONTROL ${name}: a good input failed (${list.join(' | ')}) — this check would cry wolf`) }

// ─── (a) flags ──────────────────────────────────────────────────────────────
const FLAG_KEYS = ['EATERY_LIVE', 'CRUNCHY_EXPRESS_LIVE']

function parseFlags(flagsText) {
  const code = stripComments(flagsText)
  const out = {}
  for (const k of FLAG_KEYS) {
    const m = code.match(new RegExp(`^export\\s+const\\s+${k}\\s*=\\s*(true|false)\\b`, 'm'))
    if (m) out[k] = m[1] === 'true'
  }
  return out
}
function parseExpectedScalars(guardText) {
  const code = stripComments(guardText)
  const m = code.match(/const\s+EXPECTED_SCALARS\s*=\s*\{([\s\S]*?)\n\}/)
  const out = {}
  if (!m) return null
  for (const x of m[1].matchAll(/([A-Z0-9_]+)\s*:\s*(true|false)/g)) out[x[1]] = x[2] === 'true'
  return out
}
function flagProblems(flags, expected) {
  const out = []
  for (const k of FLAG_KEYS) if (!(k in flags)) out.push(`${k} is not declared as 'export const ${k} = true|false' in constants/flags.js`)
  if (flags.CRUNCHY_EXPRESS_LIVE === true && flags.EATERY_LIVE !== true) out.push('CRUNCHY_EXPRESS_LIVE is true while EATERY_LIVE is not — a partner live inside a dark section')
  if (!expected) out.push('could not find EXPECTED_SCALARS in scripts/check-module-flags.mjs')
  else for (const k of FLAG_KEYS) {
    if (!(k in expected)) out.push(`${k} is missing from EXPECTED_SCALARS in scripts/check-module-flags.mjs`)
    else if (k in flags && expected[k] !== flags[k]) out.push(`${k} is ${flags[k]} in flags.js but ${expected[k]} in EXPECTED_SCALARS`)
  }
  return out
}

// ─── (b) redesign.js ────────────────────────────────────────────────────────
const DEV = "(typeof __DEV__ !== 'undefined' && __DEV__)"
const CANON = {
  EATERY_PREVIEW_DATA: `${DEV} || IS_PREVIEW_BUILD`,
  EATERY: `EATERY_LIVE || ${DEV} || (IS_PREVIEW_BUILD && EATERY_PREVIEW)`,
  CRUNCHY_EXPRESS: `CRUNCHY_EXPRESS_LIVE || ${DEV} || (IS_PREVIEW_BUILD && CRUNCHY_EXPRESS_PREVIEW)`,
}
function redesignProblems(text) {
  const code = stripComments(text)
  const out = []
  const seen = {}
  for (const [name, want] of Object.entries(CANON)) {
    const m = code.match(new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*(.+)$`, 'm'))
    if (!m) { out.push(`export const ${name} is missing from constants/redesign.js`); continue }
    const got = norm(m[1].replace(/;\s*$/, ''))
    if (got !== want) out.push(`${name} = ${got}   — expected exactly: ${want}`)
  }
  for (const name of ['EATERY_PREVIEW', 'CRUNCHY_EXPRESS_PREVIEW']) {
    const m = code.match(new RegExp(`^const\\s+${name}\\s*=\\s*(true|false)\\s*;?\\s*$`, 'm'))
    if (!m) out.push(`const ${name} is not declared as a boolean`)
    else seen[name] = m[1]
  }
  out.seen = seen
  return out
}

// ─── (c) eateryPreview import rule ──────────────────────────────────────────
// Accepted, and only these two shapes (comments stripped):
//   EATERY_PREVIEW_DATA ? require('<rel>/constants/eateryPreview') : …     (also `&&`)
//   if (EATERY_PREVIEW_DATA) { … require('<rel>/constants/eateryPreview') … }   (braced block)
// plus: the file imports EATERY_PREVIEW_DATA from constants/redesign. Anything else that mentions
// the module (ES import, export … from, import(), unguarded require, wrong condition) is red.
const REQ = String.raw`require\(\s*(['"])(?:\.{1,2}/)+(?:[\w.-]+/)*(?:constants/)?eateryPreview(?:\.js)?\1\s*\)`
const SHAPE_A = new RegExp(String.raw`\bEATERY_PREVIEW_DATA\s*(?:\?|&&)\s*${REQ}`, 'g')
const SHAPE_B_HEAD = /\bif\s*\(\s*EATERY_PREVIEW_DATA\s*\)\s*\{/g
function importerProblems(text, who) {
  const code = stripComments(text)
  const out = []
  const mentions = [...code.matchAll(/eateryPreview/g)].map(m => m.index)
  if (!mentions.length) return out
  const spans = []
  for (const m of code.matchAll(SHAPE_A)) spans.push([m.index, m.index + m[0].length])
  for (const h of code.matchAll(SHAPE_B_HEAD)) {
    let depth = 1, i = h.index + h[0].length
    while (i < code.length && depth > 0) { if (code[i] === '{') depth++; else if (code[i] === '}') depth--; i++ }
    const body = code.slice(h.index + h[0].length, i)
    for (const r of body.matchAll(new RegExp(REQ, 'g'))) spans.push([h.index + h[0].length + r.index, h.index + h[0].length + r.index + r[0].length])
  }
  const bad = mentions.filter(ix => !spans.some(([a, b]) => ix >= a && ix < b))
  if (bad.length) {
    const line = code.slice(0, bad[0]).split('\n').length
    out.push(`${who}:${line} references eateryPreview outside a require() guarded by EATERY_PREVIEW_DATA (${bad.length} unguarded mention(s))`)
  }
  if (!/import\s*\{[^}]*\bEATERY_PREVIEW_DATA\b[^}]*\}\s*from\s*['"][^'"]*\/redesign(?:\.js)?['"]/.test(code))
    out.push(`${who} references eateryPreview but does not import EATERY_PREVIEW_DATA from constants/redesign`)
  return out
}
const SCAN = ['App.js', 'screens', 'components', 'constants', 'utils', 'hooks', 'lib']
function listSource() {
  const files = []
  const walk = p => {
    const abs = resolve(ROOT, p)
    if (!existsSync(abs)) return
    if (statSync(abs).isDirectory()) {
      for (const e of readdirSync(abs)) { if (e !== 'node_modules') walk(join(p, e)) }
    } else if (/\.(js|jsx|ts|tsx)$/.test(p)) files.push(p)
  }
  SCAN.forEach(walk)
  return files
}

// ─── (d) sponsored slug ─────────────────────────────────────────────────────
// Only top-level seeds count: the migration's verification DO blocks insert throwaway probe rows
// (zz-on, zz-off, …) that are rolled back, and must never satisfy the gate-slug check.
function seededSlugs(rawSql) {
  const sql = rawSql.replace(/\bDO\s+(\$[A-Za-z_]*\$)[\s\S]*?\1\s*;/gi, '')
  const slugs = []
  for (const ins of sql.matchAll(/insert\s+into\s+(?:public\.)?eatery_partners\s*\(([^)]*)\)\s*values/gi)) {
    const cols = ins[1].split(',').map(c => c.trim().toLowerCase())
    const si = cols.indexOf('slug')
    if (si < 0) continue
    const v = sql.slice(ins.index + ins[0].length)
    let depth = 0, inStr = false, field = '', fields = []
    for (let i = 0; i < v.length; i++) {
      const c = v[i]
      if (!inStr && depth === 0 && c === ';') break
      if (inStr) { field += c; if (c === "'") { if (v[i + 1] === "'") { field += "'"; i++ } else inStr = false } continue }
      if (c === "'") { inStr = true; field += c; continue }
      if (c === '(') { depth++; if (depth === 1) { fields = []; field = ''; continue } }
      if (c === ')') { depth--; if (depth === 0) { fields.push(field.trim()); const m = (fields[si] || '').match(/^'([^']*)'$/); if (m) slugs.push(m[1]); field = ''; continue } }
      if (c === ',' && depth === 1) { fields.push(field.trim()); field = ''; continue }
      if (depth >= 1) field += c
    }
  }
  return slugs
}
function slugProblems(slug, seeded) {
  const out = []
  if (!/^[a-z0-9-]+$/.test(slug)) out.push(`gate slug '${slug}' does not match ^[a-z0-9-]+$`)
  if (!seeded.includes(slug)) out.push(`gate slug '${slug}' is not a seeded slug in the eatery migration (seeded: ${seeded.join(', ') || 'none'})`)
  return out
}

// ─── DB half: pure row evaluation ───────────────────────────────────────────
function partnerProblems(row, todayISO, strict = false, warn = warnings) {
  const out = []
  if (row.is_active !== true) out.push('is_active is not true')
  if (row.lat == null || row.lng == null) out.push('lat/lng missing')
  if (!row.logo_path) out.push('logo_path missing')
  const items = row.eatery_menu_items?.[0]?.count ?? 0
  if (!(items >= 1 || row.menu_url)) out.push('no menu: 0 menu items and no menu_url')
  const d = row.menu_verified_on
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) out.push(`menu_verified_on missing or invalid (${d})`)
  else {
    const age = Math.round((Date.parse(todayISO) - Date.parse(d)) / 86400000)
    if (age < 0) out.push(`menu_verified_on ${d} is in the future`)
    else if (age > MENU_MAX_AGE_DAYS) (strict ? out : warn).push(`menu_verified_on ${d} is ${age} days old (max ${MENU_MAX_AGE_DAYS})`)
  }
  return out
}

function loadEnv() {
  const out = {}
  try {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* process.env only */ }
  return { ...out, ...process.env }
}
async function rest(base, key, path) {
  let res
  try { res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } }) }
  catch (e) { return { error: `network error: ${e.message}` } }
  const raw = await res.text()
  let body; try { body = JSON.parse(raw) } catch { body = raw.slice(0, 200) }
  if (!res.ok) return { error: `HTTP ${res.status} ${body?.code ?? ''} ${body?.message ?? (typeof body === 'string' ? body : '')}`.trim() }
  return { body, range: res.headers.get('content-range') }
}

// ═══ RUN ═══════════════════════════════════════════════════════════════════
console.log(`eatery guard — mode: ${OFFLINE ? 'offline' : 'full'}${STRICT ? ' +strict-staleness' : ''}`)

// controls: flags
{
  const good = { EATERY_LIVE: false, CRUNCHY_EXPRESS_LIVE: false }
  mustPass('flags good', flagProblems(good, { ...good }))
  mustFail('flags partner live in dark section', flagProblems({ EATERY_LIVE: false, CRUNCHY_EXPRESS_LIVE: true }, { EATERY_LIVE: false, CRUNCHY_EXPRESS_LIVE: true }))
  mustFail('flags absent', flagProblems({ EATERY_LIVE: false }, { ...good }))
  mustFail('flags baseline mismatch', flagProblems(good, { EATERY_LIVE: true, CRUNCHY_EXPRESS_LIVE: false }))
  mustFail('flags baseline missing key', flagProblems(good, { EATERY_LIVE: false }))
  mustFail('flags declaration commented out', flagProblems(parseFlags('// export const EATERY_LIVE = false\nexport const CRUNCHY_EXPRESS_LIVE = false'), { ...good }))
}
// controls: redesign
{
  const ok = [
    "const EATERY_PREVIEW = true", "const CRUNCHY_EXPRESS_PREVIEW = false",
    `export const EATERY = ${CANON.EATERY}`, `export const CRUNCHY_EXPRESS = ${CANON.CRUNCHY_EXPRESS}`,
    `export const EATERY_PREVIEW_DATA = ${CANON.EATERY_PREVIEW_DATA}`,
  ].join('\n')
  mustPass('redesign good', redesignProblems(ok))
  mustFail('redesign PREVIEW_DATA = true', redesignProblems(ok.replace(CANON.EATERY_PREVIEW_DATA, 'true')))
  mustFail('redesign PREVIEW_DATA gains _LIVE', redesignProblems(ok.replace(`EATERY_PREVIEW_DATA = ${DEV}`, `EATERY_PREVIEW_DATA = EATERY_LIVE || ${DEV}`)))
  mustFail('redesign EATERY missing', redesignProblems(ok.replace(/export const EATERY = .*\n/, '')))
  mustFail('redesign PREVIEW not boolean', redesignProblems(ok.replace('EATERY_PREVIEW = true', 'EATERY_PREVIEW = 1')))
}
// controls: importer rule
{
  const imp = "import { EATERY_PREVIEW_DATA } from '../constants/redesign'\n"
  mustFail('importer ES import', importerProblems(imp + "import X from '../constants/eateryPreview'\n", 'ctl'))
  mustFail('importer export from', importerProblems(imp + "export * from './eateryPreview'\n", 'ctl'))
  mustFail('importer dynamic import()', importerProblems(imp + "const m = import('../constants/eateryPreview')\n", 'ctl'))
  mustFail('importer unguarded require', importerProblems(imp + "const X = require('../constants/eateryPreview')\n", 'ctl'))
  mustFail('importer wrong condition', importerProblems(imp + "if (__DEV__) { X = require('../constants/eateryPreview') }\n", 'ctl'))
  mustFail('importer guard only in a comment', importerProblems(imp + "// EATERY_PREVIEW_DATA ? \nconst X = require('../constants/eateryPreview')\n", 'ctl'))
  mustFail('importer guarded but no redesign import', importerProblems("const X = EATERY_PREVIEW_DATA ? require('../constants/eateryPreview') : null\n", 'ctl'))
  mustPass('importer guarded ternary', importerProblems(imp + "const X = EATERY_PREVIEW_DATA ? require('../constants/eateryPreview') : null\n", 'ctl'))
  mustPass('importer guarded &&', importerProblems(imp + "const X = EATERY_PREVIEW_DATA && require('../constants/eateryPreview')\n", 'ctl'))
  mustPass('importer guarded if block', importerProblems(imp + "let X = null\nif (EATERY_PREVIEW_DATA) {\n  X = require('../constants/eateryPreview')\n}\n", 'ctl'))
  mustPass('importer comment mention only', importerProblems("// see constants/eateryPreview\nconst a = 1\n", 'ctl'))
}
// controls: slug + seed parser + row evaluation
const SQL_SAMPLE = "INSERT INTO public.eatery_partners (slug, name, notes)\nVALUES\n ('crunchy-express', 'Crunchy; Express', 'it''s (ok)'),\n ('other-one', 'O', null);\n"
{
  const s = seededSlugs(SQL_SAMPLE)
  controls++; if (s.join() !== 'crunchy-express,other-one') problems.push(`CONTROL seed parser: got [${s}] from the sample, expected crunchy-express,other-one`)
  mustPass('slug known', slugProblems('crunchy-express', s))
  mustFail('slug unknown', slugProblems('nope', s))
  mustFail('slug bad charset', slugProblems('Crunchy_Express', ['Crunchy_Express']))
  const withProbe = SQL_SAMPLE + "DO $$\nBEGIN\n  INSERT INTO public.eatery_partners (slug, name) VALUES ('zz-probe', 'P');\nEND $$;\n"
  const sp = seededSlugs(withProbe)
  controls++; if (sp.includes('zz-probe')) problems.push(`CONTROL seed parser: a DO-block probe slug counted as seeded: [${sp}]`)
  mustFail('slug only in a DO-block probe', slugProblems('zz-on', seededSlugs(withProbe.replace('zz-probe', 'zz-on'))))
  const tagged = seededSlugs(SQL_SAMPLE + "DO $body$\nBEGIN\n  INSERT INTO public.eatery_partners (slug, name) VALUES ('zz-tagged', 'P');\nEND $body$;\n")
  controls++; if (tagged.includes('zz-tagged') || !tagged.includes('crunchy-express')) problems.push(`CONTROL seed parser: tagged DO-block probe handling wrong: [${tagged}]`)
}
const TODAY = new Date().toISOString().slice(0, 10)
const daysAgo = n => new Date(Date.parse(TODAY) - n * 86400000).toISOString().slice(0, 10)
const GOOD_ROW = { slug: 'crunchy-express', is_active: true, lat: 35.1, lng: 33.3, logo_path: 'l.png', menu_url: null, menu_verified_on: daysAgo(3), eatery_menu_items: [{ count: 4 }] }
{
  mustPass('row complete', partnerProblems(GOOD_ROW, TODAY))
  mustPass('row menu_url instead of items', partnerProblems({ ...GOOD_ROW, menu_url: 'https://x', eatery_menu_items: [{ count: 0 }] }, TODAY))
  mustFail('row no coords', partnerProblems({ ...GOOD_ROW, lat: null }, TODAY))
  mustFail('row no logo', partnerProblems({ ...GOOD_ROW, logo_path: null }, TODAY))
  mustFail('row no menu', partnerProblems({ ...GOOD_ROW, eatery_menu_items: [{ count: 0 }], menu_url: null }, TODAY))
  {
    const w = []
    mustPass('row stale 31d is only a warning by default', partnerProblems({ ...GOOD_ROW, menu_verified_on: daysAgo(31) }, TODAY, false, w))
    mustFail('row stale 31d warns by default', w)
    mustFail('row stale 31d fails under --strict-staleness', partnerProblems({ ...GOOD_ROW, menu_verified_on: daysAgo(31) }, TODAY, true, []))
    mustPass('row 30d is fine even strict', partnerProblems({ ...GOOD_ROW, menu_verified_on: daysAgo(30) }, TODAY, true, []))
  }
  mustFail('row inactive', partnerProblems({ ...GOOD_ROW, is_active: false }, TODAY))
  mustFail('row future date', partnerProblems({ ...GOOD_ROW, menu_verified_on: daysAgo(-2) }, TODAY))
  mustPass('row 30d is fine', partnerProblems({ ...GOOD_ROW, menu_verified_on: daysAgo(30) }, TODAY))
}

// real checks (a)
const flagsText = read('constants/flags.js')
const flags = parseFlags(flagsText)
assert(flagProblems(flags, parseExpectedScalars(read('scripts/check-module-flags.mjs'))), 'flags')
console.log(`flags: EATERY_LIVE=${flags.EATERY_LIVE} CRUNCHY_EXPRESS_LIVE=${flags.CRUNCHY_EXPRESS_LIVE} (flags.js vs EXPECTED_SCALARS compared)`)

// (b)
{
  const rp = redesignProblems(read('constants/redesign.js'))
  assert(rp, 'redesign.js')
  console.log(`redesign.js: EATERY, CRUNCHY_EXPRESS, EATERY_PREVIEW_DATA canonical; EATERY_PREVIEW=${rp.seen.EATERY_PREVIEW} CRUNCHY_EXPRESS_PREVIEW=${rp.seen.CRUNCHY_EXPRESS_PREVIEW}`)
}

// (c)
{
  const previewPath = 'constants/eateryPreview.js'
  console.log(existsSync(resolve(ROOT, previewPath)) ? `${previewPath}: present` : `${previewPath}: not present yet (part b)`)
  const files = listSource().filter(f => f !== previewPath)
  const importers = []
  for (const f of files) {
    const text = read(f)
    if (!stripComments(text).includes('eateryPreview')) continue
    importers.push(f)
    assert(importerProblems(text, f), 'eateryPreview')
  }
  assertions++
  console.log(`eateryPreview rule: scanned ${files.length} source files, ${importers.length} importers${importers.length ? ': ' + importers.join(', ') : ''}`)
}

// (d) The strip slider is data-driven (utils/stripSlides.js): no sponsored slug is hard-coded any more, so what is
// left to pin is the one place a slug IS written down, the EATERY_GATES keys. A gate for a slug nobody seeded
// would silently gate nothing.
{
  const src = stripComments(read('utils/loadEateryPartners.js'))
  const m = src.match(/export\s+const\s+EATERY_GATES\s*=\s*\{([^}]*)\}/)
  if (!m) { problems.push('utils/loadEateryPartners.js: EATERY_GATES not found'); }
  else {
    const keys = [...m[1].matchAll(/(?:^|,)\s*(['"]?)([A-Za-z0-9_-]+)\1\s*:/g)].map(x => x[2])
    const mdir = resolve(ROOT, 'supabase/migrations')
    const seeded = readdirSync(mdir).filter(f => /eatery/i.test(f) && f.endsWith('.sql')).flatMap(f => seededSlugs(readFileSync(join(mdir, f), 'utf8')))
    console.log(`EATERY_GATES keys: ${keys.join(', ') || 'none'}; seeded slugs: ${seeded.join(', ') || 'none'}`)
    assert(keys.length ? [] : ['EATERY_GATES has no keys (parse failure or gates removed)'], 'gate keys present')
    assert(keys.flatMap(k => slugProblems(k, seeded)), 'gate slugs seeded')
  }
}

// DB half
async function dbHalf() {
  if (OFFLINE) { console.log('DB half: skipped (--offline)'); return }
  if (!flags.EATERY_LIVE && !flags.CRUNCHY_EXPRESS_LIVE) { console.log('DB half: both flags false — no network call'); return }
  const E = loadEnv()
  const base = E.EXPO_PUBLIC_SUPABASE_URL, key = E.EXPO_PUBLIC_SUPABASE_ANON_KEY
  for (const [n, v] of [['EXPO_PUBLIC_SUPABASE_URL', base], ['EXPO_PUBLIC_SUPABASE_ANON_KEY', key]])
    if (!v) problems.push(`DB half: ${n} not found (environment or .env) with a flag true — failing closed`)
  if (!base || !key) return
  if (flags.CRUNCHY_EXPRESS_LIVE) {
    const r = await rest(base, key, 'eatery_partners?slug=eq.crunchy-express&select=id,slug,is_active,lat,lng,logo_path,menu_url,menu_verified_on,eatery_menu_items(count)')
    assertions++
    if (r.error) problems.push(`DB half: crunchy-express query failed: ${r.error}`)
    else if (!Array.isArray(r.body) || r.body.length !== 1) problems.push(`DB half: expected exactly 1 visible crunchy-express row (RLS: visible = is_active), got ${Array.isArray(r.body) ? r.body.length : 'non-array'}`)
    else {
      for (const p of partnerProblems(r.body[0], TODAY, STRICT)) problems.push(`DB half: crunchy-express: ${p}`)
      console.log(`DB half: crunchy-express row checked (menu items: ${r.body[0].eatery_menu_items?.[0]?.count ?? 0}, menu_verified_on: ${r.body[0].menu_verified_on})`)
    }
  }
  if (flags.EATERY_LIVE) {
    const r = await rest(base, key, 'eatery_partners?select=id&limit=1')
    assertions++
    if (r.error) problems.push(`DB half: eatery_partners query failed: ${r.error}`)
    else {
      const total = Number((r.range || '').split('/')[1])
      if (!(total >= 1)) problems.push(`DB half: EATERY_LIVE is true but ${Number.isNaN(total) ? 'count unreadable (' + r.range + ')' : total} partners are visible`)
      else console.log(`DB half: ${total} visible partner(s)`)
    }
  }
}
await dbHalf()

for (const w of warnings) console.log(`⚠ WARNING (does not block${STRICT ? '' : ' in the ota chain'}): ${w}`)
console.log(`summary: ${assertions} assertions, ${controls} controls, mode ${OFFLINE ? 'offline' : 'full'}`)
if (problems.length) {
  console.error(`\n✗ eatery guard: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ eatery guard OK')
