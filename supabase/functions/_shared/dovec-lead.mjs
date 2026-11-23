// Döveç enquiries: validation, idempotency, rate limits, the two mock locks and delivery, in pure functions with the
// database and fetch injected, so node tests drive every branch. The edge function (dovec-lead/index.ts) only builds
// the store and resolves who is calling.
//
// API: POST {base}/api/partner/leads, Authorization: Bearer <DOVEC_PARTNER_KEY>.
//   Required name (<= 120), phone (international), consent (true). Optional email, message (<= 2000), project, unit_type,
//   language (2 letters), external_id. ANY other field rejects the whole enquiry. 202 { ok:true, status:'received' }.
//   The same external_id never opens a second enquiry. Limit 30 requests per minute (429 + Retry-After).
//
// PRIVACY: a lead is personal data. Nothing here logs a name, phone, e-mail, message or user id: a log line holds the
// external_id (ADA-n), the status word and an HTTP code.
// The ONLY host the partner key is ever sent to: a fixed constant, no environment override.
export const DEFAULT_BASE_URL = 'https://atlas.dovecgroup.com'
export const CONSENT_TEXT_VERSIONS = ['dovec-consent-2026-11-23']

// LOCK 1 of 2. A code constant: flipping it is a reviewed commit plus a deploy. LOCK 2 is the secret DOVEC_LEADS_MODE.
// Unless BOTH say live, nothing leaves this function and the lead is stored as 'mock'.
export const LEADS_LIVE_ALLOWED = false
export const isLive = (mode, allowed = LEADS_LIVE_ALLOWED) => allowed === true && mode === 'live'

export const LIMITS = { perUserHour: 3, perUserDay: 10, globalDay: 200 }
export const MAX_ATTEMPTS = 5
export const CLAIM_MS = 15 * 60000
export const STALE_LEAD_MS = 7 * 86400000
export const MIN_AGE = 18
export const RATE_LIMIT_CODE = 'DV429'
export const RETRY_BATCH = 20
export const SEND_TIMEOUT_MS = 15000

const LANG = { English: 'en', Turkish: 'tr', Arabic: 'ar', Russian: 'ru', Greek: 'el', French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa' }
const knownLang = name => typeof name === 'string' && Object.hasOwn(LANG, name)
export const languageCode = name => (knownLang(name) ? LANG[name] : 'en')
const languageName = name => (knownLang(name) ? name : 'English')

const BODY_KEYS = ['client_request_id', 'project_id', 'unit_type', 'name', 'phone', 'email', 'message', 'consent', 'consent_text_version', 'language']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE = /^\+[1-9][0-9]{6,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const opt = v => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v)

// Under 18 today, by the profile's date of birth ('YYYY-MM-DD'); no date on file = not blocked here (the 18+ tick stands).
// Today is the Nicosia calendar day; the 18th birthday itself is allowed.
export function isUnder18(dob, nowDate) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return false
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowDate)
  const cutoff = `${String(Number(today.slice(0, 4)) - MIN_AGE).padStart(4, '0')}${today.slice(4)}`
  return dob.slice(0, 10) > cutoff
}

// -> { ok:true, value } | { ok:false, status, error, field? }. Field NAMES only, never values.
export function validateLead(body) {
  if (!isObj(body)) return { ok: false, status: 400, error: 'invalid_request', field: 'body' }
  for (const k of Object.keys(body)) if (!BODY_KEYS.includes(k)) return { ok: false, status: 400, error: 'invalid_request', field: 'unknown_field' }
  const bad = field => ({ ok: false, status: 400, error: 'invalid_request', field })
  if (typeof body.client_request_id !== 'string' || !UUID.test(body.client_request_id)) return bad('client_request_id')
  if (body.consent !== true) return { ok: false, status: 400, error: 'consent_required' }
  if (!CONSENT_TEXT_VERSIONS.includes(body.consent_text_version)) return bad('consent_text_version')
  if (typeof body.project_id !== 'string' || !body.project_id.trim() || body.project_id.length > 100) return bad('project_id')
  if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 120) return bad('name')
  if (typeof body.phone !== 'string') return bad('phone')
  const phone = body.phone.replace(/\s+/g, '')
  if (!PHONE.test(phone)) return bad('phone')
  const email = opt(body.email)
  if (email !== null && (typeof email !== 'string' || email.trim().length > 254 || !EMAIL.test(email.trim()))) return bad('email')
  const message = opt(body.message)
  if (message !== null && (typeof message !== 'string' || message.trim().length > 2000)) return bad('message')
  const unitType = opt(body.unit_type)
  if (unitType !== null && (typeof unitType !== 'string' || unitType.trim().length > 100)) return bad('unit_type')
  if (typeof body.language !== 'string') return bad('language')
  return { ok: true, value: {
    client_request_id: body.client_request_id.toLowerCase(), project_id: body.project_id.trim(),
    unit_type: unitType === null ? null : unitType.trim(), name: body.name.trim(), phone,
    email: email === null ? null : email.trim(), message: message === null ? null : message.trim(),
    consent: true, consent_text_version: body.consent_text_version, language: languageName(body.language),
  } }
}

