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
// SAFETY FIRST (2026-10-26): whatever the old first-marker cut removed is still removed,
// unless it is positively LISTING CONTENT. An attempt to recognise the block's shape (a
// "block walk") failed open on every shape it did not know (foreign number, bare name,
// @handle, footer line), so the cut is decided by what the tail LOOKS LIKE instead:
//
//  1. For each marker (İletişim, Bilgi için, Detaylı bilgi) in order, the TAIL is the plain
//     text from that marker to the end. The EARLIEST marker whose tail is short (TAIL_MAX)
//     and holds no listing-content token (currency, m2, a price) is the cut. A marker whose
//     tail carries "Fiyat: £250.000" is not a block start, so the sentence and the price in
//     front of the real block survive (21016).
//  2. Anywhere in the text: e-mail addresses, WhatsApp links and whole contact lines
//     (name : phone/e-mail/WhatsApp) are removed. A name-shaped line with an EMPTY or other
//     value is a feature label ("Banyo Sayısı : 2", "Site Fasiliteleri :") and stays.
//
// A marker that did NOT cut leaves its tail in the text. The strip never throws (the Edge
// Function calls it outside its try); contactKinds() below reports 'uncut-marker' when that
// tail still has a contact-ish SHAPE, and assertNoContact() refuses the row. A marker in
// prose with no such shape is kept: the sentence is content, not a leak.
//
// TRUNCATION IS NOT THE GUARD. assertNoContact() is the part that survives a new wording,
// and the same detectors run daily over what is stored (scripts/check-novest-descriptions.mjs).
export const CONTACT_MARKER = /İletişim|iletişim|İLETİŞİM|Iletisim|Bilgi\s+için|Detaylı\s+bilgi/

// TRNC/TR mobiles: 05xx xxx xx xx, with or without +90, and any separator run; the (0392)
// landline shape; any international number (+CC …, 00CC …, 8-15 digits; not "2+1 …"); and a
// generic national 0-prefixed 10-11 digit number (0212 …). Every quantifier is bounded.
export const PHONE_RE = new RegExp([
  String.raw`(?:\+?90[\s.\-]?)?\(?0?\s?(?:5\d{2}|392|533|542|548)\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}`,
  String.raw`(?<![\p{L}\p{N}])\+[\s.\-()]{0,2}\d(?:[\s.\-()]{0,2}\d){7,14}`,
  String.raw`(?<![\p{L}\p{N}.,])00[\s.\-]?\d(?:[\s.\-()]{0,2}\d){7,13}`,
  String.raw`(?<![\p{N}.,])0(?:[\s.\-()]{0,2}\d){9,10}(?!\p{N})`,
].join('|'), 'u')

// The local part is anchored at the start of its token (lookbehind) instead of capped at 64:
// an uncapped, unanchored local part is retried from every character of a long run (3 s on
// 5 KB); anchored it is scanned once per token. An over-long local part is removed whole.
export const EMAIL_RE =
  /(?<![\p{L}\p{N}._%+\-])[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]{1,63}(?:\.[\p{L}\p{N}\-]{1,63}){0,10}\.\p{L}{2,24}/u

export const WHATSAPP_RE =
  /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|(?:www\.|web\.|chat\.)?whatsapp\.com)(?:\/[^\s<>"')\]]{0,200})?/i

// Refusal-only shapes (removing them would only hide a leak we could not otherwise see).
export const HANDLE_RE = /(?<![\p{L}\p{N}._%+\-@])@[A-Za-z0-9_][A-Za-z0-9._]{2,29}/u
export const OBFUSCATED_EMAIL_RE = /[\[({<]\s{0,2}(?:at|@)\s{0,2}[\])}>]/i
const URL_RE = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>"')\]]{1,200}|(?<![\p{L}\p{N}@.\-])[\p{L}\p{N}\-]{2,63}\.(?:com|net|org|info|biz|eu|cy|tr|io|me|co|uk)(?:\.[a-z]{2})?(?![\p{L}\p{N}])`, 'iu')

const NAME_COLON =
  "^[\\s•·*\\-–]*\\p{Lu}[\\p{L}'’.\\-]*(?:\\s+\\p{L}[\\p{L}'’.\\-]*){0,3}(?:\\s*\\([^)]{0,60}\\))?\\s*:(?!\\/\\/)\\s*"

// A whole line: name-shaped, a colon, and a phone / e-mail / WhatsApp value somewhere after.
// Only ever tested on a line of at most LINE_MAX characters (see isContactLine).
export const CONTACT_LINE_RE =
  new RegExp(`${NAME_COLON}[^\\n]{0,200}?(?:${PHONE_RE.source}|${EMAIL_RE.source}|${WHATSAPP_RE.source})[^\\n]*$`, 'u')

const LINE_MAX = 300
const MAY_BE_WHATSAPP = /wa\.me|whatsapp/i   // cheap prefilter: the real regex only runs when this hits
const isContactLine = line => line.length <= LINE_MAX && CONTACT_LINE_RE.test(line)

const globalOf = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
const MARKER_G = globalOf(CONTACT_MARKER)

// A line that is only a name: 2-5 words, the first capitalised, no digits, optional colon.
const NAME_ONLY_RE = /^\p{Lu}[\p{L}'’.\-]*(?:\s+\p{L}[\p{L}'’.\-]*){1,4}$/u
const LEADING_BULLET = /^[\s•·*\-–]+/

// What a marker's tail may still contain and be a contact block: nothing the listing is about.
// TAIL_MAX: the longest tail the cut removes from the live feed is 104 plain
// characters (measured 2026-10-26 by validate-novest-mapping.mjs, "longest removed tail" line: 104).
const TAIL_MAX = 300
const RAW_TAIL_MAX = 4000   // tags inflate raw length; beyond this the tail cannot qualify
const LISTING_CURRENCY = /[£$€₺]|(?<![\p{L}\p{N}])(?:TL|GBP|STG|EUR|USD)(?![\p{L}\p{N}])/u
const LISTING_AREA = /(?<!\p{L})m[2²](?!\p{N})|metrekare/iu
const LISTING_PRICE = /(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d]|[.\-\s]\d)/
const hasListingToken = s => LISTING_CURRENCY.test(s) || LISTING_AREA.test(s) || LISTING_PRICE.test(s)

