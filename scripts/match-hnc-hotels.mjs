#!/usr/bin/env node
// ─── Match hotelsofnorthcyprus.com pages (data/hnc/hotels.json) to our 102 KITOB hotels ─
//   node scripts/match-hnc-hotels.mjs     → data/hnc/match.json + a printed report
//
// A site page is our hotel when its phone's last 7 digits equal ours, or its name shares a
// distinctive word with ours (generic words — hotel, resort, casino … — never count) AND its
// location agrees with our region. Two pages for one hotel (the site has duplicates, e.g. Ekor
// Elegance) → the one with more content wins. Nothing here touches the database.
//
// Also compares KITOB's own map marker on the page with our stored pin (from the applied
// geocode lists) — the pin audit's second opinion.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseFile, fold } from './import-kitob-hotels.mjs'
import { resolveRegion } from '../utils/resolveRegion.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIN_DESC = 120   // below this it is a tagline ("Get a five-star experience"), not a description
const site = JSON.parse(readFileSync(resolve(ROOT, 'data/hnc/hotels.json'), 'utf8'))
const { rows } = normaliseFile(readFileSync(resolve(ROOT, 'data/kitob/kitob-2026-09-17.csv'), 'utf8'), '2026-09-17')

const GENERIC = new Set(['hotel', 'hotels', 'otel', 'oteli', 'resort', 'casino', 'spa', 'and', 've', 'the', 'club', 'village',
  'holiday', 'bungalow', 'bungalows', 'apart', 'beach', 'garden', 'gardens', 'palace', 'boutique', 'butik', 'tatil', 'koyu',
  'restoran', 'premium', 'deluxe', 'luxury', 'city', 'grand', 'royal', 'park', 'center', 'centre', 'inn', 'house', 'cyprus',
  'kibris', 'north', 'lounge', 'bar', 'court', 'marina', 'convention', 'touristic', 'suites', 'kyrenia', 'girne', 'nicosia',
  'lefkosa', 'famagusta', 'magusa', 'iskele', 'bafra'])
const norm = s => fold(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/['’`]/g, '')
const words = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w))
const full = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean).join(' ')
const last7 = p => (p || '').replace(/\D/g, '').slice(-7)
const LOC = { kyrenia: 'kyrenia', nicosia: 'nicosia', famagusta: 'famagusta', iskele: 'iskele', bafra: 'karpaz',
  karpaz: 'karpaz', lefke: 'lefke', guzelyurt: 'morphou', morphou: 'morphou', 'long beach': 'iskele' }
const siteRegion = h => LOC[norm(h.location)] ?? (h.marker ? resolveRegion(h.marker.lat, h.marker.lng) : null)
const km = (a, b, c, d) => { const k = Math.PI / 180, x = (c - a) * k, y = (d - b) * k * Math.cos(a * k); return 6371 * Math.hypot(x, y) }

// Our stored pins, from every applied geocode list (OSM + Google).
const pins = new Map()
for (const f of readdirSync(resolve(ROOT, 'data/kitob')).filter(x => /^geocode-(osm|google)-\d+\.csv$/.test(x)).sort()) {
  const osm = f.includes('-osm-')
  for (const l of readFileSync(resolve(ROOT, 'data/kitob', f), 'utf8').trim().split('\n').slice(1).filter(Boolean)) {
    const c = l.split(';'); pins.set(`${c[0]}|${c[1]}`, osm ? { lat: +c[5], lng: +c[6], source: 'osm', osm_id: c[3] } : { lat: +c[3], lng: +c[4], source: 'google_places' })
  }
}

