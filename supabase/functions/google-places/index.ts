// google-places — every Google Places API (New) call ADA makes, so the key never reaches a phone.
//
//   POST { action: 'nearby',  lat, lng, lang }                → { places: [{ id, name, lat, lng, type }] }
//   POST { action: 'details', ids: [...≤20], lang }           → { names: { [id]: name | null } }
//   POST { action: 'checkin', placeId, lat, lng, accuracy }   → { ok, already, id } | { error: CODE }
//   POST { action: 'refresh' }  (cron, service_role key only) → { refreshed, removed }
//
// Who: verify_jwt = true, and the caller's uid comes from auth.getUser() on THAT JWT — never
// from the body. nearby and checkin refuse guests (is_anonymous); details serves guests too
// (a pin tap on the map). Every Google call is counted first by claim_google_places_call()
// (per-user and global daily caps, 20261093): Google bills per call.
//
// ─── GOOGLE MAPS PLATFORM TERMS (Service Specific Terms §14, read 2026-10-07) ────────
// Nothing Google returns is stored except a place ID and, for a pin, lat/lng (< 30 days,
// 20261093 purges at 29). Names/types go to the phone for display and are dropped here.
// "Pharmacy" is decided from types at check-in/refresh time and stored only as the absence
// of a pin (p_pin = false). Field masks keep each call on the cheapest SKU that serves it:
//   nearby  places.id,displayName,location,types,primaryType  — Nearby Search Pro (displayName)
//   details id,displayName                                     — Place Details Pro
//   checkin/refresh id,location,types                           — Place Details Essentials
//
// ─── PRIVACY: NOTHING IS LOGGED ────────────────────────────────────────────
// The caller's position arrives in the POST body (invocation logs record the URL, never the
// body), goes to Google once (nearby, rounded to 4 decimals ≈ 10 m — the policy's figure) or into check_in_google() for the
// distance check (never stored), and is dropped. Failures log a status code only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PLACES = 'https://places.googleapis.com/v1'
const RADIUS_M = 100
const MAX_IDS = 20
const REFRESH_AFTER_DAYS = 20
const REFRESH_BATCH = 100
const ID = /^[A-Za-z0-9_-]{16,255}$/
const PHARMACY_TYPES = ['pharmacy', 'drugstore']
// Not a place anyone checks into.
const SKIP_TYPES = ['political', 'route', 'street_address', 'plus_code', 'postal_code', 'locality', 'sublocality']
// ADA stores languages as full English names (constants/i18n.js LANGUAGES); Google wants ISO.
const LANG: Record<string, string> = {
  English: 'en', Turkish: 'tr', Arabic: 'ar', Russian: 'ru', Greek: 'el',
  French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa',
}
const CODES = ['AUTH_REQUIRED', 'NOT_ELIGIBLE', 'BANNED', 'NAME_REQUIRED', 'NOTICE_REQUIRED',
  'PLACE_NOT_FOUND', 'BAD_FIX', 'LOW_ACCURACY', 'TOO_FAR', 'TOO_FAST', 'DAILY_LIMIT']

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
// ~11 m at this latitude: the precision the privacy policy states ("about 10 metres").
const r4 = (n: number) => Math.round(n * 1e4) / 1e4
function jwtRole(jwt: string) {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)))?.role ?? null
  } catch { return null }
}
const isFix = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

async function google(path: string, key: string, fieldMask: string, init: RequestInit = {}) {
  const res = await fetch(`${PLACES}${path}`, {
    ...init,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask, 'Content-Type': 'application/json' },
  })
  if (res.status === 404) return { status: 404, body: null }
  if (!res.ok) { console.error(`google-places: Google status ${res.status} on ${path.split('/')[1]?.split(':')[0] ?? path}`); return { status: res.status, body: null } }
  return { status: 200, body: await res.json() }
}

async function claim(uid: string, kind: string, cost = 1) {
  const { data, error } = await admin.rpc('claim_google_places_call', { p_user_id: uid, p_kind: kind, p_cost: cost })
  if (error) { console.error('google-places: quota rpc failed'); return false }
  return data === true
}

