// Döveç projects (partner) — the pure parts: visibility, price and delivery text, the enquiry payload, request-id reuse,
// outcome mapping and the WhatsApp link. No React Native imports, so node tests load it (scripts/test-dovec-ui.mjs).
// Backend: supabase/migrations/20261229_dovec_projects.sql, supabase/functions/dovec-lead.
import { DOVEC_PARTNER_LIVE } from './flags.js'
import { monthNames } from './months.js'

// Where Döveç's logo goes once it is delivered: { light: <navy on light ground>, dark: <white on dark ground> }, each a
// require()d asset. Null until then; the screens render no logo (and no ADA-drawn stand-in) while this is null.
export const DOVEC_LOGO = null

export const DOVEC_CONSENT_VERSION = 'dovec-consent-2026-11-23'
export const DOVEC_MESSAGE_MAX = 2000

// Production: the code flag AND dovec_settings.published. A dev bundle or ADA Preview (`preview`) shows it whatever
// `published` says, so the design can be checked on real rows while published = false.
export function dovecShown({ published, preview, live = DOVEC_PARTNER_LIVE }) {
  return preview === true || (live === true && published === true)
}

// ─── text ────────────────────────────────────────────────────────────────────
// £1,250,000: grouped by hand, no Intl (Hermes number-format quirks). Null and NaN give null: the caller shows nothing.
export function formatGbp(n) {
  if (n === null || n === undefined || n === '') return null
  const v = Math.round(Number(n))
  if (!Number.isFinite(v) || v < 0) return null
  return `£${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

// planned_delivery_month arrives as 'YYYY-MM-01'. Shown only for the current month or later; a month already past
// shows nothing at all (never "delivered": the feed does not say so).
export function deliveryLabel(month, lang, now = new Date()) {
  const m = /^(\d{4})-(\d{2})/.exec(typeof month === 'string' ? month : '')
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  if (y * 12 + mo < now.getFullYear() * 12 + now.getMonth() + 1) return null
  return `${monthNames(lang)[mo - 1]} ${y}`
}

export const placeLine = p => [p.city, p.area].map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(' · ')

// gallery is jsonb, shape not fixed yet: https strings or { url } objects. Anything else is dropped.
export function galleryUrls(gallery) {
  if (!Array.isArray(gallery)) return []
  return gallery.map(g => (typeof g === 'string' ? g : g?.url)).filter(u => typeof u === 'string' && u.startsWith('https://'))
}

export const unitTypes = p => (Array.isArray(p?.unit_types) ? p.unit_types.filter(u => u && typeof u.type === 'string' && u.type.trim()) : [])

// ─── enquiry ────────────────────────────────────────────────────────────────
const PHONE = /^\+[1-9][0-9]{6,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Country code + typed number -> E.164 candidate. A number typed with its own '+' stands alone; a leading 0 (trunk
// prefix) is dropped. Returns '' when nothing usable was typed.
export function composePhone(cc, national) {
  const raw = String(national ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  return `${cc || ''}${digits.replace(/^0+/, '')}`
}

// Mirrors validateLead (supabase/functions/_shared/dovec-lead.mjs). -> { ok, errors:{ field:true } }
export function validateEnquiry({ name, cc, phone, email, message, consent }) {
  const errors = {}
  const n = String(name ?? '').trim()
  if (n.length < 1 || n.length > 120) errors.name = true
  if (!PHONE.test(composePhone(cc, phone))) errors.phone = true
  const e = String(email ?? '').trim()
  if (e && (e.length > 254 || !EMAIL.test(e))) errors.email = true
  if (String(message ?? '').trim().length > DOVEC_MESSAGE_MAX) errors.message = true
  if (consent !== true) errors.consent = true
  return { ok: Object.keys(errors).length === 0, errors }
}

// The ONLY place the request body is made: an explicit pick (no spread), empty optionals left out, consent strict.
export function buildLeadPayload({ requestId, projectId, unitType, name, cc, phone, email, message, consent, lang }) {
  if (consent !== true) throw new Error('consent required')
  const out = {
    client_request_id: requestId,
    project_id: projectId,
    name: String(name).trim(),
    phone: composePhone(cc, phone),
    consent: true,
    consent_text_version: DOVEC_CONSENT_VERSION,
    language: lang,
  }
  if (unitType) out.unit_type = unitType
  if (String(email ?? '').trim()) out.email = String(email).trim()
  if (String(message ?? '').trim()) out.message = String(message).trim()
  return out
}

// The id is part of the retry contract: the same payload keeps its id (a retry after a network failure is the same
// enquiry), any change makes a new one. `prev` = { id, key } | null. -> { id, key }
export function requestIdFor(prev, payload, makeId) {
  const { client_request_id: _drop, ...rest } = payload
  const key = JSON.stringify(rest)
  return prev && prev.key === key ? prev : { id: makeId(), key }
}

// HTTP status + body of dovec-lead -> what the screen does.
//   ok | rejected | invalid | consent | signin | unavailable | changed | rate | error
export function classifyLead(status, body) {
  if (status === 200 && body?.ok === true) return { kind: 'ok', externalId: body.external_id, status: body.status }
  if (status === 200 && body?.ok === false && body?.error === 'rejected') return { kind: 'rejected', externalId: body.external_id ?? null }
  if (status === 400 && body?.error === 'consent_required') return { kind: 'consent' }
  if (status === 400) return { kind: 'invalid', field: body?.field ?? null }
  if (status === 403) return { kind: 'signin' }
  if (status === 404) return { kind: 'unavailable' }
  if (status === 409) return { kind: 'changed' }
  if (status === 429) return { kind: 'rate' }
  return { kind: 'error' }
}

export const OUTCOME_KEY = {
  rejected: 'dovecErrRejected', invalid: 'dovecErrRejected', consent: 'dovecErrRejected', signin: 'dovecErrSignIn',
  unavailable: 'dovecErrUnavailable', rate: 'dovecErrRate', changed: 'dovecErrGeneric', network: 'dovecErrNetwork', error: 'dovecErrGeneric',
}

// ─── WhatsApp (thank-you screen only, when dovec_settings.whatsapp_e164 is set) ───────────────
export const dovecWaUrl = (e164, text) => {
  const digits = String(e164 ?? '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null
}
export const dovecWaText = (template, projectName, ref) =>
  template.replace('{project}', () => projectName).replace('{ref}', () => ref)
