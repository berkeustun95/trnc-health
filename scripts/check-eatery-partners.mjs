#!/usr/bin/env node
// ─── Eatery (Yeme-İçme) partner guard ───────────────────────────────────────
//
//   --daily: daily-health mode. IGNORES the flags and every other check: reads all eatery_partners rows the ANON key
//     can see (RLS = exactly the ACTIVE ones, so inactive partners are ignored by construction) and fails if any
//     has menu_verified_on missing, invalid, in the future or older than 30 days. Zero active partners = OK.
//     No env/network/HTTP success = fail closed. Needs EXPO_PUBLIC_SUPABASE_URL + _ANON_KEY (no service key).
//   --strict-staleness: menu_verified_on older than 30 days FAILS in the full DB half; default = warning only
//   npm run eatery:check               full: offline half + DB half (only when a flag is true)
//   node scripts/check-eatery-partners.mjs --offline    offline half only (pre-push; no .env, no network)
//
// OFFLINE: (a) EATERY_LIVE / CRUNCHY_EXPRESS_LIVE declared, never partner-live in a dark section,
//   and baselined in check-module-flags.mjs with the same value; (b) the redesign.js gate
//   expressions have their canonical shape (EATERY_PREVIEW_DATA = dev || Preview build, nothing
//   else); (c) constants/eateryPreview.js placeholders are reachable only through a require()
//   guarded by EATERY_PREVIEW_DATA; (d) every EATERY_GATES key is a seeded slug; (e) production keeps
//   the is_active filter: the loader drops `.eq('is_active', true)` ONLY under !EATERY_PREVIEW_DATA, and it
//   is the only app reader of the eatery tables (20261119 lets the previewer account read inactive rows, so
//   in production the client filter is the only thing keeping them out of every build).
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
const DAILY = process.argv.includes('--daily')
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

