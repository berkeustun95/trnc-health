#!/usr/bin/env node
// ─── KITOB hotels → corroborated coordinates (20261060 provenance) ──────────
//
//   GOOGLE_PLACES_API_KEY=… npm run hotels:geocode -- --dry-run [--limit 10]
//   GOOGLE_PLACES_API_KEY=… npm run hotels:geocode -- --apply
//
// Same approach as scripts/geocode-pharmacies-tier2.mjs. For each hotel without coordinates:
// Google Places Text Search → up to 3 candidates. A candidate is WRITTEN (source google_places,
// tier 2) only when ALL of:
//   • region_audit  resolveRegion(candidate) === the hotel's region (the app's own classifier,
//                   constants/regions.js — the same rule the Karpaz ruling follows)
//   • address_town  the candidate's address names the hotel's village or its district
//   • and AT LEAST ONE of
//       phone_match   Places' phone and KITOB's share the last 7 digits
//       name_match    a distinctive (non-generic) word of the name matches
//       osm           an OSM lodging within 150 m names the same distinctive word
// Anything short of that is NOT written. It goes to data/kitob/geocode-review-*.csv — Berke's
// review list, and the hand-placing queue (tier 3, visual_satellite mandatory). Writing a
// coordinate nothing corroborates is the failure the provenance columns exist to prevent.
//
// --dry-run reads the CSV (data/kitob/kitob-2026-09-17.csv) and never opens a database client,
// so it is PHYSICALLY unable to write. --apply reads hotel ids from prod as service_role and
// writes only rows that still have no coordinates (never overwrites a pin).
//
// The key is read from the environment only, never stored. The app's Maps key cannot be used:
// it is restricted to the Android app, so places.googleapis.com rejects it from Node.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseFile, fold } from './import-kitob-hotels.mjs'
import { resolveRegion } from '../utils/resolveRegion.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = 'data/kitob/kitob-2026-09-17.csv'
const LIST_DATE = '2026-09-17'
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const APPLY = args.includes('--apply')
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }

// Words that say "a hotel" rather than WHICH hotel. A match on these corroborates nothing.
const GENERIC = new Set(['hotel', 'hotels', 'otel', 'resort', 'casino', 'spa', 'and', 've', 'the', 'club',
  'village', 'holiday', 'bungalow', 'bungalows', 'apart', 'beach', 'garden', 'gardens', 'palace',
  'boutique', 'butik', 'tatil', 'koyu', 'restoran', 'port', 'premium', 'deluxe', 'luxury', 'city',
  'grand', 'royal', 'park', 'center', 'centre', 'inn', 'house', 'cyprus', 'kibris', 'north', 'lounge',
  'bar', 'court', 'golf', 'marina', 'de', 'di', 'la', 'le', 'les'])
export const distinctive = name => fold(name).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w))

// District names as they appear in Google's formatted addresses (Turkish, English, Greek-derived).
const DISTRICT_WORDS = {
  kyrenia: ['girne', 'kyrenia'], nicosia: ['lefkosa', 'nicosia', 'lefkoşa'],
  famagusta: ['gazimagusa', 'magusa', 'famagusta'], iskele: ['iskele', 'trikomo'],
  morphou: ['guzelyurt', 'morphou'], lefke: ['lefke', 'lefka'],
  karpaz: ['karpaz', 'karpas', 'iskele', 'bafra', 'yenierenkoy', 'yeni erenkoy', 'kaplica', 'mehmetcik', 'dipkarpaz'],
}

export const last7 = p => (p || '').replace(/\D/g, '').slice(-7)

export function corroborate(hotel, cand, osmNear) {
  const lat = cand.location?.latitude, lng = cand.location?.longitude
  const addr = fold(cand.formattedAddress || '')
  const got = []
  const regionOk = resolveRegion(lat, lng) === hotel.region
  if (regionOk) got.push('region_audit')
  const village = hotel.address ? fold(hotel.address) : null
  const townOk = (village && addr.includes(village))
    || (DISTRICT_WORDS[hotel.region] || []).some(w => addr.includes(fold(w)))
  if (townOk) got.push('address_town')
  const phone = cand.nationalPhoneNumber || cand.internationalPhoneNumber
  if (hotel.phone && phone && last7(phone) === last7(hotel.phone)) got.push('phone_match')
  const mine = distinctive(hotel.name)
  const theirs = new Set(distinctive(cand.displayName?.text || ''))
  if (mine.length && mine.some(w => theirs.has(w))) got.push('name_match')
  if (mine.length && osmNear(lat, lng).some(n => distinctive(n).some(w => mine.includes(w)))) got.push('osm')
  const strong = got.some(g => ['phone_match', 'name_match', 'osm'].includes(g))
  return { lat, lng, got, pass: regionOk && townOk && strong }
}