// sha256 over the canonical normalised payload (fixed key order; client_request_id is NOT part of it).
export async function payloadHash(v) {
  const canon = JSON.stringify([v.project_id, v.unit_type, v.name, v.phone, v.email, v.message, v.consent, v.consent_text_version, v.language])
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon)))
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('')
}

// The only place the outgoing body is made: an explicit pick, empty optionals omitted, consent asserted again.
export function buildOutgoing(lead) {
  if (lead.consent !== true) throw new Error('refusing to send without consent')
  const out = { name: lead.name, phone: lead.phone, consent: true }
  if (lead.email) out.email = lead.email
  if (lead.message) out.message = lead.message
  if (lead.project_id) out.project = lead.project_id
  if (lead.unit_type) out.unit_type = lead.unit_type
  out.language = lead.language_code
  out.external_id = lead.external_id
  return out
}

const backoffMs = attempts => Math.min(5 * 60000 * 2 ** Math.max(0, attempts - 1), 2 * 3600000)
function retryAfterMs(res) {
  const s = Number(res.headers?.get?.('retry-after'))
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 3600000) : null
}

// Sends one stored lead and writes the outcome. Returns the new status.
//   deps: { store, env: { mode, apiKey }, fetchImpl, now, log, liveAllowed }
export async function deliver(lead, deps) {
  const { store, env, fetchImpl = fetch, now = () => new Date(), log = () => {} } = deps
  const live = isLive(env.mode, deps.liveAllowed ?? LEADS_LIVE_ALLOWED) && !!env.apiKey
  const finish = async (patch) => { await store.updateLead(lead.id, patch); log(`dovec-lead ${lead.external_id} ${patch.status}${patch.last_http_status ? ` http=${patch.last_http_status}` : ''}`); return patch.status }
  // A retry lead is a real enquiry that may still be sent live: never settle it as mock, whatever the store returned.
  if (!live && lead.status === 'retry') return 'retry'
  if (!live) return finish({ status: 'mock' })
  if (!lead.name || !lead.phone) return finish({ status: 'failed' })
  const attempts = (lead.attempts ?? 0) + 1
  let res
  try {
    res = await fetchImpl(`${DEFAULT_BASE_URL}/api/partner/leads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildOutgoing(lead)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (e) {
    if (e?.message === 'refusing to send without consent') throw e
    return retryOrFail(attempts, null, backoffMs(attempts), finish)
  }
  const code = res.status
  if (code >= 200 && code < 300) return finish({ status: 'sent', attempts, last_http_status: code, sent_at: now().toISOString(), next_attempt_at: null })
  if (code === 429 || code === 401 || code >= 500) return retryOrFail(attempts, code, retryAfterMs(res) ?? backoffMs(attempts), finish, now)
  return finish({ status: 'rejected', attempts, last_http_status: code, next_attempt_at: null })
}

function retryOrFail(attempts, code, waitMs, finish, now = () => new Date()) {
  if (attempts >= MAX_ATTEMPTS) return finish({ status: 'failed', attempts, last_http_status: code, next_attempt_at: null })
  return finish({ status: 'retry', attempts, last_http_status: code, next_attempt_at: new Date(now().getTime() + waitMs).toISOString() })
}

const publicResult = lead => lead.status === 'rejected'
  ? { status: 200, body: { ok: false, error: 'rejected', external_id: lead.external_id } }
  : { status: 200, body: { ok: true, external_id: lead.external_id, status: lead.status === 'failed' ? 'retry' : lead.status } }

// caller: { kind: 'user', id } | { kind: 'service' }  (the edge function resolves it; guests never get here)
// store: findByRequest(userId, crid) · getVisibleProject(id) · getDateOfBirth(userId) · countLeads({ userId?, sinceIso })
//        insertLead(row) · updateLead(id, patch) · dueLeads(limit, nowIso, statuses) · claimLead(id, nowIso, untilIso) -> row | null
// The count below is only a courtesy pre-check; the limits are enforced atomically by the BEFORE INSERT trigger on
// dovec_leads (20261229, SQLSTATE DV429), which insertLead surfaces and this function maps to 429.
// -> { status, body } for the HTTP response.
export async function handleLead({ caller, body, deps }) {
  const { store, now = () => new Date() } = deps
  if (isObj(body) && 'mode' in body) {
    if (caller.kind !== 'service' || body.mode !== 'retry') return { status: 403, body: { error: 'forbidden' } }
    return retryDue(deps)
  }
  if (caller.kind !== 'user') return { status: 403, body: { error: 'forbidden' } }
  const v = validateLead(body)
  if (!v.ok) return { status: v.status, body: { error: v.error, ...(v.field ? { field: v.field } : {}) } }
  const dob = await store.getDateOfBirth(caller.id)
  if (isUnder18(dob, now())) return { status: 403, body: { error: 'under_18' } }
  const hash = await payloadHash(v.value)

  const replay = async existing => existing.payload_hash === hash
    ? publicResult(existing) : { status: 409, body: { error: 'request_changed' } }
  const prior = await store.findByRequest(caller.id, v.value.client_request_id)
  if (prior) return replay(prior)

  const project = await store.getVisibleProject(v.value.project_id)
  if (!project) return { status: 404, body: { error: 'project_unavailable' } }
  if (v.value.unit_type !== null && !(project.unit_types ?? []).some(u => u.type === v.value.unit_type)) {
    return { status: 400, body: { error: 'invalid_request', field: 'unit_type' } }
  }

  const t = now().getTime()
  const iso = ms => new Date(t - ms).toISOString()
  const [hour, day, all] = await Promise.all([
    store.countLeads({ userId: caller.id, sinceIso: iso(3600000) }),
    store.countLeads({ userId: caller.id, sinceIso: iso(86400000) }),
    store.countLeads({ sinceIso: iso(86400000) }),
  ])
  if (hour >= LIMITS.perUserHour || day >= LIMITS.perUserDay || all >= LIMITS.globalDay) return { status: 429, body: { error: 'rate_limited' } }

  let lead
  try {
    lead = await store.insertLead({
      user_id: caller.id, client_request_id: v.value.client_request_id, payload_hash: hash, project_id: project.id,
      project_name: project.name, unit_type: v.value.unit_type, name: v.value.name, phone: v.value.phone,
      email: v.value.email, message: v.value.message, language: v.value.language, language_code: languageCode(v.value.language),
      consent: true, consent_text_version: v.value.consent_text_version, status: 'pending',
    })
  } catch (e) {
    if (e?.code === RATE_LIMIT_CODE || e?.message === 'dovec_rate_limited') return { status: 429, body: { error: 'rate_limited' } }
    if (e?.code === '23505') {
      const again = await store.findByRequest(caller.id, v.value.client_request_id)
      if (again) return replay(again)
    }
    throw e
  }
  const status = await deliver(lead, deps)
  return publicResult({ ...lead, status })
}

// Retry mode: resend the SAME stored payload and external_id of leads that are due. While not live, only 'pending'
// leads (saved but never processed) are settled as 'mock'; a 'retry' lead is left alone so a live send is not lost.
export async function retryDue(deps) {
  const { store, env, now = () => new Date() } = deps
  const live = isLive(env.mode, deps.liveAllowed ?? LEADS_LIVE_ALLOWED) && !!env.apiKey
  const due = await store.dueLeads(RETRY_BATCH, now().toISOString(), live ? ['retry', 'pending'] : ['pending'])
  const counts = { processed: 0, sent: 0, retry: 0, failed: 0, rejected: 0, mock: 0 }
  for (const candidate of due) {
    if (!live && candidate.status === 'retry') continue
    // Claim first: pushes next_attempt_at 15 minutes out, only if the row is still due. An overlapping run loses the claim.
    const lead = await store.claimLead(candidate.id, now().toISOString(), new Date(now().getTime() + CLAIM_MS).toISOString())
    if (!lead) continue
    const status = await deliver(lead, deps)
    counts.processed++
    counts[status] = (counts[status] ?? 0) + 1
  }
  return { status: 200, body: { ok: true, ...counts } }
}
