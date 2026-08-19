#!/usr/bin/env node
// ─── Gişe Kıbrıs feed → clean seed ───────────────────────────────────────────
//
// Transforms the partner's raw export into supabase/seed/gisekibris-events-clean.json.
// Pure transform: reads a file, writes a file, touches no network and no database.
//
//   node scripts/prepare-gisekibris-feed.mjs ~/Downloads/upcoming-events.json
//   node scripts/prepare-gisekibris-feed.mjs <raw.json> --out <path>
//
// Then: node scripts/check-gisekibris-urls.mjs --apply   (probes ticket_url)
// Then: node scripts/import-gisekibris-events.mjs --dry
//
// WHY THIS EXISTS: the first clean seed was produced ad-hoc, so the transform was
// unreproducible — the whitespace rule below in particular existed nowhere but in
// the output. A weekly drop needs the transform in the repo, not in someone's memory.
//
// IDENTITY — external_id = 'gk-' + the partner's own event ID.
// Their ID appears in two independent places and both are cross-checked here:
//   url    .../etkinlikler/merchandise-…-cage-club--uHqm0skWkAIxoFk91MpC
//   image  .../o/events-v2%2FuHqm0skWkAIxoFk91MpC%2Fbanner.png
// The ID is NOT fixed-width — 71 of 72 are 20-char Firestore ids, one is a 25-char
// cuid — so extraction splits on the LAST '--' and never assumes a length. If
// extraction fails, or the two sources disagree, this script EXITS NON-ZERO. It
// never falls back to a synthetic key: a silent fallback would reintroduce the
// content-hash identity this whole change exists to remove.
//
// (Superseded synthetic key, for reading old migrations: gk- + sha1(title|start)[:12].
// It rehashed whenever the partner fixed a typo, silently orphaning the row.)
//
// TITLE WHITESPACE IS LOAD-BEARING. 20 of 72 raw names carry doubled or trailing
// spaces ("RUSS MILLIONS  X CHAMADA CLUB"). Titles are NFC-normalised and their
// internal runs collapsed to single spaces. This is cosmetic for display but was
// structural for the old key, and it is still how a human reconciles a row against
// the feed — so it stays, and it stays documented.
//
// TOKENS ARE STRIPPED. source_image_url keeps only the path; the '?alt=media&token='
// query carries the partner's Firebase access token and this repo is public. The
// import writes the full tokenised URL to the database, and its sameValue() guard
// treats a stored URL that merely extends the stripped one as equal, so re-running
// never downgrades a fetchable URL to a bare path.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')
const SOURCE = 'gisekibris'

// Their vocabulary → ours (events_category_check: music, nightlife, sports, arts,
// family, other). An unmapped value is a hard error — defaulting to 'other' would
// silently bury a whole new category of events under a chip nobody filters by.
const CATEGORY = {
  'Club & Lounge & Bar': 'nightlife',
  'Elektronik Müzik':    'nightlife',
  'Plaj Partisi':        'nightlife',
  'Konser':              'music',
  'Hotel Konseri':       'music',
  'Sahne':               'arts',
}

// Mirrors events_description_check / events_description_i18n_check exactly. Checked
// here so a violation is a readable error on a local file rather than a CHECK
// failure partway through a live import.
const MAX_DESC = 2500
const MAX_I18N_JSON = 6000

const args = process.argv.slice(2)
const rawPath = args.find(a => !a.startsWith('--'))
const outIdx = args.indexOf('--out')
const outPath = outIdx !== -1 ? resolve(args[outIdx + 1]) : DEFAULT_OUT

function fail(...lines) {
  for (const l of lines) console.error(l)
  process.exit(1)
}

if (!rawPath) fail('Usage: node scripts/prepare-gisekibris-feed.mjs <raw-feed.json> [--out <path>]')
if (!existsSync(rawPath)) fail(`Raw feed not found: ${rawPath}`)

// ─── Field transforms ────────────────────────────────────────────────────────

const nfc = s => (s ?? '').normalize('NFC')

// Collapses every internal whitespace run, including newlines and tabs.
const cleanTitle = s => nfc(s).replace(/\s+/g, ' ').trim()

