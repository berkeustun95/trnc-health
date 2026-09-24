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

// The partner's city strings → the district names the rest of the app uses
// (constants/regions.js REGION_TO_DUTY, and scripts/gisekibris-venues.json).
// They send the colloquial short form "Mağusa"; everything we render says
// "Gazimağusa". `events` has no city column — the city is folded into the location
// text — so this is display-only, but a card reading "…, Mağusa" next to a UI that
// says "Gazimağusa" everywhere else is exactly the kind of drift that erodes trust
// in the data.
//
// Unmapped is a HARD ERROR, same as category. The first version of this pipeline
// applied this normalisation by hand and never wrote it down, so regenerating the
// seed silently reverted one row to "Mağusa" — caught only because it showed up as
// an unexplained `location` diff in a dry run. A one-line map entry is the whole fix.
const CITY = {
  'Girne':      'Girne',
  'Lefkoşa':    'Lefkoşa',
  'İskele':     'İskele',
  'Mağusa':     'Gazimağusa',
  'Gazimağusa': 'Gazimağusa',
  'Güzelyurt':  'Güzelyurt',
  'Lefke':      'Lefke',
}

// Mirrors events_description_check / events_description_i18n_check exactly. Checked
// here so a violation is a readable error on a local file rather than a CHECK
// failure partway through a live import.
const MAX_DESC = 3000
const MAX_I18N_JSON = 6000

const args = process.argv.slice(2)
const selftest = args.includes('--selftest')
const rawPath = args.find(a => !a.startsWith('--'))
const outIdx = args.indexOf('--out')
const outPath = outIdx !== -1 ? resolve(args[outIdx + 1]) : DEFAULT_OUT

function fail(...lines) {
  for (const l of lines) console.error(l)
  process.exit(1)
}

if (!rawPath && !selftest) fail('Usage: node scripts/prepare-gisekibris-feed.mjs <raw-feed.json> [--out <path>]')
if (rawPath && !existsSync(rawPath)) fail(`Raw feed not found: ${rawPath}`)

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

