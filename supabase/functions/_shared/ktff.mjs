// KTFF "Sitene Ekle" API -> ktff_leagues / ktff_standings / ktff_fixtures, on cron (20261228).
//
// Pure parsing, back-off math, the request/run orchestration and the Edge handler live here, so Node can test them
// (scripts/check-ktff-sync.mjs). Deno and Node both provide fetch, Intl and crypto.subtle; the Supabase client is
// reached only through supabaseStore() and the logo storage object, which tests replace.
//
// Rules that shape the code (Berke / KTFF terms):
//   * KTFF asked for server-side fetching, no frequent polling: the cron job calls this only when ktff_sync_due() says so,
//     and one run spends at most REQUEST_BUDGET requests.
//   * Origin https://getadaapp.com is how KTFF recognises us (403 until they approve it). No key.
//   * Data is NEVER deleted because a request failed. The only delete is a league's stale standings rows, and only
//     when that league's response held rows.
//   * KTFF's logo URLs come from API data: only https on ktff.org or a subdomain is ever fetched (SSRF guard), only
//     png / jpeg / webp (no SVG), and only OUR copy in the public team-logos bucket is stored in *_logo_url.
import { serviceCaller } from './caller-auth.mjs'

export const KTFF_BASE = 'https://ktff.org/api/sitene-ekle'
export const KTFF_ORIGIN = 'https://getadaapp.com'
export const KTFF_TZ = 'Asia/Famagusta'
export const LEAGUES = [1, 2]
export const REQUEST_BUDGET = 10
export const BACKFILL_PER_LEAGUE = 3
export const TIMEOUT_MS = 10000
export const MAX_BODY_CHARS = 2000000

const MIN = 60000
const HOUR = 3600000
export const BASE_BACKOFF_MS = 15 * MIN
export const MAX_BACKOFF_MS = 6 * HOUR
export const FORBIDDEN_BACKOFF_MS = 6 * HOUR
export const NOT_FOUND_BACKOFF_MS = 6 * HOUR
const RETRY_AFTER_MIN_MS = MIN
const RETRY_AFTER_MAX_MS = 24 * HOUR

export const LOGO_MAX_BYTES = 524288
export const LOGO_COPIES_PER_RUN = 40
export const LOGO_TIME_BUDGET_MS = 45000

// ─── Sanitising ─────────────────────────────────────────────────────────────
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g

export function cleanText(v, max = 120) {
  if (typeof v !== 'string') return null
  const s = [...v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('')
  return s === '' ? null : s
}

export function cleanInt(v) {
  return Number.isInteger(v) && Math.abs(v) <= 2147483647 ? v : null
}

export function cleanColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null
}

// KTFF logo -> a URL we are willing to fetch and store as source_logo_url, or null.
export function ktffLogoSource(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === '' || s.length > 500) return null
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return null
  const h = u.hostname.toLowerCase()
  if (h !== 'ktff.org' && !h.endsWith('.ktff.org')) return null
  return u.toString()
}

const arr = v => (Array.isArray(v) ? v : [])
const obj = v => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)

// ─── Time zone: KTFF's wall clock -> an instant ─────────────────────────────
// Asia/Famagusta (EET / EEST), NOT a fixed +03:00: the tz database has it at UTC+2 in winter and UTC+3 in summer.
const tzFormats = new Map()
function tzOffsetMs(utcMs, tz) {
  let f = tzFormats.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' })
    tzFormats.set(tz, f)
  }
  const p = {}
  for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000
}