async function refresh(key: string) {
  const cut = new Date(Date.now() - REFRESH_AFTER_DAYS * 86400e3).toISOString()
  const { data: due, error } = await admin.from('google_place_pins')
    .select('google_place_id').lt('fetched_at', cut).order('fetched_at').limit(REFRESH_BATCH)
  if (error) { console.error('google-places: refresh read failed'); return json(502, { error: 'db' }) }
  let refreshed = 0, removed = 0
  for (const { google_place_id: id } of due ?? []) {
    if (!(await claim('00000000-0000-0000-0000-000000000000', 'refresh'))) break
    const g = await google(`/places/${id}`, key, 'id,location,types')
    if (g.status !== 200 && g.status !== 404) continue   // transient: the 29-day purge is the backstop
    const loc = g.body?.location
    const pharmacy = (g.body?.types ?? []).some((t: string) => PHARMACY_TYPES.includes(t))
    if (g.status === 404 || pharmacy || !isFix(loc?.latitude, loc?.longitude)) {
      await admin.from('google_place_pins').delete().eq('google_place_id', id); removed++
    } else {
      await admin.from('google_place_pins')
        .update({ latitude: loc.latitude, longitude: loc.longitude, fetched_at: new Date().toISOString() })
        .eq('google_place_id', id)
      refreshed++
    }
  }
  return json(200, { refreshed, removed })
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const key = Deno.env.get('GOOGLE_PLACES_SERVER_KEY')
  if (!key) { console.error('google-places: GOOGLE_PLACES_SERVER_KEY not set'); return json(503, { error: 'not_configured' }) }

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json(400, { error: 'body' }) }
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  // The gateway (verify_jwt) has already checked the signature, so the role claim can be read
  // as-is: only the service_role key (the cron's Vault secret) carries 'service_role'.
  if (b?.action === 'refresh') {
    return jwtRole(jwt) === 'service_role' ? refresh(key) : json(403, { error: 'forbidden' })
  }

  const { data: { user } = { user: null }, error: authErr } = await admin.auth.getUser(jwt)
  if (authErr || !user) return json(401, { error: 'AUTH_REQUIRED' })
  const guest = user.is_anonymous === true
  const languageCode = LANG[String(b?.lang ?? '')] ?? 'en'

  if (b?.action === 'nearby') {
    if (guest) return json(403, { error: 'AUTH_REQUIRED' })
    const lat = Number(b.lat), lng = Number(b.lng)
    if (!isFix(lat, lng)) return json(400, { error: 'body' })
    if (!(await claim(user.id, 'nearby'))) return json(429, { error: 'QUOTA' })
    const g = await google('/places:searchNearby', key,
      'places.id,places.displayName,places.location,places.types,places.primaryType', {
        method: 'POST',
        body: JSON.stringify({
          locationRestriction: { circle: { center: { latitude: r4(lat), longitude: r4(lng) }, radius: RADIUS_M } },
          rankPreference: 'DISTANCE', maxResultCount: 20, languageCode,
        }),
      })
    if (g.status !== 200) return json(502, { error: 'google' })
    const places = (g.body?.places ?? [])
      .filter((p: any) => ID.test(p?.id ?? '') && isFix(p?.location?.latitude, p?.location?.longitude)
        && !(p.types ?? []).some((t: string) => SKIP_TYPES.includes(t)))
      .map((p: any) => ({
        id: p.id, name: p.displayName?.text ?? null,
        lat: p.location.latitude, lng: p.location.longitude,
        type: p.primaryType ?? null,
      }))
    return json(200, { places })
  }

  if (b?.action === 'details') {
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].filter(i => ID.test(i)) : []
    if (ids.length === 0 || ids.length > MAX_IDS) return json(400, { error: 'body' })
    if (!(await claim(user.id, 'details', ids.length))) return json(429, { error: 'QUOTA' })
    const out = await Promise.all(ids.map(async id => {
      const g = await google(`/places/${id}?languageCode=${languageCode}`, key, 'id,displayName')
      return [id, g.status === 200 ? g.body?.displayName?.text ?? null : null] as const
    }))
    return json(200, { names: Object.fromEntries(out) })
  }

  if (b?.action === 'checkin') {
    if (guest) return json(403, { error: 'AUTH_REQUIRED' })
    const placeId = String(b.placeId ?? ''), lat = Number(b.lat), lng = Number(b.lng), accuracy = Number(b.accuracy)
    if (!ID.test(placeId)) return json(400, { error: 'PLACE_NOT_FOUND' })
    if (!isFix(lat, lng)) return json(400, { error: 'BAD_FIX' })
    if (!(await claim(user.id, 'checkin'))) return json(429, { error: 'QUOTA' })
    const g = await google(`/places/${placeId}`, key, 'id,location,types')
    if (g.status === 404) return json(404, { error: 'PLACE_NOT_FOUND' })
    if (g.status !== 200) return json(502, { error: 'google' })
    const loc = g.body?.location
    if (!isFix(loc?.latitude, loc?.longitude)) return json(404, { error: 'PLACE_NOT_FOUND' })
    const pharmacy = (g.body?.types ?? []).some((t: string) => PHARMACY_TYPES.includes(t))
    const { data, error } = await admin.rpc('check_in_google', {
      p_user_id: user.id, p_google_place_id: placeId,
      p_place_lat: loc.latitude, p_place_lng: loc.longitude,
      p_lat: lat, p_lng: lng, p_accuracy: Number.isFinite(accuracy) ? accuracy : null,
      p_pin: !pharmacy,
    })
    if (error) {
      const code = CODES.find(c => String(error.message ?? '').includes(c))
      if (!code) console.error('google-places: check_in_google failed')
      return json(code ? 409 : 502, { error: code ?? 'UNKNOWN' })
    }
    const row = Array.isArray(data) ? data[0] : data
    return json(200, { ok: true, already: row?.already === true, id: row?.checkin_id ?? null })
  }

  return json(400, { error: 'action' })
})
