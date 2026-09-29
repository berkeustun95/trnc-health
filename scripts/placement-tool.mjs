#!/usr/bin/env node
// ─── Hand placement THROUGH OSM — local queue (Berke, 2026-09-29) ────────────
//
//   npm run place            # http://127.0.0.1:8787 — writes to the DB (service role, Keychain)
//   npm run place -- --dry   # same queue, re-check works, NOTHING is written (anon key only)
//
// WHY OSM: no satellite imagery we can use lets us derive and store coordinates privately
// (Esri/Bing/Mapbox grant tracing for OSM contributions; EOX commercial is paid; Google is out).
// So Berke places the hotel/pharmacy node in OSM with iD, and this tool pulls the new OSM
// element into our data: geocode_source 'osm', tier 3 (hand-placed on imagery),
// corroboration visual_satellite (+ name_match when the OSM name agrees). ODbL: the app's
// OsmAttribution already credits every osm pin.
//
// ⚠ IT NEVER SHOWS, FETCHES OR HINTS AT THE CURRENT GOOGLE PIN. OSM forbids data derived from
// Google, and a pin shown "for reference" is exactly that. The pharmacy read selects no
// coordinate column; the hotel hand list's Places columns are dropped at parse time. iD is
// centred on the TOWN named in the KITOB/KTEB address (an OSM place node), never on a pin.
//
// Local only: binds 127.0.0.1, every write needs the per-run token embedded in the page.
// Order: 44 hotels (Mimoza PENDING until KITOB answers) → the 3 flagged pharmacies (Meliz,
// Cevher, Arkan Adışanlı) → the other 279. A pharmacy placed here leaves the exception list
// (data/geocode-exceptions/pharmacy-google-pins.csv — commit it afterwards).

import http from 'node:http'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseFile, fold } from './import-kitob-hotels.mjs'
import { AREA_POINTS } from '../constants/areaPoints.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const PORT = 8787
const TOKEN = randomBytes(16).toString('hex')
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const EXC = resolve(ROOT, 'data/geocode-exceptions/pharmacy-google-pins.csv')
const PROGRESS = resolve(ROOT, 'data/placement-progress.json')        // gitignored
const PULLED = resolve(ROOT, 'data/osm/placement-pulled.json')        // our snapshot of placed elements
const PENDING = { 'kitob-mimoza-hotel-famagusta': 'pending KITOB (identity of Mimoza Hotel)' }
const FLAGGED_FIRST = ['meliz', 'cevher', 'arkan']
const RECHECK_M = 2500
// Organised Editing Guidelines: every changeset comment carries the hashtag AND links the page.
const WIKI = 'https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/ADA_North_Cyprus_places'

const fail = m => { console.error(m); process.exit(1) }
const readJson = (p, d) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d

// ─── names ──────────────────────────────────────────────────────────────────
const GENERIC = new Set(['hotel', 'otel', 'oteli', 'resort', 'spa', 'casino', 'beach', 'club', 'holiday', 'village',
  'apart', 'suites', 'suite', 'boutique', 'butik', 'the', 'and', 've', 'eczane', 'eczanesi', 'ecz', 'pharmacy',
  'yeni', 'new', 'merkez', 'center', 'centre', 'garden', 'gardens', 'palace', 'park', 'residence'])
