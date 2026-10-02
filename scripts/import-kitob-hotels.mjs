#!/usr/bin/env node
// ─── KITOB member hotels → public.hotels (20261059) ─────────────────────────
//
//   npm run hotels:import -- data/kitob/<file>.csv --list-date 2026-10-15            # dry run
//   npm run hotels:import -- data/kitob/<file>.csv --list-date 2026-10-15 --apply    # write
//   npm run hotels:import -- --self                                                   # offline self-test
//
// The input is the CSV KITOB sends (template: data/kitob/kitob-otel-listesi-sablon.csv).
// kitob.org is never fetched: the data comes from KITOB as a file, with permission.
//
// ─── WHAT A RUN DOES (the Novest pattern) ───────────────────────────────────
//   • external_id is the upsert key: kitob-<üye no> when the row has one, else
//     kitob-<name slug>-<region>. content_hash only skips rows that have not changed —
//     it is never a key (a changed phone number would otherwise become a second hotel).
//   • A row whose üye no appears for the first time is matched to its old slug-keyed row
//     and re-keyed, so adding member numbers to a later list does not delist anyone.
//   • A hotel absent from the file gets delisted_at = now(). Never deleted. If it comes
//     back in a later file, delisted_at is cleared.
//   • is_active is NEVER written. New rows land dark (DEFAULT false); publishing is a
//     reviewed UPDATE (go-live SOP step 3). A relisted hotel does not republish itself.
//   • Refuses to delist more than 30% of the listed hotels in one run (a truncated
//     export looks exactly like a mass closure) unless --allow-mass-delist.
//
// Credentials: EXPO_PUBLIC_SUPABASE_URL from .env; the service-role key from the macOS
// Keychain entry the Novest importer uses. Nothing is printed or written to disk.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { HOTEL_CLASSES, HOTEL_CLASS_LABEL_KEY } from '../constants/hotels.js'
import { LANG_CODES } from '../constants/i18n.js'
import { REGIONS } from '../constants/regions.js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'kitob'
const DELIST_FLOOR = 0.7

const fail = (...lines) => { for (const l of lines) console.error(l); process.exit(1) }

// ─── The template's columns. Header order is free; names are matched folded. ─
export const COLUMNS = {
  member_no: ['uye_no', 'uye no', 'uyelik no', 'member_no'],
  name:      ['otel_adi', 'otel adi', 'otel', 'name'],
  // Optional, ADA-internal (not in KITOB's template): the name the hotel's identity is keyed
  // on, so an ADA name correction (data/kitob/overrides.json) never re-keys it.
  key_name:  ['kaynak_adi'],
  klass:     ['sinif', 'sinifi', 'class'],
  district:  ['ilce', 'bolge', 'district'],
  address:   ['adres', 'address'],
  phone:     ['telefon', 'tel', 'phone'],
  email:     ['eposta', 'e-posta', 'email', 'e-mail'],
  website:   ['web_sitesi', 'web sitesi', 'web', 'website'],
  lat:       ['enlem', 'lat', 'latitude'],
  lng:       ['boylam', 'lng', 'lon', 'longitude'],
}
const REQUIRED = ['name', 'klass', 'district']

// Turkish fold: lower-case with the dotted/dotless i handled, diacritics stripped.
export function fold(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[âà]/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/[_\s]+/g, ' ').trim()
}

export const slug = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// KITOB's own class names (as on their member list), folded, plus the obvious variants.
const CLASS_ALIASES = {
  '5 yildiz': 'star5', '5 yildizli': 'star5', '5*': 'star5', '5 star': 'star5',
  '4 yildiz': 'star4', '4 yildizli': 'star4', '4*': 'star4', '4 star': 'star4',
  '3 yildiz': 'star3', '3 yildizli': 'star3', '3*': 'star3', '3 star': 'star3',
  '2 yildiz': 'star2', '2 yildizli': 'star2', '2*': 'star2', '2 star': 'star2',
  '1 yildiz': 'star1', '1 yildizli': 'star1', '1*': 'star1', '1 star': 'star1',
  'bungalow': 'bungalow',
  'tatil koyu': 'holiday_village', 'holiday village': 'holiday_village',
  'butik otel': 'boutique', 'butik': 'boutique', 'boutique hotel': 'boutique',
  'ozel sertifikali': 'special_certified', 'ozel sertifikali otel': 'special_certified',
  'apart otel': 'apart', 'apart': 'apart', 'apart hotel': 'apart',
}