// 'YYYY-MM-DD HH:mm' in tz -> ISO UTC string; null when blank, malformed, or not a real date.
export function localToUtcIso(local, tz = KTFF_TZ) {
  if (typeof local !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(local.trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const back = new Date(wall)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
      || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) return null
  const guess = wall - tzOffsetMs(wall, tz)
  const utc = wall - tzOffsetMs(guess, tz)
  return new Date(utc).toISOString()
}

// ─── Parsing (tolerant: unknown or missing -> null, never throws on shape) ──
const LABEL_FIELDS = ['text', 'label', 'name', 'title']

function legendOf(list) {
  const out = new Map()
  for (const e of arr(list)) {
    const o = obj(e)
    const id = o && cleanInt(o.id)
    if (id === null || id === undefined) continue
    let label = null
    for (const f of LABEL_FIELDS) if (typeof o[f] === 'string') { label = cleanText(o[f], 80); break }
    out.set(id, { id, color: cleanColor(o.color), text_color: cleanColor(o.text_color), label })
  }
  return out
}

// tr and en merged by id; the English label falls back to the Turkish one.
export function mergeLegend(trList, enList) {
  const tr = legendOf(trList)
  const en = legendOf(enList)
  const ids = [...tr.keys(), ...[...en.keys()].filter(id => !tr.has(id))]
  return ids.map(id => {
    const a = tr.get(id)
    const b = en.get(id)
    return {
      id,
      color: a?.color ?? b?.color ?? null,
      text_color: a?.text_color ?? b?.text_color ?? null,
      label_tr: a?.label ?? b?.label ?? null,
      label_en: b?.label ?? a?.label ?? null,
    }
  })
}

function marker(row) {
  const m = obj(row?.position_marker)
  return {
    marker_id: m ? cleanInt(m.id) : null,
    marker_color: m ? cleanColor(m.color) : null,
    marker_text_color: m ? cleanColor(m.text_color) : null,
  }
}

// One /puan-durumu league item -> { league_id, name_tr, name_en, source_logo_url, legend, rows, skipped }.
// league_id outside {1,2} -> null (the table's CHECK would refuse it).
export function parseStandingsItem(item) {
  const it = obj(item)
  const league_id = it ? cleanInt(it.league_id) : null
  if (league_id === null || !LEAGUES.includes(league_id)) return null
  const trRows = arr(it.data_tr).map(obj).filter(Boolean)
  const enRows = arr(it.data_en).map(obj).filter(Boolean)
  const enById = new Map(enRows.map(r => [cleanInt(r.team_id), r]))
  const seen = new Set()
  const rows = []
  let skipped = 0
  const take = (r, other) => {
    const team_id = cleanInt(r.team_id)
    if (team_id === null || seen.has(team_id)) { skipped++; return }
    seen.add(team_id)
    rows.push({
      league_id, team_id,
      rank: cleanInt(r.rank),
      team_tr: cleanText(r.team) ?? null,
      team_en: cleanText(other?.team) ?? null,
      source_logo_url: ktffLogoSource(r.team_logo) ?? ktffLogoSource(other?.team_logo),
      played: cleanInt(r.played), won: cleanInt(r.won), drawn: cleanInt(r.drawn), lost: cleanInt(r.lost),
      goals_for: cleanInt(r.goals_for), goals_against: cleanInt(r.goals_against),
      goal_difference: cleanInt(r.goal_difference), points: cleanInt(r.points),
      ...marker(r),
    })
  }
  for (const r of trRows) take(r, enById.get(cleanInt(r.team_id)))
  const trIds = new Set(trRows.map(r => cleanInt(r.team_id)))
  for (const r of enRows) if (!trIds.has(cleanInt(r.team_id))) {
    // Turkish row missing: build from English only; the Turkish name stays null and the app falls back.
    const before = rows.length
    take(r, r)
    if (rows.length > before) rows[rows.length - 1].team_tr = null
  }
  const trLegend = arr(it.position_legend_tr)
  const enLegend = it.position_legend_en === undefined || arr(it.position_legend_en).length === 0 ? trLegend : arr(it.position_legend_en)
  return {
    league_id,
    name_tr: cleanText(it.name_tr), name_en: cleanText(it.name_en),
    source_logo_url: ktffLogoSource(it.logo),
    legend: mergeLegend(trLegend, enLegend),
    rows, skipped,
  }
}

export function parseStandings(json) {
  const j = obj(json)
  return arr(j?.data).map(parseStandingsItem).filter(Boolean)
}

const score = v => (typeof v === 'string' && /^[0-9]{1,3}$/.test(v.trim()) ? v.trim() : null)

// /fikstur response -> { league_id, name_tr, name_en, source_logo_url, selected_week, available_weeks, rows, skipped }.
// requestedWeek is used only when the response carries no selected_week of its own and the request named an integer week.
export function parseFixtures(json, requestedLeague, requestedWeek) {
  const j = obj(json) ?? {}
  const respLeague = cleanInt(j.league_id)
  const league_id = respLeague !== null && LEAGUES.includes(respLeague) ? respLeague : requestedLeague
  const selected_week = cleanInt(j.selected_week)
  const available_weeks = [...new Set(arr(j.available_weeks).map(cleanInt).filter(w => w !== null && w > 0))].sort((a, b) => a - b)
  const week = selected_week ?? (Number.isInteger(requestedWeek) ? requestedWeek : null)
  const trRows = arr(j.data_tr).map(obj).filter(Boolean)
  const enRows = arr(j.data_en).map(obj).filter(Boolean)
  const enById = new Map(enRows.map(r => [cleanInt(r.match_id), r]))
  const seen = new Set()
  const rows = []
  let skipped = 0
  const take = (r, other, trSide) => {
    const match_id = cleanInt(r.match_id)
    if (match_id === null || week === null || !LEAGUES.includes(league_id) || seen.has(match_id)) { skipped++; return }
    seen.add(match_id)
    const local = typeof r.match_datetime === 'string' && r.match_datetime.trim() !== '' ? r.match_datetime.trim() : null
    const kickoff_at = local ? localToUtcIso(local) : null
    rows.push({
      match_id, league_id, week,
      home_team_tr: trSide ? cleanText(r.home_team) : null, home_team_en: cleanText(other ? other.home_team : (trSide ? null : r.home_team)),
      away_team_tr: trSide ? cleanText(r.away_team) : null, away_team_en: cleanText(other ? other.away_team : (trSide ? null : r.away_team)),
      home_source_logo_url: ktffLogoSource(r.home_logo) ?? ktffLogoSource(other?.home_logo),
      away_source_logo_url: ktffLogoSource(r.away_logo) ?? ktffLogoSource(other?.away_logo),
      home_score: score(r.home_score), away_score: score(r.away_score),
      match_local: kickoff_at ? local : null,
      kickoff_at,
    })
  }
  for (const r of trRows) take(r, enById.get(cleanInt(r.match_id)), true)
  const trIds = new Set(trRows.map(r => cleanInt(r.match_id)))
  for (const r of enRows) if (!trIds.has(cleanInt(r.match_id))) take(r, null, false)
  return {
    league_id, selected_week, available_weeks,
    name_tr: cleanText(j.name_tr), name_en: cleanText(j.name_en),
    source_logo_url: ktffLogoSource(j.logo),
    rows, skipped,
  }
}

// ─── Back-off ───────────────────────────────────────────────────────────────
// Retry-After: seconds or an HTTP date -> ms from now, or null.
export function parseRetryAfter(header, nowMs) {
  if (header === null || header === undefined) return null
  const s = String(header).trim()
  if (/^[0-9]{1,9}$/.test(s)) return Number(s) * 1000
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null
}

// n = the failure count AFTER this failure (>= 1): 15 min, 30, 60, 120, 240, then 6 h.
export function exponentialBackoffMs(n) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(Math.max(1, n) - 1, 10))
}

