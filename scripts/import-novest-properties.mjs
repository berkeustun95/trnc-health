#!/usr/bin/env node
// ─── Coldwell Banker Novest — property import ────────────────────────────────
//
//   node scripts/import-novest-properties.mjs --dry     # report only, no writes
//   node scripts/import-novest-properties.mjs
//
// Idempotent upsert of Novest's listings into `properties`. One-way mirror: we GET
// from their site and never write to it.
//
// REQUIRES, in this order:
//   20260904_accommodation_partner_feed.sql            (schema + the RLS partner branch)
//   20260915_properties_deed_type_comment.sql          (comment only)
//   20260916_novest_agency_and_seed_teardown.sql       (the agency row + seed teardown)
// The pre-flight below refuses to run if the third is missing — without the agency row
// every listing would render with no agency name.
//
// CREDENTIALS — macOS Keychain, never .env, same as the Gişe Kıbrıs importer:
//   security add-generic-password -a "$USER" -s ada-supabase-service-role -w
// service_role is required because feed rows must land status='active' to be publicly
// visible, and no RLS role may write a row with agent_id NULL.
//
// ─── WHY THERE IS NO modified_after CURSOR ──────────────────────────────────
//
// The plan called for incremental sync via ?modified_after=<last successful run>. It is
// not implemented, deliberately, and this is the one place this importer departs from
// the approved design:
//
//   1. A cursor has NOWHERE TO LIVE. There is no column for the partner's modification
//      time and adding one is a Slice 1 amendment, which is out of scope by instruction.
//   2. The available substitute, max(updated_at), IS OUR CLOCK, NOT THEIRS. Comparing
//      the two skips any listing modified inside the skew window, silently and
//      permanently — the failure mode is a price that never updates again.
//   3. It optimises a cost that does not exist. 91 listings is ONE request of ~640 KB.
//      modified_after would save roughly 630 KB twice a day.
//
// So: fetch the whole feed every run, and let `content_hash` do the work it was
// specified for — rows whose normalised payload is unchanged are not written at all.
// That is strictly more correct than a cursor and costs one request.
//
// When the feed outgrows one page (>100 listings) this is worth revisiting WITH a real
// cursor column, added deliberately rather than derived from a clock we do not own.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

import {
  SOURCE, AGENCY_ID, getAll, decodeEntities, cleanDescription, assertNoPhone,
  num, int, meta, metaArray, mapPropertyType, extractDeedType, coordsInCyprus,
  INTENT_BY_STATUS, DISTRICT_BY_STATE, AREA_ALIASES, FEATURE_TO_COLUMN,
} from '../supabase/functions/_shared/novest-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEYCHAIN_SERVICE = 'ada-supabase-service-role'
const dry = process.argv.includes('--dry')
// Maps and validates the whole feed with NO database connection and no credentials.
// This is how a mapping change is tested: every CHECK constraint below is enforced in
// JS, so a row that would be rejected by Postgres is caught here instead of at 3am.
const offline = process.argv.includes('--offline')

// Fewer than this share of the previously-active rows coming back means something is
// wrong with THEIR site, not with their listings. Delisting on a bad fetch would empty
// the module; delisting late costs nothing. This is the sibling of assertHomogeneous():
// both refuse to write rather than write something plausible and wrong.
const DELIST_FLOOR = 0.7

const fail = (...lines) => { for (const l of lines) console.error(l); process.exit(1) }

// ─── Credentials ─────────────────────────────────────────────────────────────

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
    fail(`Keychain entry "${KEYCHAIN_SERVICE}" holds the PUBLISHABLE key, not the secret one.`,
      'It is bound by RLS and cannot write rows with agent_id NULL.')
  }
  return key
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

// EVERY key appears on EVERY row, null where absent. This is what keeps the upsert
// payload homogeneous — PostgREST derives one column list from the union of the objects
// and NULLs any column a shorter row omits, which is how 69 events silently lost their
// status. Building rows with a fixed shape makes that impossible by construction;
// assertHomogeneous() below is the second line of defence, not the first.
const MUTABLE = [
  'title', 'description', 'intent', 'property_type', 'price', 'currency', 'price_period',
  'bedrooms', 'bathrooms', 'living_rooms', 'area_sqm', 'plot_sqm',
  'district', 'area', 'deed_type', 'amenities', 'furnished', 'gated_community',
  'source_url', 'published_at',
]