// The six official districts, plus Karpaz (our 7th region, constants/regions.js). A
// Karpaz hotel that KITOB files under İskele stays iskele: we do not re-derive it.
const DISTRICT_ALIASES = {
  'lefkosa': 'nicosia', 'nicosia': 'nicosia',
  'girne': 'kyrenia', 'kyrenia': 'kyrenia',
  'gazimagusa': 'famagusta', 'magusa': 'famagusta', 'famagusta': 'famagusta',
  'guzelyurt': 'morphou', 'morphou': 'morphou',
  'iskele': 'iskele', 'trikomo': 'iskele',
  'lefke': 'lefke',
  'karpaz': 'karpaz', 'karpas': 'karpaz',
}

// ─── CSV, RFC 4180, delimiter sniffed. Turkish-locale Excel saves with ';'. ─
export function parseCsv(text) {
  text = text.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/, 1)[0]
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(f => f.trim() !== ''))
}

export function mapHeader(header) {
  const idx = {}
  header.forEach((h, i) => {
    const f = fold(h)
    for (const [key, names] of Object.entries(COLUMNS)) {
      if (names.map(fold).includes(f)) {
        if (key in idx) throw new Error(`two columns map to "${key}": "${header[idx[key]]}" and "${h}"`)
        idx[key] = i
      }
    }
  })
  const missing = REQUIRED.filter(k => !(k in idx))
  if (missing.length) throw new Error(`required column(s) missing: ${missing.join(', ')} — header was: ${header.join(' | ')}`)
  return idx
}

// "+90 392 815 1234". Returns [value, warning].
export function normPhone(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return [null, null]
  const first = s.split(/[\/;,]| - /)[0]
  let d = first.replace(/\D/g, '')
  if (d.startsWith('0090')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = '90' + d.slice(1)
  if (d.length === 10) d = '90' + d
  if (!/^90[2-5]\d{9}$/.test(d)) return [null, `phone "${s}" not recognised — left empty`]
  const w = first === s ? null : `phone "${s}" has several numbers — kept the first`
  return [`+90 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`, w]
}

export function normEmail(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return [null, null]
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? [s, null] : [null, `email "${raw}" not valid — left empty`]
}

export function normWebsite(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return [null, null]
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (!u.hostname.includes('.')) throw new Error()
    return [u.toString().replace(/\/$/, ''), null]
  } catch { return [null, `website "${raw}" not a URL — left empty`] }
}

// Decimal comma tolerated ("35,33"). Both or neither, inside the hotels_coords_check box.
export function normCoords(rawLat, rawLng) {
  const p = v => { const t = String(v ?? '').trim().replace(',', '.'); return t === '' ? null : Number(t) }
  const lat = p(rawLat), lng = p(rawLng)
  if (lat == null && lng == null) return [null, null, null]
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [null, null, `coordinates "${rawLat}", "${rawLng}" incomplete — both left empty`]
  }
  if (lat >= 32.2 && lat <= 34.7 && lng >= 34.5 && lng <= 35.8) {
    return [null, null, `coordinates "${rawLat}", "${rawLng}" look swapped (enlem/boylam) — both left empty`]
  }
  if (!(lat >= 34.5 && lat <= 35.8 && lng >= 32.2 && lng <= 34.7)) {
    return [null, null, `coordinates "${rawLat}", "${rawLng}" are outside Cyprus — both left empty`]
  }
  return [lat, lng, null]
}

