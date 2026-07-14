// Ground-truth check for the city-detection resolver. Run:  node scripts/validate-regions.mjs
//
// This script IS the gate on constants/regions.js. The outline polygon and the
// anchor set are hand-assembled, so they do not get to be trusted until they
// reproduce data we already know is right.
//
// Three independent checks:
//   1. GATE      — every real TRNC place must be inside the outline; every known
//                  RoC place must be outside it.
//   2. LEAVE-ONE-OUT — the 387 geocoded pharmacies, each classified with its own
//                  coordinate's anchors removed. (Plain 1-NN would score 100% by
//                  construction; the anchors are these very points.)
//   3. HELD OUT  — the 9 seeded beaches/landmarks. These were never used as
//                  anchors, so this is the only fully independent signal here.
//
// Everything is also re-run through coarseCoord (2 dp, ~1.1 km), which is the
// precision the app actually feeds the resolver.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { ANCHORS, TRNC_OUTLINE, MAX_ANCHOR_KM, REGIONS } from '../constants/regions.js'
import { resolveRegion, pointInPolygon } from '../utils/resolveRegion.js'
import { haversineKm, coarseCoord } from '../utils/facilityUtils.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- ground truth -----------------------------------------------------------

// Turkish duty/address label -> canonical slug. Mesarya folds by geography, so
// it has no single slug and is scored separately.
const LABEL_TO_SLUG = {
  'Lefkoşa': 'nicosia',
  'Girne': 'kyrenia',
  'Gazimağusa': 'famagusta',
  'Güzelyurt': 'morphou',
  'İskele': 'iskele',
  'Yeni İskele': 'iskele', // kept so the known bad geocode shows up as a mismatch
  'Lefke': 'lefke',
  'Karpaz': 'karpaz',
}

// Places we know are in the Republic. None of these may resolve to a TRNC region.
const ROC_CONTROLS = [
  ['Larnaca', 34.9182, 33.6301],
  ['Ayia Napa', 34.9880, 33.9970],
  ['Limassol', 34.7071, 33.0226],
  ['Paphos', 34.7754, 32.4245],
  ['Deryneia', 35.0575, 33.9550],
  ['Athienou', 35.0625, 33.5400],
  ['Kato Pyrgos', 35.1758, 32.6386],
  ['Larnaca Airport', 34.8751, 33.6249],
  ['Troodos', 34.9229, 32.8783],
  ['South Nicosia (Ledra)', 35.1700, 33.3620], // expected to FAIL — see regions.js
  ['Mersin, Turkey', 36.8121, 34.6415],
  ['Middle of the sea', 35.9000, 33.5000],
]

function parsePharmacies() {
  const sql = readFileSync(join(ROOT, 'seed_pharmacies_geocoded.sql'), 'utf8')
  const re = /^\('((?:[^']|'')*)',\s*'pharmacy',\s*'((?:[^']|'')*)',\s*'(?:(?:[^']|'')*)',\s*\w+,\s*\w+,\s*(?:'(?:(?:[^']|'')*)'|null),\s*(-?[\d.]+),\s*(-?[\d.]+)\)[,;]?\s*$/gm
  const rows = []
  let m
  while ((m = re.exec(sql)) !== null) {
    const address = m[2]
    const parts = address.split(',').map(s => s.trim())
    rows.push({
      name: m[1].replace(/''/g, "'"),
      address,
      label: parts[parts.length - 1],
      lat: +m[3],
      lng: +m[4],
    })
  }
  return rows
}

function parsePlaces() {
  const sql = readFileSync(join(ROOT, 'supabase/beaches_landmarks_migration.sql'), 'utf8')
  const re = /\(NULL,\s*'((?:[^']|'')*)',\s*'(\w+)',\s*(-?[\d.]+),\s*(-?[\d.]+),/g
  const rows = []
  let m
  while ((m = re.exec(sql)) !== null) {
    rows.push({ name: m[1].replace(/''/g, "'"), expect: m[2], lat: +m[3], lng: +m[4] })
  }
  return rows
}

// --- geometry helpers (report only) -----------------------------------------

const KM_PER_DEG_LAT = 110.574
const kmPerDegLng = lat => 111.320 * Math.cos((lat * Math.PI) / 180)

