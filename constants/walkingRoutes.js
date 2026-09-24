// ─── Walking routes on the Keşfet map — the gate and the arithmetic ─────────
//
// Pure functions only, so scripts/validate-map-sources.mjs can assert them in Node. The
// screen draws what these return and decides nothing itself — same split as mapSources.js.
//
// ⚠ THE LAYER IS NOT `|| isAdmin`. Every other dark surface on this map opens for an admin
//   (the house pattern), and that would be wrong here: routes are one scalar flag with no
//   Coming Soon screen, and an admin opening the map in production is a user looking at a
//   production screen. The ONLY preview path is review mode — __DEV__ + an env var + admin
//   (utils/exploreReview.js) — which a release bundle folds to false. An admin alone
//   unlocks nothing; the validator asserts exactly that case.
//
// ⚠ ROUTES ARE A LAYER, NOT A buildMapSources() SOURCE. Sources become pins and pins are
//   clustered; a numbered stop must never disappear into a bubble reading "7".

export const ROUTE_COLOR = '#0E7C7B'
// ×1.3 is the usual street-detour factor over straight-line distance in a historic core;
// 4.5 km/h is an unhurried sightseeing pace. Both are estimates, and the UI only ever shows
// the ROUNDED result with a ≈ — never the raw number, which would claim a precision the
// method does not have.
export const DETOUR_FACTOR = 1.3
export const WALK_KMH = 4.5
export const VISITNCY_SOURCE = 'visitncy'

export function routesLayerVisible({ routesLive, review = false, isAdmin = false }) {
  return !!routesLive || (!!review && !!isAdmin)
}

export function metresBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// rows: walking_routes with walking_route_stops(position, place_id) embedded.
// placesById: the places the map ALREADY LOADED — RLS-filtered, status-filtered. A stop
// whose place is not in it (pending, hidden, deleted) is SKIPPED and the rest are
// RENUMBERED, so the line, the numbers and the ≈ figures all describe the same walk. The
// distance is recomputed from the drawn stops rather than read from straight_line_km, which
// describes the full route and would disagree with a line that has a stop missing.
export function resolveRoutes(rows, placesById, { review = false } = {}) {
  const out = []
  for (const r of rows || []) {
    if (!r.is_active && !review) continue
    const stops = [...(r.walking_route_stops || [])]
      .sort((a, b) => a.position - b.position)
      .map(s => placesById.get(s.place_id))
      .filter(p => p && p.latitude != null && p.longitude != null)
    if (stops.length < 2) continue
    out.push({ ...r, stops, estimate: walkEstimate(stops) })
  }
  return out.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

// Rounded for display: whole km (never below 1), minutes to the nearest 5 (never below 5).
export function walkEstimate(stops) {
  let m = 0
  for (let i = 1; i < stops.length; i++) m += metresBetween(stops[i - 1], stops[i])
  const walkedKm = (m / 1000) * DETOUR_FACTOR
  const rawMin = (walkedKm / WALK_KMH) * 60
  return {
    km:  Math.max(1, Math.round(walkedKm)),
    min: Math.max(5, Math.round(rawMin / 5) * 5),
  }
}

// The partner credit names the Ministry of Tourism and links to its site in the reader's
// language: the Turkish portal for Turkish, the English one for everyone else. `lang` is
// a LANGUAGES key ('Turkish'), never an ISO code — see CLAUDE.md.
export function creditUrl(lang) {
  return lang === 'Turkish' ? 'https://www.adakibrisim.com' : 'https://www.visitncy.com'
}
// The site's own brand, never translated — it fills routeCredit's {brand} slot, so the
// name on the credit always matches the site the tap opens.
export function creditBrand(lang) {
  return lang === 'Turkish' ? 'Ada Kıbrıs' : 'Visit NCY'
}

export function walkingDirectionsUrl(stop) {
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=walking`
}