// The same ID from the other direction, from EITHER image host.
//
// ⚠ THE HOST DID NOT MOVE, IT SPLIT — both shapes are live in one response.
//   Measured on the 2026-09-24 live feed, 36 rows:
//     32  img-cdn.gisekibris.com/event/<ID>/banner.jpg          (the new CDN)
//      4  firebasestorage.../o/events-v2%2F<ID>%2Fbanner.png    (the original)
//   A regex matching only the new shape loses the cross-check on those 4; only the
//   old one loses it on 32. Accept both, and keep decodeURIComponent for the
//   Firebase form, whose separators are percent-encoded.
function idFromImage(url) {
  if (typeof url !== 'string' || !url) return null
  let pathname
  try { pathname = decodeURIComponent(new URL(url).pathname) } catch { return null }
  const m = pathname.match(/\/(?:event|events-v2)\/([^/]+)\//)
  return m ? m[1] : null
}

const stripToken = url => (typeof url === 'string' ? url.split('?')[0] : null)

// ─── Rebuild a ticket url the feed sent WITHOUT its id ──────────────────────
//
// The live feed emits one row whose url is slug-only, and THAT URL 404s:
//   feed sends  /etkinlikler/sener-sen-zengin-mutfagi?code=AF1727004770915   -> 404
//   canonical   /etkinlikler/sener-sen-zengin-mutfagi--cmrxgkhys00006dpe19d8kiuh
//                                                                            -> 200
// Measured 2026-09-24, both forms, with and without the affiliate code.
//
// Storing what the partner sent would put a DEAD link on a LIVE event: the page
// resolves fine by its canonical url and reports isCancelled=false. The next step
// in the pipeline would then null it, and the row would LOSE a Buy Ticket link it
// has today — a regression produced by trusting a field we can see is broken.
//
// So when the url carries no id and we have one from the image path, the id is
// appended in the partner's own canonical form. This is reconstruction, not
// invention: the slug and the id are both theirs, and only the id half routes on
// their site (a wrong slug still resolves), which is the same property that makes
// a stored link survive a title edit.
//
// The query string is preserved — that is where the affiliate code lives.
//
// ⚠ Nothing here is trusted on its own: check-gisekibris-urls.mjs probes every url
//   afterwards and nulls whatever does not resolve, so a reconstruction that
//   guessed wrong is caught rather than shipped.
function canonicalTicketUrl(rawUrl, id) {
  if (typeof rawUrl !== 'string' || !rawUrl || !id) return rawUrl ?? null
  let u
  try { u = new URL(rawUrl) } catch { return rawUrl }
  const seg = u.pathname.replace(/\/+$/, '').split('/').pop() ?? ''
  if (seg.includes('--')) return rawUrl                       // already canonical
  u.pathname = `${u.pathname.replace(/\/+$/, '')}--${id}`
  return u.toString()
}

// ─── Turkish-aware case fold, for the CATEGORY lookup only ──────────────────
//
// The live feed sends 'ELEKTRONİK MÜZİK' where the file drops sent 'Elektronik
// Müzik', so the map had to stop being case-sensitive. It cannot become a naive
// toLowerCase(): Turkish dotted capital İ (U+0130) lowercases to 'i' + U+0307
// COMBINING DOT ABOVE, so 'ELEKTRONİK MÜZİK'.toLowerCase() is 'elektroni̇k müzi̇k'
// — a different string from 'elektronik müzik', and it would still miss. Measured,
// not assumed: see `--selftest`, which folds the literal string from the feed.
//
// Scope is deliberately narrow. This maps İ→i and I→ı (Turkish's two i's are
// different letters, not a case pair) and does NOT fold accents — the same line
// utils/moderationNormalize.js holds, and for the same reason: folding ö→o makes
// unrelated words collide. It is applied ONLY to category keys, never to titles,
// descriptions or venue names, which are stored as the partner sends them.
const trFold = s => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().trim()

// Built from CATEGORY so the two can never drift; a collision would silently merge
// two of their categories into one of ours, so it is an error, not a warning.
const CATEGORY_FOLDED = (() => {
  const m = new Map()
  for (const [k, v] of Object.entries(CATEGORY)) {
    const f = trFold(k)
    if (m.has(f)) fail(`CATEGORY has two keys that fold to ${JSON.stringify(f)} — they would merge silently.`)
    m.set(f, v)
  }
  return m
})()

// ─── Self-test ───────────────────────────────────────────────────────────────
//
// Both halves have been WATCHED RED (break the fold, break the regex) — a check
// nobody has seen fail is a decoration. The category cases use the LITERAL strings
// from the live feed and the file drops, not paraphrases of them.
if (selftest) {
  let bad = 0
  const t = (label, got, want) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(46)} ${JSON.stringify(got)}${ok ? '' : `  wanted ${JSON.stringify(want)}`}`)
  }
  console.log('\n  Turkish category fold')
  t("'ELEKTRONİK MÜZİK' (live feed)", CATEGORY_FOLDED.get(trFold('ELEKTRONİK MÜZİK')), 'nightlife')
  t("'Elektronik Müzik' (file drops)", CATEGORY_FOLDED.get(trFold('Elektronik Müzik')), 'nightlife')
  t("'Club & Lounge & Bar'",          CATEGORY_FOLDED.get(trFold('Club & Lounge & Bar')), 'nightlife')
  t("'KONSER' upper",                 CATEGORY_FOLDED.get(trFold('KONSER')), 'music')
  t("'Hotel Konseri'",                CATEGORY_FOLDED.get(trFold('Hotel Konseri')), 'music')
  t('unknown stays unmapped',         CATEGORY_FOLDED.get(trFold('Tiyatro Gecesi')), undefined)
  // The trap itself: a naive lowercase leaves a combining dot and must NOT match.
  t('naive toLowerCase would MISS',   'ELEKTRONİK MÜZİK'.toLowerCase() === 'elektronik müzik', false)

  console.log('\n  id extraction — both image hosts, and the url fallback')
  t('CDN  /event/<id>/',      idFromImage('https://img-cdn.gisekibris.com/event/uewOPw8E9YKvoDpt793t/banner.jpg'), 'uewOPw8E9YKvoDpt793t')
  t('Firebase events-v2%2F',  idFromImage('https://firebasestorage.googleapis.com/v0/b/x/o/events-v2%2FKuUoVfqsF3pXjQNzYszB%2Fbanner.png?alt=media'), 'KuUoVfqsF3pXjQNzYszB')
  t('url with --ID and ?code', idFromUrl('https://www.gisekibris.com/etkinlikler/x--AbC123?code=AF1'), 'AbC123')
  t('url WITHOUT an id (ŞENER ŞEN)', idFromUrl('https://www.gisekibris.com/etkinlikler/sener-sen-zengin-mutfagi?code=AF1727004770915'), null)
  // The row that forced the fallback must land on its EXISTING external_id.
  t('ŞENER ŞEN falls back to the stored id',
    'gk-' + idFromImage('https://img-cdn.gisekibris.com/event/cmrxgkhys00006dpe19d8kiuh/banner.jpg'),
    'gk-cmrxgkhys00006dpe19d8kiuh')

  console.log('\n  ticket url reconstruction')
  t('slug-only url gains the id, keeps ?code',
    canonicalTicketUrl('https://www.gisekibris.com/etkinlikler/sener-sen-zengin-mutfagi?code=AF1727004770915', 'cmrxgkhys00006dpe19d8kiuh'),
    'https://www.gisekibris.com/etkinlikler/sener-sen-zengin-mutfagi--cmrxgkhys00006dpe19d8kiuh?code=AF1727004770915')
  t('a url that already has an id is untouched',
    canonicalTicketUrl('https://www.gisekibris.com/etkinlikler/x--AbC123?code=AF1', 'AbC123'),
    'https://www.gisekibris.com/etkinlikler/x--AbC123?code=AF1')
  t('affiliate code survives reconstruction',
    canonicalTicketUrl('https://www.gisekibris.com/etkinlikler/y?code=AF1727004770915', 'ZZZ').includes('code=AF1727004770915'), true)

  console.log('\n  whitespace')
  t('six trailing tabs are trimmed', nfc('Grand Opera Hotel Girne\t\t\t\t\t\t').trim(), 'Grand Opera Hotel Girne')
  t('internal runs collapse in titles', cleanTitle('RUSS MILLIONS  X  CHAMADA CLUB'), 'RUSS MILLIONS X CHAMADA CLUB')

  console.log(bad ? `\n  ${bad} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(bad ? 1 : 0)
}

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
const idSources = []
const seenId = new Map()