// What to persist after a failed request. outcome: 'http' | 'network' | 'non_json' | 'store'.
// status: the HTTP status (0 = timeout / network, -1 = a 200 that was not a JSON object).
// stop = this run must not spend the rest of its budget (403 = our Origin is not approved, 429 = rate limited).
export function planBackoff({ outcome, status, retryAfterHeader = null, failCount = 0, nowMs }) {
  const n = (Number.isInteger(failCount) && failCount >= 0 ? failCount : 0) + 1
  let delay
  let stop = false
  if (outcome === 'http' && status === 403) { delay = FORBIDDEN_BACKOFF_MS; stop = true }
  else if (outcome === 'http' && (status === 429 || status === 503)) {
    const ra = parseRetryAfter(retryAfterHeader, nowMs)
    delay = ra === null ? exponentialBackoffMs(n) : Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ra))
    stop = status === 429
  }
  else if (outcome === 'http' && (status === 404 || status === 422)) delay = NOT_FOUND_BACKOFF_MS
  else delay = exponentialBackoffMs(n)
  return { failCount: n, delayMs: delay, nextAllowedAt: new Date(nowMs + delay).toISOString(), stop }
}

// ─── One KTFF request ───────────────────────────────────────────────────────
// -> { outcome: 'ok', status: 200, etag, json } | { outcome: 'not_modified', status: 304 }
//  | { outcome: 'http', status, retryAfter } | { outcome: 'network', status: 0 } | { outcome: 'non_json', status: -1 }
export async function ktffGet(fetchImpl, path, params, etag, timeoutMs = TIMEOUT_MS) {
  const qs = new URLSearchParams(params).toString()
  const headers = { Origin: KTFF_ORIGIN, Accept: 'application/json' }
  if (etag) headers['If-None-Match'] = etag
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let res
    try {
      res = await fetchImpl(`${KTFF_BASE}${path}${qs ? `?${qs}` : ''}`, { method: 'GET', headers, signal: ctrl.signal, redirect: 'manual' })
    } catch { return { outcome: 'network', status: 0 } }
    if (res.status === 304) { try { await res.body?.cancel() } catch { /* nothing to drain */ } return { outcome: 'not_modified', status: 304 } }
    if (!res.ok) {
      try { await res.body?.cancel() } catch { /* nothing to drain */ }
      return { outcome: 'http', status: res.status, retryAfter: res.headers.get('retry-after') }
    }
    let text
    try { text = await res.text() } catch { return { outcome: 'network', status: 0 } }
    let json = null
    try { json = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null } catch { json = null }
    if (!obj(json)) return { outcome: 'non_json', status: -1 }
    return { outcome: 'ok', status: 200, etag: res.headers.get('etag'), json }
  } finally { clearTimeout(timer) }
}

