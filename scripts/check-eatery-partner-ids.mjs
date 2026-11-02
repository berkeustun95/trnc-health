#!/usr/bin/env node
// ─── Website partners: every stored partner_item_id still exists on the partner's site ─────────────
//
//   node scripts/check-eatery-partner-ids.mjs          # daily-health (production env: service key, READ ONLY)
//   node scripts/check-eatery-partner-ids.mjs --self   # the pure comparison against its controls only
//
// WHY (Berke, 2026-11-02): a website partner's basket hands off as ?cart=<their id>:<qty> (20261159). The ids are THEIR
// menu database's; when the owner deletes and re-creates a dish the id changes and our link silently drops it. The 30-day
// menu staleness alarm cannot see that.
//
// RED when: a stored id is missing on the site; a website partner's item has no id (it can never reach the cart); a website
// partner with ids has no site reader below (fail closed); any read fails (HTTP / network / truncation), after retries.
// NOTE only (stays green): dishes on the site that ADA does not list (the owner added something: a menu refresh is due).
//
// Reads ALL website partners, INACTIVE included (the service key bypasses RLS: Pasatiempo is pre-launch). GET only, nothing is
// written. The site reader for pasatiempo is its public Firestore (the documents its own SPA loads); the web key is the one the
// site publishes to every visitor (pasatiempocy.com/firebase-config.js), not a secret.
import { readFileSync, existsSync } from 'node:fs'

const SELF = process.argv.includes('--self')

// slug -> how to list the partner's own item ids. Add a reader with every new website partner (a missing one is RED).
const SITE_READERS = {
  pasatiempo: { kind: 'firestore', project: 'pasatiempocy-ef0b7', collection: 'items', webKey: 'AIzaSyDRXq-Ar3Wg92QzNZbruaTc4KjvILTERsY' },
}

// Pure. stored = [{ slug, id, name, partner_item_id }], site = { [slug]: Set(ids) } (only slugs whose read succeeded),
// readers = the slugs that have a reader. Returns { problems, notes }.
export function compareIds(stored, site, readers) {
  const problems = [], notes = []
  const bySlug = new Map()
  for (const r of stored) { if (!bySlug.has(r.slug)) bySlug.set(r.slug, []); bySlug.get(r.slug).push(r) }
  for (const [slug, rows] of bySlug) {
    for (const r of rows) if (typeof r.partner_item_id !== 'string' || !r.partner_item_id) problems.push(`${slug}: "${r.name}" (item ${r.id}) has no partner_item_id — it can never reach the cart`)
    const withId = rows.filter(r => typeof r.partner_item_id === 'string' && r.partner_item_id)
    if (!withId.length) continue
    if (!readers.includes(slug)) { problems.push(`${slug}: website partner with ${withId.length} stored ids but no site reader in SITE_READERS — failing closed`); continue }
    const ids = site[slug]
    if (!(ids instanceof Set)) { problems.push(`${slug}: the site could not be read — failing closed`); continue }
    if (ids.size === 0) { problems.push(`${slug}: the site returned 0 items — failing closed (a broken read must not pass)`); continue }
    for (const r of withId) if (!ids.has(r.partner_item_id)) problems.push(`${slug}: "${r.name}" (item ${r.id}) — id ${r.partner_item_id} no longer exists on the site`)
    const ours = new Set(withId.map(r => r.partner_item_id))
    const extra = [...ids].filter(x => !ours.has(x))
    if (extra.length) notes.push(`${slug}: ${extra.length} dish id(s) on the site are not in ADA (new dishes? refresh the menu): ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ', …' : ''}`)
  }
  return { problems, notes }
}