// ─── OSM lodging in the TRNC (relation 2514541), one Overpass query ─────────
async function loadOsm() {
  const q = `[out:json][timeout:60];area(3602514541)->.t;(nwr["tourism"~"^(hotel|guest_house|apartment|motel|resort|chalet|hostel)$"](area.t);nwr["leisure"="resort"](area.t););out center tags;`
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ADA-app hotel geocoder (berkeustun95)' } })
  if (!res.ok) fail(`Overpass ${res.status}`)
  const els = (await res.json()).elements || []
  return els.map(e => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
    names: [e.tags?.name, e.tags?.['name:en'], e.tags?.['name:tr']].filter(Boolean) })).filter(e => e.lat && e.names.length)
}
const km = (a, b, c, d) => { const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h)) }

// ─── self-test: the rule refuses what it must, offline ──────────────────────
function selfTest() {
  let bad = 0
  const t = (l, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${l} -> ${JSON.stringify(g)}${ok ? '' : ` (want ${JSON.stringify(w)})`}`) }
  const none = () => []
  const h = { name: 'Kaşgar Court Hotel', region: 'kyrenia', address: null, phone: '+90 392 815 5934' }
  const c = (name, lat, lng, addr, phone) => ({ displayName: { text: name }, location: { latitude: lat, longitude: lng }, formattedAddress: addr, nationalPhoneNumber: phone })
  console.log('\n── geocode-kitob-hotels self-test ──')
  t('distinctive drops generic words', distinctive('Grand Pasha Kyrenia Hotel Casino Spa'), ['pasha', 'kyrenia'])
  t('good: name + town + region', corroborate(h, c('Kaşgar Court', 35.337, 33.318, 'Girne', null), none).pass, true)
  t('good: phone alone is enough', corroborate(h, c('Some Other Name', 35.337, 33.318, 'Girne', '0392 815 59 34'), none).got.includes('phone_match'), true)
  t('refused: right name, wrong region (Famagusta)', corroborate(h, c('Kaşgar Court', 35.125, 33.94, 'Gazimağusa', null), none).pass, false)
  t('refused: only generic words match', corroborate(h, c('Court Hotel', 35.337, 33.318, 'Girne', null), none).pass, false)
  t('refused: address names no town', corroborate(h, c('Kaşgar Court', 35.337, 33.318, 'Unnamed Road', null), none).pass, false)
  t('osm corroborates', corroborate(h, c('X', 35.337, 33.318, 'Girne', null), () => ['Kaşgar Court Hotel']).got.includes('osm'), true)
  t('Bafra resort resolves to karpaz', resolveRegion(35.40, 34.07), 'karpaz')
  console.log(bad ? `\n${bad} FAILED\n` : '\nall passed\n'); process.exit(bad ? 1 : 0)
}

async function places(q, key) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.types' },
    body: JSON.stringify({ textQuery: q, languageCode: 'tr', maxResultCount: 3,
      locationRestriction: { rectangle: { low: { latitude: 34.95, longitude: 32.6 }, high: { latitude: 35.75, longitude: 34.65 } } } }) })
  if (!res.ok) fail(`Places ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).places || []
}

