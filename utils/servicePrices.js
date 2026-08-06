// Physical-service price ranges (garage Slice 4). Numeric only, single assumed
// currency (TL) — these are real-world commerce prices, allowed to display under
// Apple 3.1.1, and unrelated to ADA's own price-free featured/subscription tiers.
// Stored on facilities.service_prices as { serviceKey: { from, to } }.

export const PRICE_CURRENCY = 'TL'

// "400–600 TL", or "400 TL" when both ends match / only one is set. null if empty.
export function formatPriceRange(range) {
  if (!range || typeof range !== 'object') return null
  const { from, to } = range
  if (from == null && to == null) return null
  const lo = from != null ? from : to
  const hi = to   != null ? to   : from
  return `${lo === hi ? lo : `${lo}–${hi}`} ${PRICE_CURRENCY}`
}

// Services the facility both OFFERS (service_types) and has a price for, returned
// in `orderedKeys` order (falls back to the blob's own key order). Each entry:
// { key, from, to }.
export function pricedServices(facility, orderedKeys) {
  const sp = facility?.service_prices
  if (!sp || typeof sp !== 'object') return []
  const types = Array.isArray(facility?.service_types) ? facility.service_types : []
  const keys  = orderedKeys?.length ? orderedKeys : Object.keys(sp)
  const out = []
  for (const key of keys) {
    if (!types.includes(key)) continue
    const range = sp[key]
    if (!range || typeof range !== 'object') continue
    if (range.from == null && range.to == null) continue
    out.push({ key, from: range.from, to: range.to })
  }
  return out
}