export const hashRow = row => createHash('sha256').update(JSON.stringify(
  ['kitob_member_no', 'name', 'kitob_class', 'region', 'address', 'phone', 'email', 'website',
   'lat', 'lng', 'source_list_date'].map(k => row[k] ?? null))).digest('hex')

// One CSV row → { row } or { error }. Warnings never block; errors block the whole run.
export function normaliseRow(cells, idx, listDate, line) {
  const get = k => (k in idx ? String(cells[idx[k]] ?? '').trim() : '')
  const warnings = []
  const name = get('name').replace(/\s+/g, ' ')
  if (!name) return { error: `line ${line}: otel_adi is empty` }
  const keyName = get('key_name').replace(/\s+/g, ' ') || name
  const klass = CLASS_ALIASES[fold(get('klass'))]
  if (!klass) return { error: `line ${line} (${name}): sinif "${get('klass')}" is not one of KITOB's 10 classes` }
  const region = DISTRICT_ALIASES[fold(get('district'))]
  if (!region) return { error: `line ${line} (${name}): ilce "${get('district')}" is not a TRNC district` }
  const memberNo = get('member_no') || null
  if (memberNo && !slug(memberNo)) return { error: `line ${line} (${name}): uye_no "${memberNo}" has no letters or digits` }
  const [phone, wp] = normPhone(get('phone'))
  const [email, we] = normEmail(get('email'))
  const [website, ww] = normWebsite(get('website'))
  const [lat, lng, wc] = normCoords(get('lat'), get('lng'))
  for (const w of [wp, we, ww, wc]) if (w) warnings.push(`line ${line} (${name}): ${w}`)
  const row = {
    external_id: memberNo ? `${SOURCE}-${slug(memberNo)}` : `${SOURCE}-${slug(keyName)}-${region}`,
    slug_id: `${SOURCE}-${slug(keyName)}-${region}`,
    kitob_member_no: memberNo, name, kitob_class: klass, region,
    address: get('address').replace(/\s+/g, ' ') || null, phone, email, website, lat, lng,
    is_kitob_member: true, source: SOURCE, source_list_date: listDate,
  }
  row.content_hash = hashRow(row)
  return { row, warnings }
}

export function normaliseFile(text, listDate) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { rows: [], errors: ['the file has no data rows'], warnings: [] }
  const idx = mapHeader(rows[0])
  const out = [], errors = [], warnings = []
  rows.slice(1).forEach((cells, i) => {
    const r = normaliseRow(cells, idx, listDate, i + 2)
    if (r.error) errors.push(r.error)
    else { out.push(r.row); warnings.push(...r.warnings) }
  })
  const seen = new Map()
  for (const r of out) {
    if (seen.has(r.external_id)) errors.push(`duplicate hotel: "${r.name}" and "${seen.get(r.external_id)}" both key to ${r.external_id}`)
    else seen.set(r.external_id, r.name)
  }
  return { rows: out, errors, warnings }
}

// ─── RE-KEYING: identity survives a member number arriving, or a region correction ─
// external_id is kitob-<member no> or kitob-<name slug>-<region>. Two things can change it
// without the hotel changing: KITOB adds member numbers, or ADA corrects a region (Kaplıca,
// The Arkın İskele, 2026-09-29). Without a re-key the old row is delisted and a new dark row
// inserted, losing coordinates. A region move is taken ONLY when exactly one existing row has
// the same name slug in a DIFFERENT region and that row is not itself in the file — two real
// hotels sharing a name in two districts must never merge.
export function planRekeys(rows, existingIds) {
  const ids = new Set(existingIds), inFile = new Set(rows.map(r => r.external_id)), out = []
  for (const r of rows) {
    if (ids.has(r.external_id)) continue
    let from = null
    if (r.external_id !== r.slug_id && ids.has(r.slug_id)) from = r.slug_id
    else if (r.external_id === r.slug_id) {
      const base = r.slug_id.slice(0, -(r.region.length + 1))
      const cands = [...ids].filter(id => id.startsWith(base + '-') && REGIONS.includes(id.slice(base.length + 1))
        && id !== r.external_id && !inFile.has(id))
      if (cands.length === 1) from = cands[0]
    }
    if (from) { out.push({ from, to: r.external_id }); ids.delete(from); ids.add(r.external_id) }
  }
  return out
}