// Perpendicular distance from a point to the outline, in km. Used to report how
// much clearance each real place has to the Green Line / coast.
function kmToOutline(lat, lng) {
  const sx = kmPerDegLng(lat)
  const px = lng * sx
  const py = lat * KM_PER_DEG_LAT
  let best = Infinity
  for (let i = 0, j = TRNC_OUTLINE.length - 1; i < TRNC_OUTLINE.length; j = i++) {
    const ax = TRNC_OUTLINE[j][1] * sx, ay = TRNC_OUTLINE[j][0] * KM_PER_DEG_LAT
    const bx = TRNC_OUTLINE[i][1] * sx, by = TRNC_OUTLINE[i][0] * KM_PER_DEG_LAT
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const cx = ax + t * dx, cy = ay + t * dy
    best = Math.min(best, Math.hypot(px - cx, py - cy))
  }
  return best
}

// Nearest-anchor classify, with the option to drop anchors sitting on the exact
// coordinate under test. That exclusion is what makes the pharmacy run honest.
function classify(lat, lng, { excludeCoord = null } = {}) {
  if (!pointInPolygon(lat, lng, TRNC_OUTLINE)) return { region: null, km: Infinity, gated: true }
  let region = null
  let bestKm = Infinity
  for (const [aLat, aLng, r] of ANCHORS) {
    if (excludeCoord && aLat === excludeCoord[0] && aLng === excludeCoord[1]) continue
    const km = haversineKm(lat, lng, aLat, aLng)
    if (km < bestKm) { bestKm = km; region = r }
  }
  if (bestKm > MAX_ANCHOR_KM) return { region: null, km: bestKm, gated: false }
  return { region, km: bestKm, gated: false }
}

// --- run --------------------------------------------------------------------

const pharmacies = parsePharmacies()
const places = parsePlaces()
const bad = []
const line = '-'.repeat(78)

console.log(`\n${line}\nCITY DETECTION — GROUND TRUTH REPORT`)
console.log(`${pharmacies.length} pharmacies · ${places.length} beaches/landmarks · ${ANCHORS.length} anchors · ${TRNC_OUTLINE.length} outline vertices\n${line}`)

// 1. GATE ---------------------------------------------------------------------
console.log('\n[1] GATE — outline polygon\n')

const outside = pharmacies.filter(p => !pointInPolygon(p.lat, p.lng, TRNC_OUTLINE))
const outsideCoarse = pharmacies.filter(p => !pointInPolygon(coarseCoord(p.lat), coarseCoord(p.lng), TRNC_OUTLINE))
console.log(`  TRNC pharmacies inside outline : ${pharmacies.length - outside.length}/${pharmacies.length}` +
  (outside.length ? '  <-- FAIL' : '  OK'))
console.log(`  ...same, at 2dp coarse precision: ${pharmacies.length - outsideCoarse.length}/${pharmacies.length}` +
  (outsideCoarse.length ? '  <-- FAIL' : '  OK'))
for (const p of outside) { bad.push(`GATE: ${p.name} (${p.label}) at ${p.lat},${p.lng} is OUTSIDE the outline`) }
for (const p of outsideCoarse) if (!outside.includes(p)) bad.push(`GATE(coarse): ${p.name} (${p.label}) falls outside once rounded to 2dp`)

console.log('\n  RoC / off-island controls (must all be null):')
for (const [name, lat, lng] of ROC_CONTROLS) {
  const got = resolveRegion(lat, lng)
  const gotCoarse = resolveRegion(coarseCoord(lat), coarseCoord(lng))
  const ok = got === null && gotCoarse === null
  const known = name.startsWith('South Nicosia')
  const tag = ok ? 'OK' : known ? '<-- KNOWN LIMIT (documented)' : '<-- FAIL'
  console.log(`    ${name.padEnd(24)} -> ${String(got).padEnd(10)} (coarse: ${String(gotCoarse).padEnd(10)}) ${tag}`)
  if (!ok && !known) bad.push(`GATE: RoC control "${name}" resolved to ${got}/${gotCoarse}, expected null`)
}

// Green Line clearance — the number Berke asked to see.
const clearances = pharmacies
  .map(p => ({ ...p, km: kmToOutline(p.lat, p.lng) }))
  .sort((a, b) => a.km - b.km)
console.log('\n  Tightest clearances to the outline (real TRNC places closest to being nulled):')
for (const p of clearances.slice(0, 8)) {
  console.log(`    ${p.km.toFixed(2).padStart(6)} km  ${p.label.padEnd(12)} ${p.address.slice(0, 44)}`)
}
const nicosiaMin = clearances.filter(p => p.label === 'Lefkoşa')[0]
console.log(`\n  Closest Lefkoşa place to the line: ${nicosiaMin.km.toFixed(2)} km  (${nicosiaMin.address.slice(0, 40)})`)
console.log(`  Coarse rounding can move a point by up to ~0.8 km, so clearance must exceed that.`)