// ─── Logos ──────────────────────────────────────────────────────────────────
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function logoObjectPath(source, ext) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `ktff/${hex(d).slice(0, 16)}.${ext}`
}

// The file's own magic bytes decide the type; the Content-Type header must agree (so a server cannot label an SVG as png).
export function sniffImage(bytes) {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'image/webp', ext: 'webp' }
  return null
}

async function readCapped(res, max) {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) { try { await reader.cancel() } catch { /* done anyway */ } return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

// storage = { upload(path, bytes, contentType) -> { error }, publicUrl(path) -> string }. Returns our public URL or null; never throws.
export function makeLogoCopier({ fetchImpl, storage, timeoutMs = TIMEOUT_MS }) {
  return async function copyLogo(source) {
    const src = ktffLogoSource(source)
    if (!src) return null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(src, { method: 'GET', headers: { Accept: 'image/png,image/jpeg,image/webp' }, signal: ctrl.signal, redirect: 'manual' })
      if (!res.ok) return null
      const declared = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(declared)) return null
      const len = Number(res.headers.get('content-length'))
      if (Number.isFinite(len) && len > LOGO_MAX_BYTES) return null
      const bytes = await readCapped(res, LOGO_MAX_BYTES)
      if (!bytes) return null
      const kind = sniffImage(bytes)
      if (!kind || kind.type !== declared) return null
      const path = await logoObjectPath(src, kind.ext)
      const { error } = await storage.upload(path, bytes, kind.type)
      if (error) return null
      return storage.publicUrl(path) || null
    } catch { return null } finally { clearTimeout(timer) }
  }
}

