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

// THE TEST ENQUIRY: one fixed enquiry, ever, to prove delivery with Döveç before launch. Its locks are SEPARATE from the two
// above, so opening the test never opens user-lead sending: LOCK A is this code constant (a reviewed commit + a deploy),
// LOCK B is the secret DOVEC_LEADS_MODE === 'test_once' ('live' does NOT open it). The phone number comes only from the
// secret DOVEC_TEST_LEAD_PHONE (never a body field, never logged). Triggered only by { mode: 'test_lead' } from the service
// key; the workflow .github/workflows/dovec-test-lead.yml is the only caller.
// Open for the one agreed test (2026-11-26): the secret stays the lock until Berke's go, and both go back closed after the send.
export const TEST_LEAD_ALLOWED = true
export const isTestOpen = (mode, allowed = TEST_LEAD_ALLOWED) => allowed === true && mode === 'test_once'
export const TEST_LEAD = Object.freeze({ name: 'TEST ADA – please ignore', external_id: 'TEST-1', message: 'Test talebidir, işlem yapmayın', consent: true, language: 'tr' })
export const TEST_FINAL = ['sent', 'rejected', 'failed', 'mock']
// The project Döveç asked the test to name: the dovec_projects row the 'D-Point' seed is attached to (and still listed).
export const TEST_PROJECT_SEED = 'D-Point'

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
  const test = lead.is_test === true
  const live = (test ? isTestOpen(env.mode, deps.testAllowed ?? TEST_LEAD_ALLOWED) : isLive(env.mode, deps.liveAllowed ?? LEADS_LIVE_ALLOWED)) && !!env.apiKey
  const finish = async (patch) => { await store.updateLead(lead.id, patch); log(`dovec-lead ${lead.external_id} ${patch.status}${patch.last_http_status ? ` http=${patch.last_http_status}` : ''}`); return patch.status }
  // A retry lead is a real enquiry that may still be sent live: never settle it as mock, whatever the store returned.
  // The test enquiry is never settled as mock either: that would burn the one send it exists for.
  if (!live && (lead.status === 'retry' || test)) return lead.status
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
    if (test) log(`dovec-lead ${lead.external_id} network_error ${e?.name ?? 'Error'}`)
    return retryOrFail(attempts, null, backoffMs(attempts), finish)
  }
  const code = res.status
  if (test) log(`dovec-lead ${lead.external_id} response http=${code} body=${await answerText(res, lead.phone, env.apiKey)}`)
  if (code >= 200 && code < 300) return finish({ status: 'sent', attempts, last_http_status: code, sent_at: now().toISOString(), next_attempt_at: null })
  if (code === 429 || code === 401 || code >= 500) return retryOrFail(attempts, code, retryAfterMs(res) ?? backoffMs(attempts), finish, now)
  return finish({ status: 'rejected', attempts, last_http_status: code, next_attempt_at: null })
}

// Döveç's raw answer to the test enquiry, for the private function log only: capped, one line, the phone and key
// masked. Any run of 7+ digits is masked too, so the phone cannot slip through in another format (no '+', spaced, 00…).
async function answerText(res, phone, apiKey) {
  let text = ''
  try { text = typeof res.text === 'function' ? String(await res.text()) : '' } catch { return '<unreadable>' }
  for (const secret of [apiKey, phone, phone?.replace(/^\+/, '')]) if (secret) text = text.split(secret).join('<masked>')
  text = text.replace(/\d(?:[\s.-]?\d){6,}/g, '<digits>')
  return JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 500))
}

function retryOrFail(attempts, code, waitMs, finish, now = () => new Date()) {
  if (attempts >= MAX_ATTEMPTS) return finish({ status: 'failed', attempts, last_http_status: code, next_attempt_at: null })
  return finish({ status: 'retry', attempts, last_http_status: code, next_attempt_at: new Date(now().getTime() + waitMs).toISOString() })
}

const publicResult = lead => lead.status === 'rejected'
  ? { status: 200, body: { ok: false, error: 'rejected', external_id: lead.external_id } }
  : { status: 200, body: { ok: true, external_id: lead.external_id, status: lead.status === 'failed' ? 'retry' : lead.status } }

