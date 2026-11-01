// ─── Döveç feed — THE ONE MAPPING FILE ───────────────────────────────────────
//
// Everything that depends on Döveç's API lives here and nowhere else: base URL, auth, pagination,
// and the field mapping (their fields → property_projects / properties). When the real API
// arrives, the edits are in this file only — see supabase/functions/sync-dovec/PLUG-IN.md.
//
// ⚠ THE API SHAPE BELOW IS A GUESS. Döveç has not sent the API yet; every field name marked
//   `GUESS` was invented for the mock fixture (sync-dovec/fixtures/dovec-mock.json). Change the
//   marked lines to their real names; the rules around them (contact strip, price coupling,
//   status vocabulary, content_hash) stay.
//
// Imported by BOTH runtimes, like novest-feed.mjs:
//   • Deno — supabase/functions/sync-dovec/index.ts (the cron job)
//   • Node — scripts/mirror-dovec-images.mjs, scripts/test-dovec-sync.mjs,
//            scripts/build-dovec-preview.mjs
// So: no `node:` import, no React Native import. fetch, URL, crypto.subtle only.
//
// The contact strip and number parsing are NOT re-implemented: they are Novest's, imported, so a
// fix to the detectors protects both partners at once.

import { cleanDescription, contactCutReport, assertNoContact, decodeEntities, num, int } from './novest-feed.mjs'

export const SOURCE = 'dovec'
export const AGENCY_ID = '00000000-0000-4000-9000-000000000003'   // seeded pending by 20261153

// ─── API ACCESS ──────────────────────────────────────────────────────────────
// Both come from the Edge Function's secrets (scripts/sb.sh secrets set …), never from this file.
export const ENV_BASE_URL = 'DOVEC_API_BASE_URL'     // e.g. https://api.dovec.example/v1   (GUESS)
export const ENV_API_KEY = 'DOVEC_API_KEY'
export const PROJECTS_PATH = '/projects'               // GUESS: one endpoint, units nested per project
export const PER_PAGE = 50                             // GUESS
const UA = 'ADA-TRNC-Health/1.0 (+https://getadaapp.com; partner listing sync)'
const REQUEST_DELAY_MS = 500

