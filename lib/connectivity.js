// Bağlantı & eSIM — data layer for the KKTCELL partner module.
//
// READ-ONLY SURFACE. Nothing here writes to connectivity_operators / _packages / _stores,
// and nothing should be added that does: the three tables are maintained by SQL so a
// price, a brand colour, a phone number or a campaign banner can change the same day
// without an OTA. That is the whole point of the module, and it is why no value below is
// hardcoded — every colour, URL, logo and phone number comes off the operator row.
//
// Each function returns { data, error } rather than throwing, matching the shape screens
// in this app already destructure from supabase-js directly.

import { supabase } from './supabase'
import { haversineKm } from '../utils/facilityUtils'

// The single active partner operator. v1 is KKTCELL-only, but the slug is NOT hardcoded —
// the module renders whichever active operator sorts first, so swapping partner or adding
// a second one later is a data change, not a code change.
export async function fetchOperator() {
  const { data, error } = await supabase
    .from('connectivity_operators')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return { data: data ?? null, error }
}

// maybeSingle() returns { data: null, error: null } on zero rows — it does NOT throw — so
// a caller that gets null here is looking at "no active operator", not a failure. Screens
// must render an empty state for that rather than assuming data is present.

export async function fetchPackages(operatorId) {
  if (!operatorId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('connectivity_packages')
    .select('*')
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  return { data: data ?? [], error }
}

export async function fetchStores(operatorId) {
  if (!operatorId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('connectivity_stores')
    .select('*')
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  return { data: data ?? [], error }
}

// ─── HANDOFF URL ────────────────────────────────────────────────────────────
//
// KKTCELL measures ADA-referred traffic on their own side by the utm_source tag, so the
// tag has to survive whatever URL shape they put in the row.
//
// CONDITIONAL, not a bare `+ '?utm_source=ada'`. handoff_url is SQL-swappable and today's
// seeded values happen to carry no query string — but the day somebody pastes a URL that
// already has one, a second '?' silently breaks the link, and it breaks it on the single
// CTA the whole module exists to deliver. Also refuses to append twice, so a row that
// already carries the tag is left exactly as written.
export function withUtmSource(url, source = 'ada') {
  if (!url) return null
  if (/[?&]utm_source=/.test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  // Preserve any fragment: a tag appended after #section never reaches the server.
  const hash = url.indexOf('#')
  if (hash === -1) return `${url}${sep}utm_source=${source}`
  return `${url.slice(0, hash)}${sep}utm_source=${source}${url.slice(hash)}`
}

// The package's own application URL when it has one, otherwise the operator's generic eSIM
// page. Either way the utm tag is applied to whichever URL actually gets opened.
export function packageHandoffUrl(pkg, operator) {
  return withUtmSource(pkg?.handoff_url || operator?.esim_url || null)
}

// ─── PRICE STAMP ────────────────────────────────────────────────────────────
//
// "Son güncelleme" under the package list. Derived from max(price_updated_at) across the
// packages actually on screen — NOT a value stored anywhere, so it cannot go stale
// independently of the prices it describes.
export function latestPriceUpdate(packages) {
  const stamps = (packages ?? [])
    .map(p => p?.price_updated_at)
    .filter(Boolean)
    .map(v => new Date(v))
    .filter(d => !Number.isNaN(d.getTime()))
  if (!stamps.length) return null
  return new Date(Math.max(...stamps.map(d => d.getTime())))
}

// ─── STORE DIRECTIONS ───────────────────────────────────────────────────────
//
// maps_url when the row carries one (it may point at a specific Places listing, which is
// better than a dropped pin), coordinates otherwise. Returns null when the row has
// neither, so the caller can hide the CTA rather than open a broken map.
export function storeDirectionsUrl(store) {
  if (store?.maps_url) return store.maps_url
  if (hasCoords(store)) {
    return `https://www.google.com/maps/search/?api=1&query=${store.latitude},${store.longitude}`
  }
  return null
}

export function hasCoords(store) {
  return typeof store?.latitude === 'number' && typeof store?.longitude === 'number'
}

// Stores that can actually be drawn as pins. A store row is allowed to exist with no
// coordinates (an address-only branch), and such a row still belongs in the LIST — it just
// cannot go on the map. Keeping the two derivations separate stops an address-only row
// from collapsing the map region to NaN.
export function mappableStores(stores) {
  return (stores ?? []).filter(hasCoords)
}

// ─── THE DOMAIN THE USER IS ABOUT TO LAND ON ────────────────────────────────
//
// Printed under the primary CTA, and it is derived from the URL rather than written into
// the copy on purpose. The whole reason this handoff uses expo-web-browser instead of a
// WKWebView is that the user types PASSPORT DETAILS on the other side and must be able to
// see the real address bar — so the label ADA shows beforehand has to come from the same
// string that is actually opened. A hardcoded "kktcell.com" would keep saying kktcell.com
// after somebody repointed handoff_url in SQL, which is the one moment it would matter.
//
// Regex rather than `new URL()`: this runs on a value typed into a database column, and a
// malformed one should cost the sub-label, not throw inside a render.
export function handoffHost(url) {
  const m = String(url || '').match(/^https?:\/\/([^/?#]+)/i)
  if (!m) return null
  return m[1].replace(/^www\./i, '').toLowerCase()
}

// ─── NEAREST STORE, AND DISTANCES ───────────────────────────────────────────
//
// Follows screens/DutyListScreen.js rather than inventing a second approach — same
// haversineKm out of utils/facilityUtils.js that duty and Home already share, and the same
// two rules that matter more than the arithmetic:
//
//   1. DERIVED, NEVER STORED AT FETCH TIME. userLocation resolves asynchronously in App.js
//      and can land AFTER a screen mounts, so a distance computed during the fetch leaves a
//      list that never gains distances on a slow fix. Callers must compute in a useMemo
//      keyed on the coordinates.
//   2. `sortByDistance = !!userLocation && !locationDenied`, copied verbatim. The two are
//      checked separately because they MEAN different things: a denied permission leaves
//      userLocation null too, but "the user said no" and "we do not have a fix yet" are
//      different states and only the second may resolve later.
//
// ⚠ NOTHING HERE ASKS FOR A PERMISSION, and nothing in this module may. Location is
//   requested exactly once, at App.js startup; every screen consumes userLocation as a prop.
//   A permission prompt raised from inside a partner module — a screen the user reached by
//   tapping "see packages" — would be both a surprise and, on a declared mixed-audience app,
//   a poor look. The prompt stays where the user can connect it to the app as a whole.
//
// ⚠ COORDINATES NEVER LEAVE THE DEVICE HERE. haversineKm is local arithmetic. utils/
//   facilityUtils.js has coarseCoord() for values that DO go to a third party (the weather
//   API) because Google Play declares Coarse Location; nothing in this module sends a
//   position anywhere, so there is nothing to coarsen.

// Straight-line km from the user to a store, or null when either side lacks coordinates.
export function storeDistanceKm(store, userLocation) {
  if (!userLocation || !hasCoords(store)) return null
  if (typeof userLocation.latitude !== 'number' || typeof userLocation.longitude !== 'number') return null
  return haversineKm(userLocation.latitude, userLocation.longitude, store.latitude, store.longitude)
}

// Stores with a `_dist` attached, sorted nearest-first when a distance is available.
//
// ⚠ FALLS BACK TO sort_order, NOT TO AN ARBITRARY ORDER. Without a fix the list keeps the
//   order the operator chose, which is a deliberate editorial sequence — not a random one —
//   so a user with location off still sees the branch KKTCELL put first.
//
// Rows with no coordinates sort LAST among located rows but are never dropped: an
// address-only branch is a real place a user can walk into.
export function decorateStores(stores, userLocation, { sortByDistance = true } = {}) {
  const out = (stores ?? []).map(st => ({ ...st, _dist: storeDistanceKm(st, userLocation) }))
  if (!sortByDistance) return out
  const anyDist = out.some(st => st._dist != null)
  if (!anyDist) return out
  return out.sort((a, b) => {
    if (a._dist == null && b._dist == null) return 0
    if (a._dist == null) return 1
    if (b._dist == null) return -1
    return a._dist - b._dist
  })
}

// The store to name on the compact line.
//
// ⚠ "NEAREST" IS ONLY EVER COMPUTED OVER ROWS THAT HAVE COORDINATES — an address-only row
//   can never win, because there is no distance by which it could. That is a property of the
//   data, not a filter anybody chose, and it is stated here so it is not rediscovered later
//   as a bug.
//
// With no fix (or no located rows) this returns the FIRST row by sort_order and a null
// distance, so the line still renders and stays tappable. The caller shows no distance in
// that case — duty's rule: no coordinate means no distance text at all, never a placeholder
// and never a zero.
export function nearestStore(stores, userLocation) {
  const list = stores ?? []
  if (!list.length) return null
  const located = list.filter(hasCoords)
  if (userLocation && located.length) {
    const decorated = decorateStores(located, userLocation)
    if (decorated[0]?._dist != null) return decorated[0]
  }
  return { ...list[0], _dist: null }
}