// caller: { kind: 'user', id } | { kind: 'service' }  (the edge function resolves it; guests never get here)
// store: isPublished() -> bool (dovec_settings.published, anything but true is false) · isAdmin(userId) -> bool
//        findByRequest(userId, crid) · getVisibleProject(id) · getDateOfBirth(userId) · countLeads({ userId?, sinceIso })
//        insertLead(row) · updateLead(id, patch) · dueLeads(limit, nowIso, statuses) · claimLead(id, nowIso, untilIso) -> row | null
// The count below is only a courtesy pre-check; the limits are enforced atomically by the BEFORE INSERT trigger on
// dovec_leads (20261229, SQLSTATE DV429), which insertLead surfaces and this function maps to 429.
// -> { status, body } for the HTTP response.
export async function handleLead({ caller, body, deps }) {
  const { store, now = () => new Date() } = deps
  if (isObj(body) && 'mode' in body) {
    if (caller.kind !== 'service' || (body.mode !== 'retry' && body.mode !== 'test_lead')) return { status: 403, body: { error: 'forbidden' } }
    return body.mode === 'retry' ? retryDue(deps) : handleTestLead({ body, deps })
  }
  if (caller.kind !== 'user') return { status: 403, body: { error: 'forbidden' } }
  const v = validateLead(body)
  if (!v.ok) return { status: v.status, body: { error: v.error, ...(v.field ? { field: v.field } : {}) } }
  // Dark module: while dovec_settings.published is not true, only an admin (the admin preview form) may enquire; everyone
  // else gets the not-found answer, before any other read or write. getVisibleProject keeps its freshness check (suspended,
  // 24 h) for admins too: stricter than the DB read gate on a stale feed, accepted because nothing can be delivered then.
  if ((await store.isPublished()) !== true && (await store.isAdmin(caller.id)) !== true) return { status: 404, body: { error: 'project_unavailable' } }
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
    if (candidate.is_test === true) continue   // the test enquiry is sent only by its own run, never by the cron
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

// { mode: 'test_lead', dry?: boolean } (service key only). Dry is the DEFAULT: it reports what would happen (lock states, the
// phone as set/missing/invalid, the D-Point project as resolved/missing, the existing row's status word, the payload with
// fixed values, the phone and project id masked) and
// writes and sends nothing. Apply (dry === false): both test locks open, a valid phone, no earlier TEST-1 in a final
// state; the row is INSERTED first, then sent (insert-then-send, one row ever: a unique index + external_id unique).
// An earlier TEST-1 still 'pending' or 'retry' is resent only through the normal claimed retry path.
// Output carries status words only: never the phone, a name or a user id.
export async function handleTestLead({ body, deps }) {
  const { store, env, now = () => new Date() } = deps
  for (const k of Object.keys(body)) if (k !== 'mode' && k !== 'dry') return { status: 400, body: { error: 'invalid_request', field: 'unknown_field' } }
  if (body.dry !== undefined && typeof body.dry !== 'boolean') return { status: 400, body: { error: 'invalid_request', field: 'dry' } }
  const dry = body.dry !== false
  const locks = { code: (deps.testAllowed ?? TEST_LEAD_ALLOWED) === true, secret: env.mode === 'test_once' }
  const phone = typeof env.testPhone === 'string' ? env.testPhone.trim() : ''
  const phoneState = phone === '' ? 'missing' : PHONE.test(phone) ? 'set' : 'invalid'
  const project = await store.getTestProject()
  const projectState = project?.id ? 'resolved' : 'missing'
  const keyState = env.apiKey ? 'set' : 'missing'
  const existing = await store.findTestLead()
  const state = existing ? existing.status : 'none'
  const resumable = existing && (existing.status === 'pending' || existing.status === 'retry')
  const refusal = !(locks.code && locks.secret) ? 'locked'
    : keyState !== 'set' ? 'key_missing'
    : phoneState !== 'set' ? `phone_${phoneState}`
    : projectState !== 'resolved' && !resumable ? 'project_missing'
    : existing && TEST_FINAL.includes(existing.status) ? 'already_used'
    : null
  const would = refusal ? `refuse:${refusal}` : resumable ? 'resend_claimed' : 'insert_and_send'
  if (dry) {
    return { status: 200, body: { ok: true, dry: true, locks, key: keyState, phone: phoneState, project: projectState, existing: state, would,
      payload: { name: TEST_LEAD.name, message: TEST_LEAD.message, consent: true, language: TEST_LEAD.language, external_id: TEST_LEAD.external_id, phone: phoneState === 'set' ? '<secret>' : null, project: projectState === 'resolved' ? '<D-Point id>' : null } } }
  }
  if (refusal) return { status: refusal === 'already_used' ? 409 : 403, body: { ok: false, error: refusal } }
  if (resumable) {
    const claimed = await store.claimLead(existing.id, now().toISOString(), new Date(now().getTime() + CLAIM_MS).toISOString())
    if (!claimed) return { status: 200, body: { ok: false, error: 'not_due', existing: state } }
    return { status: 200, body: { ok: true, status: await deliver(claimed, deps) } }
  }
  const v = { project_id: project.id, unit_type: null, name: TEST_LEAD.name, phone, email: null, message: TEST_LEAD.message, consent: true,
    consent_text_version: CONSENT_TEXT_VERSIONS[0], language: 'Turkish' }
  let lead
  try {
    lead = await store.insertLead({
      user_id: null, client_request_id: crypto.randomUUID(), payload_hash: await payloadHash(v), project_id: project.id, project_name: project.name ?? null,
      unit_type: null, name: v.name, phone: v.phone, email: null, message: v.message, language: 'Turkish', language_code: TEST_LEAD.language,
      consent: true, consent_text_version: v.consent_text_version, status: 'pending', external_id: TEST_LEAD.external_id, is_test: true,
    })
  } catch (e) {
    if (e?.code === '23505') return { status: 409, body: { ok: false, error: 'already_used' } }
    throw e
  }
  return { status: 200, body: { ok: true, status: await deliver(lead, deps) } }
}
