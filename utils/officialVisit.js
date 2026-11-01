// Visiting info from the Eski Eserler ve Müzeler Dairesi (EEMD) on places.official_visit
// (20261155): status, fee, a SEASONAL schedule and the official page.
//
// EEMD publishes one schedule per season and nothing in between. Hours are therefore shown
// only while today's CYPRUS date is inside hours.from..hours.to ('MM-DD', every year: the
// summer schedule comes back on 1 April without a data change); outside it the page says
// "check the official page" — a stale summer 19:00 closing shown in December is worse than
// none. The fee has no window: it stays, with the month it was read ("updated").
//
// Pure and offline, so scripts/test-official-visit.mjs can run it under plain Node.

const TZ = 'Europe/Nicosia'

// 'YYYY-MM-DD' in Cyprus. Fixed +03:00 if Intl is unavailable (as utils/towingHours.js):
// at worst a window opens or closes three hours early around midnight.
export function cyprusDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
    const get = t => parts.find(p => p.type === t)?.value
    const d = `${get('year')}-${get('month')}-${get('day')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  } catch {}
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)
}

// What the place page renders, or null for a place without EEMD data.
//   closed      → the "temporarily closed" badge; no fee, no hours, no Sunday note
//   fee         → { full, student } in TL (0/0 = free), or null when EEMD lists none
//   hours       → the schedule while in season, else null
//   sundayFree  → the site's schedule opens on weekends (the note is false on a site shut
//                 on Sundays, so it is never shown there)
export function officialVisitView(ov, now = new Date()) {
  if (!ov || typeof ov !== 'object') return null
  const closed = ov.status === 'closed'
  const h = ov.hours || null
  const today = cyprusDate(now)
  return {
    closed,
    fee: closed ? null : (ov.fee || null),
    hours: !closed && h && today.slice(5) >= h.from && today.slice(5) <= h.to ? h : null,
    sundayFree: !closed && h?.weekends === true,
    sourceUrl: ov.source_url || null,
    updated: /^\d{4}-\d{2}$/.test(ov.updated || '') ? ov.updated : null,
  }
}

// The fee line, worded once for the place page and the map pin sheet. `tr` is a key → string
// lookup (t bound to the language), so this file stays free of the i18n bundle.
export function officialFeeText(fee, tr) {
  if (!fee) return null
  if (fee.full === 0 && fee.student === 0) return tr('ovFree')
  return tr('ovFee').replace('{full}', fee.full).replace('{student}', fee.student)
}
