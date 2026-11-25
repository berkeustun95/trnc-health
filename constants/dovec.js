// Döveç projects (partner) — the pure parts: visibility, price and delivery text, the enquiry payload, request-id reuse,
// outcome mapping and the WhatsApp link. No React Native imports, so node tests load it (scripts/test-dovec-ui.mjs).
// Backend: supabase/migrations/20261229_dovec_projects.sql, supabase/functions/dovec-lead.
import { DOVEC_PARTNER_LIVE } from './flags.js'
import { monthNames } from './months.js'

// Logo height in dp per screen (components/dovec/DovecLogo.js); tune on device. The bundled files are 3x the largest one.
export const DOVEC_LOGO_HEIGHT_LIST = 32
export const DOVEC_LOGO_HEIGHT_DETAIL = 36

export const DOVEC_CONSENT_VERSION = 'dovec-consent-2026-11-23'
export const DOVEC_MESSAGE_MAX = 2000

// Production: the code flag AND dovec_settings.published. A dev bundle or ADA Preview (`preview`) skips these two checks only;
// the rows still come through RLS (20261231), so while published = false a non-admin reads none and sees no entry (the entry also
// needs projects.length > 0). An admin checks the real rows from AdminScreen's "Open Döveç projects (preview)", not through Emlak.
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

// Unit types are shown translated for the three the feed is expected to send (English or Turkish form, any case); anything
// else (1+1, Villa, Penthouse...) is shown exactly as given. DISPLAY ONLY: state and the lead payload keep the feed's own string.
const UNIT_TYPE_KEY = {
  studio: 'dovecUnitStudio', 'stüdyo': 'dovecUnitStudio', studyo: 'dovecUnitStudio',
  office: 'dovecUnitOffice', ofis: 'dovecUnitOffice',
  shop: 'dovecUnitShop', 'dükkan': 'dovecUnitShop', dukkan: 'dovecUnitShop',
}
export const unitTypeKey = type =>
  UNIT_TYPE_KEY[String(type ?? '').trim().toLowerCase().replace(/\u0307/g, '')] ?? null
export const unitTypeLabel = (type, lang, tr) => {
  const key = unitTypeKey(type)
  return key ? tr(key, lang) : type
}

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
//   ok | rejected | invalid | consent | signin | under18 | unavailable | changed | rate | error
export function classifyLead(status, body) {
  if (status === 200 && body?.ok === true) return { kind: 'ok', externalId: body.external_id, status: body.status }
  if (status === 200 && body?.ok === false && body?.error === 'rejected') return { kind: 'rejected', externalId: body.external_id ?? null }
  if (status === 400 && body?.error === 'consent_required') return { kind: 'consent' }
  if (status === 400) return { kind: 'invalid', field: body?.field ?? null }
  if (status === 403 && body?.error === 'under_18') return { kind: 'under18' }
  if (status === 403) return { kind: 'signin' }
  if (status === 404) return { kind: 'unavailable' }
  if (status === 409) return { kind: 'changed' }
  if (status === 429) return { kind: 'rate' }   // body { error: 'rate_limited' }; any 429 reads the same
  return { kind: 'error' }
}

export const OUTCOME_KEY = {
  rejected: 'dovecErrRejected', invalid: 'dovecErrRejected', consent: 'dovecErrRejected', signin: 'dovecErrSignIn', under18: 'dovecErrUnder18',
  unavailable: 'dovecErrUnavailable', rate: 'dovecErrRate', changed: 'dovecErrGeneric', network: 'dovecErrNetwork', error: 'dovecErrGeneric',
}

// ─── WhatsApp (thank-you screen only, when dovec_settings.whatsapp_e164 is set) ───────────────
export const dovecWaUrl = (e164, text) => {
  const digits = String(e164 ?? '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null
}
// Döveç's own Turkish text, sent in EVERY app language (not translated, so not in i18n).
export const DOVEC_WA_TEMPLATE = 'Merhaba, ADA uygulamasından yazıyorum. {project} hakkında bilgi almak istiyorum. (Ref: {ref})'
export const dovecWaText = (projectName, ref) =>
  DOVEC_WA_TEMPLATE.replace('{project}', () => projectName).replace('{ref}', () => ref)

// The app-to-app link (opens WhatsApp directly); the caller falls back to dovecWaUrl when openURL rejects.
export const dovecWaAppUrl = (e164, text) => {
  const digits = String(e164 ?? '').replace(/\D/g, '')
  return digits ? `whatsapp://send?phone=${digits}&text=${encodeURIComponent(text)}` : null
}

// ─── Maps (detail page; only when both coordinates are numbers) ───────────────────────────────
// The hotels' https Google Maps form (HotelsTab fallback, constants/ehliyet.js mapsUrlForBranch), never the pharmacy/Apple path.
export const dovecCoords = (project) => {
  const { latitude: lat, longitude: lng } = project || {}
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}
export const dovecMapsUrl = (project) => {
  const c = dovecCoords(project)
  return c ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}` : null
}

// ─── Privacy notice (dovec_settings.privacy_url_tr / _en) ─────────────────────────────────────
// Turkish app language -> the TR notice, every other language -> EN; TR falls back to EN when missing. Only https is accepted.
const httpsUrl = u => (typeof u === 'string' && u.trim().startsWith('https://') ? u.trim() : null)
export function privacyUrlFor(settings, lang) {
  const tr = httpsUrl(settings?.privacy_url_tr)
  const en = httpsUrl(settings?.privacy_url_en)
  return lang === 'Turkish' ? tr || en : en
}
// Fail closed: the client cannot tell mock mode from live (the lead function's mode is a server secret), so with no valid
// privacy URL the form is not submittable in any mode.
export const dovecCanSend = (valid, privacyUrl) => valid === true && !!privacyUrl