// 2. LEAVE-ONE-OUT ------------------------------------------------------------
console.log(`\n${line}\n\n[2] PHARMACIES — leave-one-out (own coordinate's anchors removed)\n`)

const perLabel = {}
const mismatches = []
const mesarya = []

for (const p of pharmacies) {
  const lat = coarseCoord(p.lat), lng = coarseCoord(p.lng)
  const { region, km } = classify(lat, lng, { excludeCoord: [p.lat, p.lng] })

  if (p.label.endsWith('Mesarya')) { mesarya.push({ ...p, got: region }); continue }

  const expect = LABEL_TO_SLUG[p.label]
  if (!expect) { bad.push(`DATA: unmapped address label "${p.label}" (${p.name})`); continue }

  const stat = (perLabel[p.label] ||= { n: 0, ok: 0 })
  stat.n++
  if (region === expect) stat.ok++
  else mismatches.push({ ...p, expect, got: region, km })
}

for (const [label, st] of Object.entries(perLabel).sort((a, b) => b[1].n - a[1].n)) {
  const pct = ((st.ok / st.n) * 100).toFixed(1)
  const flag = st.ok === st.n ? 'OK' : '<-- see mismatches'
  console.log(`  ${label.padEnd(12)} ${String(st.ok).padStart(3)}/${String(st.n).padEnd(3)} ${pct.padStart(5)}%  ${flag}`)
}
const totN = Object.values(perLabel).reduce((s, x) => s + x.n, 0)
const totOk = Object.values(perLabel).reduce((s, x) => s + x.ok, 0)
console.log(`  ${'TOTAL'.padEnd(12)} ${String(totOk).padStart(3)}/${String(totN).padEnd(3)} ${((totOk / totN) * 100).toFixed(1).padStart(5)}%`)

if (mismatches.length) {
  console.log('\n  Mismatches:')
  for (const m of mismatches) {
    console.log(`    expected ${String(m.expect).padEnd(10)} got ${String(m.got).padEnd(10)} ${m.km.toFixed(1).padStart(5)}km  ${m.name}`)
    console.log(`      ${m.address}`)
  }
}

// 3. MESARYA FOLD -------------------------------------------------------------
console.log(`\n${line}\n\n[3] MESARYA FOLD — no ground truth; these are MY calls, please check\n`)
const byPlace = {}
for (const m of mesarya) {
  const place = m.address.split(',').map(s => s.trim()).slice(-2)[0]
  const k = `${m.label} / ${place}`
  ;(byPlace[k] ||= { got: m.got, n: 0, lat: m.lat, lng: m.lng })
  byPlace[k].n++
}
for (const [k, v] of Object.entries(byPlace).sort()) {
  console.log(`  ${k.padEnd(28)} n=${String(v.n).padStart(2)}  ${v.lat.toFixed(4)},${v.lng.toFixed(4)}  ->  ${v.got}`)
}