// ─── The run ────────────────────────────────────────────────────────────────
// store: see supabaseStore() below for the contract. Returns a summary with no data in it.
export async function runKtff(store, { fetchImpl, copyLogo, nowFn = () => Date.now(), say = () => {} }) {
  const startMs = nowFn()
  const nowIso = () => new Date(nowFn()).toISOString()
  const states = await store.loadStates()
  const gate = states.get('standings')
  if (gate?.next_allowed_at && Date.parse(gate.next_allowed_at) > startMs) {
    return { ok: true, skipped: 'backoff', next_allowed_at: gate.next_allowed_at, requests: 0, endpoints: [] }
  }
  const leagues = await store.loadLeagues()
  const logoCache = await store.loadLogoCache()
  const logoFor = src => (src ? logoCache.get(src) ?? null : null)

  const endpoints = []
  let budget = REQUEST_BUDGET
  let stopped = false
  let gateUntil = null
  const note = (endpoint, status, extra) => endpoints.push({ endpoint, status, ...(extra ? { note: extra } : {}) })

  const fail = async (endpoint, r) => {
    const prev = states.get(endpoint)
    const plan = planBackoff({ outcome: r.outcome, status: r.status, retryAfterHeader: r.retryAfter, failCount: prev?.fail_count ?? 0, nowMs: nowFn() })
    await store.saveState(endpoint, { last_status: r.status, last_attempt_at: nowIso(), fail_count: plan.failCount, next_allowed_at: plan.nextAllowedAt })
    if (gateUntil === null || plan.nextAllowedAt > gateUntil) gateUntil = plan.nextAllowedAt
    if (plan.stop) stopped = true
    note(endpoint, r.status, r.outcome === 'http' ? `back off to ${plan.nextAllowedAt}` : r.outcome)
    say(`${endpoint}: ${r.outcome} ${r.status}, next ${plan.nextAllowedAt}`)
  }
  const succeed = async (endpoint, r) => {
    const prev = states.get(endpoint)
    await store.saveState(endpoint, {
      etag: r.outcome === 'ok' ? (r.etag ?? null) : (prev?.etag ?? null),
      last_status: r.status, last_attempt_at: nowIso(), last_success_at: nowIso(), next_allowed_at: null, fail_count: 0,
    })
    states.set(endpoint, { ...(prev ?? {}), last_success_at: nowIso() })
    note(endpoint, r.status)
  }
  // Request + persist + record. persist(r) runs only for a 200; a store error counts as a failure and leaves the ETag alone.
  const step = async (endpoint, path, params, persist) => {
    if (stopped || budget <= 0) return null
    budget--
    const r = await ktffGet(fetchImpl, path, params, states.get(endpoint)?.etag ?? null)
    if (r.outcome !== 'ok' && r.outcome !== 'not_modified') { await fail(endpoint, r); return null }
    try {
      if (r.outcome === 'ok') await persist(r.json)
    } catch (e) {
      await fail(endpoint, { outcome: 'store', status: 0 })
      say(`${endpoint}: store error ${String(e?.message || e).slice(0, 120)}`)
      return null
    }
    await succeed(endpoint, r)
    return r
  }

  const summary = { standings: { leagues: 0, rows: 0 }, fixtures: { requests: 0, rows: 0 }, logos: { copied: 0, failed: 0, pending: 0 } }
  const sel = new Map()
  const avail = new Map()
  for (const L of LEAGUES) { const row = leagues.get(L); sel.set(L, row?.current_week ?? null); avail.set(L, row?.available_weeks ?? []) }

  // 1. standings
  await step('standings', '/puan-durumu', {}, async json => {
    for (const item of parseStandings(json)) {
      const { rows, legend } = item
      await store.upsertLeague({
        league_id: item.league_id, ...(item.name_tr ? { name_tr: item.name_tr } : {}), ...(item.name_en ? { name_en: item.name_en } : {}),
        ...(item.source_logo_url ? { source_logo_url: item.source_logo_url, logo_url: logoFor(item.source_logo_url) } : {}),
        legend, updated_at: nowIso(),
      })
      const out = rows.map(({ ...r }) => ({ ...r, logo_url: logoFor(r.source_logo_url), updated_at: nowIso() }))
      if (out.length) {
        await store.upsertStandings(out)
        await store.pruneStandings(item.league_id, out.map(r => r.team_id))
      }
      summary.standings.leagues++
      summary.standings.rows += out.length
    }
  })

  const persistFixtures = (L, requestedWeek, isNow) => async json => {
    const p = parseFixtures(json, L, requestedWeek)
    const meta = {
      league_id: L, ...(p.name_tr ? { name_tr: p.name_tr } : {}), ...(p.name_en ? { name_en: p.name_en } : {}),
      ...(p.source_logo_url ? { source_logo_url: p.source_logo_url, logo_url: logoFor(p.source_logo_url) } : {}),
      updated_at: nowIso(),
    }
    if (isNow) {
      if (p.available_weeks.length) meta.available_weeks = p.available_weeks
      if (p.selected_week !== null) meta.current_week = p.selected_week
    }
    await store.upsertLeague(meta)
    if (isNow) {
      if (p.available_weeks.length) avail.set(L, p.available_weeks)
      if (p.selected_week !== null) sel.set(L, p.selected_week)
    }
    if (p.rows.length) {
      await store.upsertFixtures(p.rows.map(r => ({
        ...r, home_logo_url: logoFor(r.home_source_logo_url), away_logo_url: logoFor(r.away_source_logo_url), updated_at: nowIso(),
      })))
    }
    summary.fixtures.rows += p.rows.length
  }
  const fixturesStep = async (L, week, isNow) => {
    summary.fixtures.requests++
    const key = isNow ? `fixtures:${L}` : `fixtures:${L}:${week}`
    return step(key, '/fikstur', { league_id: String(L), week: isNow ? 'now' : String(week) }, persistFixtures(L, isNow ? null : week, isNow))
  }

  // 2. this week, both leagues
  for (const L of LEAGUES) await fixturesStep(L, null, true)
  // 3. the week before (late results)
  const prevDone = new Set()
  for (const L of LEAGUES) {
    const s = sel.get(L)
    const w = s !== null && s !== undefined ? s - 1 : null
    if (w !== null && w >= 1 && avail.get(L).includes(w)) { prevDone.add(`${L}:${w}`); await fixturesStep(L, w, false) }
  }
  // 4. backfill: up to 3 weeks per league the week picker has nothing for, nearest to the current week first
  if (!stopped && budget > 0) {
    for (const L of LEAGUES) {
      const s = sel.get(L)
      if (s === null || s === undefined) continue
      const have = await store.fixtureWeeks(L)
      const missing = avail.get(L)
        .filter(w => w !== s && !prevDone.has(`${L}:${w}`) && !have.has(w) && !states.get(`fixtures:${L}:${w}`)?.last_success_at)
        .sort((a, b) => Math.abs(a - s) - Math.abs(b - s) || a - b)
        .slice(0, BACKFILL_PER_LEAGUE)
      for (const w of missing) await fixturesStep(L, w, false)
    }
  }

  // 5. the global gate: the standings row is what ktff_sync_due() reads
  if (gateUntil !== null) await store.saveState('standings', { next_allowed_at: gateUntil })

  // 6. logos: copy what is still missing; a failed copy never fails the run
  try {
    const pending = [...(await store.pendingLogoSources())]
    summary.logos.pending = pending.length
    const deadline = nowFn() + LOGO_TIME_BUDGET_MS
    for (const src of pending.slice(0, LOGO_COPIES_PER_RUN)) {
      if (nowFn() > deadline) break
      const url = logoCache.get(src) ?? await copyLogo(src)
      if (!url) { summary.logos.failed++; continue }
      logoCache.set(src, url)
      try { await store.setLogo(src, url); summary.logos.copied++ } catch { summary.logos.failed++ }
    }
  } catch (e) { say(`logos: ${String(e?.message || e).slice(0, 120)}`) }

  const ok = endpoints.every(e => e.status === 200 || e.status === 304)
  return { ok, skipped: null, requests: REQUEST_BUDGET - budget, stopped, next_allowed_at: gateUntil, endpoints, ...summary, ms: nowFn() - startMs }
}