const plain = s => fold(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/['’`.]/g, '')
const words = s => plain(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w))
const nameAgrees = (a, b) => { const t = new Set(words(b)); return words(a).some(w => t.has(w)) }
const metres = (a, b, c, d) => { const k = Math.PI / 180, x = (c - a) * k, y = (d - b) * k * Math.cos(a * k); return Math.round(6371000 * Math.hypot(x, y)) }

// ─── the town an address names → an OSM place node (never a pin) ────────────
const placesFile = readdirSync(resolve(ROOT, 'data/osm')).filter(f => /^places-.*\.json$/.test(f)).sort().at(-1)
if (!placesFile) fail('no data/osm/places-*.json — run `npm run areas:points` first (it saves the OSM place snapshot)')
const PLACES = JSON.parse(readFileSync(resolve(ROOT, 'data/osm', placesFile), 'utf8')).elements
  .filter(e => e.lat != null && e.tags?.name)
  .map(e => ({ name: e.tags.name, key: plain(e.tags['name:tr'] || e.tags.name), lat: e.lat, lng: e.lon, place: e.tags.place }))
  .filter(p => p.key.length >= 4)
const ZOOM = { city: 16, town: 17, suburb: 17, quarter: 17, village: 18, neighbourhood: 18, hamlet: 18, locality: 17 }
const SPECIFIC = { neighbourhood: 0, hamlet: 0, quarter: 1, suburb: 1, village: 2, locality: 3, town: 4, city: 5 }
// North Nicosia's city node lies south of the Green Line, outside the TRNC area query, so an
// address ending "Lefkoşa" would find no town. Its centre is the Yenişehir/Kumsal quarter point.
const CITY_FALLBACK = [['lefkosa', () => AREA_POINTS.nicosia?.yenisehir || AREA_POINTS.nicosia?.kumsal]]
function centreFor(text, region) {
  const t = ` ${plain(text).replace(/[^a-z0-9]+/g, ' ')} `
  // The most specific VILLAGE/TOWN wins ("Tatlısu, Gazimağusa" → Tatlısu). A quarter or
  // neighbourhood name ("Yalı Mah.") recurs across the island, so it only refines the centre
  // when it lies within 4 km of that village/town.
  const hits = PLACES.filter(p => t.includes(` ${p.key.replace(/[^a-z0-9]+/g, ' ')} `))
    .sort((a, b) => (SPECIFIC[a.place] ?? 9) - (SPECIFIC[b.place] ?? 9) || b.key.length - a.key.length)
  const anchor = hits.find(p => (SPECIFIC[p.place] ?? 9) >= 2)
  const fine = anchor && hits.find(p => (SPECIFIC[p.place] ?? 9) < 2 && metres(anchor.lat, anchor.lng, p.lat, p.lng) <= 4000)
  const hit = fine || anchor
  if (hit) return { lat: hit.lat, lng: hit.lng, zoom: ZOOM[hit.place] || 17, why: `address names ${hit.name}${fine ? ` (${anchor.name})` : ''}` }
  for (const [w, pt] of CITY_FALLBACK) if (t.includes(` ${w} `) && pt()) return { lat: pt()[0], lng: pt()[1], zoom: 16, why: `address names ${w} (city centre)` }
  const m = region && (AREA_POINTS[region]?.merkez || (region === 'nicosia' && CITY_FALLBACK[0][1]()))
  if (m) return { lat: m[0], lng: m[1], zoom: 15, why: `no town in the address — ${region} centre` }
  const any = region && Object.values(AREA_POINTS[region] || {})[0]
  if (any) return { lat: any[0], lng: any[1], zoom: 14, why: `no town in the address — somewhere in ${region}` }
  return { lat: 35.25, lng: 33.6, zoom: 10, why: 'no town found — whole TRNC' }
}

// ─── DB client ──────────────────────────────────────────────────────────────
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n').map(l => l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { createClient } = await import('@supabase/supabase-js')
const key = DRY ? env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  : execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'], { encoding: 'utf8' }).trim()
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } })

// ─── the queue ──────────────────────────────────────────────────────────────
function buildQueue() {
  const progress = readJson(PROGRESS, {})
  // Hotels: the newest APPLIED hand list. Only name/region/adres/phone are kept — its Places
  // columns (place id, maps link) are dropped here and never reach the page.
  const handFile = readdirSync(resolve(ROOT, 'data/kitob')).filter(f => /^geocode-hand-\d+\.csv$/.test(f)).sort().at(-1)
  if (!handFile) fail('no applied data/kitob/geocode-hand-<stamp>.csv')
  const [head, ...lines] = readFileSync(resolve(ROOT, 'data/kitob', handFile), 'utf8').trim().split('\n')
  const col = Object.fromEntries(head.split(';').map((h, i) => [h, i]))
  const { rows } = normaliseFile(readFileSync(resolve(ROOT, 'data/kitob/kitob-2026-09-17.csv'), 'utf8'), '2026-09-17')
  const hotels = lines.map(l => l.split(';')).map(c => {
    const name = c[col.name], region = c[col.region]
    const k = rows.find(r => r.name === name && r.region === region)
    if (!k) fail(`hand list row "${name}" (${region}) is not in the KITOB file — keys drifted`)
    return { key: k.external_id, kind: 'hotel', name, region, address: c[col.adres] || '', phone: c[col.phone] || k.phone || '',
      source: `KITOB list 2026-09-17 · ${k.kitob_class}`, website: k.website || '' }
  })
  const exc = readFileSync(EXC, 'utf8').trim().split('\n').slice(1).map(l => l.split(';'))
    .map(c => ({ key: c[0], kind: 'pharmacy', name: c[1], region: null, address: [c[3], c[2]].filter(Boolean).join(', '),
      phone: '', source: `KTEB list · ${c[4]}`, flagged: c[4].startsWith('OSM agrees') }))
  const rank = p => { const i = FLAGGED_FIRST.findIndex(w => plain(p.name).includes(w)); return p.flagged ? (i < 0 ? 9 : i) : 99 }
  const pharm = exc.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p)
  const all = [...hotels, ...pharm]
  // A pharmacy is done when it left the exception list; everything placed is in progress.json.
  const doneKeys = Object.keys(progress)
  return { all, progress, total: all.length + doneKeys.filter(k => !all.some(x => x.key === k)).length }
}

