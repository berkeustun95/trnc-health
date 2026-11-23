// Döveç partner feed: everything the sync knows about the API, in pure functions so node tests can import it.
// The edge function (sync-dovec/index.ts) only builds the store and calls runSync().
//
// API (read from Döveç's partner documentation, 2026-11-23):
//   GET {base}/api/partner/projects   Authorization: Bearer <DOVEC_PARTNER_KEY>
//   200 { generated_at, partner, currency, count, projects: [ { id, name, city, area, status, planned_delivery_month,
//         from_price, currency, available_units, unit_types: [{ type, from_price }], cover_image_url, website_url } ] }
//   401 key revoked or suspended; 503 { error: 'not_provisioned' }; 429 + Retry-After. Limit 60 requests per minute.
//
// Partner rule (Berke, 2026-11-10): an EMPTY field is on purpose. A null from_price / available_units / delivery month /
// cover is stored as NULL, never skipped, never invented. Only a project with no identity, or a value that is present
// but unreadable, is skipped (and reported, never fixed silently).
export const DEFAULT_BASE_URL = 'https://atlas.dovecgroup.com'
export const FETCH_TIMEOUT_MS = 20000
export const MASS_DELIST_FRACTION = 0.5

const STATUSES = ['on_sale', 'under_construction']
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = v => (typeof v === 'string' ? v.trim() : null)
const isHttps = v => { try { return new URL(v).protocol === 'https:' } catch { return false } }
const priceOrNull = v => (v === null || v === undefined ? { ok: true, v: null }
  : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? { ok: true, v } : { ok: false })

// One project -> a row for dovec_projects, or { ok:false, id, reason }. `reason` is a fixed word plus the field name.
export function mapProject(raw) {
  if (!isObj(raw)) return { ok: false, id: null, reason: 'not_an_object' }
  const id = typeof raw.id === 'string' ? raw.id.trim() : Number.isInteger(raw.id) ? String(raw.id) : ''
  if (!id || id.length > 100) return { ok: false, id: null, reason: 'id' }
  const bad = field => ({ ok: false, id, reason: field })
  const name = str(raw.name); if (!name || name.length > 200) return bad('name')
  const city = str(raw.city); if (!city || city.length > 100) return bad('city')
  const area = raw.area === null || raw.area === undefined ? '' : str(raw.area)
  if (area === null || area.length > 100) return bad('area')
  if (!STATUSES.includes(raw.status)) return bad('status')
  if (raw.currency !== 'GBP') return bad('currency')
  let delivery = null
  if (raw.planned_delivery_month !== null && raw.planned_delivery_month !== undefined) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.planned_delivery_month)
    if (!m) return bad('planned_delivery_month')
    delivery = `${m[1]}-${m[2]}-01`
  }
  const price = priceOrNull(raw.from_price); if (!price.ok) return bad('from_price')
  let units = null
  if (raw.available_units !== null && raw.available_units !== undefined) {
    if (!Number.isInteger(raw.available_units) || raw.available_units < 0) return bad('available_units')
    units = raw.available_units
  }
  const unitTypes = []
  if (raw.unit_types !== null && raw.unit_types !== undefined) {
    if (!Array.isArray(raw.unit_types)) return bad('unit_types')
    for (const u of raw.unit_types) {
      const type = isObj(u) ? str(u.type) : null
      const p = isObj(u) ? priceOrNull(u.from_price) : { ok: false }
      if (!type || type.length > 100 || !p.ok) return bad('unit_types')
      unitTypes.push({ type, from_price: p.v })
    }
  }
  let cover = null
  if (raw.cover_image_url !== null && raw.cover_image_url !== undefined && raw.cover_image_url !== '') {
    if (typeof raw.cover_image_url !== 'string' || !isHttps(raw.cover_image_url)) return bad('cover_image_url')
    cover = raw.cover_image_url
  }
  if (typeof raw.website_url !== 'string' || !isHttps(raw.website_url)) return bad('website_url')
  return { ok: true, row: {
    id, name, city, area: area || null, status: raw.status, planned_delivery_month: delivery, from_price: price.v,
    currency: 'GBP', available_units: units, unit_types: unitTypes, cover_url: cover, website_url: raw.website_url,
  } }
}

// Envelope + every project -> { ok:false, status, detail } or { ok:true, rows, skipped:[{id,reason}], seenIds:Set }.
// seenIds holds every readable id in the feed, valid or not: a project that is present but invalid keeps its old row.
export function mapFeed(body) {
  if (!isObj(body) || !Array.isArray(body.projects) || !Number.isInteger(body.count)) {
    return { ok: false, status: 'parse_error', detail: 'envelope: projects or count missing' }
  }
  if (body.count !== body.projects.length) {
    return { ok: false, status: 'refused_count_mismatch', detail: `count says ${body.count}, list has ${body.projects.length}` }
  }
  const rows = [], skipped = [], seenIds = new Set()
  for (const raw of body.projects) {
    const m = mapProject(raw)
    const id = m.ok ? m.row.id : m.id
    if (id) {
      if (seenIds.has(id)) { skipped.push({ id, reason: 'duplicate_id' }); continue }
      seenIds.add(id)
    }
    if (m.ok) rows.push(m.row); else skipped.push({ id: m.id, reason: m.reason })
  }
  return { ok: true, rows, skipped, seenIds, total: body.projects.length }
}