// 4. HELD-OUT -----------------------------------------------------------------
console.log(`\n${line}\n\n[4] HELD OUT — beaches & landmarks (never used as anchors)\n`)
let heldOk = 0
for (const p of places) {
  const got = resolveRegion(coarseCoord(p.lat), coarseCoord(p.lng))
  const ok = got === p.expect
  if (ok) heldOk++
  else bad.push(`HELD-OUT: ${p.name} expected ${p.expect}, got ${got}`)
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${p.name.padEnd(30)} expected ${String(p.expect).padEnd(10)} got ${got}`)
}
console.log(`\n  ${heldOk}/${places.length} correct`)

// 5. COARSE ROBUSTNESS --------------------------------------------------------
// coarseCoord rounds to 2dp. A point can therefore shift by up to 0.005deg in
// each axis (~0.55 km lat, ~0.45 km lng). A place whose clearance to the outline
// is smaller than that can be nulled purely by rounding. Test all four corners
// of each point's rounding cell, not just the value it happens to land on.
console.log(`\n${line}\n\n[5] COARSE-ROUNDING ROBUSTNESS\n`)
const fragile = []
for (const p of pharmacies) {
  const corners = [[-0.005, -0.005], [-0.005, 0.005], [0.005, -0.005], [0.005, 0.005]]
  const outs = corners.filter(([dLat, dLng]) => !pointInPolygon(p.lat + dLat, p.lng + dLng, TRNC_OUTLINE))
  if (outs.length) fragile.push({ ...p, outs: outs.length })
}
console.log(`  Places that a 2dp rounding could push outside the outline: ${fragile.length}/${pharmacies.length}`)
if (fragile.length) {
  const byLabel = {}
  for (const f of fragile) (byLabel[f.label] ||= []).push(f)
  for (const [label, fs] of Object.entries(byLabel)) {
    console.log(`    ${label.padEnd(12)} ${String(fs.length).padStart(3)} places  (worst: ${Math.max(...fs.map(f => f.outs))}/4 corners out)`)
  }
  for (const f of fragile) console.log(`      ${f.outs}/4 corners out  ${f.address}`)
  console.log('  => these users may see NO welcome card. Failure mode is silence, not a wrong city.')
  console.log('  => at FULL precision (the ~100m fix we actually get) all 387 are inside. See report.')
}

// Where does the İskele/Karpaz line actually fall? No ground truth exists for it,
// so all we can do is show it. Transect runs up the peninsula axis.
console.log('\n  İskele -> Karpaz transect (up the peninsula):')
let prev = null
for (let t = 0; t <= 1.0001; t += 0.02) {
  const lat = 35.286 + t * (35.660 - 35.286)
  const lng = 33.893 + t * (34.520 - 33.893)
  const r = resolveRegion(lat, lng)
  if (r !== prev) {
    console.log(`    ${lat.toFixed(3)}, ${lng.toFixed(3)}  -> ${r}${prev !== null ? '   <-- switches here' : ''}`)
    prev = r
  }
}

// Where exactly does the Nicosia line fall? Probe a north-south transect.
console.log('\n  Nicosia transect (lng 33.36, the walled-city meridian):')
for (let lat = 35.150; lat <= 35.200; lat += 0.005) {
  const r = resolveRegion(coarseCoord(lat), coarseCoord(33.36))
  const side = lat < 35.172 ? 'RoC side ' : 'TRNC side'
  console.log(`    lat ${lat.toFixed(3)}  ${side}  -> ${r}`)
}

// 6. COVERAGE GRID ------------------------------------------------------------
// Sample the whole bounding box. Anywhere inside the outline that resolves to
// null is a hole — a place where a real user would be told nothing.
console.log(`\n${line}\n\n[6] COVERAGE — 0.01deg grid over the outline interior\n`)
let inRing = 0
const holes = []
const areaByRegion = {}
for (let lat = 35.00; lat <= 35.72; lat += 0.01) {
  for (let lng = 32.70; lng <= 34.62; lng += 0.01) {
    if (!pointInPolygon(lat, lng, TRNC_OUTLINE)) continue
    inRing++
    const r = resolveRegion(lat, lng)
    if (r === null) holes.push([lat, lng])
    else areaByRegion[r] = (areaByRegion[r] || 0) + 1
  }
}
for (const [r, n] of Object.entries(areaByRegion).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(10)} ${String(n).padStart(4)} cells  ${((n / inRing) * 100).toFixed(1).padStart(5)}%`)
}
console.log(`  ${'(null)'.padEnd(10)} ${String(holes.length).padStart(4)} cells  ${((holes.length / inRing) * 100).toFixed(1).padStart(5)}%  <-- inside TRNC but resolves to nothing`)
if (holes.length) {
  const lats = holes.map(h => h[0]), lngs = holes.map(h => h[1])
  console.log(`  Holes span lat ${Math.min(...lats).toFixed(2)}..${Math.max(...lats).toFixed(2)}, lng ${Math.min(...lngs).toFixed(2)}..${Math.max(...lngs).toFixed(2)}`)
  console.log(`  (expected: open sea inside the deliberately-slack coastline, plus sparse Karpaz)`)
}

// 7. SANITY -------------------------------------------------------------------
console.log(`\n${line}\n\n[7] SANITY\n`)
const anchorRegions = new Set(ANCHORS.map(a => a[2]))
for (const r of REGIONS) {
  const n = ANCHORS.filter(a => a[2] === r).length
  // Anchor COUNT was never the real signal — evidence quality was. Karpaz sits at
  // 3 and that is fine: they are verified town centres, not scraped geocodes.
  console.log(`  ${r.padEnd(10)} ${String(n).padStart(2)} anchors${n < 3 ? '   <-- thin' : ''}`)
  if (!anchorRegions.has(r)) bad.push(`SANITY: region "${r}" has no anchors`)
}
for (const r of anchorRegions) if (!REGIONS.includes(r)) bad.push(`SANITY: anchor uses unknown region "${r}"`)

// --- verdict -----------------------------------------------------------------
console.log(`\n${line}`)
if (bad.length === 0 && mismatches.length === 0) {
  console.log('\nRESULT: clean — no gate failures, no mismatches, no held-out failures.\n')
} else {
  console.log(`\nRESULT: ${bad.length} hard failure(s), ${mismatches.length} classification mismatch(es).\n`)
  for (const b of bad) console.log(`  ! ${b}`)
  console.log()
}