// ─── THE PAYLOAD, AND WHY COORDINATES ARE SPECIAL ─────────────────────────────
// A PostgREST upsert sets every column present in the payload. KITOB's file carries no
// coordinates, so sending lat/lng from it would write NULL over every geocoded pin on the
// next list update (20261060's two-way CHECK would then refuse the row, failing the run).
// So coordinates travel ONLY when the file supplies them AND the row has none yet; a file
// coordinate never overwrites an existing pin (it is reported instead). Rows with and
// without coordinates go in separate batches, because a bulk upsert needs uniform keys.
// is_active is never sent: an upsert only sets the columns it is given.
export function buildPayloads(rows, existingById, now) {
  const plain = [], withCoords = [], notApplied = []
  for (const { slug_id, lat, lng, ...r } of rows) {
    const base = { ...r, delisted_at: null, last_seen_at: now }
    const prev = existingById.get(r.external_id)
    if (lat == null) plain.push(base)
    else if (prev && prev.lat != null) { plain.push(base); notApplied.push(r.external_id) }
    else withCoords.push({ ...base, lat, lng, geocode_source: 'partner', geocode_tier: null,
                           geocode_corroboration: null, geocoded_at: now })
  }
  return { batches: [plain, withCoords].filter(b => b.length), notApplied }
}