// ─── CONSTRAINT MIRRORS ──────────────────────────────────────────────────────
//
// Every one of these mirrors a CHECK that already exists on `properties`. The database
// is still the authority — this is not a substitute for it. It exists because a 23514
// arriving from a bulk upsert names the constraint and NOT THE ROW, so one bad listing
// out of 88 fails the batch and tells you nothing about which. Validating here names
// the listing.
const ALLOWED = {
  property_type: ['apartment', 'villa', 'studio', 'house', 'land', 'commercial'],
  intent:        ['rent', 'sale', 'short_term'],
  currency:      ['GBP', 'TRY', 'EUR', 'USD'],
  price_period:  ['monthly', 'nightly', 'weekly', 'yearly', 'total'],
  district:      ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz'],
  deed_type:     ['turkish', 'exchange', 'foreign', 'allocation', 'tmd'],
}
const RANGES = {
  living_rooms: [0, 20], ensuite_count: [0, 20], min_term_months: [0, 120],
  floor: [-5, 200], total_floors: [1, 200],
}

function validateRow(r) {
  const bad = []
  for (const [k, vals] of Object.entries(ALLOWED)) {
    if (r[k] != null && !vals.includes(r[k])) bad.push(`${k}=${JSON.stringify(r[k])} not in {${vals.join('|')}}`)
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (r[k] != null && (r[k] < lo || r[k] > hi)) bad.push(`${k}=${r[k]} outside ${lo}..${hi}`)
  }
  // properties_amenities_shape_check. An EMPTY array is REJECTED (cardinality >= 1), which
  // is why the mapper writes null and not [] — this catches a regression of that.
  if (r.amenities !== null) {
    if (!Array.isArray(r.amenities) || r.amenities.length < 1 || r.amenities.length > 60)
      bad.push(`amenities cardinality ${r.amenities?.length} outside 1..60 (use null, never [])`)
    else if (r.amenities.join(',').length > 2000) bad.push('amenities serialise past 2000 chars')
  }
  if (!(r.price > 0)) bad.push(`price=${r.price} is not a publishable figure`)
  if (!r.title) bad.push('title is empty (NOT NULL)')
  if (bad.length) throw new Error(bad.join('; '))
}

