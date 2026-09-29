#!/usr/bin/env node
// ─── Oteller "Bölge" coverage: how many hotels get an area, and from what ─────
//   npm run hotels:areas                          # report
//   npm run hotels:areas -- --fixture <out.json>  # also write a LOCAL device-test fixture
//
// Reads only committed/local files, never the database: the KITOB list
// (data/kitob/kitob-2026-09-17.csv) and the newest APPLIED hotel geocode output
// (data/kitob/geocode-osm-<stamp>.csv — our data + OSM coordinates + place IDs, gitignored).
// The area itself is computed on the device (utils/hotelArea.js), so a moved pin moves its
// area with no re-run; this script only reports. Re-run it after any pin change to see the
// new coverage.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normaliseFile } from './import-kitob-hotels.mjs'
import { hotelArea } from '../utils/hotelArea.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const FIXTURE = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null
// --google <file>: use that Google list instead of the newest applied one (projection from a dry run).
const GOOGLE_ARG = args.includes('--google') ? args[args.indexOf('--google') + 1] : null

const { rows, errors } = normaliseFile(readFileSync(resolve(ROOT, 'data/kitob/kitob-2026-09-17.csv'), 'utf8'), '2026-09-17')
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }

// EVERY applied OSM list, oldest first (a later apply writes only the pins IT added — the
// 2026-09-29 Google apply wrote an empty one, and reading only the newest showed 0 OSM pins).
const osmFiles = readdirSync(resolve(ROOT, 'data/kitob')).filter(f => /^geocode-osm-\d+\.csv$/.test(f)).sort()
if (!osmFiles.length) { console.error('no applied data/kitob/geocode-osm-<stamp>.csv (dry runs are ignored)'); process.exit(1) }
const osmFile = osmFiles.join(' + ')
const pins = new Map(osmFiles.flatMap(f => readFileSync(resolve(ROOT, 'data/kitob', f), 'utf8').trim().split('\n').slice(1))
  .filter(Boolean).map(l => l.split(';')).map(c => [`${c[0]}|${c[1]}`, { lat: +c[5], lng: +c[6] }]))

// Google-sourced pins (20261062, known risk): the newest APPLIED geocode-google-<stamp>.csv.
const gFiles = GOOGLE_ARG ? [GOOGLE_ARG] : readdirSync(resolve(ROOT, 'data/kitob')).filter(x => /^geocode-google-\d+\.csv$/.test(x)).sort().map(f => `data/kitob/${f}`)
const gFile = gFiles.join(' + ')
const gpins = new Map(gFiles.flatMap(f => readFileSync(resolve(ROOT, f), 'utf8').trim().split('\n').slice(1)).filter(Boolean)
  .map(l => l.split(';')).map(c => [`${c[0]}|${c[1]}`, { lat: +c[3], lng: +c[4], source: 'google_places' }]))
console.log(`Google pins from ${gFile || '(none applied yet)'}: ${gpins.size}`)

// Pins placed since, through the placement tool (npm run place): progress maps hotel → OSM id,
// placement-pulled.json holds that element's coordinates.
const progress = existsSync(resolve(ROOT, 'data/placement-progress.json')) ? JSON.parse(readFileSync(resolve(ROOT, 'data/placement-progress.json'), 'utf8')) : {}
const pulled = existsSync(resolve(ROOT, 'data/osm/placement-pulled.json')) ? JSON.parse(readFileSync(resolve(ROOT, 'data/osm/placement-pulled.json'), 'utf8')).elements : []
const placed = new Map(Object.entries(progress).filter(([, v]) => v.kind === 'hotel').map(([k, v]) => {
  const e = pulled.find(x => `${x.type}/${x.id}` === v.osm)
  return [k, e && { lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon }]
}).filter(([, v]) => v))
console.log(`hotels placed through the tool: ${placed.size}`)

const hotels = rows.map(r => {
  const g = gpins.get(`${r.name}|${r.region}`)
  const p = placed.get(r.external_id) || pins.get(`${r.name}|${r.region}`) || g
  return { id: r.external_id, name: r.name, kitob_class: r.kitob_class, region: r.region, address: r.address,
    phone: r.phone, website: r.website, lat: p?.lat ?? null, lng: p?.lng ?? null,
    geocode_source: p ? (p.source || 'osm') : null, photo_url: null, is_kitob_member: true }
})
const matchedPins = hotels.filter(h => pins.has(`${h.name}|${h.region}`)).length
const matchedG = hotels.filter(h => gpins.has(`${h.name}|${h.region}`)).length
if (matchedG !== gpins.size) { console.error(`✗ ${gpins.size - matchedG} Google pin row(s) matched no hotel`); process.exit(1) }
console.log(`KITOB rows ${hotels.length} · OSM pins from ${osmFile}: ${pins.size} rows, ${matchedPins} matched to a hotel`)
if (matchedPins !== pins.size) { console.error(`✗ ${pins.size - matchedPins} pin row(s) matched no hotel — name/region keys drifted`); process.exit(1) }

const res = hotels.map(h => ({ h, a: hotelArea(h) }))
const byVillage = res.filter(x => x.a?.from === 'village').length
const byPin = res.filter(x => x.a?.from === 'pin')
const none = res.filter(x => !x.a)
console.log(`\nBEFORE (village only): ${byVillage}/${hotels.length}`)
console.log(`AFTER  (village, else nearest area to the pin): ${byVillage + byPin.length}/${hotels.length}  (+${byPin.length} from pins)`)
for (const { h, a } of byPin.sort((x, y) => y.a.km - x.a.km)) console.log(`  pin → ${a.name.padEnd(14)} ${a.km.toFixed(1).padStart(4)} km  ${h.name} (${h.region})`)
const noneNoPin = none.filter(x => x.h.lat == null)
console.log(`\nstill no area: ${none.length} — ${noneNoPin.length} have no village AND no pin yet (hand placement), ${none.length - noneNoPin.length} other`)
for (const { h } of none.filter(x => x.h.lat != null)) console.log(`  ? ${h.name} (${h.region}, "${h.address}")`)

if (FIXTURE) {
  writeFileSync(resolve(FIXTURE), JSON.stringify(hotels, null, 1))
  console.log(`\nfixture → ${FIXTURE} (${hotels.length} hotels; LOCAL ONLY, never commit)`)
}