async function main() {
  if (DRY === APPLY) fail('Pass exactly one of --dry-run or --apply.')
  const KEY = process.env.GOOGLE_PLACES_API_KEY
  if (!KEY) fail('Missing GOOGLE_PLACES_API_KEY (environment only; the app Maps key is Android-restricted).')

  const { rows, errors } = normaliseFile(readFileSync(resolve(ROOT, CSV), 'utf8'), LIST_DATE)
  if (errors.length) fail(...errors)

  let sb = null, idByExt = new Map()
  if (APPLY) {
    const envPath = resolve(ROOT, '.env')
    if (existsSync(envPath)) for (const l of readFileSync(envPath, 'utf8').split('\n')) {
      const m = l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
    const key = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'], { encoding: 'utf8' }).trim()
    const { createClient } = await import('@supabase/supabase-js')
    sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } })
    const { data, error, count } = await sb.from('hotels').select('id,external_id,lat', { count: 'exact' }).eq('source', 'kitob')
    if (error) fail(`read hotels: ${error.message}`)
    if (data.length !== count) fail(`read ${data.length} of ${count} hotels — refusing to work on a partial set.`)
    idByExt = new Map(data.map(r => [r.external_id, r]))
  }

  const osm = await loadOsm()
  console.log(`OSM lodging in TRNC: ${osm.length}`)
  const osmNear = (lat, lng) => osm.filter(o => km(lat, lng, o.lat, o.lng) <= 0.15).flatMap(o => o.names)

  const todo = rows.filter(r => !APPLY || idByExt.get(r.external_id)?.lat == null).slice(0, LIMIT)
  const written = [], review = []
  const regionTr = { kyrenia: 'Girne', nicosia: 'Lefkoşa', famagusta: 'Gazimağusa', iskele: 'İskele', morphou: 'Güzelyurt', lefke: 'Lefke', karpaz: 'Karpaz' }
  for (const h of todo) {
    const q = [h.name, h.address, regionTr[h.region], 'Kuzey Kıbrıs'].filter(Boolean).join(', ')
    const cands = await places(q, KEY)
    const judged = cands.map(c => ({ c, ...corroborate(h, c, osmNear) }))
    const pick = judged.find(j => j.pass)
    if (pick) {
      written.push({ h, pick })
      if (APPLY) {
        const row = idByExt.get(h.external_id)
        const { error } = await sb.from('hotels').update({ lat: pick.lat, lng: pick.lng, geocode_source: 'google_places',
          geocode_tier: 2, geocode_corroboration: pick.got, geocoded_at: new Date().toISOString() })
          .eq('id', row.id).is('lat', null)
        if (error) fail(`write ${h.name}: ${error.message}`)
      }
    } else {
      const best = judged[0]
      review.push({ name: h.name, region: h.region, adres: h.address || '', phone: h.phone || '',
        candidate: best?.c.displayName?.text || '(no result)', candidate_address: best?.c.formattedAddress || '',
        lat: best?.lat ?? '', lng: best?.lng ?? '', corroborated: best?.got.join('+') || '',
        missing: best ? ['region_audit', 'address_town'].filter(g => !best.got.includes(g)).concat(
          best.got.some(g => ['phone_match', 'name_match', 'osm'].includes(g)) ? [] : ['phone/name/osm']).join('+') : 'no candidate',
        maps: best ? `https://maps.google.com/?q=${best.lat},${best.lng}` : '' })
    }
    await new Promise(r => setTimeout(r, 120))
  }

  const tally = written.reduce((m, w) => { const k = w.pick.got.filter(g => ['phone_match', 'name_match', 'osm'].includes(g)).join('+'); m[k] = (m[k] || 0) + 1; return m }, {})
  console.log(`\n${DRY ? 'DRY RUN' : 'APPLIED'} · ${todo.length} hotel(s) · ${written.length} corroborated (tier 2) · ${review.length} to review`)
  console.log('  strong evidence among the written:', JSON.stringify(tally))
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const out = resolve(ROOT, `data/kitob/geocode-review-${stamp}${DRY ? '-dry' : ''}.csv`)
  const cols = ['name', 'region', 'adres', 'phone', 'candidate', 'candidate_address', 'lat', 'lng', 'corroborated', 'missing', 'maps']
  writeFileSync(out, [cols.join(';'), ...review.map(r => cols.map(c => String(r[c]).replace(/;/g, ',')).join(';'))].join('\n') + '\n')
  console.log(`  review list → ${out.replace(ROOT + '/', '')}`)
  for (const r of review) console.log(`    ${r.name} [${r.region}] — ${r.missing}; best: ${r.candidate} (${r.candidate_address})`)
}

if (args.includes('--self')) selfTest()
else main()
