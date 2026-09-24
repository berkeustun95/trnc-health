// walk-leg — the live walking path from where the walker is to the next stop of a route.
//
//   POST { from: { lat, lon }, to_place_id }  →  { path: [[lng, lat], …], metres, seconds }
//
// openrouteservice foot-walking (HeiGIT), called from here so the API key never reaches a
// phone and HeiGIT only ever sees this server. Results: CC-BY-SA 4.0, attributed in the app.
//
// ─── PRIVACY: NOTHING IS STORED, NOTHING IS LOGGED ─────────────────────────
// The walker's position arrives in the POST BODY (invocation logs record the URL, never the
// body), is forwarded to ORS once, and is dropped. No console.log of a request, a position or
// a place anywhere in this file; failures log a status code only. HeiGIT's own logs keep
// request coordinates rounded to two decimals (~1 km) — stated in the privacy policy.
//
// ─── NOT A GENERAL ROUTER ───────────────────────────────────────────────────
// Deployed with --no-verify-jwt (the project's publishable key is not a JWT — same as
// apple-token and weather), so the body is the only gate, and it is a narrow one:
//   • the destination is a PLACE ID that must be a stop on a walking route — never raw
//     coordinates — and its position is read from our database;
//   • the start must be within MAX_START_KM of it.
// Together they cap what anyone can do with this key to "walk to a Visit NCY stop", inside
// ORS's 2,000 requests/day, 40/minute.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'
const MAX_START_KM = 5
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371, rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const r5 = (n: number) => Math.round(n * 1e5) / 1e5

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const key = Deno.env.get('ORS_API_KEY')
  if (!key) { console.error('walk-leg: ORS_API_KEY not set'); return json(503, { error: 'not_configured' }) }

  let lat: number, lon: number, to: string
  try {
    const b = await req.json()
    lat = Number(b?.from?.lat); lon = Number(b?.from?.lon); to = String(b?.to_place_id ?? '')
  } catch {
    return json(400, { error: 'body' })
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !UUID.test(to)) {
    return json(400, { error: 'body' })
  }

  // The destination must be a stop on a walking route (active or not: review mode walks
  // dark routes; the set is ~76 places either way).
  const { data: stop, error } = await admin.from('walking_route_stops')
    .select('places(latitude, longitude)').eq('place_id', to).limit(1).maybeSingle()
  if (error) { console.error('walk-leg: stop lookup failed'); return json(502, { error: 'lookup' }) }
  const place = (stop as { places?: { latitude: number | null; longitude: number | null } } | null)?.places
  if (!place || place.latitude == null || place.longitude == null) return json(404, { error: 'not_a_stop' })
  if (km(lat, lon, place.latitude, place.longitude) > MAX_START_KM) return json(400, { error: 'too_far' })

  let res: Response
  try {
    res = await fetch(ORS_URL, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify({ coordinates: [[r5(lon), r5(lat)], [place.longitude, place.latitude]] }),
    })
  } catch {
    console.error('walk-leg: ORS unreachable')
    return json(502, { error: 'router' })
  }
  if (!res.ok) { console.error(`walk-leg: ORS status ${res.status}`); return json(502, { error: 'router' }) }
  const f = (await res.json())?.features?.[0]
  const coords: number[][] = f?.geometry?.coordinates ?? []
  if (coords.length < 2) return json(502, { error: 'no_path' })
  return json(200, {
    path: coords.map(([x, y]) => [r5(x), r5(y)]),
    metres: Math.round(f?.properties?.summary?.distance ?? 0),
    seconds: Math.round(f?.properties?.summary?.duration ?? 0),
  })
})