// ─── --self: offline, every rule shown firing on a bad input and passing a good one ─
function selfTest() {
  let bad = 0
  const t = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${label} -> ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
  }
  console.log('\n── import-kitob-hotels self-test ──')
  // The classes the importer can produce must be exactly the DB/app vocabulary.
  t('alias targets = HOTEL_CLASSES', [...new Set(Object.values(CLASS_ALIASES))].sort(), [...HOTEL_CLASSES].sort())
  // Every key the Oteller tab renders is PRESENT in each of the nine locale blocks. Read
  // from the table, not through t(): t() falls back to English, so a key missing from one
  // locale still "resolves" (the trap scripts/check-dorms.mjs records). The new keys sit one
  // per line at four-space indent, so a per-block line match is exact for them.
  const src = readFileSync(resolve(ROOT, 'constants/i18n.js'), 'utf8')
  const starts = [...src.matchAll(/^ {2}([a-z]{2}): \{$/gm)]
  t('i18n: 9 locale blocks found (control)', [starts.length, Object.keys(LANG_CODES).length], [9, 9])
  const UI_KEYS = [...Object.values(HOTEL_CLASS_LABEL_KEY), 'accomTabProperty', 'accomTabHotels',
    'hotelFilterClass', 'hotelKitobMember', 'hotelCall', 'hotelWebsite', 'hotelMap',
    'hotelsSoonTitle', 'hotelsSoonBody', 'hotelsLoadError', 'hotelsNoResults',
    'menuAccomTile', 'menuAccomTileHotels', 'hotelPhotoCredit', 'hotelReadMore', 'hotelReadLess', 'osmAttribution']
  const missing = starts.flatMap((m, i) => {
    const block = src.slice(m.index, starts[i + 1]?.index ?? src.length)
    return UI_KEYS.filter(k => !new RegExp(`^ {4}${k}:`, 'm').test(block)).map(k => `${m[1]}.${k}`)
  })
  t(`i18n: ${UI_KEYS.length} Oteller keys present in every locale`, missing, [])
  t('district targets = REGIONS', [...new Set(Object.values(DISTRICT_ALIASES))].sort(), [...REGIONS].sort())
  t('fold İSKELE', fold('İSKELE'), 'iskele')
  t('fold Tatil Köyü', CLASS_ALIASES[fold('Tatil Köyü')], 'holiday_village')
  t('fold ÖZEL SERTİFİKALI', CLASS_ALIASES[fold('ÖZEL SERTİFİKALI')], 'special_certified')
  t('fold Gazimağusa', DISTRICT_ALIASES[fold('Gazimağusa')], 'famagusta')
  t('phone 0392 815 12 34', normPhone('0392 815 12 34')[0], '+90 392 815 1234')
  t('phone +90 (533) 800-1234', normPhone('+90 (533) 800-1234')[0], '+90 533 800 1234')
  t('phone two numbers keeps first', normPhone('0392 815 1234 / 0548 111 2233')[0], '+90 392 815 1234')
  t('phone 12345 rejected', normPhone('12345')[0], null)
  t('email upper-case', normEmail(' Info@Otel.COM ')[0], 'info@otel.com')
  t('email no domain rejected', normEmail('info@otel')[0], null)
  t('website bare host', normWebsite('www.otel.com')[0], 'https://www.otel.com')
  t('website junk rejected', normWebsite('yok')[0], null)
  t('coords decimal comma', normCoords('35,3364', '33,3190').slice(0, 2), [35.3364, 33.319])
  t('coords swapped rejected, and named as swapped', [...normCoords('33.319', '35.3364').slice(0, 2), /swapped/.test(normCoords('33.319', '35.3364')[2])], [null, null, true])
  t('coords half rejected', normCoords('35.33', '').slice(0, 2), [null, null])
  t('csv ; delimiter + quotes + BOM', parseCsv('﻿a;b\n"x;1";"he said ""hi"""\n'), [['a', 'b'], ['x;1', 'he said "hi"']])
  const header = 'uye_no;otel_adi;sinif;ilce;adres;telefon;eposta;web_sitesi;enlem;boylam'
  const good = normaliseFile(`${header}\n12;Örnek Otel;4 Yıldız;Girne;Merkez;0392 815 12 34;;;;\n;Deniz Apart;Apart Otel;Lefkoşa;;;;;;\n`, '2026-10-01')
  t('good file: 2 rows, 0 errors', [good.rows.length, good.errors.length], [2, 0])
  t('member no key', good.rows[0]?.external_id, 'kitob-12')
  t('slug key', good.rows[1]?.external_id, 'kitob-deniz-apart-nicosia')
  const renamed = normaliseFile('kaynak_adi;otel_adi;sinif;ilce\nDorona Art Hotel;Dorana Art Hotel;2 Yıldız;Girne\n', '2026-10-01')
  t('kaynak_adi keeps identity through a name correction', [renamed.rows[0]?.external_id, renamed.rows[0]?.name], ['kitob-dorona-art-hotel-kyrenia', 'Dorana Art Hotel'])
  t('is_kitob_member true', good.rows.every(r => r.is_kitob_member), true)
  // Region correction keeps identity; ambiguity and a still-listed twin never merge.
  const mv = { external_id: 'kitob-skali-iskele', slug_id: 'kitob-skali-iskele', region: 'iskele' }
  t('region move re-keys the single old row', planRekeys([mv], ['kitob-skali-karpaz', 'kitob-other-kyrenia']), [{ from: 'kitob-skali-karpaz', to: 'kitob-skali-iskele' }])
  t('two old candidates: ambiguous, no re-key', planRekeys([mv], ['kitob-skali-karpaz', 'kitob-skali-famagusta']), [])
  t('old row still in the file: two real hotels, no re-key', planRekeys([mv, { external_id: 'kitob-skali-karpaz', slug_id: 'kitob-skali-karpaz', region: 'karpaz' }], ['kitob-skali-karpaz']), [])
  t('member number arrives: slug id re-keyed', planRekeys([{ external_id: 'kitob-12', slug_id: 'kitob-x-kyrenia', region: 'kyrenia' }], ['kitob-x-kyrenia']), [{ from: 'kitob-x-kyrenia', to: 'kitob-12' }])
  // A list update never wipes a coordinate: a coordinate-free file sends no lat/lng key at all.
  const geocoded = new Map([[good.rows[0].external_id, { lat: 35.33 }]])
  const p1 = buildPayloads(good.rows, geocoded, 'now')
  t('no-coordinate file: no row carries a lat key', p1.batches.flat().some(r => 'lat' in r), false)
  t('no-coordinate file: is_active never sent', p1.batches.flat().some(r => 'is_active' in r), false)
  const withXY = good.rows.map((r, i) => ({ ...r, lat: 35.3 + i / 100, lng: 33.3 }))
  const p2 = buildPayloads(withXY, geocoded, 'now')
  t('file coordinate never overwrites an existing pin', p2.notApplied, [good.rows[0].external_id])
  t('file coordinate fills an empty row, as partner', p2.batches.flat().filter(r => 'lat' in r).map(r => r.geocode_source), ['partner'])
  t('every batch has uniform keys', p2.batches.every(b => b.every(r => Object.keys(r).sort().join() === Object.keys(b[0]).sort().join())), true)
  const badFile = normaliseFile(`${header}\n;A;6 Yıldız;Girne;;;;;;\n;B;3 Yıldız;Baf;;;;;;\n;C;3 Yıldız;Girne;;;;;;\n;C;3 yildiz;GIRNE;;;;;;\n`, '2026-10-01')
  t('bad file: class, district, duplicate all refused', badFile.errors.length, 3)
  let threw = null
  try { mapHeader(['otel_adi', 'ilce']) } catch (e) { threw = e.message.startsWith('required column(s) missing: klass') }
  t('missing sinif column refused', threw, true)
  console.log(bad ? `\n${bad} FAILED\n` : '\nall passed\n')
  process.exit(bad ? 1 : 0)
}