// True when the text after the LAST marker still has a contact-ish shape: a name-only line,
// a URL / website, an @handle or [at] e-mail (phones and e-mails are their own kinds).
function uncutMarkerTail(s) {
  let idx = -1
  for (const m of s.matchAll(MARKER_G)) idx = m.index
  if (idx < 0) return false
  const lines = s.slice(idx).split('\n', 400)
  lines[0] = lines[0].replace(MARKER_G, '').replace(/^[^\p{L}\p{N}]+/u, '')
  for (const raw of lines) {
    const line = raw.replace(LEADING_BULLET, '').replace(/\s*:\s*$/, '').trim()
    if (line.length === 0 || line.length > LINE_MAX) continue
    if (NAME_ONLY_RE.test(line) || URL_RE.test(line) || HANDLE_RE.test(line) || OBFUSCATED_EMAIL_RE.test(line)) return true
  }
  return false
}

// Which kinds of contact data are in `text`. Names only — never the matched strings, so a
// caller can log the result in a public run.
export function contactKinds(text) {
  const s = String(text ?? '')
  const kinds = []
  const at = s.includes('@')
  if (/\d/.test(s) && PHONE_RE.test(s)) kinds.push('phone')
  if (at && EMAIL_RE.test(s)) kinds.push('email')
  if (/[\[({<]/.test(s) && OBFUSCATED_EMAIL_RE.test(s)) kinds.push('email-obfuscated')
  if (at && HANDLE_RE.test(s)) kinds.push('handle')
  if (MAY_BE_WHATSAPP.test(s) && WHATSAPP_RE.test(s)) kinds.push('whatsapp')
  if (s.includes(':') && s.split('\n').some(isContactLine)) kinds.push('contact-line')
  if (uncutMarkerTail(s)) kinds.push('uncut-marker')
  return kinds
}

// Line-ish segments of tag-bearing text. Each starts at its leading boundary token (tokLen
// long), so a segment can be cut out whole, bullet and all.
const BOUNDARY = /<\/(?:p|div|ul|ol|li|h[1-6])\s*>|<(?:li|p|div|ul|ol|h[1-6])(?:\s[^>]{0,200})?>|<br\s*\/?>|\r?\n/gi
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

function blockCutIndex(text) {
  const cuts = []
  for (const s of segmentsOf(text)) {
    let first = true
    for (const m of s.raw.matchAll(MARKER_G)) {
      const atStart = first && plainOf(s.raw.slice(0, m.index)) === ''
      first = false
      cuts.push(atStart ? s.start : s.start + s.tokLen + m.index)
    }
  }
  // A later marker's tail is a SUFFIX of an earlier one's, so "short and token-free" holds for
  // a suffix of the markers: walk from the last one back, and the earliest that still
  // qualifies is the cut. Also bounds the work: only markers near the end are ever measured.
  let best = -1
  for (let i = cuts.length - 1; i >= 0; i--) {
    if (text.length - cuts[i] > RAW_TAIL_MAX) break
    const tail = plainOf(text.slice(cuts[i]))
    if (tail.length > TAIL_MAX || hasListingToken(tail)) break
    best = cuts[i]
  }
  return best
}

// Plain text that the marker cut removes ('' when nothing is cut). For the validator's TAIL_MAX report.
export function removedTail(html) {
  const text = decodeEntities(html)
  const i = blockCutIndex(text)
  return i < 0 ? '' : plainOf(text.slice(i))
}

function dropContactLines(text) {
  return segmentsOf(text).map(s => {
    if (!isContactLine(s.plain)) return text.slice(s.start, s.end)
    const tok = text.slice(s.start, s.start + s.tokLen)
    return /^<li/i.test(tok) ? '' : tok
  }).join('')
}

export function stripContactBlock(html) {
  let text = decodeEntities(html)
  const cut = blockCutIndex(text)
  if (cut >= 0) text = text.slice(0, cut)
  text = dropContactLines(text)
  if (text.includes('@')) text = text.replace(globalOf(EMAIL_RE), '')
  if (MAY_BE_WHATSAPP.test(text)) text = text.replace(globalOf(WHATSAPP_RE), '')
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
