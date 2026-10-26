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
//     <ul><li><b>Ad Soyad : 05xx xxx xx xx</b></li>
//         <li><b>Ad Soyad : 05xx xxx xx xx</b></li></ul>
// (one or two agents; a block can also carry names with no number at all)
//
// C2: no per-property agent surfaces anywhere in ADA, so these come out BEFORE storing,
// never at render — a stored phone is a leak whatever the UI does with it.
//
// Two rules, in this order (2026-10-26):
//
//  1. A marker (İletişim, Bilgi için, Detaylı bilgi) cuts the text ONLY when it opens a
//     TRAILING CONTACT BLOCK: every non-empty line after it is a contact line (a name, a
//     colon, then a phone / e-mail / WhatsApp link / nothing). A marker followed by anything
//     else — "Fiyat: £…", prose — is not a block start and the text is kept. The old
//     first-marker cut silently dropped the sentence AND the price line of a listing that
//     says "Detaylı bilgi ve satış için bize iletişime geçin." before its price.
//  2. Anywhere in the text: e-mail addresses, WhatsApp links and whole contact lines
//     (name : phone/e-mail/WhatsApp) are removed. A name-shaped line with an EMPTY or other
//     value outside a block is a feature label ("Banyo Sayısı : 2", "Site Fasiliteleri :")
//     and stays.
//
// TRUNCATION IS NOT THE GUARD. assertNoContact() below is the part that survives a new
// wording, and it refuses the row rather than storing a leak. The same detectors run daily
// over what is stored (scripts/check-novest-descriptions.mjs).
export const CONTACT_MARKER = /İletişim|iletişim|İLETİŞİM|Iletisim|Bilgi\s+için|Detaylı\s+bilgi/

// TRNC/TR mobiles: 05xx xxx xx xx, with or without +90, and any separator run.
// Also catches the (0392) landline shape used elsewhere in the feed's prose.
export const PHONE_RE =
  /(?:\+?90[\s.\-]?)?\(?0?\s?(?:5\d{2}|392|533|542|548)\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}/

export const EMAIL_RE = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}/u