export function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` }        // GUESS: may be 'x-api-key': apiKey
}

// Reads one page and says whether another follows. GUESS: { data: [...], meta: { last_page } }.
export function readPage(body) {
  if (!body || !Array.isArray(body.data)) throw new Error(`expected { data: [...] }, got ${typeof body?.data}`)
  return { items: body.data, lastPage: Number(body.meta?.last_page) || 1 }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Every page, or a throw. A partial read would look like mass delisting, so there is no
// "return what we have".
export async function fetchFeed({ baseUrl, apiKey, fetchImpl = fetch, delayMs = REQUEST_DELAY_MS }) {
  if (!baseUrl || !apiKey) throw new Error(`${ENV_BASE_URL} / ${ENV_API_KEY} not set — the Döveç API is not connected`)
  const out = []
  for (let page = 1; ; page++) {
    if (page > 1 && delayMs) await sleep(delayMs)
    const url = new URL(baseUrl.replace(/\/$/, '') + PROJECTS_PATH)
    url.searchParams.set('page', String(page))         // GUESS
    url.searchParams.set('per_page', String(PER_PAGE)) // GUESS
    const res = await fetchImpl(url.toString(), {
      headers: { ...authHeaders(apiKey), Accept: 'application/json', 'User-Agent': UA },
    })
    if (!res.ok) throw new Error(`GET ${url.pathname}?page=${page} -> ${res.status}`)
    const { items, lastPage } = readPage(await res.json())
    out.push(...items)
    if (page >= lastPage) break
    if (page > 200) throw new Error('more than 200 pages — refusing (pagination loop?)')
  }
  return out
}

// ─── VOCABULARIES (their value → ours) ───────────────────────────────────────
export const PROJECT_STATUS = {                          // GUESS: their status strings
  on_sale: 'selling', selling: 'selling', launch: 'selling',
  under_construction: 'under_construction', construction: 'under_construction',
  completed: 'delivered', delivered: 'delivered', ready: 'delivered',
}

export const UNIT_TYPE = {                               // GUESS: their unit category strings
  apartment: 'apartment', flat: 'apartment', penthouse: 'apartment', loft: 'apartment', duplex: 'apartment',
  studio: 'studio',
  villa: 'villa', bungalow: 'villa',
  townhouse: 'house', house: 'house',
  shop: 'commercial', office: 'commercial', commercial: 'commercial',
}

// Only these are listed. reserved / sold units are treated as absent from the feed, so a unit that
// sells is delisted by the normal path (row kept, never deleted).
export const UNIT_LISTED = new Set(['available'])        // GUESS

export const DISTRICT = {                                // their city → ADA region
  lefkosa: 'nicosia', nicosia: 'nicosia',
  girne: 'kyrenia', kyrenia: 'kyrenia',
  gazimagusa: 'famagusta', famagusta: 'famagusta', magusa: 'famagusta',
  guzelyurt: 'morphou', morphou: 'morphou',
  iskele: 'iskele', trikomo: 'iskele',
  lefke: 'lefke',
  karpaz: 'karpaz',
}

const CURRENCIES = new Set(['GBP', 'TRY', 'EUR', 'USD'])

// ─── content_hash: ONE list per table, defined once ──────────────────────────
// The hash is over exactly these keys in this order. sync-novest keeps two copies of its list
// (Edge Function + importer) and documents the drift risk; here there is one.
export const PROJECT_MUTABLE = [
  'name', 'description', 'project_status', 'construction_progress', 'delivery_date', 'unit_types',
  'price_from', 'currency', 'price_on_request', 'district', 'area', 'address',
  'latitude', 'longitude', 'location_precision', 'source_url',
]
export const UNIT_MUTABLE = [
  'title', 'description', 'property_type', 'price', 'price_on_request', 'currency',
  'bedrooms', 'bathrooms', 'living_rooms', 'area_sqm', 'net_area_sqm', 'floor',
  'district', 'area', 'development_name', 'amenities', 'source_url', 'project_external_id',
]

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export const hashOf = (row, keys) => sha256Hex(JSON.stringify(keys.map(k => row[k] ?? null)))

// ─── Small parsers ───────────────────────────────────────────────────────────
const slugify = s => String(s ?? '').toLocaleLowerCase('tr')
  .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// "2027-Q2" → 2027-04-01 (first day of the quarter; rendered as a quarter). "2026-09-30" kept.
export function parseDelivery(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})-Q([1-4])$/i)
  if (m) return `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return s
  return null
}

// "2+1" → { bedrooms: 2, living_rooms: 1 }; "Studio" → { bedrooms: 0, living_rooms: null }
export function parseLayout(raw) {
  const s = String(raw ?? '').trim()
  const m = s.match(/^(\d{1,2})\s*\+\s*(\d)$/)
  if (m) return { bedrooms: Number(m[1]), living_rooms: Number(m[2]) }
  if (/^st(u|ü)d(y|i)o/i.test(s)) return { bedrooms: 0, living_rooms: null }
  return { bedrooms: null, living_rooms: null }
}

// Their price block → our coupled pair. Never coerce: a non-number price that is not flagged
// on-request is a REJECTED row, not a zero.
function priceOf(p) {
  if (p?.on_request === true) return { price: null, price_on_request: true, currency: null }   // GUESS
  const price = num(p?.amount ?? p?.from)                                                       // GUESS
  const currency = String(p?.currency ?? '').toUpperCase()                                      // GUESS
  if (price === null || price <= 0) return { error: `price ${JSON.stringify(p?.amount ?? p?.from)}` }
  if (!CURRENCIES.has(currency)) return { error: `currency ${JSON.stringify(p?.currency)}` }
  return { price, price_on_request: false, currency }
}

function placeOf(loc, areasByRegion, areaSlugOf) {
  const district = DISTRICT[slugify(loc?.city)] ?? null                                         // GUESS
  let area = null
  const cand = slugify(loc?.area)                                                               // GUESS
  if (district && cand && (areasByRegion[district] || []).some(n => areaSlugOf(n) === cand)) area = cand
  return { district, area }
}

function cleanText(id, html, flagged) {
  const raw = String(html ?? '')
  const text = cleanDescription(raw) || null
  const cut = contactCutReport(raw).flagged
  if (cut) flagged.push(`${id}: ${cut}`)
  return text
}

