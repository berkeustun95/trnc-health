// Google places for check-ins — every call goes through the google-places Edge Function
// (the key never ships in the app). Server half: supabase/functions/google-places,
// supabase/migrations/20261093_checkins_google_places.sql.
//
// GOOGLE CONTENT IS NEVER STORED. Place names are held in memory only — sessionNames below,
// so a place is not looked up twice while the app is open (Berke, 2026-10-07) — and dropped
// when the app goes to the background. Never AsyncStorage, never our database: the Maps
// Platform terms allow storing a place ID, and lat/lng for < 30 days. ⚠ ToS §3.2.3(b) ("will
// not cache Google Maps Content except as expressly permitted") read literally covers even
// this in-memory reuse; accepted as a known risk, the same class as the per-screen state.
//
// Like utils/checkins.js, each function takes the Supabase client first so Node can test it.
import { useEffect, useRef, useState } from 'react'
import { metresBetween } from '../constants/walkingRoutes.js'
import { CHECKIN_RADIUS_M } from './checkins.js'

export const NEARBY_RADIUS_M = 100
export const GOOGLE_NAMES_BATCH = 20

// The Edge Function answers a refusal with { error: CODE } and a non-2xx status; supabase-js
// then hands back a FunctionsHttpError whose `context` is the Response. A fetch that never
// reached a server is a FunctionsFetchError (no context) → 'NETWORK'.
async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('google-places', { body })
  if (!error) return { ok: true, data }
  let code = null
  try { code = (await error.context?.json?.())?.error ?? null } catch { code = null }
  return { ok: false, code: code ?? (error.context ? 'UNKNOWN' : 'NETWORK') }
}

// Google places within NEARBY_RADIUS_M of the fix, nearest first, with their distance.
export async function nearbyGoogle(client, fix, lang) {
  const res = await invoke(client, { action: 'nearby', lat: fix.latitude, lng: fix.longitude, lang })
  if (!res.ok) return { ok: false, code: res.code, places: [] }
  const places = (res.data?.places ?? [])
    .map(p => ({ ...p, metres: Math.round(metresBetween(fix, { latitude: p.lat, longitude: p.lng })) }))
    .sort((a, b) => a.metres - b.metres)
  return { ok: true, places }
}

// ADA's own active places within NEARBY_RADIUS_M (RLS shows active places to everyone).
// A bounding box narrows the query; the exact distance decides.
export async function nearbyAda(client, fix) {
  const dLat = NEARBY_RADIUS_M / 111320
  const dLng = NEARBY_RADIUS_M / (111320 * Math.cos(fix.latitude * Math.PI / 180))
  const { data, error } = await client.from('places')
    .select('id, name, name_i18n, category, latitude, longitude')
    .eq('status', 'active').is('hidden_at', null)
    .gte('latitude', fix.latitude - dLat).lte('latitude', fix.latitude + dLat)
    .gte('longitude', fix.longitude - dLng).lte('longitude', fix.longitude + dLng)
    .limit(30)
  if (error) return { ok: false, places: [] }
  const places = (data ?? [])
    .map(p => ({ ...p, metres: Math.round(metresBetween(fix, p)) }))
    .filter(p => p.metres <= NEARBY_RADIUS_M)
    .sort((a, b) => a.metres - b.metres)
  return { ok: true, places }
}

// { [placeId]: name | null } for up to GOOGLE_NAMES_BATCH ids per call.
// Per-session names, by language. Only real names are kept: a null (unknown place, Google
// error) is asked again next time.
const sessionNames = new Map()
const nameKey = (lang, id) => `${lang}|${id}`
export function clearGoogleNames() { sessionNames.clear() }

export async function googleNames(client, ids, lang) {
  const out = {}
  const uniq = [...new Set(ids.filter(Boolean))]
  const missing = []
  for (const id of uniq) {
    const k = nameKey(lang, id)
    if (sessionNames.has(k)) out[id] = sessionNames.get(k)
    else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += GOOGLE_NAMES_BATCH) {
    const res = await invoke(client, { action: 'details', ids: missing.slice(i, i + GOOGLE_NAMES_BATCH), lang })
    if (!res.ok) break
    for (const [id, name] of Object.entries(res.data?.names ?? {})) {
      out[id] = name
      if (name) sessionNames.set(nameKey(lang, id), name)
    }
  }
  return out
}

// "While the app is open": the first hook to mount drops the names whenever the app is
// backgrounded. require() here, not an import, so Node (the tests) never loads react-native.
let lifetimeHooked = false
function hookLifetime() {
  if (lifetimeHooked) return
  lifetimeHooked = true
  const { AppState } = require('react-native')
  AppState.addEventListener('change', s => { if (s === 'background') clearGoogleNames() })
}

// Same result shape as checkIn() in utils/checkins.js, so one Outcome renders both.
export async function checkInGoogle(client, placeId, fix) {
  const res = await invoke(client, {
    action: 'checkin', placeId, lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy,
  })
  if (!res.ok) return { ok: false, code: res.code }
  return { ok: true, already: res.data?.already === true, id: res.data?.id ?? null }
}

// The phone-side pre-check against Google's position for the row (the server re-reads it).
export function googleWithinReach(place, fix) {
  return metresBetween(fix, { latitude: place.lat, longitude: place.lng }) <= CHECKIN_RADIUS_M
}

export async function loadGooglePins(client) {
  const { data, error } = await client.rpc('get_google_place_pins')
  return error ? [] : data ?? []
}

// A Google place's page in Google Maps (opens the app when installed).
export function googleMapsUrl(placeId, name) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name || 'place')}&query_place_id=${encodeURIComponent(placeId)}`
}

// Names for the Google ids in `ids`, fetched once per id for as long as the caller is mounted.
// Component state only (see the note at the top): nothing outlives the screen.
export function useGoogleNames(client, ids, lang) {
  hookLifetime()
  const [names, setNames] = useState({})
  const asked = useRef(new Set())
  const key = ids.filter(Boolean).join(',')
  useEffect(() => {
    const missing = [...new Set(ids.filter(id => id && !asked.current.has(id)))]
    if (!missing.length) return
    missing.forEach(id => asked.current.add(id))
    // No cancel on re-run: an answer for ids already marked asked must still land.
    googleNames(client, missing, lang).then(n => setNames(prev => ({ ...prev, ...n })))
  }, [key, lang])
  return names
}