// ─── main ────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const allowMass = args.includes('--allow-mass-delist')
  const dateAt = args.indexOf('--list-date')
  const listDate = dateAt >= 0 ? args[dateAt + 1] : null
  const file = args.find((a, i) => !a.startsWith('--') && (dateAt < 0 || i !== dateAt + 1))
  prodWriteGuard({ wouldWrite: apply, workflow: 'hotels-import',
    dryHint: 'npm run hotels:import -- data/kitob/<file>.csv --list-date YYYY-MM-DD' })

  if (!file) fail('Usage: npm run hotels:import -- <file.csv> --list-date YYYY-MM-DD [--apply]')
  if (!listDate || !/^\d{4}-\d{2}-\d{2}$/.test(listDate) || Number.isNaN(Date.parse(listDate))) {
    fail('--list-date YYYY-MM-DD is required: the date printed on the KITOB list (it drives hotels:health).')
  }
  if (Date.parse(listDate) > Date.now()) fail(`--list-date ${listDate} is in the future.`)

  const path = resolve(ROOT, file)
  if (!existsSync(path)) fail(`no such file: ${file}`)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)) }
  catch { fail(`${file} is not UTF-8. In Excel: File → Save As → "CSV UTF-8 (Comma delimited)".`) }

  let parsed
  try { parsed = normaliseFile(text, listDate) } catch (e) { fail(`${file}: ${e.message}`) }
  const { rows, errors, warnings } = parsed
  for (const w of warnings) console.log(`  warn  ${w}`)
  if (errors.length) fail(`\n${errors.length} error(s) — nothing written:`, ...errors.map(e => `  ${e}`))
  if (!rows.length) fail('no hotels in the file.')

  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  if (!url) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, serviceRoleKey(), { auth: { persistSession: false } })

  // count: 'exact' against rows received — PostgREST max-rows can cap the page silently.
  const { data: existing, error, count } = await supabase.from('hotels')
    .select('id,external_id,content_hash,delisted_at,is_active,lat', { count: 'exact' }).eq('source', SOURCE)
  if (error) fail(`reading hotels failed: ${error.message}`)
  if (count !== existing.length) fail(`read ${existing.length} of ${count} existing hotels — refusing to diff a partial set.`)

  const byId = new Map(existing.map(r => [r.external_id, r]))
  const rekey = planRekeys(rows, [...byId.keys()])
  for (const { from, to } of rekey) { byId.set(to, byId.get(from)); byId.delete(from) }
  const present = new Set(rows.map(r => r.external_id))
  const inserts = [], updates = [], relists = []
  let unchanged = 0
  for (const r of rows) {
    const prev = byId.get(r.external_id)
    if (!prev) inserts.push(r)
    else if (prev.delisted_at) relists.push(r)
    else if (prev.content_hash !== r.content_hash) updates.push(r)
    else unchanged++
  }
  const listed = [...byId.values()].filter(r => !r.delisted_at)
  const delists = [...byId.entries()].filter(([id, r]) => !present.has(id) && !r.delisted_at).map(([id]) => id)

  console.log(`\nKITOB list ${listDate} · ${file} · ${rows.length} hotel(s)`)
  console.log(`  insert     ${inserts.length}   (land dark: is_active DEFAULT false)`)
  console.log(`  update     ${updates.length}`)
  console.log(`  unchanged  ${unchanged}   (content_hash match — not written)`)
  console.log(`  re-key     ${rekey.length}   (identity kept: member number arrived or region corrected)`)
  console.log(`  relist     ${relists.length}   (delisted_at cleared; is_active untouched)`)
  console.log(`  delist     ${delists.length}   (delisted_at = now; row kept)`)
  for (const d of delists) console.log(`    ${d}`)

  if (listed.length && (listed.length - delists.length) / listed.length < DELIST_FLOOR && !allowMass) {
    fail(`\nREFUSED: this run would delist ${delists.length} of ${listed.length} listed hotels.`,
      'A truncated export looks exactly like this. Check the file; if it is right, re-run with --allow-mass-delist.')
  }
  if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply.\n'); return }

  const now = new Date().toISOString()
  for (const { from, to } of rekey) {
    const { error: e } = await supabase.from('hotels').update({ external_id: to }).eq('external_id', from)
    if (e) fail(`re-key ${from} → ${to} failed: ${e.message}`)
  }
  const { batches, notApplied } = buildPayloads([...inserts, ...updates, ...relists], byId, now)
  for (const id of notApplied) console.log(`  kept existing coordinates (file value not applied): ${id}`)
  for (const payload of batches) {
    const { error: e, data } = await supabase.from('hotels').upsert(payload, { onConflict: 'external_id' }).select('id')
    if (e) fail(`upsert failed: ${e.message}`)
    if (data.length !== payload.length) fail(`upsert wrote ${data.length} of ${payload.length} rows.`)
  }
  if (delists.length) {
    const { error: e } = await supabase.from('hotels').update({ delisted_at: now }).in('external_id', delists)
    if (e) fail(`delist failed: ${e.message}`)
  }
  // Every present row proves this run saw it, including the unchanged ones.
  const { error: e2 } = await supabase.from('hotels').update({ last_seen_at: now })
    .eq('source', SOURCE).in('external_id', [...present])
  if (e2) fail(`last_seen_at stamp failed: ${e2.message}`)

  const { count: listedAfter } = await supabase.from('hotels').select('id', { count: 'exact', head: true })
    .eq('source', SOURCE).is('delisted_at', null)
  const { count: liveAfter } = await supabase.from('hotels').select('id', { count: 'exact', head: true })
    .eq('source', SOURCE).is('delisted_at', null).eq('is_active', true)
  console.log(`\nwritten. ${listedAfter} listed · ${liveAfter} published (is_active) · last_seen_at stamped on ${present.size}\n`)
}

// Only when run directly: scripts/geocode-kitob-hotels.mjs imports normaliseFile from here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self')) selfTest()
  else main()
}