const phones = new Map()
async function phoneFor(item) {
  if (item.kind !== 'pharmacy' || phones.has(item.key)) return phones.get(item.key) || item.phone
  const { data } = await sb.from('facilities').select('id, phone').eq('id', item.key).maybeSingle()   // NO coordinate column
  phones.set(item.key, data?.phone || '')
  return phones.get(item.key)
}

// ─── Overpass (main server only; the kumi mirror served June data) ──────────
async function overpass(q) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ADA placement tool (berkeustun95)' } }).catch(() => null)
    if (r?.ok) { try { return JSON.parse(await r.text()) } catch { /* busy page */ } }
    await new Promise(s => setTimeout(s, 4000 * (i + 1)))
  }
  throw new Error('Overpass unavailable — try again in a minute')
}
const FEATURE = {
  hotel: '["tourism"~"^(hotel|resort|guest_house|apartment|hostel|motel|chalet)$"]',
  pharmacy: '["amenity"="pharmacy"]',
}
async function recheck(item) {
  const c = centreFor(item.address, item.region)
  const q = `[out:json][timeout:40];nwr${FEATURE[item.kind]}(around:${RECHECK_M},${c.lat},${c.lng});out center meta;`
  const snap = await overpass(q)
  return { base: snap.osm3s?.timestamp_osm_base, cands: snap.elements.map(e => ({
    osm: `${e.type}/${e.id}`, name: e.tags?.name || '(no name)', lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
    user: e.user, at: e.timestamp, agrees: nameAgrees(item.name, [e.tags?.name, e.tags?.['name:tr'], e.tags?.['name:en']].filter(Boolean).join(' ')),
  })).filter(x => x.lat != null).sort((a, b) => (b.agrees - a.agrees) || b.at.localeCompare(a.at)).slice(0, 15) }
}