// Our identity is unresolved here, so the site's page cannot be assumed to be this hotel.
const PENDING_IDENTITY = { 'kitob-mimoza-hotel-famagusta': 'identity pending KITOB (site page is "Mimoza Beach Hotel")' }
const matches = []
for (const r of rows) {
  const mine = words(r.name)
  const cands = site.map(h => {
    const why = []
    // Exact name (all words, generic ones included) beats everything: "Royal Palace Hotel" has no
    // distinctive word, and a hotel group shares one phone across hotels (Olive Tree / Citrus Tree).
    if (full(h.name) === full(r.name)) why.push('exact_name')
    if (r.phone && last7(h.phone) && last7(h.phone) === last7(r.phone)) why.push('phone')
    const theirs = words(h.name), overlap = mine.filter(w => theirs.includes(w)).length
    const jacc = overlap / (new Set([...mine, ...theirs]).size || 1)
    if (overlap) why.push('name')
    const reg = siteRegion(h)
    const regionOk = reg === r.region || (reg === 'iskele' && r.region === 'karpaz') || (reg === 'karpaz' && r.region === 'iskele')
    const score = (why.includes('exact_name') ? 10 : 0) + (why.includes('phone') ? 3 : 0) + 4 * jacc + (regionOk ? 1 : 0)
    return { h, why, regionOk, jacc, score }
  }).filter(c => c.why.includes('exact_name') || c.why.includes('phone') || (c.why.includes('name') && c.regionOk && c.jacc >= 0.5))
    .sort((a, b) => b.score - a.score || (b.h.description?.length || 0) - (a.h.description?.length || 0))
  matches.push({ r, c: PENDING_IDENTITY[r.external_id] ? null : (cands[0] || null), alts: cands.slice(1).map(x => x.h.name),
    held: PENDING_IDENTITY[r.external_id] || null })
}
// A site page may match only one of our hotels.
const used = new Map()
for (const m of matches) if (m.c) used.set(m.c.h.url, [...(used.get(m.c.h.url) || []), m])
const clash = [...used].filter(([, l]) => l.length > 1)
// The best-scoring hotel keeps the page; the others lose it (reported, never guessed).
for (const [, l] of clash) { l.sort((a, b) => b.c.score - a.c.score); for (const m of l.slice(1)) { m.lost = `${l[0].r.name} took ${m.c.h.url}`; m.c = null } }

const out = matches.map(({ r, c, alts, lost, held }) => {
  const pin = pins.get(`${r.name}|${r.region}`)
  const h = c?.h
  const markerKm = h?.marker && pin ? km(pin.lat, pin.lng, h.marker.lat, h.marker.lng) : null
  return { external_id: r.external_id, name: r.name, region: r.region, village: r.address,
    site_url: h?.url || null, site_name: h?.name || null, matched_by: c?.why || [], lost: lost || null, held: held || null, alts,
    photo: h?.photo || null, photo_from: h?.photo_from || null,
    // Up to 6: the page's own gallery in page order, else KITOB's featured image alone.
    gallery: h ? ((h.gallery?.length ? h.gallery : [h.photo]).filter(Boolean).slice(0, 6)) : [],
    description_en: h?.description && h.description.length >= MIN_DESC ? h.description : null,
    description_skipped: h?.placeholder ? 'lorem ipsum' : (h?.description && h.description.length < MIN_DESC ? `tagline (${h.description.length} chars): "${h.description}"` : null),
    kitob_marker: h?.marker || null, pin: pin || null, marker_vs_pin_km: markerKm == null ? null : +markerKm.toFixed(2) }
})
writeFileSync(resolve(ROOT, 'data/hnc/match.json'), JSON.stringify(out, null, 1))

const got = out.filter(o => o.site_url)
console.log(`our hotels ${out.length} · matched ${got.length} (phone ${got.filter(o => o.matched_by.includes('phone')).length}) · unmatched ${out.filter(o => !o.site_url).length} · page collisions resolved ${clash.length}`)
console.log(`  photos ${got.filter(o => o.photo).length} · descriptions ${got.filter(o => o.description_en).length} · skipped descriptions ${got.filter(o => o.description_skipped).length}`)
for (const o of out.filter(o => !o.site_url)) console.log(`  ✗ unmatched: ${o.name} (${o.region}${o.village ? ', ' + o.village : ''})${o.held ? ' — HELD: ' + o.held : o.lost ? ' — lost the page: ' + o.lost : ' — not on the site'}`)
for (const o of got.filter(o => o.matched_by.length === 1 && o.matched_by[0] === 'name')) console.log(`  name-only match: ${o.name} ⇄ ${o.site_name}`)
for (const o of got.filter(o => o.description_skipped)) console.log(`  description skipped: ${o.name} — ${o.description_skipped}`)
const siteUnused = site.filter(h => !out.some(o => o.site_url === h.url))
for (const h of siteUnused) console.log(`  · site page matched none of ours: ${h.name} (${h.location}) ${h.url}`)
const far = got.filter(o => o.marker_vs_pin_km != null).sort((a, b) => b.marker_vs_pin_km - a.marker_vs_pin_km)
console.log(`\nKITOB marker vs our pin (${far.length} comparable): >1 km ${far.filter(o => o.marker_vs_pin_km > 1).length} · 0.2–1 km ${far.filter(o => o.marker_vs_pin_km > 0.2 && o.marker_vs_pin_km <= 1).length} · ≤0.2 km ${far.filter(o => o.marker_vs_pin_km <= 0.2).length}`)
for (const o of far.filter(o => o.marker_vs_pin_km > 0.2)) console.log(`  ${String(o.marker_vs_pin_km).padStart(6)} km  ${o.name} (${o.pin.source})`)
console.log(`\npinless hotels with a KITOB marker: ${got.filter(o => !o.pin && o.kitob_marker).map(o => o.name).join(', ') || 'none'}`)
