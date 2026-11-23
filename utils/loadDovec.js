import { supabase } from '../lib/supabase'

const COLS = 'id, entity_uuid, name, city, area, status, planned_delivery_month, from_price, currency, available_units, unit_types, cover_url, website_url, description, gallery, latitude, longitude'

// dovec_settings (published, whatsapp_e164) and the visible projects (RLS hides unlisted, stale and suspended ones).
// -> { settings, projects } or throws.
export async function loadDovec() {
  const [s, p] = await Promise.all([
    supabase.from('dovec_settings').select('published, suspended, whatsapp_e164').eq('id', 1).maybeSingle(),
    supabase.from('dovec_projects').select(COLS).order('name', { ascending: true }),
  ])
  if (s.error) throw s.error
  if (p.error) throw p.error
  return { settings: s.data ?? { published: false, whatsapp_e164: null }, projects: p.data ?? [] }
}

// Sends one enquiry. -> { status, body } where status 0 = no answer (offline, timeout). Never throws.
export async function sendDovecLead(payload) {
  try {
    const { data, error } = await supabase.functions.invoke('dovec-lead', { body: payload })
    if (!error) return { status: 200, body: data }
    const res = error.context
    if (res && typeof res.status === 'number') {
      let body = null
      try { body = await res.json() } catch { /* no body */ }
      return { status: res.status, body }
    }
    return { status: 0, body: null }
  } catch {
    return { status: 0, body: null }
  }
}