// What to do with a mapped feed given the ids we currently list. Refusals write nothing and do not advance the sync stamp.
export function planRun(mapped, listedIds) {
  if (mapped.total === 0) {
    return listedIds.length > 0
      ? { refuse: 'refused_empty', detail: `feed is empty while ${listedIds.length} projects are listed` }
      : { rows: [], delist: [] }
  }
  if (mapped.rows.length === 0) return { refuse: 'parse_error', detail: `all ${mapped.total} projects were unreadable` }
  const delist = listedIds.filter(id => !mapped.seenIds.has(id))
  if (listedIds.length > 0 && delist.length > listedIds.length * MASS_DELIST_FRACTION) {
    return { refuse: 'refused_mass_delist', detail: `would delist ${delist.length} of ${listedIds.length} listed projects` }
  }
  return { rows: mapped.rows, delist }
}

// One GET. Returns { kind: 'ok', body } or { kind: <last_run_status vocabulary>, detail }.
export async function fetchProjects({ baseUrl = DEFAULT_BASE_URL, apiKey, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }) {
  if (!apiKey) return { kind: 'http_error', detail: 'DOVEC_PARTNER_KEY is not set' }
  let res
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/partner/projects`, {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch { return { kind: 'network_error', detail: 'request failed or timed out' } }
  if (res.status === 401) return { kind: 'http_401', detail: 'partner key rejected (revoked or suspended)' }
  if (res.status === 429) return { kind: 'http_429', detail: `rate limited, retry-after ${res.headers?.get?.('retry-after') ?? 'unknown'}` }
  let text = ''
  try { text = await res.text() } catch { /* no body */ }
  if (res.status === 503 && /not_provisioned/.test(text)) return { kind: 'not_provisioned', detail: 'partner not provisioned' }
  if (res.status !== 200) return { kind: 'http_error', detail: `HTTP ${res.status}` }
  try { return { kind: 'ok', body: JSON.parse(text) } } catch { return { kind: 'parse_error', detail: 'response is not JSON' } }
}

const describe = (skipped, extra) => {
  const bad = skipped.slice(0, 10).map(s => `${s.id ?? '?'}:${s.reason}`).join(', ')
  return `${extra}${skipped.length ? `; skipped ${skipped.length} (${bad})` : ''}`.slice(0, 1000)
}

// The whole run, store injected:
//   store.listedIds() -> string[]            ids of rows with listed = true
//   store.upsert(rows, nowIso)               idempotent upsert, listed = true, delisted_at = null
//   store.delist(ids, nowIso)
//   store.setState(patch)                    patch of dovec_settings status columns
// Returns { status, detail, valid, skipped, delisted }. Never throws on a Döveç-side problem.
export async function runSync({ apiKey, baseUrl, fetchImpl, store, now = () => new Date() }) {
  const nowIso = now().toISOString()
  const finish = async (status, detail, patch = {}, extra = {}) => {
    await store.setState({ last_run_at: nowIso, last_run_status: status, last_run_detail: detail.slice(0, 1000), ...patch })
    return { status, detail, valid: 0, skipped: 0, delisted: 0, ...extra }
  }
  const got = await fetchProjects({ baseUrl, apiKey, fetchImpl })
  if (got.kind === 'http_401') return finish('http_401', got.detail, { suspended: true })
  if (got.kind !== 'ok') return finish(got.kind, got.detail)
  const mapped = mapFeed(got.body)
  if (!mapped.ok) return finish(mapped.status, mapped.detail)
  let listed
  try { listed = await store.listedIds() } catch { return finish('write_error', 'could not read the listed projects') }
  const plan = planRun(mapped, listed)
  if (plan.refuse) return finish(plan.refuse, plan.detail, {}, { skipped: mapped.skipped.length })
  try {
    if (plan.rows.length) await store.upsert(plan.rows, nowIso)
    if (plan.delist.length) await store.delist(plan.delist, nowIso)
  } catch { return finish('write_error', 'writing projects failed; nothing marked good') }
  const detail = describe(mapped.skipped, `projects ${plan.rows.length} valid of ${mapped.total}, delisted ${plan.delist.length}`)
  return finish('ok', detail, { suspended: false, last_good_sync_at: nowIso },
    { valid: plan.rows.length, skipped: mapped.skipped.length, delisted: plan.delist.length })
}
