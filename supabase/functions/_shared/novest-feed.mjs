// ─── Novest feed — fetch, map, guard ─────────────────────────────────────────
//
// THE ONE DEFINITION of the mapping rules, imported by BOTH runtimes:
//   • Node   — scripts/import-novest-properties.mjs, mirror-novest-images.mjs,
//              validate-novest-mapping.mjs, verify-novest-import.mjs
//   • Deno   — supabase/functions/sync-novest/index.ts  (the cron job)
//
// It lives under supabase/functions/_shared/ rather than scripts/ for one reason: the
// Supabase CLI bundles what a function imports, and it will not reach up into scripts/.
// Putting it here means the cron job and the local tooling run THE SAME priority list,
// the same contact strip and the same deed regex. A Deno "port" of this file would be a
// second copy, and two copies of a priority list drift — silently, because both would
// keep working and only one would be right.
//
// CONSTRAINT: nothing here may import a Node built-in or a React Native module. It uses
// only fetch, URL, Date and setTimeout, all of which exist in both runtimes. Adding a
// `node:` import to this file breaks the cron job at deploy time.
//
// READ-ONLY against coldwellbankernovest.com. GET only, never POST/PUT/DELETE.

const BASE = 'https://coldwellbankernovest.com/wp-json/wp/v2'
const UA = 'ADA-TRNC-Health/1.0 (+https://ada.cy; partner listing sync; berke.ustun95@gmail.com)'
const REQUEST_DELAY_MS = 700   // good citizen; their box is a single LiteSpeed host

export const SOURCE = 'novest'
export const AGENCY_ID = '00000000-0000-4000-9000-000000000002'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── HTTP ────────────────────────────────────────────────────────────────────

let lastRequestAt = 0