let controls = 0, bad = 0
const ctl = (name, got, want) => { controls++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.error(`  ✗ control ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) } }
const row = (id, pid) => ({ slug: 'p', id, name: 'd' + id, partner_item_id: pid })
const n = r => [r.problems.length, r.notes.length]
ctl('all present', n(compareIds([row(1, 'a'), row(2, 'b')], { p: new Set(['a', 'b']) }, ['p'])), [0, 0])
ctl('one missing is RED', n(compareIds([row(1, 'a'), row(2, 'b')], { p: new Set(['a', 'x']) }, ['p'])), [1, 1])
ctl('stored id NULL is RED', n(compareIds([row(1, 'a'), row(2, null)], { p: new Set(['a']) }, ['p'])), [1, 0])
ctl('no reader is RED', n(compareIds([row(1, 'a')], {}, [])), [1, 0])
ctl('failed read is RED', n(compareIds([row(1, 'a')], {}, ['p'])), [1, 0])
ctl('empty site is RED', n(compareIds([row(1, 'a')], { p: new Set() }, ['p'])), [1, 0])
ctl('extra site dish is a NOTE only', n(compareIds([row(1, 'a')], { p: new Set(['a', 'z']) }, ['p'])), [0, 1])
ctl('no website partners is green', n(compareIds([], {}, ['p'])), [0, 0])
if (bad) { console.error(`✗ ${bad} control(s) failed — the comparison cannot be trusted`); process.exit(1) }
if (SELF) { console.log(`✓ partner-id comparison: ${controls} controls`); process.exit(0) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function getJson(url, headers = {}, tries = 4) {
  let last = ''
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'GET', headers })
      const text = await res.text()
      if (res.ok) return { body: JSON.parse(text), headers: res.headers }
      last = `HTTP ${res.status} ${text.slice(0, 160)}`
      if (res.status !== 429 && res.status < 500) break
    } catch (e) { last = `network error: ${e.message}` }
    await sleep(2000 * (i + 1))
  }
  return { error: last }
}
async function readFirestoreIds(r) {
  const ids = new Set()
  let token = ''
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ pageSize: '300', 'mask.fieldPaths': 'avail', key: r.webKey })
    if (token) q.set('pageToken', token)
    const res = await getJson(`https://firestore.googleapis.com/v1/projects/${r.project}/databases/(default)/documents/${r.collection}?${q}`)
    if (res.error) throw new Error(res.error)
    for (const d of res.body.documents || []) ids.add(String(d.name).split('/').pop())
    token = res.body.nextPageToken || ''
    if (!token) return ids
  }
  throw new Error('more than 50 pages — refusing to guess')
}

function env() {
  const out = { ...process.env }
  if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const E = env()
const base = E.EXPO_PUBLIC_SUPABASE_URL, key = E.SUPABASE_SERVICE_ROLE_KEY
const problems = []
console.log(`eatery partner ids — website partners (inactive included), ${controls} controls`)
if (!base || !key) {
  console.error('✗ EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — failing closed (runs in daily-health, production env)')
  process.exit(1)
}
const path = 'eatery_menu_items?select=id,name,partner_item_id,eatery_partners!inner(slug,order_method)&eatery_partners.order_method=eq.website&order=id'
const res = await getJson(`${base}/rest/v1/${path}`, { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' })
let stored = []
if (res.error) problems.push(`eatery_menu_items read failed: ${res.error}`)
else {
  const total = Number((res.headers.get('content-range') || '').split('/')[1])
  if (!Array.isArray(res.body)) problems.push('eatery_menu_items returned a non-array body — failing closed')
  else if (Number.isNaN(total) || total !== res.body.length) problems.push(`truncated or unreadable count: ${res.headers.get('content-range')} vs ${res.body.length} rows`)
  else stored = res.body.map(r => ({ slug: r.eatery_partners.slug, id: r.id, name: r.name, partner_item_id: r.partner_item_id }))
}
const site = {}
for (const slug of new Set(stored.map(r => r.slug))) {
  const r = SITE_READERS[slug]
  if (!r) continue
  try { site[slug] = await readFirestoreIds(r); console.log(`${slug}: ${stored.filter(x => x.slug === slug).length} stored, ${site[slug].size} on the site`) }
  catch (e) { problems.push(`${slug}: site read failed: ${e.message}`) }
}
const cmp = compareIds(stored, site, Object.keys(SITE_READERS))
problems.push(...cmp.problems)
for (const x of cmp.notes) console.log(`NOTE ${x}`)
if (problems.length) {
  console.error(`\n✗ eatery partner ids: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ eatery partner ids OK')
