#!/usr/bin/env node
// ─── Visit NCY walking maps — stops → places ─────────────────────────────────
//
//   node scripts/import-visitncy-places.mjs --offline   # map + validate, no DB, no credentials
//   node scripts/import-visitncy-places.mjs --dry       # + read the DB, pre-scan text, write nothing
//   node scripts/import-visitncy-places.mjs             # insert the missing stops as PENDING
//
// Reads the six MapHub snapshots in scripts/data/visitncy/ (committed, so every decision
// below was reviewed against fixed ids and a fixed order) plus two curated files:
//   stops.json    59 NEW stops — category and EN/TR names, written by hand, not split
//   matches.json  22 stops we ALREADY had — MapHub id → our place_id. NEVER written to.
//
// REQUIRES 20261045_places_source.sql (source/source_id + the provenance lock + the two
// coordinate corrections). The pre-flight refuses to run without it.
//
// CREDENTIALS — macOS Keychain, never .env, same as the Novest importer:
//   security add-generic-password -a "$USER" -s ada-supabase-service-role -w
// service_role is required for two reasons: only it can write source/source_id
// (places_guard_source nulls them for any session), and only it can see places in EVERY
// status, which the collision guard needs.
//
// ─── INSERT-IF-ABSENT, NEVER UPDATE ─────────────────────────────────────────
// A stop already present (same source_id) is left exactly as it is. An update-on-conflict
// would overwrite an admin's later edit to a name or description, and — if status were ever
// in the payload — push a live stop back to pending. Re-running is therefore always safe
// and only ever fills gaps. Syncing a changed upstream text is a deliberate, separate act.
//
// ─── THE COLLISION GUARD ────────────────────────────────────────────────────
// Recon adjudicated the 42 active places visible to anon on 2026-09-23 (matches.json →
// reviewed_place_ids). Anything else near a new stop — a pending or rejected submission
// anon could not see, or a place added since — has never been looked at against it. So
// any such place within COLLISION_M of a stop not yet imported aborts the whole write
// and prints the pair. Resolve it by hand (a match, or add the id to reviewed_place_ids).

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

import { coordsInCyprus } from '../supabase/functions/_shared/novest-feed.mjs'
import { REGIONS } from '../constants/regions.js'
import { EXPLORE_GROUPS } from '../constants/exploreCategories.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'scripts/data/visitncy')
const KEYCHAIN_SERVICE = 'ada-supabase-service-role'
const SOURCE = 'visitncy'
const COLLISION_M = 150
const offline = process.argv.includes('--offline')
const dry = process.argv.includes('--dry')

// MapHub map → region. The map a stop comes from is certain; a region derived from its
// coordinates would not be.
const MAPS = {
  'kyrenia-city-map-girne-sehir-haritasi':        'kyrenia',
  'lefkosa-city-map-sehir-haritasi':              'nicosia',
  'famagusta-city-map-gazimagusa-sehir-haritasi': 'famagusta',
  'Iskele':                                       'iskele',
  'Guzelyurt-City-Map':                           'morphou',
  'lefke':                                        'lefke',
}

// The two ids 20261045 moved, and where to. The pre-flight reads them back: if they are
// not there, the migration has not been applied (or only partly).
const CORRECTED = {
  '7ecf2c84-2192-45c9-b075-a2ce115f842c': [35.341635, 33.322362],
  '2c20f82e-1ee1-4c9b-9fdc-f59be72da470': [35.283387, 33.889256],
}

const fail = (...lines) => { for (const l of lines) console.error(l); process.exit(1) }

function loadEnv() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (!m) continue
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

function serviceRoleKey() {
  let out
  try {
    out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    fail(`Keychain entry "${KEYCHAIN_SERVICE}" not found.`, '',
      'Create it with:', `  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`)
  }
  const key = out.trim()
  if (!key) fail(`Keychain entry "${KEYCHAIN_SERVICE}" is empty.`)
  if (key.startsWith('sb_publishable_')) {
    fail(`Keychain entry "${KEYCHAIN_SERVICE}" holds the PUBLISHABLE key, not the secret one.`)
  }
  return key
}

