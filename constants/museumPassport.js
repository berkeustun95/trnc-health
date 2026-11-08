// Müze Pasaportu (Explore stage 5, 2026-11-07): a stamp per EEMD site (places.official_visit), earned
// by a check-in there (Buradayım already proves the visit: ≤ 150 m, one-off position check). Medals at
// 5, 10 and every site. Owner-only, like Check-in'lerim: built from the caller's OWN check-ins, which
// RLS shows to nobody else, so there is no public per-person history. Pure, for scripts/test-museum-passport.mjs.

export const PASSPORT_TIERS = [5, 10]   // + 'all' (every site), appended in passportState

// sites: EEMD places; checkins: the caller's rows { place_id, created_at }.
export function passportState(sites, checkins) {
  const ids = new Set((sites || []).map(s => s.id))
  const stamps = new Map()   // place_id → first check-in date (ISO)
  for (const c of checkins || []) {
    if (!c?.place_id || !ids.has(c.place_id)) continue
    const prev = stamps.get(c.place_id)
    if (!prev || c.created_at < prev) stamps.set(c.place_id, c.created_at)
  }
  const total = ids.size
  const count = stamps.size
  const tiers = [...PASSPORT_TIERS.filter(n => n < total), total]
  return {
    stamps, count, total,
    medals: tiers.map((n, i) => ({ key: i === tiers.length - 1 ? 'all' : String(n), need: n, earned: total > 0 && count >= n })),
    next: tiers.find(n => count < n) ?? null,
  }
}

// Stamped first (oldest stamp first, the order they were collected), then the rest by name.
export function passportOrder(sites, stamps, nameOf) {
  return [...(sites || [])].sort((a, b) => {
    const sa = stamps.get(a.id), sb = stamps.get(b.id)
    if (sa && sb) return sa < sb ? -1 : sa > sb ? 1 : 0
    if (sa || sb) return sa ? -1 : 1
    return nameOf(a).localeCompare(nameOf(b), 'tr')
  })
}
