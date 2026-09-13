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