feed.forEach((ev, i) => {
  const where = `#${i + 1} ${cleanTitle(ev.name) || '(untitled)'}`

  const urlId = idFromUrl(ev.url)
  const imgId = idFromImage(ev.image)

  // ── IDENTITY, AND THE ONE ROW THAT FORCED A FALLBACK ──────────────────────
  //
  // The image path is now the AUTHORITY and the url is the corroboration, because
  // the live feed has a row whose url carries no id at all:
  //
  //   ŞENER ŞEN - ZENGİN MUTFAĞI
  //     url   .../etkinlikler/sener-sen-zengin-mutfagi?code=AF1727004770915
  //     image .../event/cmrxgkhys00006dpe19d8kiuh/banner.jpg
  //
  // WHY THE IMAGE PATH IS THE RIGHT FALLBACK, AND HOW THAT WAS VERIFIED RATHER
  // THAN ASSUMED: that row already exists in the database as
  // `gk-cmrxgkhys00006dpe19d8kiuh`, because the FILE DROP's url did carry
  // `--cmrxgkhys00006dpe19d8kiuh`. The partner dropped the suffix from the url and
  // kept the same object id in the image path, so deriving from the image
  // reproduces the stored external_id byte-for-byte and the row UPDATES.
  //
  // An id invented for this row — a slug, a hash, a counter — would mint a NEW
  // external_id, insert a duplicate alongside the original, and (for anything
  // derived from mutable content) mint a different one again on the next fetch.
  // That is the content-hash identity 20260831 removed; it is not coming back.
  //
  // The cross-check is UNCHANGED where both sources exist: a disagreement is still
  // a hard error. Only its absence is new, and the run prints the per-row source so
  // a silent drift to image-only across many rows is visible rather than inferred.
  if (!imgId) {
    errors.push(`${where}: could not extract an id from image path: ${JSON.stringify(ev.image)}`)
    return
  }
  if (urlId && urlId !== imgId) {
    errors.push(`${where}: id disagreement — url says "${urlId}", image path says "${imgId}"`)
    return
  }
  const rawId = urlId ?? imgId
  const idSource = urlId ? 'url+image' : 'image-only'
  if (!/^[A-Za-z0-9]+$/.test(rawId)) {
    errors.push(`${where}: id is not alphanumeric: ${JSON.stringify(rawId)}`)
    return
  }

  const externalId = `gk-${rawId}`
  if (seenId.has(externalId)) {
    errors.push(`${where}: duplicate id ${externalId} — also used by "${seenId.get(externalId)}"`)
    return
  }
  seenId.set(externalId, cleanTitle(ev.name))

  const category = CATEGORY_FOLDED.get(trFold(ev.category))
  if (!category) {
    errors.push(`${where}: unmapped category ${JSON.stringify(ev.category)} ` +
      `(folded to ${JSON.stringify(trFold(ev.category))}) — add it to CATEGORY in this script.`)
    return
  }

  const title = cleanTitle(ev.name)
  if (!title) { errors.push(`${where}: empty title`); return }
  if (!ev.startdate) { errors.push(`${where}: missing startdate`); return }

  const rawCity = nfc(ev.city).trim()
  const city = rawCity ? CITY[rawCity] : null
  if (rawCity && !city) {
    errors.push(`${where}: unmapped city ${JSON.stringify(rawCity)} — add it to CITY in this script, ` +
      `mapped to the district name used in constants/regions.js.`)
    return
  }

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

  idSources.push({ external_id: externalId, title: cleanTitle(ev.name), source: idSource })
  events.push({
    external_id:      externalId,
    title,
    venue:            nfc(ev.venue).trim(),
    city,
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
    ticket_url:       canonicalTicketUrl(ev.url, rawId),
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

// PRINTED EVERY RUN, deliberately. `image-only` is a correct and supported state,
// but it is also what a partner-side url change looks like in bulk — so the count
// is shown rather than inferred, and the rows are named while there are few enough
// to name. A jump here means the url stopped carrying ids, which is worth knowing
// before it is the whole feed.
const imageOnly = idSources.filter(r => r.source === 'image-only')
console.log(`  external_id source: ${idSources.length - imageOnly.length} url+image (cross-checked), ${imageOnly.length} image-only`)
for (const r of imageOnly) console.log(`      image-only: ${r.external_id}  ${r.title}`)
console.log('')
console.log('  Next: node scripts/check-gisekibris-urls.mjs --apply')
console.log('')