export const WHATSAPP_RE =
  /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|(?:www\.|web\.|chat\.)?whatsapp\.com)(?:\/[^\s<>"')\]]*)?/i

const NAME_COLON =
  "^[\\s•·*\\-–]*\\p{Lu}[\\p{L}'’.\\-]*(?:\\s+\\p{L}[\\p{L}'’.\\-]*){0,3}(?:\\s*\\([^)]*\\))?\\s*:(?!\\/\\/)\\s*"
const NAME_COLON_RE = new RegExp(NAME_COLON, 'u')

// A whole line: name-shaped, a colon, and a phone / e-mail / WhatsApp value somewhere after.
export const CONTACT_LINE_RE =
  new RegExp(`${NAME_COLON}.*?(?:${PHONE_RE.source}|${EMAIL_RE.source}|${WHATSAPP_RE.source}).*$`, 'u')

const globalOf = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
const VALUES_G = [PHONE_RE, EMAIL_RE, WHATSAPP_RE].map(globalOf)
const BLOCK_LEFTOVER = /^[\s/,;|&+\-–()·.]*(?:whatsapp|wp|tel|gsm|mobil)?[\s/,;|&+\-–()·.]*$/i
const MARKER_TAIL_MAX = 120   // a marker "line" longer than this is a paragraph, never a block header

// Which kinds of contact data are in `text`. Names only — never the matched strings, so a
// caller can log the result in a public run.
export function contactKinds(text) {
  const s = String(text ?? '')
  const kinds = []
  if (PHONE_RE.test(s)) kinds.push('phone')
  if (EMAIL_RE.test(s)) kinds.push('email')
  if (WHATSAPP_RE.test(s)) kinds.push('whatsapp')
  if (s.split('\n').some(l => CONTACT_LINE_RE.test(l.trim()))) kinds.push('contact-line')
  return kinds
}

// Line-ish segments of tag-bearing text. Each starts at its leading boundary token (tokLen
// long), so a segment can be cut out whole, bullet and all.
const BOUNDARY = /<\/(?:p|div|ul|ol|li|h[1-6])\s*>|<(?:li|p|div|ul|ol|h[1-6])(?:\s[^>]*)?>|<br\s*\/?>|\r?\n/gi
const plainOf = raw => raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

function segmentsOf(text) {
  const segs = []
  let start = 0, tokLen = 0
  for (const m of text.matchAll(BOUNDARY)) {
    segs.push({ start, tokLen, end: m.index })
    start = m.index; tokLen = m[0].length
  }
  segs.push({ start, tokLen, end: text.length })
  for (const s of segs) { s.raw = text.slice(s.start + s.tokLen, s.end); s.plain = plainOf(s.raw) }
  return segs
}

function stripValues(s) {
  let out = s
  for (const re of VALUES_G) out = out.replace(re, ' ')
  return out
}

// A line that may sit inside a trailing contact block: name : value, a bare phone / e-mail /
// WhatsApp line, or hashtags (18029 ends its block with "#Tag #Tag").
function isBlockLine(plain) {
  if (/^(?:#\S+\s*)+$/u.test(plain)) return true
  const m = NAME_COLON_RE.exec(plain)
  if (m) return BLOCK_LEFTOVER.test(stripValues(plain.slice(m[0].length)))
  const rest = stripValues(plain)
  return rest !== plain.replace(/\s+/g, ' ') && BLOCK_LEFTOVER.test(rest)
}

function cutTrailingBlock(text) {
  const segs = segmentsOf(text)
  let L = segs.length
  while (L > 0 && (segs[L - 1].plain === '' || isBlockLine(segs[L - 1].plain))) L--
  for (let i = Math.max(0, L - 1); i < segs.length; i++) {
    const s = segs[i]
    const m = CONTACT_MARKER.exec(s.plain)
    if (!m || s.plain.length - m.index > MARKER_TAIL_MAX) continue
    const rawM = CONTACT_MARKER.exec(s.raw)
    const before = rawM ? plainOf(s.raw.slice(0, rawM.index)) : ''
    return text.slice(0, before === '' ? s.start : s.start + s.tokLen + (rawM ? rawM.index : 0))
  }
  return text
}

function dropContactLines(text) {
  return segmentsOf(text).map(s => {
    if (!CONTACT_LINE_RE.test(s.plain)) return text.slice(s.start, s.end)
    const tok = text.slice(s.start, s.start + s.tokLen)
    return /^<li/i.test(tok) ? '' : tok
  }).join('')
}

export function stripContactBlock(html) {
  let text = cutTrailingBlock(decodeEntities(html))
  text = dropContactLines(text)
  for (const re of [EMAIL_RE, WHATSAPP_RE]) text = text.replace(globalOf(re), '')
  return text
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
// is a smaller failure than a partner's private contact published in it. The message names
// the KIND only: callers print it into public run logs.
export function assertNoContact(label, ...fields) {
  for (const f of fields) {
    const kinds = contactKinds(f)
    if (kinds.length) throw new Error(`${label}: ${kinds.join('+')} survived the contact strip`)
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
export const TYPE_PRIORITY = [
  ['land',       ['arsa', 'arazi', 'tarla']],
  ['studio',     ['studyo']],
  ['villa',      ['villa', 'ikiz-villa', 'bungalow']],
  ['house',      ['mustakil-ev']],
  // komple-bina (added to their taxonomy by 2026-09-29, top-level, not under Ticari): a whole
  // building sold as one asset — the first one (21853) is a commercial block with a shop and
  // eight flats. An investment purchase, not a home: commercial, never 'apartment'.
  ['commercial', ['isyeri', 'dukkan', 'ticari', 'depo', 'magaza', 'ofis', 'otel', 'komple-bina']],
  ['apartment',  ['apartman-dairesi', 'penthouse', 'zemin-kat-daire', 'apartman', 'dubleks']],
]

// 'konut' is the generic container ("residential"), never a leaf answer — EXCEPT when a
// listing carries nothing else, which happens on exactly 2 rows (22055, 21804). Both are
// ground-floor flats by their own titles, so apartment is the truthful fallback and not
// a shrug.
export const KONUT = 'konut'

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
// ─── Where a listing goes: district from the agency's STATE, area from its CITY ─────────────
// One function for both callers (scripts/import-novest-properties.mjs and
// supabase/functions/sync-novest), so they cannot drift apart. areas.js is passed in rather
// than imported, because the Edge Function resolves it by its own relative path.
//
// ⚠ KARPAZ. The agency has no Karpaz state; a Bafra / Yenierenköy / Dipkarpaz listing arrives
//   under İskele. ADA's rule (constants/regions.js: "east of Boğaz = Karpaz"; areas.js since
//   2026-09-29) puts those villages in karpaz. So when the state says İskele and the city is a
//   KARPAZ area, the listing moves to karpaz WITH its area. Only that pair moves: a city that is
//   an İskele area, or matches nothing, stays exactly as before.
export function placeListing(stateSlug, citySlug, areasByRegion, areaSlugOf) {
  let district = DISTRICT_BY_STATE[stateSlug] ?? null
  let area = null
  if (citySlug && district) {
    const cand = AREA_ALIASES[citySlug] ?? citySlug
    const inRegion = r => (areasByRegion[r] || []).some(n => areaSlugOf(n) === cand)
    if (inRegion(district)) area = cand
    else if (district === 'iskele' && inRegion('karpaz')) { district = 'karpaz'; area = cand }
  }
  return { district, area }
}

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