export async function get(path, params = {}) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url.pathname}${url.search} -> ${res.status} ${res.statusText}`)
  return {
    body: await res.json(),
    total: Number(res.headers.get('x-wp-total') || 0),
    totalPages: Number(res.headers.get('x-wp-totalpages') || 0),
  }
}

// PAGINATES. Not optional, and not only for /properties: property_city has 106 terms,
// and a single per_page=100 call silently drops 5 that are in use — the listing keeps
// its area, the term lookup misses, and `area` lands NULL with no error anywhere.
export async function getAll(path, params = {}) {
  const out = []
  let page = 1
  for (;;) {
    const { body, totalPages } = await get(path, { ...params, per_page: 100, page })
    if (!Array.isArray(body)) throw new Error(`${path}: expected an array, got ${typeof body}`)
    out.push(...body)
    if (page >= (totalPages || 1)) break
    page++
  }
  return out
}

// ─── Text ────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&hellip;': '…', '&ndash;': '–', '&mdash;': '—', '&apos;': "'",
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|hellip|ndash|mdash|apos);/g, m => NAMED_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

// ─── THE CONTACT STRIP ───────────────────────────────────────────────────────
//
// Every body ends with a contact block:
//     <p><b>İletişim :</b></p>
//     <ul><li><b>Ahmet Ulutekin : 0542 861 04 30</b></li>
//         <li><b>İsmail Pirgalı : 0533 834 67 70</b></li></ul>
//
// C2: no per-property agent surfaces anywhere in ADA, so these come out BEFORE storing,
// never at render — a stored phone is a leak whatever the UI does with it.
//
// Measured across all 91 live listings on 2026-08-24:
//   • 91/91 carry an İletişim marker (spellings: 'İletişim' x90, 'iletişim' x1)
//   • ZERO listings have a phone-shaped string anywhere BEFORE the marker
//   • 60 listings carry one phone, 31 carry two — the block is plural
//
// TRUNCATION ALONE IS NOT THE GUARD. It works today and fails SILENTLY the day they
// write "Bilgi için" instead. assertNoPhone() below is the part that survives that, and
// it refuses the row rather than storing a leak. Same discipline as the towing checks:
// a guard nobody has watched refuse something is not a guard.
const CONTACT_MARKER = /İletişim|iletişim|İLETİŞİM|Iletisim|Bilgi\s+için|Detaylı\s+bilgi/

// TRNC/TR mobiles: 05xx xxx xx xx, with or without +90, and any separator run.
// Also catches the (0392) landline shape used elsewhere in the feed's prose.
export const PHONE_RE =
  /(?:\+?90[\s.\-]?)?\(?0?\s?(?:5\d{2}|392|533|542|548)\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}/

export function stripContactBlock(html) {
  const text = decodeEntities(html)
  const m = CONTACT_MARKER.exec(text)
  return m ? text.slice(0, m.index) : text
}

// <li> -> a bullet line. The source uses one <li> per fact ("90M2", "2+1",
// "Türk Koçanlı"), so the list structure IS the content and flattening it to a
// paragraph would run those facts together into an unreadable run-on.
export function htmlToText(html) {
  return String(html)
    .replace(/<\/(?:p|div|ul|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function cleanDescription(html) {
  return htmlToText(stripContactBlock(html))
}

// Throws. The caller drops the row rather than storing it — a listing missing from ADA
// is a smaller failure than a partner's private mobile number published in it.
export function assertNoPhone(label, ...fields) {
  for (const f of fields) {
    const hit = PHONE_RE.exec(String(f ?? ''))
    if (hit) throw new Error(`${label}: a phone-shaped string survived the contact strip — ${JSON.stringify(hit[0])}`)
  }
}

// ─── Numbers ─────────────────────────────────────────────────────────────────
//
// Their meta values are STRINGS ("130000", "90"). Anything that is not a clean number
// is REJECTED (null), never coerced — Number('') is 0 and Number('yok') is NaN, and a
// price silently becoming 0 is the worst possible failure in a property app.
export function num(raw) {
  if (raw === undefined || raw === null) return null
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim()
  if (s === '' || !/^-?\d+(?:[.,]\d+)?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function int(raw) {
  const n = num(raw)
  return n === null ? null : Math.trunc(n)
}

export const meta = (p, k) => {
  const v = (p.property_meta || {})[k]
  return Array.isArray(v) ? v[0] : v
}

export const metaArray = (p, k) => {
  const v = (p.property_meta || {})[k]
  return (Array.isArray(v) ? v : v ? [v] : []).filter(x => x !== '' && x != null)
}

// ─── property_type — A PRIORITY LIST, NOT DEPTH ──────────────────────────────
//
// The spec's "pick the deepest term" does not work, and the reason is not the Konut
// case it was written for. Konut, Villa, Zemin Kat Daire, Arsa and Ticari are ALL
// `parent: 0` — depth cannot separate them, and 18 of 91 listings carry two top-level
// terms. Measured tie cases:
//
//   Konut + Villa                             8 rows   0 vs 0
//   Konut + Zemin Kat Daire                   6 rows   0 vs 0
//   Arsa + Ticari                             1 row    0 vs 0
//   Konut + Apartman Dairesi + Ticari + Ofis  1 row    1 vs 1
//
// ORDER IS LOAD-BEARING, and two entries are here for a specific listing:
//
//   land BEFORE commercial   — 19242 is "Ticari Arsa", a commercial PLOT. It is land.
//   commercial BEFORE apartment
//       — 22204 "Ofis Ve Daireler" is a genuinely mixed-use building tagged with both
//         families. No algorithm resolves it; this is a judgement call, recorded in
//         2026-08-24_accommodation-slice2-log.md. An apartment buyer landing on an
//         office block is the worse miss, so mixed-use goes to commercial. It is the
//         ONLY row in the feed where the two families collide.
//
// Verified against all 21 combinations present in the live feed: every one resolves,
// and only 21853 (no terms at all) falls through.
const TYPE_PRIORITY = [
  ['land',       ['arsa', 'arazi', 'tarla']],
  ['studio',     ['studyo']],
  ['villa',      ['villa', 'ikiz-villa', 'bungalow']],
  ['house',      ['mustakil-ev']],
  ['commercial', ['isyeri', 'dukkan', 'ticari', 'depo', 'magaza', 'ofis', 'otel']],
  ['apartment',  ['apartman-dairesi', 'penthouse', 'zemin-kat-daire', 'apartman', 'dubleks']],
]

// 'konut' is the generic container ("residential"), never a leaf answer — EXCEPT when a
// listing carries nothing else, which happens on exactly 2 rows (22055, 21804). Both are
// ground-floor flats by their own titles, so apartment is the truthful fallback and not
// a shrug.
const KONUT = 'konut'

export function mapPropertyType(slugs) {
  for (const [ours, theirs] of TYPE_PRIORITY) {
    if (slugs.some(s => theirs.includes(s))) return ours
  }
  if (slugs.includes(KONUT)) return 'apartment'
  return null   // caller skips and reports
}

export const INTENT_BY_STATUS = { satilik: 'sale', kiralik: 'rent' }

export const DISTRICT_BY_STATE = {
  lefkosa: 'nicosia', girne: 'kyrenia', gazimagusa: 'famagusta',
  guzelyurt: 'morphou', iskele: 'iskele', lefke: 'lefke',
  // No 'karpaz' term exists in their taxonomy today. properties_district_check allows
  // it (20260904 widened the CHECK), so a term appearing later needs only this line.
}

// Their spelling vs constants/areas.js. Three real places written two ways, NOT a
// fuzzy matcher: a fuzzy match on Turkish place names would happily equate Girne's
// Boğaz with İskele's Boğaz, which are 40 km apart.
export const AREA_ALIASES = {
  'yeni-kent': 'yenikent',
  'yeni-sehir': 'yenisehir',
  'guzelyurt-merkez': 'merkez',
}

// Features that own a dedicated column. Excluded from `amenities` so the same fact does
// not render twice — once as a chip and once as a Fact row.
export const FEATURE_TO_COLUMN = {
  esyali: 'furnished',
  siteicerisinde: 'gated_community',   // their label carries a typo: "Site İçerisidne"
}

// ─── deed_type — anchored, whole-<li>, positive-only ─────────────────────────
//
// See 20260915_properties_deed_type_comment.sql for the full argument. The anchoring is
// the entire trick: a substring search for "koçan" also matches these real strings from
// this same feed, none of which states a deed type —
//     "%40 Peşinat Geriye Kalan Koçan Tesliminde"   (x3, payment terms)
//     "Koçanları Hazır" / "Koçanı Hazır"            (deeds ready, type unstated)
//     "Anahtar Teslimine Hazır ,Türk koçanlı ve …"  (compound sentence, land swap)
//
// POSITIVE-ONLY. Absence means the listing did not say. NULL is "not known" and never
// "no deed"; nothing may infer a non-Turkish deed from it.
const DEED_TURKISH = /^[-\s]*Türk\s+Koçan(?:lı)?[\s.]*$/i

export function extractDeedType(html) {
  const cut = stripContactBlock(html)
  for (const m of cut.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim()
    if (DEED_TURKISH.test(t)) return 'turkish'
  }
  return null
}

// ─── THE COORDINATE TRIPWIRE ─────────────────────────────────────────────────
//
// ⚠ THIS REJECTS 100% OF TODAY'S INPUT, BY DESIGN. It is not a filter that passes some
//   coordinates. All 91 live listings carry the byte-identical Houzez demo default
//   25.68654,-80.431345 — Miami. There is exactly ONE distinct pair in the whole feed:
//   nobody at Novest has ever touched the map field.
//
//   So this is a TRIPWIRE for the day they start filling it in, not a cleaner. If it
//   ever passes a coordinate, that is news and the run reports it — it does not quietly
//   start writing pins.
//
//   Anything that passes still lands with location_precision='area', because
//   properties_feed_precision_check requires it of every feed row. A partner supplying
//   genuinely exact coordinates is a deliberate Slice 1 amendment, not an import change.
const CY = { latMin: 34.9, latMax: 35.8, lngMin: 32.2, lngMax: 34.6 }

export function coordsInCyprus(lat, lng) {
  if (lat === null || lng === null) return false
  return lat >= CY.latMin && lat <= CY.latMax && lng >= CY.lngMin && lng <= CY.lngMax
}