// ─── (e) production is_active filter + single reader ───────────────────────
const FILTER = "if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)"
function loaderFilterProblems(text) {
  const src = norm(stripComments(text))
  const out = []
  const reads = src.split(".from('eatery_partners')").length - 1
  if (reads !== 1) out.push(`expected exactly 1 .from('eatery_partners') in the loader, found ${reads}`)
  const at = src.indexOf(FILTER)
  if (at < 0 || src.indexOf(FILTER, at + 1) >= 0) out.push(`expected exactly once: ${FILTER}`)
  else {
    const from = src.indexOf(".from('eatery_partners')"), awaitQ = src.indexOf('await q')
    if (!(from >= 0 && from < at && awaitQ > at)) out.push('the is_active filter must sit between the query and its await')
  }
  return out
}
const READ_RE = /\.from\(\s*(['"])eatery_(partners|menu_items|photos)\1\s*\)/
function readerProblems(byFile) {
  const out = []
  for (const [f, text] of Object.entries(byFile)) {
    if (f === 'utils/loadEateryPartners.js') continue
    if (READ_RE.test(stripComments(text))) out.push(`${f} reads an eatery table directly; go through utils/loadEateryPartners.js (it keeps the production is_active filter)`)
  }
  return out
}

// ─── (f) contact numbers: one door ─────────────────────────────────────────
// Every phone/WhatsApp an eatery screen dials or messages comes out of eateryContactNumbers (constants/eatery.js), which
// swaps in the Preview test number. A direct partner.phone / partner.whatsapp read, or a hand-built tel: / wa.me link,
// in any other eatery file would let a Preview tap reach a real shop.
const CONTACT_FN = /export function eateryContactNumbers[\s\S]*?\n\}\n/
const CONTACT_READ = /\??\.\s*(?:phone|whatsapp)\b|\[\s*['"](?:phone|whatsapp)['"]\s*\]/
const LINK_BUILD = /\btel:|wa\.me\//  // only constants/eatery.js (eateryContacts, orderWhatsAppUrl) builds links, from the numbers
// Reading the RESULT of the one door (nums.phone, partnerContactNumbers(p).whatsapp) is the point, not a leak.
const RESULT_READ = /(?:\bnums\??|\bpartnerContactNumbers\([^)]*\))\??\.(?:phone|whatsapp)\b/g
// Any file that touches the eatery partner rows or the door is in scope, whatever its name.
const USES_DOOR = /\b(?:eateryContacts|partnerContactNumbers|effectiveWhatsapp)\b/
// A loadEateryPartners caller is in scope unless every call passes a literal column list with no phone / whatsapp
// (it then cannot hold a contact: HomeScreen's tile row).
function readsPartnerRows(text) {
  const calls = [...stripComments(text).matchAll(/\bloadEateryPartners\s*\(\s*((['"`])[^'"`]*\2|[^)]*)/g)].filter(m => m.index === undefined || !/import/.test(text.slice(Math.max(0, m.index - 20), m.index)))
  if (!/\bloadEateryPartners\b/.test(text)) return false
  if (!calls.length) return true
  return calls.some(m => !/^(['"`])[^'"`]*\1/.test(m[1].trim()) || /phone|whatsapp/i.test(m[1]))
}
const DESTRUCTURE = /\{[^{}]*\b(?:phone|whatsapp)\b[^{}]*\}\s*=\s*[\w.?]*(?:partner|row|p)\b(?!\w)/i
function contactsSecondArgs(code) {
  const bad = []
  for (const m of code.matchAll(/(?<!function\s)(?<![\w.])eateryContacts\s*\(/g)) {
    let depth = 1, i = m.index + m[0].length, arg = '', args = []
    for (; i < code.length && depth > 0; i++) {
      const c = code[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break }
      if (c === ',' && depth === 1) { args.push(arg.trim()); arg = ''; continue }
      arg += c
    }
    args.push(arg.trim())
    if (!/^(?:nums\b|partnerContactNumbers\()/.test(args[1] || '')) bad.push(args[1] ?? '(missing)')
  }
  return bad
}
function contactReadProblems(byFile) {
  const out = []
  for (const [f, text] of Object.entries(byFile)) {
    if (!/eatery/i.test(f) && !USES_DOOR.test(text) && !readsPartnerRows(text)) continue
    let code = stripComments(text).replace(RESULT_READ, '')
    if (f === 'constants/eatery.js') code = code.replace(CONTACT_FN, '')
    const m = code.match(CONTACT_READ) || (f === 'constants/eatery.js' ? null : code.match(LINK_BUILD))
    if (m) out.push(`${f} touches a partner contact directly (${m[0].trim()}); go through eateryContactNumbers(partner, …)`)
    const d = code.match(DESTRUCTURE)
    if (d) out.push(`${f} destructures a partner contact (${d[0].trim()}); go through eateryContactNumbers(partner, …)`)
    for (const arg of contactsSecondArgs(code)) out.push(`${f} calls eateryContacts with a 2nd argument that is not nums / partnerContactNumbers(…): ${arg}`)
  }
  return out
}

// Test taps (Preview, dev) must not reach contact_events: every logContactEvent call in an eatery screen sits behind CONTACT_LOGGING.
function logGateProblems(byFile) {
  const out = []
  for (const [f, text] of Object.entries(byFile)) {
    if (!/eatery/i.test(f)) continue
    const code = stripComments(text)
    const calls = [...code.matchAll(/\blogContactEvent\s*\(/g)].filter(m => !/import[^\n]*$/.test(code.slice(0, m.index).split('\n').pop()))
    for (const m of calls) if (!/\bCONTACT_LOGGING\s*&&\s*[^\n;]*$/.test(code.slice(0, m.index).split('\n').pop())) out.push(`${f} calls logContactEvent without CONTACT_LOGGING && on the same line`)
  }
  return out
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

// ─── --daily: active partners must have a fresh menu ────────────────────────
// Pure: rows = [{ slug, menu_verified_on }] as the anon key sees them. Returns one line per offender.
function dailyProblems(rows, todayISO) {
  const out = []
  for (const r of rows) {
    const d = r.menu_verified_on
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) { out.push(`${r.slug}: menu_verified_on missing or invalid (${d})`); continue }
    const age = Math.round((Date.parse(todayISO) - Date.parse(d)) / 86400000)
    if (age < 0) out.push(`${r.slug}: menu_verified_on ${d} is in the future`)
    else if (age > MENU_MAX_AGE_DAYS) out.push(`${r.slug}: menu verified ${d}, ${age} days ago (max ${MENU_MAX_AGE_DAYS})`)
  }
  return out
}
async function dailyMain() {
  console.log(`eatery guard — mode: daily (active partners, menu freshness <= ${MENU_MAX_AGE_DAYS} days)`)
  const today = new Date().toISOString().slice(0, 10)
  const ago = n => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10)
  mustFail('daily 31d stale', dailyProblems([{ slug: 'x', menu_verified_on: ago(31) }], today))
  mustPass('daily 30d fine', dailyProblems([{ slug: 'x', menu_verified_on: ago(30) }], today))
  mustFail('daily missing date', dailyProblems([{ slug: 'x', menu_verified_on: null }], today))
  mustFail('daily garbage date', dailyProblems([{ slug: 'x', menu_verified_on: 'soon' }], today))
  mustFail('daily future date', dailyProblems([{ slug: 'x', menu_verified_on: ago(-1) }], today))
  mustPass('daily no rows', dailyProblems([], today))
  const E = loadEnv()
  const base = E.EXPO_PUBLIC_SUPABASE_URL, key = E.EXPO_PUBLIC_SUPABASE_ANON_KEY
  for (const [n, v] of [['EXPO_PUBLIC_SUPABASE_URL', base], ['EXPO_PUBLIC_SUPABASE_ANON_KEY', key]])
    if (!v) problems.push(`${n} not found (environment or .env) — failing closed`)
  let rows = []
  if (base && key) {
    const r = await rest(base, key, 'eatery_partners?select=slug,menu_verified_on&order=slug')
    if (r.error) problems.push(`eatery_partners query failed: ${r.error}`)
    else if (!Array.isArray(r.body)) problems.push('eatery_partners query returned a non-array body — failing closed')
    else {
      const total = Number((r.range || '').split('/')[1])
      if (Number.isNaN(total)) problems.push(`content-range unreadable (${r.range}) — cannot prove nothing was truncated`)
      else if (total !== r.body.length) problems.push(`truncated: count ${total} vs ${r.body.length} rows received`)
      else rows = r.body
    }
  }
  if (!problems.length) {
    if (!rows.length) console.log('0 active partners visible to anon — nothing to check (OK; inactive partners are not returned by RLS)')
    for (const r of rows) {
      const age = r.menu_verified_on ? Math.round((Date.parse(today) - Date.parse(r.menu_verified_on)) / 86400000) : 'n/a'
      console.log(`active partner ${r.slug}: menu_verified_on ${r.menu_verified_on ?? 'missing'} (${age} days)`)
    }
    for (const p of dailyProblems(rows, today)) problems.push(p)
  }
  console.log(`summary: ${rows.length} active partner(s) checked, ${controls} controls, mode daily`)
  if (problems.length) {
    console.error(`\n✗ eatery daily: ${problems.length} problem(s)`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ eatery daily OK')
  process.exit(0)
}
if (DAILY) await dailyMain()

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

// (e) Production keeps the is_active filter, and the loader is the only app reader of the eatery tables.
{
  const ctlLoader = "import { EATERY_PREVIEW_DATA } from '../constants/redesign'\nexport async function loadEateryPartners(cols) {\n  let q = supabase.from('eatery_partners').select(cols)\n  if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)\n  const { data } = await q.order('sort_order')\n}\n"
  mustPass('loader filter kept', loaderFilterProblems(ctlLoader))
  mustFail('loader filter removed', loaderFilterProblems(ctlLoader.replace("  if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)\n", '')))
  mustFail('loader filter only in a comment', loaderFilterProblems(ctlLoader.replace("  if (!EATERY_PREVIEW_DATA)", "  // if (!EATERY_PREVIEW_DATA)")))
  mustFail('loader filter under __DEV__', loaderFilterProblems(ctlLoader.replace('if (!EATERY_PREVIEW_DATA)', 'if (!__DEV__)')))
  mustFail('loader filter under isAdmin', loaderFilterProblems(ctlLoader.replace('if (!EATERY_PREVIEW_DATA)', 'if (!EATERY_PREVIEW_DATA && !isAdmin)')))
  mustFail('loader filter after the await', loaderFilterProblems(ctlLoader.replace("  if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)\n  const { data } = await q.order('sort_order')\n", "  const { data } = await q.order('sort_order')\n  if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)\n")))
  mustFail('loader with a second read', loaderFilterProblems(ctlLoader + "const b = supabase.from('eatery_partners').select('*')\n"))
  mustPass('reader: loader only', readerProblems({ 'utils/loadEateryPartners.js': ctlLoader, 'screens/X.js': "const COLS = 'slug, eatery_menu_items(name)'\n" }))
  mustFail('reader: a screen queries eatery_partners', readerProblems({ 'utils/loadEateryPartners.js': ctlLoader, 'screens/X.js': "supabase.from('eatery_partners').select('*')\n" }))
  mustFail('reader: a screen queries eatery_menu_items', readerProblems({ 'utils/loadEateryPartners.js': ctlLoader, 'screens/X.js': 'supabase.from("eatery_menu_items").select()\n' }))
  mustPass('reader: mention in a comment', readerProblems({ 'utils/loadEateryPartners.js': ctlLoader, 'screens/X.js': "// supabase.from('eatery_photos')\n" }))

  const fnSrc = 'export function eateryContactNumbers(p) {\n  return { phone: p.phone, whatsapp: p.whatsapp }\n}\nexport function eateryContacts(p, nums) {\n  return nums.phone\n}\n'
  mustPass('contact: only inside eateryContactNumbers', contactReadProblems({ 'constants/eatery.js': fnSrc, 'screens/EateryPartnerScreen.js': "const c = eateryContacts(partner, partnerContactNumbers(partner))\n" }))
  mustFail('contact: screen reads partner.whatsapp', contactReadProblems({ 'constants/eatery.js': fnSrc, 'screens/EateryPartnerScreen.js': "const d = eateryOrderDigits(partner.whatsapp)\n" }))
  mustFail('contact: screen reads partner?.phone', contactReadProblems({ 'constants/eatery.js': fnSrc, 'components/EateryQuiz.js': "Linking.openURL(partner?.phone)\n" }))
  mustFail('contact: eateryContacts reads p.phone itself', contactReadProblems({ 'constants/eatery.js': fnSrc.replace('nums.phone', 'p?.phone') }))
  mustFail('contact: any file importing the door is in scope (name has no "eatery")', contactReadProblems({ 'screens/HomeScreen.js': "import { effectiveWhatsapp } from '../utils/eateryBasket'\nconst w = partner.whatsapp\n" }))
  mustFail('contact: loadEateryPartners with phone column is in scope', contactReadProblems({ 'screens/ExploreX.js': "const r = await loadEateryPartners('slug, phone')\nconst w = row.whatsapp\n" }))
  mustPass('contact: loadEateryPartners tile-only columns out of scope', contactReadProblems({ 'screens/HomeX.js': "const r = await loadEateryPartners('slug, name')\nconst w = item.phone\n" }))
  mustPass('contact: unrelated file with .phone is out of scope', contactReadProblems({ 'screens/TowingScreen.js': "const w = tow.phone\n" }))
  mustFail('contact: destructure phone', contactReadProblems({ 'screens/EateryPartnerScreen.js': "const { phone, name } = partner\n" }))
  mustFail('contact: destructure whatsapp from p', contactReadProblems({ 'components/EateryQuiz.js': "const { whatsapp } = p\n" }))
  mustFail('contact: eateryContacts with raw partner as 2nd arg', contactReadProblems({ 'screens/EateryPartnerScreen.js': "const c = eateryContacts(partner, partner)\n" }))
  mustFail('contact: eateryContacts with a literal 2nd arg', contactReadProblems({ 'screens/EateryPartnerScreen.js': "const c = eateryContacts(partner, { phone: x, whatsapp: y })\n" }))
  mustFail('contact: eateryContacts with no 2nd arg', contactReadProblems({ 'screens/EateryPartnerScreen.js': "const c = eateryContacts(partner)\n" }))
  mustPass('contact: eateryContacts with partnerContactNumbers', contactReadProblems({ 'screens/EateryPartnerScreen.js': "const c = eateryContacts(partner, partnerContactNumbers(partner))\n" }))
  mustPass('log gate: behind CONTACT_LOGGING', logGateProblems({ 'screens/EateryPartnerScreen.js': "import { logContactEvent } from 'x'\n  if (CONTACT_LOGGING && !partner.placeholder) logContactEvent('eatery', 1, a)\n" }))
  mustFail('log gate: ungated call', logGateProblems({ 'screens/EateryPartnerScreen.js': "  if (!partner.placeholder) logContactEvent('eatery', 1, a)\n" }))
  mustFail('log gate: gate only in a comment', logGateProblems({ 'screens/EateryPartnerScreen.js': "  // CONTACT_LOGGING &&\n  logContactEvent('eatery', 1, a)\n" }))
  mustFail('contact: bracket read', contactReadProblems({ 'components/EateryOrder.js': "const w = p['whatsapp']\n" }))
  mustFail('contact: hand-built tel:', contactReadProblems({ 'utils/eateryX.js': "const u = `tel:${n}`\n" }))
  mustFail('contact: hand-built wa.me', contactReadProblems({ 'components/EateryOrder.js': "const u = 'https://wa.me/' + n\n" }))
  mustFail('contact: constants/eatery.js reads phone outside the function', contactReadProblems({ 'constants/eatery.js': fnSrc + 'const x = p.phone\n' }))
  mustPass('contact: mention in a comment', contactReadProblems({ 'screens/EateryPartnerScreen.js': "// partner.whatsapp is never read here\n" }))
  {
    const cf = Object.fromEntries(listSource().map(f => [f, read(f)]))
    assert(contactReadProblems(cf), 'eatery contact numbers: one door')
    assert(logGateProblems(cf), 'eatery contact taps: not logged on Preview / dev')
    console.log(`eatery contact numbers: read only in eateryContactNumbers; ${Object.keys(cf).length} eatery files scanned`)
  }
  assert(loaderFilterProblems(read('utils/loadEateryPartners.js')), 'loader is_active filter')
  const files = listSource()
  assert(readerProblems(Object.fromEntries(files.map(f => [f, read(f)]))), 'single eatery reader')
  console.log(`production is_active filter: kept under !EATERY_PREVIEW_DATA; eatery readers scanned in ${files.length} source files`)
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