function metres(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ─── Description splitting ───────────────────────────────────────────────────
// Each MapHub description is: a "Direction" line + a goo.gl link, the English text, a
// separator line (..., …, or a run of dashes), the Turkish text, and sometimes a
// "For more info / daha fazlası için;" line + a link. The two links are boilerplate.
// Anything that does not come apart into exactly one EN half and one TR half is REFUSED,
// never guessed: stops.json must say what it is ('tr_only' | 'none').

// Word boundaries are Unicode lookarounds, NOT \b: JavaScript's \b is ASCII-only, so it
// treats ş/ı/ç as non-word characters and finds the English word "in" inside "inşa"
// ("inşa edilmiştir" — "was built"). That misread a Turkish-only text as bilingual.
const word = list => new RegExp(`(?<![\\p{L}\\p{N}])(${list})(?![\\p{L}\\p{N}])`, 'iu')
const TR_LETTER = /[çğıöşüÇĞİÖŞÜ]/
const EN_WORDS = word('the|and|was|of|is|in|built')
const TR_WORDS = word('ve|bir|olarak|bu|yılında|için|ile|da|de|en')

function stripBoilerplate(raw) {
  const lines = (raw ?? '').replace(/\r/g, '').split('\n')
  if (/^\s*direction\s*$/i.test(lines[0] ?? '')) {
    lines.shift()
    if (/^\s*https?:\/\//.test(lines[0] ?? '')) lines.shift()
  }
  return lines.join('\n')
    .replace(/\n\s*For more info[^\n]*\n\s*https?:\/\/\S+\s*$/i, '')
    .trim()
}

const tidy = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()

function describe(raw, override) {
  const body = stripBoilerplate(raw)
  if (override === 'none') {
    return body === '' ? { i18n: null } : { problem: `marked "none" but has prose: ${body.slice(0, 60)}…` }
  }
  if (override === 'tr_only') {
    if (!TR_LETTER.test(body) || EN_WORDS.test(body)) return { problem: 'marked "tr_only" but does not read as Turkish-only' }
    return { i18n: { tr: tidy(body) } }
  }
  const parts = body.split(/\n[ \t]*(?:\.{3}|…|-{3,})[ \t]*\n/)
  if (parts.length !== 2) return { problem: `found ${parts.length} part(s), expected an EN half and a TR half` }
  const [en, tr] = parts.map(tidy)
  if (!EN_WORDS.test(en)) return { problem: `first half does not read as English: ${en.slice(0, 60)}…` }
  if (!TR_LETTER.test(tr) || !TR_WORDS.test(tr)) return { problem: `second half does not read as Turkish: ${tr.slice(0, 60)}…` }
  return { i18n: { en, tr } }
}

// ─── Load + validate, entirely offline ──────────────────────────────────────

loadEnv()
const stopsFile = JSON.parse(readFileSync(join(DATA, 'stops.json'), 'utf8'))
const matchFile = JSON.parse(readFileSync(join(DATA, 'matches.json'), 'utf8'))
const curated = new Map(stopsFile.stops.map(s => [s.maphub_id, s]))
const matched = new Map(matchFile.matches.map(m => [m.maphub_id, m]))
const reviewed = new Set(matchFile.reviewed_place_ids)
const heritage = new Set(EXPLORE_GROUPS.heritage)

const snapshots = readdirSync(DATA).filter(f => f.endsWith('.geojson')).map(f => f.replace(/\.geojson$/, ''))
if (snapshots.sort().join() !== Object.keys(MAPS).sort().join()) {
  fail(`Snapshot set differs from MAPS.`, `  on disk: ${snapshots.sort().join(', ')}`, `  MAPS:    ${Object.keys(MAPS).sort().join(', ')}`)
}

const problems = []
const rows = []
let featureCount = 0
const seen = new Set()
for (const [slug, region] of Object.entries(MAPS)) {
  if (!REGIONS.includes(region)) fail(`MAPS: "${region}" is not a canonical region`)
  const features = JSON.parse(readFileSync(join(DATA, `${slug}.geojson`), 'utf8')).features
  for (const f of features) {
    featureCount++
    const id = f.id
    if (seen.has(id)) { problems.push(`${id}: appears twice across the snapshots`); continue }
    seen.add(id)
    const isNew = curated.has(id), isMatch = matched.has(id)
    if (isNew === isMatch) { problems.push(`${id} "${f.properties.title}": is ${isNew ? 'BOTH new and matched' : 'NEITHER new nor matched'}`); continue }
    if (isMatch) continue

    const c = curated.get(id)
    const [lng, lat] = f.geometry?.coordinates ?? []
    if (f.geometry?.type !== 'Point' || !coordsInCyprus(lat, lng)) problems.push(`${id}: geometry is not a point in Cyprus (${lat}, ${lng})`)
    if (!heritage.has(c.category)) problems.push(`${id}: category "${c.category}" is not a heritage category`)
    if (!c.name_en?.trim() || !c.name_tr?.trim()) problems.push(`${id}: missing a name`)
    const d = describe(f.properties.description, c.description)
    if (d.problem) problems.push(`${id} "${c.name_en}": ${d.problem}`)
    const text = JSON.stringify(d.i18n ?? {})
    if (/https?:\/\/|goo\.gl|\bDirection\b/i.test(text)) problems.push(`${id} "${c.name_en}": boilerplate survived into the description`)

    rows.push({
      source: SOURCE,
      source_id: String(id),
      category: c.category,
      name: c.name_en,
      name_i18n: { en: c.name_en, tr: c.name_tr },
      description_i18n: d.i18n ?? null,
      region,
      latitude: lat,
      longitude: lng,
      status: 'pending',
    })
  }
}
if (featureCount !== curated.size + matched.size) {
  problems.push(`snapshots hold ${featureCount} features but stops.json + matches.json cover ${curated.size + matched.size}`)
}
for (const id of [...curated.keys(), ...matched.keys()]) {
  if (!seen.has(id)) problems.push(`${id}: in the curated files but in no snapshot`)
}

console.log(`Visit NCY stops — ${featureCount} features in ${snapshots.length} snapshots`)
console.log(`  new (stops.json):     ${curated.size}`)
console.log(`  matched (untouched):  ${matched.size}`)
const byCity = {}
for (const r of rows) byCity[r.region] = (byCity[r.region] ?? 0) + 1
console.log(`  new by region:        ${Object.entries(byCity).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
const kinds = { 'en+tr': 0, tr_only: 0, none: 0 }
for (const r of rows) kinds[!r.description_i18n ? 'none' : r.description_i18n.en ? 'en+tr' : 'tr_only']++
console.log(`  descriptions:         ${kinds['en+tr']} EN+TR · ${kinds.tr_only} TR only · ${kinds.none} none`)

if (process.argv.includes('--print')) {
  for (const r of rows) {
    console.log(`\n── ${r.source_id} · ${r.region} · ${r.category}\n   EN ${r.name}\n   TR ${r.name_i18n.tr}`)
    if (r.description_i18n?.en) console.log(`   en: ${r.description_i18n.en.slice(0, 160).replace(/\n/g, ' ⏎ ')}…`)
    if (r.description_i18n?.tr) console.log(`   tr: ${r.description_i18n.tr.slice(0, 160).replace(/\n/g, ' ⏎ ')}…`)
  }
}

if (problems.length) {
  fail(`\nREFUSING — ${problems.length} row(s) need a decision in stops.json / matches.json:`,
    ...problems.map(p => `  • ${p}`))
}
console.log('  offline validation:   all rows map cleanly')

if (offline) {
  console.log('\n(offline) no database contacted, no text pre-scanned, nothing written.')
  process.exit(0)
}

// ─── Database ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON) fail('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY missing — expected in .env')
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const db = createClient(SUPABASE_URL, serviceRoleKey(), opts)
const anon = createClient(SUPABASE_URL, ANON, opts)

// Pre-flight: 20261045 applied — the column exists AND the corrections are in place.
{
  const { error } = await db.from('places').select('source').limit(1)
  if (error) fail(`Pre-flight: places.source is not readable (${error.code ?? ''} ${error.message}).`,
    'Apply supabase/migrations/20261045_places_source.sql first.')
  const { data, error: e2 } = await db.from('places').select('id, latitude, longitude').in('id', Object.keys(CORRECTED))
  if (e2) fail(`Pre-flight: ${e2.message}`)
  for (const [id, [lat, lng]] of Object.entries(CORRECTED)) {
    const r = data.find(x => x.id === id)
    if (!r || r.latitude !== lat || r.longitude !== lng) {
      fail(`Pre-flight: place ${id} is at ${r ? `${r.latitude},${r.longitude}` : '(missing)'}, not the corrected ${lat},${lng}.`,
        '20261045 has not been applied, or has been only partly applied.')
    }
  }
}

// Every place, every status. count:'exact' against what arrived — the only truncation
// check that works at any max-rows cap.
const { data: places, count, error: pe } = await db.from('places')
  .select('id, name, status, source, source_id, latitude, longitude, updated_at', { count: 'exact' })
  .range(0, 9999)
if (pe) fail(`Reading places: ${pe.message}`)
if (count !== places.length) fail(`Reading places: ${count} exist but ${places.length} arrived — truncated. Refusing to guard against a partial list.`)
const statusCount = places.reduce((a, p) => (a[p.status] = (a[p.status] ?? 0) + 1, a), {})
console.log(`\nDatabase: ${count} places visible to service_role (${Object.entries(statusCount).map(([k, v]) => `${v} ${k}`).join(', ')})`)

const byId = new Map(places.map(p => [p.id, p]))
for (const m of matchFile.matches) {
  const p = byId.get(m.place_id)
  if (!p) fail(`matches.json: place ${m.place_id} ("${m.place_name}") no longer exists.`)
  if (p.source) fail(`matches.json: place ${m.place_id} ("${m.place_name}") now carries source=${p.source}. Matched rows must never be written; look before continuing.`)
}

const present = new Set(places.filter(p => p.source === SOURCE).map(p => p.source_id))
const toInsert = rows.filter(r => !present.has(r.source_id))
console.log(`  already imported:     ${rows.length - toInsert.length} (left exactly as they are)`)
console.log(`  to insert:            ${toInsert.length}`)

// Collision guard (see header).
const collisions = []
for (const r of toInsert) {
  for (const p of places) {
    if (p.source === SOURCE || reviewed.has(p.id) || p.latitude == null) continue
    const d = metres(r.latitude, r.longitude, p.latitude, p.longitude)
    if (d <= COLLISION_M) collisions.push(`${r.source_id} "${r.name}" ↔ ${p.id} "${p.name}" [${p.status}] — ${Math.round(d)} m`)
  }
}
if (collisions.length) {
  fail(`\nREFUSING — ${collisions.length} new stop(s) sit within ${COLLISION_M} m of a place recon never reviewed:`,
    ...collisions.map(c => `  • ${c}`),
    'Decide each pair: a duplicate goes into matches.json; a distinct place goes into reviewed_place_ids.')
}
console.log(`  collision guard:      clear (no unreviewed place within ${COLLISION_M} m)`)

// Content pre-scan. check_place_content fires for service_role too, and a rejected row
// would otherwise surface as a failed write. Both matchers get a POSITIVE CONTROL first:
// a scanner that says "clean" to everything reads exactly like clean text.
{
  const { data: term, error } = await db.from('blocked_terms').select('term').limit(1).single()
  if (error || !term) fail(`Pre-scan control: could not read a blocked term (${error?.message ?? 'no rows'}).`)
  const ctl1 = await db.rpc('contains_blocked_term', { p_text: `a ${term.term} b` })
  const ctl2 = await db.rpc('contains_payment_solicitation', { p_text: 'pay by iban please' })
  if (ctl1.error || ctl1.data !== true) fail(`Pre-scan control: contains_blocked_term did not flag a known term (${ctl1.error?.message ?? ctl1.data}).`)
  if (ctl2.error || ctl2.data !== true) fail(`Pre-scan control: contains_payment_solicitation did not flag "iban" (${ctl2.error?.message ?? ctl2.data}).`)

  const hits = []
  for (const r of toInsert) {
    // Same concatenation check_place_content scans.
    const text = [r.name, ...Object.values(r.name_i18n), ...Object.values(r.description_i18n ?? {})].join('  ')
    const [b, p] = await Promise.all([
      db.rpc('contains_blocked_term', { p_text: text }),
      db.rpc('contains_payment_solicitation', { p_text: text }),
    ])
    if (b.error || p.error) fail(`Pre-scan ${r.source_id}: ${(b.error ?? p.error).message}`)
    if (b.data) hits.push(`${r.source_id} "${r.name}": BLOCKED_TERM`)
    if (p.data) hits.push(`${r.source_id} "${r.name}": BLOCKED_PAYMENT`)
  }
  if (hits.length) fail(`\nREFUSING — the content filter would reject ${hits.length} row(s):`, ...hits.map(h => `  • ${h}`))
  console.log(`  content pre-scan:     ${toInsert.length} clean (both controls fired)`)
}

if (dry) {
  console.log('\n(dry) nothing written.')
  process.exit(0)
}
if (!toInsert.length) {
  console.log('\nNothing to insert.')
  process.exit(0)
}

// ─── Write ───────────────────────────────────────────────────────────────────
// One row per request: a failure names the row, and a partial run is safe because a
// re-run only fills what is missing.
const matchedBefore = new Map(matchFile.matches.map(m => [m.place_id, byId.get(m.place_id).updated_at]))
let inserted = 0
for (const r of toInsert) {
  const { error } = await db.from('places')
    .upsert(r, { onConflict: 'source,source_id', ignoreDuplicates: true })
  if (error) fail(`Insert ${r.source_id} "${r.name}" failed: ${error.message}`, error.details ?? '', error.hint ?? '',
    `${inserted} row(s) were inserted before this one; re-running fills the rest.`)
  inserted++
}
console.log(`\nInserted ${inserted} row(s).`)

// ─── Verify what the database now says, not what we sent ─────────────────────
const { data: mine, error: ve } = await db.from('places').select('id, status, source_id').eq('source', SOURCE)
if (ve) fail(`Verify: ${ve.message}`)
const expectIds = new Set(rows.map(r => r.source_id))
const nonPending = mine.filter(m => m.status !== 'pending')
console.log(`  service_role sees:    ${mine.length} visitncy rows (expected ${rows.length}); ${nonPending.length} not pending`)
if (mine.length !== rows.length || mine.some(m => !expectIds.has(m.source_id))) fail('Verify: the visitncy row set is not the curated set.')

const { data: after, error: ae } = await db.from('places').select('id, updated_at, source').in('id', [...matchedBefore.keys()])
if (ae) fail(`Verify: ${ae.message}`)
const touched = after.filter(a => a.source || a.updated_at !== matchedBefore.get(a.id))
console.log(`  matched rows touched: ${touched.length} of ${after.length} (expected 0)`)
if (touched.length) fail('Verify: a matched row changed during the import.', ...touched.map(t => `  • ${t.id}`))

// The public surface: pending rows must be invisible to anon, AND anon must still see the
// live places — a 0 from a working read and a 0 from a broken one look identical.
const a1 = await anon.from('places').select('id', { count: 'exact', head: true }).eq('source', SOURCE)
const a2 = await anon.from('places').select('id', { count: 'exact', head: true }).eq('status', 'active')
if (a1.error || a2.error) fail(`Verify (anon): ${(a1.error ?? a2.error).message}`)
console.log(`  anon sees:            ${a1.count} visitncy rows (expected 0) · ${a2.count} active places (control, expected > 0)`)
if (a1.count !== 0) fail('Verify: anon can see pending Visit NCY rows — they are PUBLIC. Investigate before anything else.')
if (!(a2.count > 0)) fail('Verify: anon sees no active places at all — the invisibility check above proves nothing.')
console.log('\nDone. All inserted rows are PENDING and invisible; activation is a separate step.')
