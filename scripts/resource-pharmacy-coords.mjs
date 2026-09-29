#!/usr/bin/env node
// ─── Re-source pharmacy pins from OSM (geocoding storage policy, 2026-09-29) ─
//
//   npm run pharmacies:resource -- --dry-run      # read-only report
//   npm run pharmacies:resource -- --apply        # writes (only after Berke's go)
//
// POLICY: Google Places is a CROSS-CHECK ONLY. Its latitude/longitude may not be stored (the
// Maps Platform terms cap caching; the place ID is exempt), and on iOS our maps are Apple
// Maps, where Places content may not be shown at all. 349 pharmacy pins were written by the
// tier-2 Places run (geocode_source = 'google_places'). This replaces each with the OSM
// coordinate of the SAME pharmacy when OSM agrees with the stored Places point:
//   • an OSM amenity=pharmacy / healthcare=pharmacy within 150 m of the Places point, and
//   • its name shares a distinctive word with ours (generic words like "Eczanesi" do not
//     count) — pharmacies cluster, so distance alone would pick a neighbour.
// Written as geocode_source 'osm', tier 1, corroboration + google_places.
// No agreeing OSM node → the pharmacy goes on the hand-placement list.
//
// Every move over 50 m is reported: that is where the old pin or OSM is wrong, and the only
// place a user should see a difference.
//
// Reads with the service role (pharmacy rows are public, but the provenance columns are the
// point and the whole set must be read). --dry-run never writes.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold } from './import-kitob-hotels.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run'), APPLY = args.includes('--apply')
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
if (DRY === APPLY && !args.includes('--self')) fail('Pass exactly one of --dry-run or --apply.')

const AGREE_M = 150, MOVE_REPORT_M = 50
const GENERIC = new Set(['eczane', 'eczanesi', 'eczanesı', 'ecz', 'pharmacy', 'pharmacie', 'apotheke', 'aptieka',
  'the', 've', 'and', 'yeni', 'new', 'merkez', 'center', 'centre'])
export const words = n => fold(n).replace(/['’`.]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w))
export const km = (a, b, c, d) => { const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h)) }

export function matchOsm(ph, osm) {
  const mine = words(ph.name)
  if (!mine.length) return null
  const cands = osm.map(o => ({ o, m: km(ph.latitude, ph.longitude, o.lat, o.lng) * 1000 }))
    .filter(x => x.m <= AGREE_M && x.o.names.some(n => words(n).some(w => mine.includes(w))))
    .sort((a, b) => a.m - b.m)
  return cands[0] || null
}

if (args.includes('--self')) {
  let bad = 0
  const t = (l, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${l} -> ${JSON.stringify(g)}`) }
  const ph = { name: 'Özlem Eczanesi', latitude: 35.19, longitude: 33.36 }
  const near = (name, dm) => ({ names: [name], lat: 35.19 + dm / 111000, lng: 33.36 })
  t('same name 40 m away matches', matchOsm(ph, [near('Özlem Eczanesi', 40)])?.o.names[0], 'Özlem Eczanesi')
  t('neighbour pharmacy 20 m away does NOT match', matchOsm(ph, [near('Kaya Eczanesi', 20)]), null)
  t('same name 400 m away does NOT match', matchOsm(ph, [near('Özlem Eczanesi', 400)]), null)
  t('generic-only name never matches', matchOsm({ ...ph, name: 'Eczane' }, [near('Eczane', 5)]), null)
  process.exit(bad ? 1 : 0)
}

async function loadOsm() {
  const q = `[out:json][timeout:90];area(3602514541)->.t;(nwr["amenity"="pharmacy"](area.t);nwr["healthcare"="pharmacy"](area.t););out center tags;`
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'])
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ADA-app pharmacy re-source (berkeustun95)' } })
        .catch(e => ({ ok: false, status: e.message }))
      if (res.ok) return ((await res.json()).elements || []).map(e => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
        names: [e.tags?.name, e.tags?.['name:tr'], e.tags?.['name:en']].filter(Boolean) })).filter(e => e.lat && e.names.length)
      await new Promise(r => setTimeout(r, 5000))
    }
  fail('Overpass unavailable')
}

const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n').map(l => l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'], { encoding: 'utf8' }).trim(), { auth: { persistSession: false } })
const { data: rows, error, count } = await sb.from('facilities')
  .select('id,name,address,city,status,latitude,longitude,geocode_corroboration', { count: 'exact' })
  .eq('type', 'pharmacy').eq('geocode_source', 'google_places')
if (error) fail(error.message)
if (rows.length !== count) fail(`read ${rows.length} of ${count} — refusing a partial set`)

const osm = await loadOsm()
const matched = [], hand = []
for (const ph of rows) {
  const m = matchOsm(ph, osm)
  if (m) matched.push({ ph, o: m.o, moved: Math.round(m.m) })
  else hand.push(ph)
}
const big = matched.filter(x => x.moved > MOVE_REPORT_M).sort((a, b) => b.moved - a.moved)
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
console.log(`OSM pharmacies in TRNC: ${osm.length}`)
console.log(`\n${DRY ? 'DRY RUN' : 'APPLY'} · ${rows.length} google_places pharmacy pins`)
console.log(`  OSM agrees (→ osm, tier 1): ${matched.length}   of which moved > ${MOVE_REPORT_M} m: ${big.length}`)
console.log(`  no agreeing OSM node (→ hand placement): ${hand.length}`)
const buckets = [[0, 10], [10, 25], [25, 50], [50, 100], [100, 151]]
console.log('  move distribution:', buckets.map(([a, b]) => `${a}-${b} m: ${matched.filter(x => x.moved >= a && x.moved < b).length}`).join(' · '))
for (const x of big) console.log(`    moves ${x.moved} m: ${x.ph.name} (${x.ph.city}) → OSM ${x.o.id} "${x.o.names[0]}"`)
// Hand list: OUR data only (name, address, city) — no Places coordinates in a file that persists.
writeFileSync(resolve(ROOT, `data/pharmacy-hand-place-${stamp}.csv`),
  ['id;name;address;city;status', ...hand.map(p => [p.id, p.name, p.address || '', p.city || '', p.status].map(v => String(v).replace(/;/g, ',')).join(';'))].join('\n') + '\n')
console.log(`  hand-placement list → data/pharmacy-hand-place-${stamp}.csv`)

if (APPLY) fail('--apply is deliberately not implemented until the pin-removal question is decided (see the vault).')