async function save(item, osm) {
  // Coordinates come from OSM by id, fetched here — never from the page.
  const [type, id] = osm.split('/')
  if (!['node', 'way', 'relation'].includes(type) || !/^\d+$/.test(id)) throw new Error(`bad OSM id ${osm}`)
  const snap = await overpass(`[out:json][timeout:25];${type}(${id});out center meta tags;`)
  const e = snap.elements[0]
  if (!e) throw new Error(`${osm} not found on Overpass yet (base ${snap.osm3s?.timestamp_osm_base}) — wait a minute`)
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon
  const want = FEATURE[item.kind].includes('pharmacy') ? e.tags?.amenity === 'pharmacy' : /^(hotel|resort|guest_house|apartment|hostel|motel|chalet)$/.test(e.tags?.tourism || '')
  if (!want) throw new Error(`${osm} is not tagged as a ${item.kind} in OSM`)
  const agrees = nameAgrees(item.name, [e.tags?.name, e.tags?.['name:tr'], e.tags?.['name:en']].filter(Boolean).join(' '))
  const corroboration = agrees ? ['visual_satellite', 'name_match'] : ['visual_satellite']
  const now = new Date().toISOString()
  const summary = `${item.name} ← ${osm} "${e.tags?.name || ''}" (${lat.toFixed(6)}, ${lng.toFixed(6)})`
  if (DRY) return `DRY — would write ${summary}`
  if (item.kind === 'hotel') {
    const { data, error } = await sb.from('hotels').update({ lat, lng, geocode_source: 'osm', geocode_tier: 3,
      geocode_corroboration: corroboration, geocoded_at: now }).eq('external_id', item.key).is('lat', null).select('id')
    if (error) throw new Error(error.message)
    if (data.length !== 1) throw new Error(`hotel ${item.key}: ${data.length} rows updated (already placed?)`)
  } else {
    const { data, error } = await sb.from('facilities').update({ latitude: lat, longitude: lng, geocode_source: 'osm',
      geocode_tier: 3, geocode_corroboration: corroboration, geocoded_at: now })
      .eq('id', item.key).eq('type', 'pharmacy').eq('geocode_source', 'google_places').select('id')
    if (error) throw new Error(error.message)
    if (data.length !== 1) throw new Error(`pharmacy ${item.key}: ${data.length} rows updated (not a google_places pin any more?)`)
    // The Google pin is gone → so is its exception row.
    const [head, ...rows] = readFileSync(EXC, 'utf8').trim().split('\n')
    const kept = rows.filter(r => !r.startsWith(`${item.key};`))
    if (kept.length !== rows.length - 1) throw new Error(`exception list: expected to remove 1 row for ${item.key}, removed ${rows.length - kept.length}`)
    writeFileSync(EXC, [head, ...kept].join('\n') + '\n')
    const { count } = await sb.from('facilities').select('id', { count: 'exact', head: true }).eq('type', 'pharmacy').eq('geocode_source', 'google_places')
    if (count !== kept.length) throw new Error(`MISMATCH: ${count} google_places pharmacy pins vs ${kept.length} exception rows`)
  }
  const progress = readJson(PROGRESS, {})
  progress[item.key] = { kind: item.kind, name: item.name, osm, at: now, name_match: agrees }
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 1))
  const pulled = readJson(PULLED, { note: 'OSM elements pulled by scripts/placement-tool.mjs (ODbL)', elements: [] })
  pulled.elements = [...pulled.elements.filter(x => `${x.type}/${x.id}` !== osm), e]
  writeFileSync(PULLED, JSON.stringify(pulled))
  return `saved ${summary}`
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const skipped = new Set()
async function current() {
  const { all, progress, total } = buildQueue()
  const open = all.filter(x => !progress[x.key] && !PENDING[x.key])
  const pending = all.filter(x => PENDING[x.key]).map(x => `${x.name} — ${PENDING[x.key]}`)
  const next = open.find(x => !skipped.has(x.key)) || open[0]
  const done = total - all.length + all.filter(x => progress[x.key]).length
  if (!next) return { done, total, pending, item: null }
  const c = centreFor(next.address, next.region)
  const hash = `map=${c.zoom}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}&comment=${encodeURIComponent(`Add ${next.kind}: ${next.name} #ada-placement ${WIKI}`)}&hashtags=ada-placement`
  return { done, total, pending, position: all.indexOf(next) + 1, stage: next.kind === 'hotel' ? 'hotels' : next.flagged ? 'flagged pharmacies' : 'pharmacies',
    item: { ...next, phone: await phoneFor(next), centreWhy: c.why }, idUrl: `https://www.openstreetmap.org/edit?editor=id#${hash}` }
}

const PAGE = readFileSync(resolve(ROOT, 'scripts/placement-tool.html'), 'utf8').replace('__TOKEN__', TOKEN).replace('__DRY__', String(DRY))
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body) }
http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8')
    if (req.method === 'GET' && req.url === '/api/current') return send(res, 200, await current())
    if (req.method !== 'POST' || req.headers['x-token'] !== TOKEN) return send(res, 403, { error: 'forbidden' })
    const body = JSON.parse(await new Promise(r => { let b = ''; req.on('data', d => { b += d }); req.on('end', () => r(b || '{}')) }))
    const item = buildQueue().all.find(x => x.key === body.key)
    if (!item) return send(res, 404, { error: 'unknown item' })
    if (req.url === '/api/recheck') return send(res, 200, await recheck(item))
    if (req.url === '/api/save') return send(res, 200, { message: await save(item, String(body.osm || '')) })
    if (req.url === '/api/skip') { skipped.add(item.key); return send(res, 200, { ok: true }) }
    send(res, 404, { error: 'not found' })
  } catch (e) { send(res, 500, { error: e.message }) }
}).listen(PORT, '127.0.0.1', async () => {
  const c = await current()
  console.log(`placement tool${DRY ? ' (DRY — nothing is written)' : ''}: http://127.0.0.1:${PORT}  ·  ${c.done}/${c.total} placed  ·  pending: ${c.pending.join('; ') || 'none'}`)
})
