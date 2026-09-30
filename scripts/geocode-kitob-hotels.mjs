#!/usr/bin/env node
// ─── KITOB hotels → a pin: OSM where it agrees, else the corroborated Google Place ─
//
//   GOOGLE_PLACES_API_KEY=… npm run hotels:geocode -- --dry-run [--limit 10]
//   GOOGLE_PLACES_API_KEY=… npm run hotels:geocode -- --apply        (needs 20261062)
//
// POLICY (Berke 2026-09-29, revised; CLAUDE.md "Geocoding"): Google Places pins are accepted as
// a KNOWN RISK (Places caching terms). A corroborated Places coordinate is stored when no OSM
// element agrees: geocode_source 'google_places', tier 2, google_place_id required (20261062),
// and a row on data/geocode-exceptions/google-pins.csv. A hotel that fails corroboration gets NO
// pin (its Harita button searches by name instead).
//
// For each hotel without coordinates:
//   1. CROSS-CHECK. Places Text Search → up to 3 candidates. A candidate is the hotel when ALL of
//        • region_audit  resolveRegion(candidate) === the hotel's region (or a committed waiver,
//                        data/kitob/overrides.json geocode_waivers)
//        • address_town  the candidate's address names the village, the district, or a known
//                        alias of either (TOWN_WORDS; accents stripped: Κερύνειας, Γαλάτεια)
//        • and at least one of phone_match / name_match / osm.
//   2. SOURCE. An OSM lodging within 150 m of that candidate whose name agrees → its coordinate,
//      geocode_source 'osm', tier 1, 'google_places' in the corroboration. No such element → the
//      Places coordinate itself, 'google_places', tier 2 (known risk).
//   Failing 1 (or hand_only in overrides.json) → no pin; listed as a Harita-search fallback.
//
// --dry-run reads the CSV and never opens a database client. --apply writes only rows that still
// have no coordinates, and never overwrites a pin.
// OSM data is ODbL: "© OpenStreetMap contributors" wherever these pins are shown.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseFile, fold } from './import-kitob-hotels.mjs'
import { resolveRegion } from '../utils/resolveRegion.js'
import { osmSnapshot } from './lib/osm-snapshot.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = 'data/kitob/kitob-2026-09-17.csv'
const LIST_DATE = '2026-09-17'
const OSM_AGREE_M = 150
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const APPLY = args.includes('--apply')
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }

// Accent-insensitive, Turkish-aware, Greek-safe comparison form.
export const norm = s => fold(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/['’`]/g, '')

// Words that say "a hotel" rather than WHICH hotel. A match on these alone corroborates nothing.
const GENERIC = new Set(['hotel', 'hotels', 'otel', 'resort', 'casino', 'spa', 'and', 've', 'the', 'club',
  'village', 'holiday', 'bungalow', 'bungalows', 'apart', 'beach', 'garden', 'gardens', 'palace',
  'boutique', 'butik', 'tatil', 'koyu', 'restoran', 'port', 'premium', 'deluxe', 'luxury', 'city',
  'grand', 'royal', 'park', 'center', 'centre', 'inn', 'house', 'cyprus', 'kibris', 'north', 'lounge',
  'bar', 'court', 'golf', 'marina', 'de', 'di', 'la', 'le', 'les'])
export const distinctive = name => norm(name).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w))
const words = name => norm(name).split(/[^a-z0-9]+/).filter(Boolean)

// FULL-NAME CONTAINMENT: "Royal Palace Hotel" inside "Royal Palace Hotel North Cyprus". Needed for
// names made only of generic words, which distinctive() cannot see. Safe ONLY because the region
// and town gates still apply to every candidate — never use it as a match on its own.
export function nameMatch(ours, theirs) {
  const mine = distinctive(ours), t = new Set(distinctive(theirs))
  if (mine.length && mine.some(w => t.has(w))) return true
  const a = words(ours).join(' '), b = ` ${words(theirs).join(' ')} `
  return a.length >= 6 && b.includes(` ${a} `)
}