// Their descriptions are HTML fragments (<p>, <br>, entities). Paragraph structure
// is preserved as blank lines because the app renders it as plain <Text>.
function stripHtml(html) {
  return nfc(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '”')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .normalize('NFC')
    .trim()
}

// Everything after the LAST '--' in the final path segment. No URL in the feed has
// carried more than one '--', but splitting on the last occurrence costs nothing and
// survives a title that one day contains a double hyphen.
function idFromUrl(url) {
  if (typeof url !== 'string' || !url) return null
  const slug = url.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop()
  const i = slug.lastIndexOf('--')
  if (i === -1) return null
  return slug.slice(i + 2) || null
}

// The same ID from the other direction: events-v2/<ID>/banner.png inside the
// percent-encoded Firebase object path.
function idFromImage(url) {
  if (typeof url !== 'string' || !url) return null
  let pathname
  try { pathname = decodeURIComponent(new URL(url).pathname) } catch { return null }
  const m = pathname.match(/events-v2\/([^/]+)\//)
  return m ? m[1] : null
}

const stripToken = url => (typeof url === 'string' ? url.split('?')[0] : null)

// ─── Transform ───────────────────────────────────────────────────────────────

let raw
try { raw = JSON.parse(readFileSync(rawPath, 'utf8')) }
catch (e) { fail(`Could not parse ${rawPath}: ${e.message}`) }

const feed = Array.isArray(raw) ? raw : (raw.events ?? raw.data ?? null)
if (!Array.isArray(feed) || !feed.length) {
  fail(`${rawPath}: expected a non-empty array of events (or {events:[…]}).`)
}

const errors = []
const events = []
const seenId = new Map()

feed.forEach((ev, i) => {
  const where = `#${i + 1} ${cleanTitle(ev.name) || '(untitled)'}`

  const urlId = idFromUrl(ev.url)
  const imgId = idFromImage(ev.image)

  // Fail loudly, per requirement — never silently fall back to a synthetic key.
  if (!urlId) {
    errors.push(`${where}: could not extract an id from url: ${JSON.stringify(ev.url)}`)
    return
  }
  if (!imgId) {
    errors.push(`${where}: could not extract an id from image path: ${JSON.stringify(ev.image)}`)
    return
  }
  if (urlId !== imgId) {
    errors.push(`${where}: id disagreement — url says "${urlId}", image path says "${imgId}"`)
    return
  }
  if (!/^[A-Za-z0-9]+$/.test(urlId)) {
    errors.push(`${where}: id is not alphanumeric: ${JSON.stringify(urlId)}`)
    return
  }

  const externalId = `gk-${urlId}`
  if (seenId.has(externalId)) {
    errors.push(`${where}: duplicate id ${externalId} — also used by "${seenId.get(externalId)}"`)
    return
  }
  seenId.set(externalId, cleanTitle(ev.name))

  const category = CATEGORY[ev.category]
  if (!category) {
    errors.push(`${where}: unmapped category ${JSON.stringify(ev.category)} — add it to CATEGORY in this script.`)
    return
  }

  const title = cleanTitle(ev.name)
  if (!title) { errors.push(`${where}: empty title`); return }
  if (!ev.startdate) { errors.push(`${where}: missing startdate`); return }

  const descTr = stripHtml(ev.description?.tr)
  const descEn = stripHtml(ev.description?.en)

  if (descTr.length > MAX_DESC) {
    errors.push(`${where}: description_tr is ${descTr.length} chars, cap is ${MAX_DESC}`)
  }
  if (descEn.length > MAX_DESC) {
    errors.push(`${where}: description_en is ${descEn.length} chars, cap is ${MAX_DESC}`)
  }
  // The jsonb the import will build: "en" is omitted when it is byte-identical to
  // "tr" (untranslated Turkish, not a translation). Sized here against the same cap.
  const i18n = {}
  if (descTr) i18n.tr = descTr
  if (descEn && descEn !== descTr) i18n.en = descEn
  const i18nLen = Object.keys(i18n).length ? JSON.stringify(i18n).length : 0
  if (i18nLen > MAX_I18N_JSON) {
    errors.push(`${where}: description_i18n would serialise to ${i18nLen} bytes, cap is ${MAX_I18N_JSON}`)
  }

  events.push({
    external_id:      externalId,
    title,
    venue:            nfc(ev.venue).trim(),
    city:             nfc(ev.city).trim() || null,
    category,
    source_category:  ev.category,
    start_date:       ev.startdate,
    end_date:         ev.enddate ?? null,
    description_tr:   descTr || null,
    description_en:   descEn || null,
    is_tba:           descTr === 'TBA',
    source_image_url: stripToken(ev.image),
    // The full URL. Only the id half after '--' routes on their site — a wrong slug
    // still resolves — so a later title edit on their side cannot break this link.
    // check-gisekibris-urls.mjs probes every one of these and NULLs any that fail.
    ticket_url:       ev.url,
    latitude:         null,   // filled at import from scripts/gisekibris-venues.json
    longitude:        null,
    source:           SOURCE,
  })
})

if (errors.length) {
  fail(
    `Refusing to write ${outPath} — ${errors.length} problem(s) in the raw feed:`,
    '',
    ...errors.map(e => `  ✗ ${e}`),
    '',
    'Nothing was written. Fix the feed (or this script) and re-run.',
  )
}

events.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title, 'tr'))