// ─── THE MAPPING ─────────────────────────────────────────────────────────────
// Pure. feed = the array fetchFeed returned. Returns rows ready for the DB minus the per-run
// fields (status, last_seen_at), plus skipped/flagged reports that name ids and KINDS only, so
// they can go into public run logs.
export async function mapFeed(feed, { areasByRegion, areaSlugOf }) {
  const projects = [], units = [], skipped = [], flagged = []

  for (const p of feed) {
    const pid = `${SOURCE}-p${p.id}`                                                            // GUESS: p.id
    const project_status = PROJECT_STATUS[slugify(p.status).replace(/-/g, '_')]                 // GUESS: p.status
    if (!project_status) { skipped.push(`${pid}: status ${JSON.stringify(p.status)}`); continue }

    const name = decodeEntities(p.name).trim()                                                  // GUESS: p.name
    const description = cleanText(pid, p.description_html, flagged)                             // GUESS: p.description_html
    try { assertNoContact(pid, name, description) }
    catch (e) { skipped.push(`${pid}: ${e.message}`); continue }

    const priceP = p.price?.on_request === true
      ? { price: null, price_on_request: true, currency: null }
      : (p.price?.from == null ? { price: null, price_on_request: false, currency: null } : priceOf(p.price))
    if (priceP.error) { skipped.push(`${pid}: ${priceP.error}`); continue }

    const lat = num(p.location?.lat), lng = num(p.location?.lng)                                // GUESS
    const hasPin = lat !== null && lng !== null && lat >= 34.5 && lat <= 35.8 && lng >= 32.2 && lng <= 34.7
    if ((lat !== null || lng !== null) && !hasPin) flagged.push(`${pid}: coordinates outside Cyprus — not stored`)

    const progress = int(p.progress_percent)                                                    // GUESS
    const unitTypes = (Array.isArray(p.unit_types) ? p.unit_types : [])                         // GUESS
      .map(s => decodeEntities(s).trim()).filter(Boolean).slice(0, 30)

    const project = {
      external_id: pid,
      name,
      description,
      project_status,
      construction_progress: project_status === 'delivered' ? 100
        : (progress !== null && progress >= 0 && progress <= 100 ? progress : null),
      delivery_date: parseDelivery(p.delivery),                                                 // GUESS
      unit_types: unitTypes.length ? unitTypes : null,
      price_from: priceP.price,
      currency: priceP.currency,
      price_on_request: priceP.price_on_request,
      ...placeOf(p.location, areasByRegion, areaSlugOf),
      address: p.location?.address ? decodeEntities(p.location.address).trim() : null,          // GUESS
      latitude: hasPin ? lat : null,
      longitude: hasPin ? lng : null,
      location_precision: hasPin ? 'exact' : null,                                              // a site pin is the site
      source_url: p.url || null,                                                                // GUESS
    }
    if (!project.name || project.name.length > 200) { skipped.push(`${pid}: name length`); continue }
    project.content_hash = await hashOf(project, PROJECT_MUTABLE)
    project.media = mediaOf(p.gallery)                                                          // for the image mirror, not stored
    projects.push(project)

    for (const u of Array.isArray(p.units) ? p.units : []) {                                    // GUESS: nested units
      const uid = `${SOURCE}-u${u.id}`                                                          // GUESS: u.id
      if (!UNIT_LISTED.has(slugify(u.availability))) { skipped.push(`${uid}: ${u.availability ?? 'no availability'}`); continue }
      const property_type = UNIT_TYPE[slugify(u.category)]                                      // GUESS: u.category
      if (!property_type) { skipped.push(`${uid}: category ${JSON.stringify(u.category)}`); continue }
      const pr = priceOf(u.price)                                                               // GUESS: u.price {amount,currency,on_request}
      if (pr.error) { skipped.push(`${uid}: ${pr.error}`); continue }

      const layout = parseLayout(u.layout)                                                      // GUESS: u.layout "2+1"
      const typeLabel = decodeEntities(u.layout || u.category).trim()
      const title = `${name} · ${typeLabel}${u.code ? ` ${decodeEntities(u.code).trim()}` : ''}` // GUESS: u.code
      const udesc = cleanText(uid, u.description_html, flagged)                                 // GUESS
      try { assertNoContact(uid, title, udesc) }
      catch (e) { skipped.push(`${uid}: ${e.message}`); continue }

      const features = (Array.isArray(u.features) ? u.features : [])                            // GUESS
        .map(s => decodeEntities(s).trim()).filter(Boolean).slice(0, 60)
      const unit = {
        external_id: uid,
        project_external_id: pid,
        title,
        description: udesc,
        intent: 'sale',
        property_type,
        price: pr.price,
        price_on_request: pr.price_on_request,
        // properties.currency is NOT NULL DEFAULT 'GBP'; an on-request unit carries the project's
        // currency (or GBP) so the column stays truthful about what a quote will be in.
        currency: pr.currency ?? project.currency ?? 'GBP',
        price_period: 'total',
        bedrooms: layout.bedrooms ?? int(u.bedrooms),                                           // GUESS
        bathrooms: int(u.bathrooms),                                                            // GUESS
        living_rooms: layout.living_rooms,
        area_sqm: num(u.gross_m2),                                                              // GUESS
        net_area_sqm: num(u.net_m2),                                                            // GUESS
        floor: int(u.floor),                                                                    // GUESS
        district: project.district,
        area: project.area,
        development_name: name,
        // null, never [] — properties_amenities_shape_check rejects an empty array.
        amenities: features.length ? features : null,
        source_url: u.url || project.source_url,                                                // GUESS
      }
      unit.content_hash = await hashOf(unit, UNIT_MUTABLE)
      unit.media = mediaOf(u.images)                                                            // GUESS: u.images
      units.push(unit)
    }
  }
  return { projects, units, skipped, flagged }
}