// Town words per region, as they appear in Places addresses: Turkish, English and Greek names,
// plus villages/suburbs that addresses use instead of the town. All compared through norm().
export const TOWN_WORDS = {
  kyrenia: ['girne', 'kyrenia', 'keryneias', 'κερυνειας', 'zeytinlik', 'dogankoy', 'beylerbeyi', 'bellapais',
            'karaoglanoglu', 'alsancak', 'lapta', 'catalkoy', 'ozankoy', 'esentepe'],
  nicosia: ['lefkosa', 'nicosia', 'ortakoy', 'ortakioi', 'gonyeli', 'balikesir'],
  famagusta: ['gazimagusa', 'magusa', 'famagusta', 'yeni bogazici', 'yenibogazici', 'tatlisu', 'salamis'],
  iskele: ['iskele', 'trikomo', 'yeni iskele', 'long beach', 'bogaz', 'kaplica'],
  morphou: ['guzelyurt', 'morphou'],
  lefke: ['lefke', 'lefka', 'gemikonagi', 'baglikoy'],
  karpaz: ['karpaz', 'karpas', 'iskele', 'bafra', 'yenierenkoy', 'yeni erenkoy', 'mehmetcik', 'galateia',
           'γαλατεια', 'dipkarpaz', 'αιγιαλουσα'],
}

export const last7 = p => (p || '').replace(/\D/g, '').slice(-7)

// Step 1 — is this Places candidate the hotel? Returns the corroboration and a pass flag.
export function crossCheck(hotel, cand, osmNear, waived = new Set()) {
  const lat = cand.location?.latitude, lng = cand.location?.longitude
  const addr = ` ${norm(cand.formattedAddress)} `
  const got = []
  const regionOk = resolveRegion(lat, lng) === hotel.region
  if (regionOk) got.push('region_audit')
  const village = hotel.address ? norm(hotel.address) : null
  const townOk = (village && addr.includes(village)) || (TOWN_WORDS[hotel.region] || []).some(w => addr.includes(norm(w)))
  if (townOk) got.push('address_town')
  const phone = cand.nationalPhoneNumber || cand.internationalPhoneNumber
  if (hotel.phone && phone && last7(phone) === last7(hotel.phone)) got.push('phone_match')
  if (nameMatch(hotel.name, cand.displayName?.text || '')) got.push('name_match')
  const osm = osmNear(lat, lng).filter(o => o.names.some(n => nameMatch(hotel.name, n)))
  if (osm.length) got.push('osm')
  const strong = got.some(g => ['phone_match', 'name_match', 'osm'].includes(g))
  const pass = (regionOk || waived.has('region_audit')) && townOk && strong
  return { lat, lng, got, pass, osm }
}

// ─── OSM lodging in the TRNC (relation 2514541), one Overpass query ─────────
async function loadOsm() {
  const q = `[out:json][timeout:60];area(3602514541)->.t;(nwr["tourism"~"^(hotel|guest_house|apartment|motel|resort|chalet|hostel)$"](area.t);nwr["leisure"="resort"](area.t););out center tags;`
  const snap = await osmSnapshot(ROOT, 'lodging', q, args.includes('--osm') ? args[args.indexOf('--osm') + 1] : null).catch(e => fail(e.message))
  return (snap.elements || []).map(e => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
    names: [e.tags?.name, e.tags?.['name:en'], e.tags?.['name:tr']].filter(Boolean) })).filter(e => e.lat && e.names.length)
}
export const km = (a, b, c, d) => { const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h)) }