function toRow(p, ctx) {
  const id = p.id
  const label = `listing ${id}`

  const typeSlugs = (p.property_type || []).map(i => ctx.types.get(i)?.slug).filter(Boolean)
  const property_type = mapPropertyType(typeSlugs)
  if (!property_type) return { skip: `${id}: no usable property_type (terms: ${typeSlugs.join(',') || 'none'})` }

  const statusSlug = (p.property_status || []).map(i => ctx.statuses.get(i)?.slug).filter(Boolean)[0]
  const intent = INTENT_BY_STATUS[statusSlug]
  if (!intent) return { skip: `${id}: no usable property_status (term: ${statusSlug || 'none'})` }

  // price is NOT NULL and a property app must never publish a price it does not have.
  // "0" appears on two kat karşılığı (land-for-flats) listings where price genuinely is
  // not a number — honest data entry against a field that cannot express the deal.
  // Rendering "£0" would be a lie; skipping is the truthful option.
  const price = num(meta(p, 'fave_property_price'))
  if (price === null || price <= 0) {
    return { skip: `${id}: price is ${JSON.stringify(meta(p, 'fave_property_price'))} — not a publishable figure` }
  }

  const stateSlug = (p.property_state || []).map(i => ctx.states.get(i)?.slug).filter(Boolean)[0]
  const district = DISTRICT_BY_STATE[stateSlug] ?? null

  // area only when it matches constants/areas.js EXACTLY, within that district. No fuzzy
  // matching: Girne's Boğaz and İskele's Boğaz are 40 km apart and share a name.
  const citySlug = (p.property_city || []).map(i => ctx.cities.get(i)?.slug).filter(Boolean)[0]
  let area = null
  if (citySlug && district) {
    const candidate = AREA_ALIASES[citySlug] ?? citySlug
    if ((AREAS_BY_REGION[district] || []).some(n => areaSlug(n) === candidate)) area = candidate
  }

  // Features that own a column are excluded from the chip list so the same fact does not
  // render twice. Empty => NULL, never []: properties_amenities_shape_check uses
  // cardinality(...) BETWEEN 1 AND 60, so an empty array is REJECTED, not stored.
  const featureSlugs = (p.property_feature || []).map(i => ctx.features.get(i)?.slug).filter(Boolean)
  const amenityNames = (p.property_feature || [])
    .map(i => ctx.features.get(i))
    .filter(f => f && !FEATURE_TO_COLUMN[f.slug])
    .map(f => decodeEntities(f.name))
  const amenities = amenityNames.length ? amenityNames : null

  const title = decodeEntities(p.title.rendered).trim()
  const description = cleanDescription(p.content.rendered) || null

  // Throws -> caller drops the row. A listing missing from ADA is a smaller failure than
  // a partner's private mobile published inside it.
  assertNoPhone(label, title, description)

  // Reported, never written. All 91 carry the Houzez Miami default today; if this ever
  // fires, Novest has started placing real pins and that is a decision, not an import.
  const lat = num(meta(p, 'houzez_geolocation_lat'))
  const lng = num(meta(p, 'houzez_geolocation_long'))
  if (coordsInCyprus(lat, lng)) ctx.coordsInBox.push(`${id}  ${lat},${lng}`)

  const row = {
      external_id: `${SOURCE}-${id}`,
      title,
      description,
      intent,
      property_type,
      price,
      currency: 'GBP',                     // all 91 are GBP; the CHECK rejects anything else
      price_period: intent === 'rent' ? 'monthly' : 'total',
      bedrooms:      int(meta(p, 'fave_property_bedrooms')),
      bathrooms:     int(meta(p, 'fave_property_bathrooms')),
      living_rooms:  int(meta(p, 'fave_property_rooms')),
      area_sqm:      num(meta(p, 'fave_property_size')),
      plot_sqm:      num(meta(p, 'fave_property_land')),
      district,
      area,
      deed_type:     extractDeedType(p.content.rendered),
      amenities,
      furnished:       featureSlugs.includes('esyali') || null,
      gated_community: featureSlugs.includes('siteicerisinde') || null,
      source_url: p.link,
      published_at: p.date_gmt ? `${p.date_gmt}Z` : null,
  }

  validateRow(row)
  return { row }
}

// Hash of the mutable payload only. Not of the raw API response — that carries their
// view counters, which change hourly and would make every listing look modified.
const hashRow = row => createHash('sha256')
  .update(JSON.stringify(MUTABLE.map(k => row[k] ?? null)))
  .digest('hex')