// [{ id, url, is_cover }] → [{ mediaId, url, cover }]; cover first, deduped by id. GUESS on names.
export function mediaOf(list) {
  const out = []
  for (const m of Array.isArray(list) ? list : []) {
    const mediaId = String(m?.id ?? '').trim()
    const url = String(m?.url ?? '').trim()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(mediaId) || !/^https:\/\//.test(url)) continue
    if (out.some(x => x.mediaId === mediaId)) continue
    const item = { mediaId, url, cover: m.is_cover === true }
    if (item.cover) out.unshift(item); else out.push(item)
  }
  return out
}

// ─── THE DIFF ────────────────────────────────────────────────────────────────
// Pure, shared by projects and units. existing = [{ external_id, status, content_hash }].
// publish = the Döveç agency row is 'active'. While it is pending, new rows land 'pending' and
// nothing is ever promoted: the sync owns active <-> delisted and never pending -> active.
export const DELIST_FLOOR = 0.7

export function planSync(mapped, existing, { publish }) {
  const prev = new Map(existing.map(r => [r.external_id, r]))
  const present = new Set(mapped.map(r => r.external_id))
  const inserts = mapped.filter(r => !prev.has(r.external_id))
  const updates = mapped.filter(r => prev.has(r.external_id) && prev.get(r.external_id).content_hash !== r.content_hash)
  const relist = publish ? existing.filter(r => r.status === 'delisted' && present.has(r.external_id)) : []
  const delist = existing.filter(r => r.status === 'active' && !present.has(r.external_id))
  const activeBefore = existing.filter(r => r.status === 'active').length
  const abort = activeBefore > 0 && mapped.length < activeBefore * DELIST_FLOOR
    ? `${mapped.length} usable row(s) against ${activeBefore} active — below the ${Math.round(DELIST_FLOOR * 100)}% floor`
    : null
  return {
    inserts, updates, relist, delist, abort,
    unchanged: mapped.length - inserts.length - updates.length,
    insertStatus: publish ? 'active' : 'pending',
  }
}

// DB payloads. source / agency_id / location_precision ride in EVERY upsert row, inserts and
// updates alike: Postgres checks CHECK constraints on the proposed INSERT row before it sees the
// conflict (sync-novest, "FOUND THE HARD WAY"). media / project_external_id are not columns.
export function projectPayload(r, extra = {}) {
  const { media, ...row } = r
  return { ...row, source: SOURCE, agency_id: AGENCY_ID, ...extra }
}
export function unitPayload(r, projectIdByExternal, extra = {}) {
  const { media, project_external_id, ...row } = r
  const project_id = projectIdByExternal.get(project_external_id)
  if (!project_id) throw new Error(`${r.external_id}: project ${project_external_id} has no id`)
  return { ...row, project_id, source: SOURCE, agency_id: AGENCY_ID, location_precision: 'area', ...extra }
}
