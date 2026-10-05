// ─── HotelRunner booking link (Oteller's "Rezervasyon Yap") ──────────────────
// The stored link (hotels.hotelrunner_url, written by scripts/apply-hotelrunner-links.mjs) plus
// ADA's attribution: utm_source=ada&utm_medium=app&utm_campaign=oteller&utm_content=<hotel slug>.
// Parameters already in HotelRunner's link are KEPT, in order; on a clash with one of OUR keys,
// ours win, so a pre-filled utm_source can never erase ADA's attribution. The fragment (#…)
// stays last. Plain string work: React Native's URL / URLSearchParams have no working set().
// Imported by the writer script too, so app and writer build query strings the same way.

const enc = v => encodeURIComponent(String(v))
const dec = v => { try { return decodeURIComponent(v.replace(/\+/g, ' ')) } catch { return v } }

export function withParams(url, params) {
  const hashAt = url.indexOf('#')
  const base = hashAt < 0 ? url : url.slice(0, hashAt)
  const frag = hashAt < 0 ? '' : url.slice(hashAt)
  const qAt = base.indexOf('?')
  const path = qAt < 0 ? base : base.slice(0, qAt)
  const ours = Object.entries(params).filter(([, v]) => v != null && v !== '')
  const keys = new Set(ours.map(([k]) => k))
  const kept = (qAt < 0 ? '' : base.slice(qAt + 1)).split('&')
    .filter(p => p && !keys.has(dec(p.split('=')[0])))
  const query = [...kept, ...ours.map(([k, v]) => `${enc(k)}=${enc(v)}`)].join('&')
  return `${path}${query ? `?${query}` : ''}${frag}`
}

// The hotel's slug for utm_content: its external_id without the source prefix
// (kitob-bellapais-gardens-kyrenia → bellapais-gardens-kyrenia).
export const hotelSlug = hotel => String(hotel.external_id || '').replace(/^kitob-/, '')

export function hotelBookingUrl(hotel) {
  if (!hotel?.hotelrunner_url) return null
  return withParams(hotel.hotelrunner_url, {
    utm_source: 'ada', utm_medium: 'app', utm_campaign: 'oteller', utm_content: hotelSlug(hotel),
  })
}