function assertHomogeneous(label, rows) {
  if (rows.length < 2) return
  const shape = Object.keys(rows[0]).sort().join(',')
  const odd = rows.findIndex(r => Object.keys(r).sort().join(',') !== shape)
  if (odd !== -1) {
    fail(`Refusing to upsert a ragged "${label}" payload — row ${odd} differs from row 0.`,
      'PostgREST would NULL every column the shorter rows omit.',
      `  row 0    : ${shape}`,
      `  row ${odd}: ${Object.keys(rows[odd]).sort().join(',')}`)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

loadEnv()
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')

const supabase = offline ? null : createClient(SUPABASE_URL, serviceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── Pre-flight ──────────────────────────────────────────────────────────────
if (!offline) {
const { data: agency, error: agencyErr } = await supabase
  .from('estate_agencies').select('id,name,status').eq('id', AGENCY_ID).maybeSingle()
if (agencyErr) fail(`Reading estate_agencies failed: ${agencyErr.message}`)
if (!agency) {
  fail(`The Novest agency row (${AGENCY_ID}) does not exist.`,
    'Apply supabase/migrations/20260916_novest_agency_and_seed_teardown.sql first',
    '(SQL editor, Role → postgres, WHOLE FILE).',
    '',
    'Without it every imported listing renders with no agency name — the one',
    'attribution the partner relationship requires.')
}
if (agency.status !== 'active') {
  fail(`The Novest agency row is status='${agency.status}'.`,
    "agencies_select_public hides anything but 'active' from anon, so the agency name",
    'would not render for a logged-out user.')
}

const { count: seedCount, error: seedErr } = await supabase
  .from('properties').select('id', { count: 'exact', head: true }).eq('source', 'seed-slice3')
if (seedErr) fail(`Reading properties failed: ${seedErr.message}`)
if (seedCount) {
  fail(`${seedCount} seed-slice3 listing(s) are still present.`,
    'They are anon-visible (props_select_public treats source IS NOT NULL as a bypass)',
    'and would sit alongside real listings. Apply the teardown in',
    '20260916_novest_agency_and_seed_teardown.sql before importing.')
}

console.log(`\nagency  : ${agency.name} (${agency.status})`)
console.log(`seed    : clean\n`)
} else {
  console.log('\n(offline) no database connection — mapping and constraint checks only\n')
}

// ─── Fetch ───────────────────────────────────────────────────────────────────
console.log('fetching taxonomies…')
const [types, statuses, states, cities, features] = await Promise.all([
  getAll('/property_type',   { _fields: 'id,name,slug' }),
  getAll('/property_status', { _fields: 'id,name,slug' }),
  getAll('/property_state',  { _fields: 'id,name,slug' }),
  getAll('/property_city',   { _fields: 'id,name,slug' }),
  getAll('/property_feature',{ _fields: 'id,name,slug' }),
])
const byId = list => new Map(list.map(t => [t.id, t]))
const ctx = {
  types: byId(types), statuses: byId(statuses), states: byId(states),
  cities: byId(cities), features: byId(features), coordsInBox: [],
}
console.log(`  types ${types.length} · statuses ${statuses.length} · states ${states.length} · cities ${cities.length} · features ${features.length}`)

console.log('fetching listings…')
const feed = await getAll('/properties', { orderby: 'modified', order: 'desc' })
console.log(`  ${feed.length} listings\n`)

if (!feed.length) {
  fail('The feed returned ZERO listings.', 'Refusing to run — this would delist every row. Nothing written.')
}

// ─── Map ─────────────────────────────────────────────────────────────────────
const rows = []
const skipped = []
for (const p of feed) {
  let out
  try { out = toRow(p, ctx) }
  catch (e) { skipped.push(`${p.id}: ${e.message}`); continue }
  if (out.skip) { skipped.push(out.skip); continue }
  rows.push({ ...out.row, content_hash: hashRow(out.row) })
}

// ─── Diff against the database ───────────────────────────────────────────────
let existing = []
if (!offline) {
  const { data, error: readErr } = await supabase
    .from('properties').select('external_id,status,content_hash').eq('source', SOURCE)
  if (readErr) fail(`Reading existing ${SOURCE} rows failed: ${readErr.message}`)
  existing = data ?? []
}

const byExternalId = new Map(existing.map(r => [r.external_id, r]))
const presentIds = rows.map(r => r.external_id)
const presentSet = new Set(presentIds)

const inserts = [], updates = []
let unchanged = 0
for (const row of rows) {
  const prev = byExternalId.get(row.external_id)
  if (!prev) { inserts.push(row); continue }
  if (prev.content_hash === row.content_hash) { unchanged++; continue }
  updates.push(row)
}

// Sync owns active <-> delisted and NOTHING ELSE. 'rejected' and 'archived' are admin
// decisions; re-activating one would silently undo a deliberate act, the same principle
// as the Gişe Kıbrıs importer never re-approving a hidden event.
const relist = existing.filter(r => r.status === 'delisted' && presentSet.has(r.external_id))
const delist = existing.filter(r => r.status === 'active'   && !presentSet.has(r.external_id))
const untouched = existing.filter(r => !['active', 'delisted'].includes(r.status))

// ─── THE MASS-DELIST GUARD ───────────────────────────────────────────────────
// A transient outage on their single LiteSpeed host must not empty the module. Delisting
// late costs nothing; delisting wrongly costs every listing.
const activeBefore = existing.filter(r => r.status === 'active').length
if (activeBefore > 0 && presentIds.length < activeBefore * DELIST_FLOOR) {
  fail(`ABORT — the feed returned ${presentIds.length} usable listing(s) against ${activeBefore} currently active.`,
    `That is below the ${Math.round(DELIST_FLOOR * 100)}% floor, so this looks like a bad fetch rather than`,
    'a mass delisting. NOTHING WRITTEN. Re-run; if it persists, check their site by hand.')
}

// ─── Report ──────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(3)
console.log('── plan ──')
console.log(`  insert     ${pad(inserts.length)}`)
console.log(`  update     ${pad(updates.length)}`)
console.log(`  unchanged  ${pad(unchanged)}   (content_hash match — not written)`)
console.log(`  relist     ${pad(relist.length)}   delisted -> active`)
console.log(`  delist     ${pad(delist.length)}   active -> delisted (row kept, never deleted)`)
console.log(`  skipped    ${pad(skipped.length)}`)
if (untouched.length) console.log(`  untouched  ${pad(untouched.length)}   (rejected/archived — sync does not own these)`)

if (skipped.length) {
  console.log('\n  SKIPPED — each needs a human decision, not a default:')
  for (const s of skipped) console.log(`    ${s}`)
}
if (delist.length) {
  console.log('\n  DELISTING:')
  for (const r of delist) console.log(`    ${r.external_id}`)
}
if (ctx.coordsInBox.length) {
  console.log(`\n  ⚠ ${ctx.coordsInBox.length} listing(s) now carry coordinates INSIDE the Cyprus box.`)
  console.log('    These are NOT imported. Slice 1 fixed feed rows at location_precision=\'area\';')
  console.log('    accepting real pins is a deliberate amendment, not an importer change.')
  for (const c of ctx.coordsInBox) console.log(`      ${c}`)
}

// Coverage, so a mapping that quietly stops working is visible in the run output rather
// than only in the database.
const cov = k => rows.filter(r => r[k] !== null && r[k] !== undefined).length
console.log('\n── coverage of the ' + rows.length + ' importable rows ──')
for (const k of ['district', 'area', 'bedrooms', 'area_sqm', 'plot_sqm', 'deed_type', 'amenities'])
  console.log(`  ${k.padEnd(14)} ${pad(cov(k))}`)

// ─── Write ───────────────────────────────────────────────────────────────────
const now = new Date().toISOString()

// Two shapes, two upserts, never mixed. Inserts carry the columns that are set ONCE and
// never rewritten; updates carry only the mutable set.
const insertPayload = inserts.map(r => ({
  ...r,
  source: SOURCE,
  agency_id: AGENCY_ID,
  status: 'active',
  // Required of every feed row by properties_feed_precision_check, coordinates or not:
  // the column DEFAULTs to 'exact', so omitting it is a 23514 rather than a silent lie.
  location_precision: 'area',
  last_seen_at: now,
}))
// ⚠ source / agency_id / location_precision ARE IN THE UPDATE PAYLOAD, AND MUST BE.
//
// They are immutable for a feed row, so including them looks redundant. It is not.
// PostgREST's upsert is INSERT ... ON CONFLICT DO UPDATE, and Postgres validates CHECK
// constraints against the PROPOSED INSERT ROW before it ever detects the conflict. A
// payload without them proposes a row with source NULL and agent_id NULL, which fails
// properties_source_agent_xor_check (both NULL satisfies neither branch), and without
// location_precision it inherits the 'exact' DEFAULT and fails
// properties_feed_precision_check. The existing row is never reached.
//
// FOUND THE HARD WAY, AND LATE: run 1 was 88 inserts and run 2 was 88 content_hash
// matches, so the update path had not executed once. It failed on the first real content
// change — and the cron function carries the same shape, so it would have failed there
// on the first price edit Novest made. Third instance this slice of a branch that was
// written, shipped and never run.
const updatePayload = updates.map(r => ({
  ...r, source: SOURCE, agency_id: AGENCY_ID, location_precision: 'area',
}))

// Deliberately outside the !dry guard: the payloads are built identically either way, so
// a ragged shape is fully detectable without writing anything. A check that only runs on
// the real run reports damage instead of preventing it.
assertHomogeneous('insert', insertPayload)
assertHomogeneous('update', updatePayload)

if (dry || offline) {
  const shape = p => (p.length ? Object.keys(p[0]).sort().join(', ') : '—')
  console.log(`\n── payload shapes (checked homogeneous) ──`)
  console.log(`  insert ${String(insertPayload.length).padStart(3)}  ${shape(insertPayload)}`)
  console.log(`  update ${String(updatePayload.length).padStart(3)}  ${shape(updatePayload)}`)
  if (insertPayload.length && updatePayload.length) {
    const only = (a, b) => Object.keys(a[0]).filter(k => !(k in b[0]))
    console.log(`  the two batches differ by: ${[...only(insertPayload, updatePayload).map(k => '+' + k),
      ...only(updatePayload, insertPayload).map(k => '-' + k)].join(', ') || 'nothing'}`)
    console.log(`  (sent as SEPARATE upserts — one mixed batch would NULL every column the other omits)`)
  }
  console.log(`\n(${offline ? 'offline' : 'dry'}) nothing written.`)
  process.exit(0)
}

let written = 0
for (const [label, payload] of [['insert', insertPayload], ['update', updatePayload]]) {
  if (!payload.length) continue
  const { data, error } = await supabase.from('properties')
    .upsert(payload, { onConflict: 'external_id' }).select('id')
  if (error) fail(`${label} upsert failed: ${error.message}`, error.details ?? '', error.hint ?? '')
  written += data?.length ?? 0
  console.log(`\n  ${label}: ${data?.length ?? 0} row(s)`)
}

if (relist.length) {
  const { error } = await supabase.from('properties').update({ status: 'active' })
    .eq('source', SOURCE).eq('status', 'delisted')
    .in('external_id', relist.map(r => r.external_id))
  if (error) fail(`relist failed: ${error.message}`)
  console.log(`  relist: ${relist.length} row(s)`)
}

if (delist.length) {
  const { error } = await supabase.from('properties').update({ status: 'delisted' })
    .eq('source', SOURCE).eq('status', 'active')
    .in('external_id', delist.map(r => r.external_id))
  if (error) fail(`delist failed: ${error.message}`)
  console.log(`  delist: ${delist.length} row(s)`)
}

// LAST, and on EVERY row present in the feed — changed or not. This column is the only
// health signal the module has: the AdminScreen staleness banner reads
// max(last_seen_at), so a run that writes nothing must still prove it ran.
// Excluded from properties_touch_updated_at, so this does not falsify updated_at.
{
  const { error } = await supabase.from('properties').update({ last_seen_at: now })
    .eq('source', SOURCE).in('external_id', presentIds)
  if (error) fail(`last_seen_at stamp failed: ${error.message}`)
}

// ─── Post-write invariant ────────────────────────────────────────────────────
// props_select_public requires status='active', so a row that lost its status is
// invisible to every user. Assert what the app actually depends on.
const { count: activeAfter, error: vErr } = await supabase
  .from('properties').select('id', { count: 'exact', head: true })
  .eq('source', SOURCE).eq('status', 'active')
if (vErr) fail(`Post-write verification failed: ${vErr.message}`)

console.log(`\n── done ──`)
console.log(`  ${written} row(s) written · ${activeAfter} active ${SOURCE} listing(s) · last_seen_at stamped on ${presentIds.length}`)
if (activeAfter !== rows.length) {
  console.error(`\n  ⚠ expected ${rows.length} active rows, found ${activeAfter}.`)
  console.error(`    Some row is not active — check for rejected/archived rows the sync does not own.`)
}