const venues = [...new Set(events.map(e => e.venue))]
const dates = events.map(e => e.start_date).sort()

const seed = {
  meta: {
    source: `Gişe Kıbrıs — ${rawPath.split('/').pop()}`,
    event_count: events.length,
    venue_count: venues.length,
    date_range: [dates[0], dates[dates.length - 1]],
    unmapped_categories: [],
    notes: [
      'Generated by scripts/prepare-gisekibris-feed.mjs — do not hand-edit.',
      "external_id = 'gk-' + the partner's own event id, taken from the last '--' segment of their url and cross-checked against the events-v2/<id>/ image path. Ids are not fixed-width (20-char Firestore, 25-char cuid), so no length is assumed.",
      'Titles are NFC-normalised with internal whitespace runs collapsed; 20 of the raw names carry doubled or trailing spaces.',
      'Descriptions stripped from HTML to plain text, NFC-normalised. Paragraph breaks kept as blank lines.',
      'ticket_url is the partner event page. Only the id half after the final \'--\' routes on their site, so a title edit on their side does not break the link. Any URL that failed to resolve was set to null by scripts/check-gisekibris-urls.mjs — the app hides the Buy Ticket button when it is null.',
      'latitude/longitude are null here; the import fills them from scripts/gisekibris-venues.json.',
      'start_date/end_date are true UTC. TRNC is UTC+3 (EEST). Render in device locale.',
      'source_image_url query strings (?alt=media&token=) stripped — this repo is public and those are Gise Kibris access tokens. The stripped path is still re-fetchable: their bucket allows public reads, and the import appends ?alt=media before downloading (without it Firebase returns object metadata JSON, not the image). Rows imported before this seed existed still hold the full tokenised URL in the database; the import will not downgrade them.',
    ],
  },
  events,
}

writeFileSync(outPath, JSON.stringify(seed, null, 2) + '\n')

const catCount = {}
for (const e of events) catCount[e.category] = (catCount[e.category] ?? 0) + 1
const bilingual = events.filter(e => e.description_en && e.description_en !== e.description_tr).length

console.log('')
console.log(`Gişe Kıbrıs feed → ${outPath.replace(ROOT + '/', '')}`)
console.log(`  ${String(events.length).padStart(4)}  events`)
console.log(`  ${String(venues.length).padStart(4)}  venues`)
console.log(`  ${String(bilingual).padStart(4)}  genuinely bilingual (en differs from tr)`)
console.log(`  ${String(events.length - bilingual).padStart(4)}  tr only (en identical or absent — "en" key omitted at import)`)
console.log(`  ${String(events.filter(e => e.is_tba).length).padStart(4)}  TBA`)
console.log(`  range: ${seed.meta.date_range.join('  →  ')}`)
console.log(`  categories: ${Object.entries(catCount).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log('')
console.log('  Next: node scripts/check-gisekibris-urls.mjs --apply')
console.log('')