// ─── The Supabase side ──────────────────────────────────────────────────────
const PAGE = 500 // below the project's max-rows (1000), so a short page really is the last page

export function supabaseStore(sb) {
  const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data ?? [] }
  const all = async (table, cols, filter) => {
    const out = []
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select(cols)
      if (filter) q = filter(q)
      const rows = must(await q.range(from, from + PAGE - 1), table)
      out.push(...rows)
      if (rows.length < PAGE) return out
    }
  }
  const chunks = (rows, n = 200) => { const o = []; for (let i = 0; i < rows.length; i += n) o.push(rows.slice(i, i + n)); return o }
  const LOGO_COLS = [
    ['ktff_leagues', 'source_logo_url', 'logo_url'],
    ['ktff_standings', 'source_logo_url', 'logo_url'],
    ['ktff_fixtures', 'home_source_logo_url', 'home_logo_url'],
    ['ktff_fixtures', 'away_source_logo_url', 'away_logo_url'],
  ]
  return {
    async loadStates() {
      return new Map(must(await sb.from('ktff_sync_state').select('*'), 'ktff_sync_state').map(r => [r.endpoint, r]))
    },
    async saveState(endpoint, patch) {
      must(await sb.from('ktff_sync_state').upsert({ endpoint, ...patch }, { onConflict: 'endpoint' }), 'ktff_sync_state upsert')
    },
    async loadLeagues() {
      return new Map(must(await sb.from('ktff_leagues').select('league_id, available_weeks, current_week'), 'ktff_leagues').map(r => [r.league_id, r]))
    },
    async loadLogoCache() {
      const m = new Map()
      for (const [t, s, l] of LOGO_COLS) for (const r of await all(t, `${s}, ${l}`, q => q.not(s, 'is', null).not(l, 'is', null))) m.set(r[s], r[l])
      return m
    },
    async upsertLeague(row) { must(await sb.from('ktff_leagues').upsert(row, { onConflict: 'league_id' }), 'ktff_leagues upsert') },
    async upsertStandings(rows) {
      for (const c of chunks(rows)) must(await sb.from('ktff_standings').upsert(c, { onConflict: 'league_id,team_id' }), 'ktff_standings upsert')
    },
    async pruneStandings(leagueId, keepIds) {
      must(await sb.from('ktff_standings').delete().eq('league_id', leagueId).not('team_id', 'in', `(${keepIds.join(',')})`), 'ktff_standings prune')
    },
    async upsertFixtures(rows) {
      for (const c of chunks(rows)) must(await sb.from('ktff_fixtures').upsert(c, { onConflict: 'match_id' }), 'ktff_fixtures upsert')
    },
    async fixtureWeeks(leagueId) {
      return new Set((await all('ktff_fixtures', 'week', q => q.eq('league_id', leagueId))).map(r => r.week))
    },
    async pendingLogoSources() {
      const s = new Set()
      for (const [t, src, logo] of LOGO_COLS) {
        for (const r of await all(t, src, q => q.not(src, 'is', null).is(logo, null))) s.add(r[src])
      }
      return s
    },
    async setLogo(source, url) {
      for (const [t, src, logo] of LOGO_COLS) must(await sb.from(t).update({ [logo]: url }).eq(src, source).is(logo, null), `${t} logo`)
    },
  }
}

// ─── The handler ────────────────────────────────────────────────────────────
// service_role callers only: verify_jwt proves the token is this project's, and the anon key is such a token too.
export async function handle(req, createClient, env, fetchImpl = fetch) {
  if (!(await serviceCaller(req.headers.get('authorization'), env('SUPABASE_SERVICE_ROLE_KEY')))) return new Response('forbidden', { status: 403 })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const log = []
  const say = s => { log.push(s); console.log(s) }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const storage = {
    upload: (path, bytes, contentType) => sb.storage.from('team-logos').upload(path, bytes, { contentType, upsert: true }),
    publicUrl: path => sb.storage.from('team-logos').getPublicUrl(path).data.publicUrl,
  }
  try {
    const result = await runKtff(supabaseStore(sb), { fetchImpl, copyLogo: makeLogoCopier({ fetchImpl, storage }), say })
    return Response.json({ ...result, log })
  } catch (e) {
    const msg = String(e?.message || e)
    say(`ERROR: ${msg}`)
    return Response.json({ ok: false, error: msg, log }, { status: 500 })
  }
}
