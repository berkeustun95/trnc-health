import { supabase } from '../lib/supabase'

const COLS = 'id, entity_uuid, name, city, area, status, planned_delivery_month, from_price, currency, available_units, unit_types, cover_url, website_url, description, gallery, latitude, longitude'

// dovec_settings (published, whatsapp_e164, privacy notice URLs) and the visible projects (RLS, 20261231: listed rows only, and only for an admin until
// published; for everyone else while published, fresh and not suspended).
// -> { settings, projects } or throws.
export async function loadDovec() {
  const [s, p] = await Promise.all([
    supabase.from('dovec_settings').select('published, suspended, whatsapp_e164, privacy_url_tr, privacy_url_en').eq('id', 1).maybeSingle(),
    supabase.from('dovec_projects').select(COLS).order('name', { ascending: true }),
  ])
  if (s.error) throw s.error
  if (p.error) throw p.error
  return { settings: s.data ?? { published: false, whatsapp_e164: null, privacy_url_tr: null, privacy_url_en: null }, projects: p.data ?? [] }
}

// `total;dur=620.4` out of a Server-Timing header -> whole ms, or null (absent, unparseable).
export function parseServerTimingTotal(header) {
  if (typeof header !== 'string') return null
  const m = /(?:^|,)\s*total\s*;(?:[^,]*;)?\s*dur\s*=\s*"?(\d+(?:\.\d+)?)"?/i.exec(header)
  return m ? Math.round(Number(m[1])) : null
}

const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())

// Sends one enquiry. -> { status, body, ms, serverMs } where status 0 = no answer (offline, timeout); ms = invoke round trip
// (admin-only timing line on the thank-you), serverMs = the function's own Server-Timing total or null. Never throws.
export async function sendDovecLead(payload) {
  const t0 = nowMs()
  const took = () => Math.round(nowMs() - t0)
  try {
    const { data, error, response } = await supabase.functions.invoke('dovec-lead', { body: payload })
    const ms = took()
    if (!error) return { status: 200, body: data, ms, serverMs: parseServerTimingTotal(response?.headers?.get?.('Server-Timing')) }
    const res = error.context
    if (res && typeof res.status === 'number') {
      let body = null
      try { body = await res.json() } catch { /* no body */ }
      return { status: res.status, body, ms, serverMs: parseServerTimingTotal(res.headers?.get?.('Server-Timing')) }
    }
    return { status: 0, body: null, ms, serverMs: null }
  } catch {
    return { status: 0, body: null, ms: took(), serverMs: null }
  }
}
