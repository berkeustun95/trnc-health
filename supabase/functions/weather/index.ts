// weather — the Home screen's forecast, from MET Norway (Locationforecast 2.0 /complete),
// so the phone never talks to a weather provider and MET only ever sees this server.
//
//   POST { lat, lon }  →  { current, daily, source }   (shape: _shared/met-weather.mjs)
//
// Written against MET's Terms of Service (api.met.no/doc/TermsOfService, read 2026-09-24):
//   • identifying User-Agent with the app name and a contact (requests without one get 403);
//   • never repeat a request before its `Expires`; revalidate with `If-Modified-Since` set to
//     the EXACT previous `Last-Modified` (a 304 keeps the cached body);
//   • coordinates at most 4 decimals — we send 1 (0.1° ≈ 10 km cells);
//   • > 20 requests/second for the whole application needs an agreement — the per-cell cache
//     and the Cyprus-only box keep us orders of magnitude below that.
// Data licence: CC BY 4.0 / NLOD 2.0 — credited in the app ("Data from MET Norway", licence
// link, "adapted": we aggregate the timeseries into a current reading and four days).
//
// ─── PRIVACY: NOTHING IS STORED, NOTHING IS LOGGED ─────────────────────────
// Coordinates arrive in the POST BODY (invocation logs record the URL, never the body) and
// are rounded to a 0.1° cell before any use. The cache lives in this isolate's memory only,
// keyed by cell — it records that a forecast for an area exists, never who asked. There is
// no console.log of a request, a cell or a coordinate anywhere in this file; errors log a
// status code only. Keep it that way: the privacy policy says so.
//
// ─── DEPLOYED WITH --no-verify-jwt, DELIBERATELY ───────────────────────────
// The weather loads on the very first launch, before any session exists, and the project's
// new publishable key is not a JWT (same reason as apple-token). The endpoint returns only
// public forecast data for Cyprus cells; the bounding box and the cache are its abuse limit.
import { MET_URL, cellOf, normalizeMet } from '../_shared/met-weather.mjs'

const USER_AGENT = 'ADA/1.2 (getadaapp.com; getadaapp@gmail.com)'

type Entry = { body: unknown; lastModified: string | null; expires: number }
const cache = new Map<string, Entry>()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function forecastFor(key: string, lat: number, lon: number): Promise<Entry | null> {
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expires) return hit

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (hit?.lastModified) headers['If-Modified-Since'] = hit.lastModified
  let res: Response
  try {
    res = await fetch(`${MET_URL}?lat=${lat}&lon=${lon}`, { headers })
  } catch {
    console.error('weather: MET unreachable')
    return hit ?? null                        // stale beats nothing
  }
  const expiresHdr = Date.parse(res.headers.get('expires') ?? '')
  // No/invalid Expires: back off 30 min rather than hammer MET.
  const expires = Number.isFinite(expiresHdr) ? expiresHdr : Date.now() + 30 * 60 * 1000

  if (res.status === 304 && hit) {
    const kept = { ...hit, expires }
    cache.set(key, kept)
    return kept
  }
  if (res.status !== 200) {
    console.error(`weather: MET status ${res.status}`)
    if (hit) cache.set(key, { ...hit, expires: Math.max(hit.expires, Date.now() + 5 * 60 * 1000) })
    return hit ?? null
  }
  const entry = { body: await res.json(), lastModified: res.headers.get('last-modified'), expires }
  cache.set(key, entry)
  return entry
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  let lat: number, lon: number
  try {
    const b = await req.json()
    lat = Number(b?.lat); lon = Number(b?.lon)
  } catch {
    return json(400, { error: 'body' })
  }
  const cell = cellOf(lat, lon)
  if (!cell) return json(400, { error: 'outside' })

  const entry = await forecastFor(`${cell.lat},${cell.lon}`, cell.lat, cell.lon)
  if (!entry) return json(502, { error: 'unavailable' })
  // Normalised per request, not per fetch: "now" and "today" move while a body is cached.
  const out = normalizeMet(entry.body, new Date())
  return out ? json(200, out) : json(502, { error: 'shape' })
})