// ─── self-test: the rules refuse what they must, offline ────────────────────
function selfTest() {
  let bad = 0
  const t = (l, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${l} -> ${JSON.stringify(g)}${ok ? '' : ` (want ${JSON.stringify(w)})`}`) }
  const none = () => []
  const h = { name: 'Kaşgar Court Hotel', region: 'kyrenia', address: null, phone: '+90 392 815 5934' }
  const c = (name, lat, lng, addr, phone) => ({ displayName: { text: name }, location: { latitude: lat, longitude: lng }, formattedAddress: addr, nationalPhoneNumber: phone })
  console.log('\n── geocode-kitob-hotels self-test ──')
  t('distinctive drops generic words', distinctive('Grand Pasha Kyrenia Hotel Casino Spa'), ['pasha', 'kyrenia'])
  t("apostrophe: Sammy's matches SAMMYS", distinctive("Sammy's Hotel"), distinctive('Sammys Hotel'))
  t('good: name + town + region', crossCheck(h, c('Kaşgar Court', 35.337, 33.318, 'Girne', null), none).pass, true)
  t('refused: right name, wrong region', crossCheck(h, c('Kaşgar Court', 35.125, 33.94, 'Gazimağusa', null), none).pass, false)
  t('refused: only generic words match', crossCheck(h, c('Court Hotel', 35.337, 33.318, 'Girne', null), none).pass, false)
  t('refused: address names no town', crossCheck(h, c('Kaşgar Court', 35.337, 33.318, 'Unnamed Road', null), none).pass, false)
  t('alias: Greek Κερύνειας counts as Girne', crossCheck({ ...h, name: 'Merit Park Hotel' }, c('Merit Park Hotel Casino', 35.3492, 33.257, 'Kervansaray Mevkii, Αγ. Γεώργιος Κερύνειας 9930', null), none).got.includes('address_town'), true)
  t('alias: Beylerbeyi counts for Bellapais', crossCheck({ ...h, name: 'Ambelia Village', address: 'Bellapais' }, c('Ambelia Village', 35.3044, 33.3504, 'Beylerbeyi 99320', null), none).pass, true)
  t('full name contained: Royal Palace', nameMatch('Royal Palace Hotel', 'Royal Palace Hotel North Cyprus'), true)
  t('full name NOT contained: Park Palace vs Grand Park Palace Resort', nameMatch('Park Palace Hotel', 'Grand Park Palace Resort'), false)
  t('waiver lets region_audit through', crossCheck(h, c('Kaşgar Court', 35.125, 33.94, 'Girne', null), none, new Set(['region_audit'])).pass, true)
  t('Bafra resort resolves to karpaz', resolveRegion(35.3654, 34.0745), 'karpaz')
  console.log(bad ? `\n${bad} FAILED\n` : '\nall passed\n'); process.exit(bad ? 1 : 0)
}

async function places(q, key) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber' },
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
  const waivers = new Map()
  for (const w of JSON.parse(readFileSync(resolve(ROOT, 'data/kitob/overrides.json'), 'utf8')).geocode_waivers || [])
    waivers.set(w.external_id, new Set([...(waivers.get(w.external_id) || []), w.check]))

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
  const osmNear = (lat, lng) => osm.filter(o => km(lat, lng, o.lat, o.lng) * 1000 <= OSM_AGREE_M)

  // Only hotels without a pin. APPLY asks the DB; a dry run uses the newest APPLIED OSM output
  // (the 58 pins) so it looks at the same 44 hotels an apply would.
  let pinned = new Set()
  if (DRY) {
    const { readdirSync } = await import('node:fs')
    const f = readdirSync(resolve(ROOT, 'data/kitob')).filter(x => /^geocode-osm-\d+\.csv$/.test(x)).sort().at(-1)
    if (f) pinned = new Set(readFileSync(resolve(ROOT, 'data/kitob', f), 'utf8').trim().split('\n').slice(1).map(l => l.split(';')).map(c => `${c[0]}|${c[1]}`))
    console.log(`dry run: skipping ${pinned.size} hotels already pinned (${f || 'no applied OSM list'})`)
  }
  const todo = rows.filter(r => APPLY ? idByExt.get(r.external_id)?.lat == null : !pinned.has(`${r.name}|${r.region}`)).slice(0, LIMIT)
  const regionTr = { kyrenia: 'Girne', nicosia: 'Lefkoşa', famagusta: 'Gazimağusa', iskele: 'İskele', morphou: 'Güzelyurt', lefke: 'Lefke', karpaz: 'Karpaz' }
  const results = []
  for (const h of todo) {
    const q = [h.name, h.address, regionTr[h.region], 'Kuzey Kıbrıs'].filter(Boolean).join(', ')
    const judged = (await places(q, KEY)).map(c => ({ c, ...crossCheck(h, c, osmNear, waivers.get(h.external_id)) }))
    // hand_only (overrides.json): never auto-placed, whatever Places returns on this run.
    const pick = waivers.get(h.external_id)?.has('hand_only') ? null : judged.find(j => j.pass)
    // Nearest agreeing OSM element to the corroborated candidate supplies the coordinate.
    const src = pick && pick.osm.map(o => ({ o, m: km(pick.lat, pick.lng, o.lat, o.lng) * 1000 })).sort((a, b) => a.m - b.m)[0]
    // For the report only: what a hand_only hotel's best candidate would have been.
    const wouldPass = waivers.get(h.external_id)?.has('hand_only') ? judged.find(j => j.pass) || null : undefined
    results.push({ h, pick, src, best: judged[0], wouldPass })
    await new Promise(r => setTimeout(r, 120))
  }

  // Two hotels on one Place is a wrong match (hotels_google_place_id_key would refuse it anyway).
  const byPlace = new Map()
  for (const r of results) if (r.pick) byPlace.set(r.pick.c.id, [...(byPlace.get(r.pick.c.id) || []), r])
  for (const [, list] of byPlace) if (list.length > 1) for (const r of list) { r.dupPlace = true }

  const osmSourced = results.filter(r => r.pick && r.src && !r.dupPlace)
  const googleSourced = results.filter(r => r.pick && !r.src && !r.dupPlace)
  const hand = results.filter(r => !osmSourced.includes(r) && !googleSourced.includes(r))
  const why = r => waivers.get(r.h.external_id)?.has('hand_only') ? 'no pin by decision (overrides.json hand_only)'
    : r.dupPlace ? 'two hotels matched the same Place'
    : !r.best ? 'no Places result'
    : 'Places cross-check failed: missing ' + ['region_audit', 'address_town'].filter(g => !r.best.got.includes(g))
        .concat(r.best.got.some(g => ['phone_match', 'name_match', 'osm'].includes(g)) ? [] : ['phone/name/osm']).join('+')

  if (APPLY) {
    for (const r of osmSourced) {
      const row = idByExt.get(r.h.external_id)
      const corroboration = [...new Set([...r.pick.got.filter(g => g !== 'osm'), 'google_places'])]
      const { error } = await sb.from('hotels').update({ lat: r.src.o.lat, lng: r.src.o.lng, geocode_source: 'osm',
        geocode_tier: 1, geocode_corroboration: corroboration, geocoded_at: new Date().toISOString(), google_place_id: r.pick.c.id })
        .eq('id', row.id).is('lat', null)
      if (error) fail(`write ${r.h.name}: ${error.message}`)
    }
    let wrote = 0
    for (const r of googleSourced) {
      const { data, error } = await sb.from('hotels').update({ lat: r.pick.lat, lng: r.pick.lng, geocode_source: 'google_places',
        geocode_tier: 2, geocode_corroboration: r.pick.got, geocoded_at: new Date().toISOString(), google_place_id: r.pick.c.id })
        .eq('id', idByExt.get(r.h.external_id).id).is('lat', null).select('id')
      if (error) fail(`write ${r.h.name}: ${error.message}`)
      wrote += data.length
    }
    if (wrote !== googleSourced.length) fail(`Google pins written ${wrote} of ${googleSourced.length} — a row gained a pin meanwhile?`)
  }

  const byRegion = list => list.reduce((m, r) => (m[r.h.region] = (m[r.h.region] || 0) + 1, m), {})
  console.log(`\n${DRY ? 'DRY RUN' : 'APPLIED'} · ${todo.length} hotel(s)`)
  console.log(`  OSM-sourced (tier 1, Places-confirmed): ${osmSourced.length}  ${JSON.stringify(byRegion(osmSourced))}`)
  console.log(`  Google-sourced (tier 2, known risk):    ${googleSourced.length}  ${JSON.stringify(byRegion(googleSourced))}`)
  console.log(`  NO PIN (Harita searches by name):       ${hand.length}`)
  for (const r of hand) console.log(`    · ${r.h.name} (${r.h.region}${r.h.address ? ', ' + r.h.address : ''}) — ${why(r)}${
    r.wouldPass === undefined ? '' : r.wouldPass ? ` · Google's best WOULD pass: "${r.wouldPass.c.displayName?.text}" [${r.wouldPass.got.join('+')}]` : " · Google's best would NOT pass either"}`)
  const moved = osmSourced.map(r => Math.round(r.src.m)).sort((a, b) => a - b)
  console.log(`  OSM vs Places distance: median ${moved[Math.floor(moved.length / 2)] ?? '-'} m, max ${moved.at(-1) ?? '-'} m`)

  // Local, gitignored (data/kitob/geocode-*.csv). The google list holds Places coordinates — the
  // same known risk as the DB rows it mirrors.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const link = id => id ? `https://www.google.com/maps/place/?q=place_id:${id}` : ''
  const clean = v => String(v ?? '').replace(/;/g, ',')
  const accFile = resolve(ROOT, `data/kitob/geocode-osm-${stamp}${DRY ? '-dry' : ''}.csv`)
  writeFileSync(accFile, ['name;region;adres;osm_id;osm_name;lat;lng;corroborated;google_place_id',
    ...osmSourced.map(r => [r.h.name, r.h.region, r.h.address, r.src.o.id, r.src.o.names[0], r.src.o.lat, r.src.o.lng,
      r.pick.got.filter(g => g !== 'osm').concat('google_places').join('+'), r.pick.c.id].map(clean).join(';'))].join('\n') + '\n')
  const gFile = resolve(ROOT, `data/kitob/geocode-google-${stamp}${DRY ? '-dry' : ''}.csv`)
  writeFileSync(gFile, ['name;region;adres;lat;lng;corroborated;google_place_id',
    ...googleSourced.map(r => [r.h.name, r.h.region, r.h.address, r.pick.lat, r.pick.lng, r.pick.got.join('+'), r.pick.c.id].map(clean).join(';'))].join('\n') + '\n')
  console.log(`  Google-sourced list → ${gFile.replace(ROOT + '/', '')}`)
  // The committed known-risk list: one row per Google hotel pin (our data only). Pharmacy rows
  // and other hotels' rows are kept as they are.
  if (APPLY && googleSourced.length) {
    const excPath = resolve(ROOT, 'data/geocode-exceptions/google-pins.csv')
    const [head, ...rest] = readFileSync(excPath, 'utf8').trim().split('\n')
    const ids = new Set(googleSourced.map(r => r.h.external_id))
    const kept = rest.filter(l => !(l.startsWith('hotel;') && ids.has(l.split(';')[1])))
    const add = googleSourced.map(r => ['hotel', r.h.external_id, r.h.name, r.h.region, r.h.address || '',
      `Google Places, corroborated: ${r.pick.got.join('+')}`].map(clean).join(';'))
    writeFileSync(excPath, [head, ...kept, ...add].join('\n') + '\n')
    console.log(`  known-risk list: +${add.length} hotel rows → data/geocode-exceptions/google-pins.csv`)
  }
  const handFile = resolve(ROOT, `data/kitob/geocode-hand-${stamp}${DRY ? '-dry' : ''}.csv`)
  writeFileSync(handFile, ['name;region;adres;phone;reason;google_place_id;places_link',
    ...hand.map(r => { const id = r.pick?.c.id || r.best?.c.id
      return [r.h.name, r.h.region, r.h.address, r.h.phone, why(r), id, link(id)].map(clean).join(';') })].join('\n') + '\n')
  console.log(`  OSM-sourced list → ${accFile.replace(ROOT + '/', '')}`)
  console.log(`  hand-placement list → ${handFile.replace(ROOT + '/', '')}`)
}

if (args.includes('--self')) selfTest()
else main()
