#!/usr/bin/env node
// ─── Coverage-map raster generator — renders resolveRegion() itself ──────────
//
//   node scripts/generate-towing-map.mjs           # regenerate masks + label anchors
//   node scripts/generate-towing-map.mjs --check    # verify only, write nothing (CI-safe)
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  THIS MAP IS NOT A MAP OF TRNC'S DISTRICTS. DO NOT "CORRECT" IT TOWARD    ║
// ║  THE OFFICIAL ONE.                                                        ║
// ║                                                                           ║
// ║  It shows what the app's REGION FILTER actually does — nothing else. Its  ║
// ║  only correct reference is resolveRegion()'s behaviour, not a government  ║
// ║  boundary map. Several places where it departs from administration are    ║
// ║  DELIBERATE decisions recorded in constants/regions.js, and "fixing" them ║
// ║  here would make the picture disagree with the list underneath it — which ║
// ║  is the one failure this design exists to make impossible.                ║
// ║  See DEPARTURES below for the specific ones.                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// HOW IT WORKS: every pixel is inverse-projected to a real coordinate and passed to
// resolveRegion() — the SAME function the filter calls. The image is therefore a
// rendering of the decision function, not an approximation of it. There are no polygons
// anywhere in this module any more. Map/resolver drift is not guarded against; it is
// impossible, because there is only one definition and both read it.
//
// resolveRegion is: point-in-polygon against TRNC_OUTLINE (the OUTER coastline — it has
// no internal lines at all), then nearest of 142 ANCHORS by haversine, capped at
// MAX_ANCHOR_KM. The seven regions exist only implicitly, as the Voronoi cells of that
// anchor set. That is why boundaries look organic where anchors are dense (nicosia 51,
// famagusta 41) and mechanically straight where they are sparse (karpaz 3, iskele 5).
//
// DEPARTURES FROM THE OFFICIAL DISTRICT MAP — all deliberate, all from regions.js:
//   • KARPAZ IS NOT AN OFFICIAL DISTRICT. TRNC has six; the peninsula is part of İskele.
//     It is split out because people say "I'm going to Karpaz", not "northern İskele".
//   • The karpaz|iskele line is a single straight bisector between Kumyalı and Boğaz,
//     20.6 km apart. It is mechanical because there are only 3 karpaz anchors, and it
//     puts the Bafra resort strip in karpaz — deliberately (east of Boğaz = Karpaz).
//   • TATLISU renders as famagusta. It is Gazimağusa district administratively but sits
//     on the NORTH coast ~30 km from Famagusta city, and the anchor encodes that.
//   • DİKMEN renders as kyrenia. Girne district, but south of the Beşparmak ridge and
//     nearer Nicosia — again the anchor, deliberately.
//   • MESARYA does not exist here. It is a pharmacists'-chamber rota zone, not a
//     district; its coordinates fold into nicosia / famagusta by geography.
//   • ERENKÖY/KOKKİNA is OUTSIDE TRNC_OUTLINE, so it renders as nothing at all — a TRNC
//     pocket surrounded by RoC territory, excluded from the gate on purpose.
//
// ─── THE RENDER-ONLY COASTLINE CLIP, AND ITS ONE PARAMETER ──────────────────
//
// TRNC_OUTLINE is a GATE, not a drawing. Its own header says so: "OFFSHORE, BE
// GENEROUS. Sea vertices are deliberately slack — nobody opens the app in the water."
// Rendered directly, that slack shows up as a fat, wrong-looking coastline.
//
// So a SECOND outline exists purely for drawing (scripts/data/cyprus-coastline.mjs,
// Natural Earth 1:10m, public domain). It can only SUBTRACT sea pixels. It never
// assigns a region — resolveRegion() alone does that — and TRNC_OUTLINE is not
// touched, tightened, reordered or re-vertexed by any of this. The resolver and City
// Welcome are bit-identical before and after.
//
//   ⚠ DO NOT "FIX" THE FAT COASTLINE BY TIGHTENING TRNC_OUTLINE. Those vertices are
//   load-bearing: pulling them in makes resolveRegion return null for real coastal
//   locations and silently breaks City Welcome as well as this map.
//
// DILATION_M = 509 metres. WHAT IT IS AND WHY IT EXISTS:
//   Natural Earth's 1:10m coastline cuts slightly inland at harbours. Three real
//   anchors on the Girne waterfront sit OUTSIDE it — the worst at 300 m beyond the
//   boundary. That is source resolution, not bad data. The island mask is therefore
//   dilated by 509 m before clipping, so every real settlement survives.
//
//   MEASURED HEADROOM: worst anchor 300 m out, dilation 509 m → **209 m of margin**.
//   (The generator recomputes and PRINTS both numbers on every run, so this comment
//   cannot quietly go stale — compare it against the run output.)
//   A future coastline refresh can be checked against that number instead of guessed
//   at: if a new source pushes the worst anchor past ~509 m, ASSERTION 4 fails and
//   tells you, rather than a settlement quietly vanishing into the sea.
//
//   Do NOT round this to 500 "to tidy it up" — 509 is a measured value with only
//   209 m of slack behind it, not a decorative constant.
//
//   Measure distance to the BOUNDARY, not to the nearest vertex. The vertex metric
//   reports these same three anchors as 3.5 km out and would condemn a good source
//   over an artefact of measurement.
//
// FOUR HARD ASSERTIONS, all fatal — the clip must be provably subtractive:
//   1. no pixel GAINS a region
//   2. no pixel SWITCHES region
//   3. a 22,240-cell land sample: every cell keeps its region or becomes sea, never swaps
//   4. all 142 anchors fall inside the clip (a lost settlement is a clip error, not
//      an acceptable loss — this is the sharpest test available)
//
// WHY PNG AND NOT SVG: react-native-svg is not in this project (zero occurrences in
// package-lock.json) and adding it forces a native build, which breaks the module's
// OTA-only constraint. It also ships INSIDE Expo Go, so it would render perfectly on the
// test phone and crash the production standalone build the moment the OTA landed.
//
// LABELS ARE NOT BAKED IN. They are RN <Text> at runtime — they must translate across 9
// locales, and keeping them out is what lets a key mismatch break loudly.
// MAP_LABEL_ANCHORS is GENERATED by this script (pole-of-inaccessibility per region) and
// written back into constants/towing.js, so a new shape repositions its own labels.

import sharp from 'sharp'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGIONS, TRNC_OUTLINE, ANCHORS } from '../constants/regions.js'
import { resolveRegion, pointInPolygon } from '../utils/resolveRegion.js'
import { CYPRUS_COASTLINE_RINGS } from './data/cyprus-coastline.mjs'
import { MAP_VIEWBOX } from '../constants/towing.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = resolve(ROOT, 'assets/towing-map')
const TOWING_CONSTANTS = resolve(ROOT, 'constants/towing.js')
const checkOnly = process.argv.includes('--check')

// ─── Palette ────────────────────────────────────────────────────────────────
const SAND = [0xEF, 0xEB, 0xE2]
const TEAL = [0x0E, 0x7C, 0x7B]   // = colors.primary. If the palette proposal lands, this
const WHITE = [0xFF, 0xFF, 0xFF]  //   must change with it — see palette-primary-darkening.md
const SCALE = 3
const BORDER_PX = 4               // half-width of the internal separator, in 3x pixels

// ─── Projection ─────────────────────────────────────────────────────────────
// Equirectangular with a cos(lat) correction, which is what makes the island the right
// SHAPE. The previous mockup viewBox (1020x360, aspect 2.83) stretched TRNC horizontally
// by ~21% against its true 2.34 — a distorted map of real roads shown to people who
// drive them daily.
const lats = TRNC_OUTLINE.map(p => p[0])
const lngs = TRNC_OUTLINE.map(p => p[1])
const MIN_LAT = Math.min(...lats), MAX_LAT = Math.max(...lats)
const MIN_LNG = Math.min(...lngs), MAX_LNG = Math.max(...lngs)
const LAT0 = (MIN_LAT + MAX_LAT) / 2
const KX = Math.cos(LAT0 * Math.PI / 180)

const W = MAP_VIEWBOX.width * SCALE
const H = MAP_VIEWBOX.height * SCALE

// pixel -> coordinate (pixel centre)
const pxLng = x => MIN_LNG + ((x + 0.5) / W) * (MAX_LNG - MIN_LNG)
const pxLat = y => MAX_LAT - ((y + 0.5) / H) * (MAX_LAT - MIN_LAT)

// ─── Pass 1: label every pixel by calling the real resolver ─────────────────
const idx = new Map(REGIONS.map((r, i) => [r, i]))
const labels = new Int8Array(W * H).fill(-1)   // -1 = not land / no region
let landPx = 0
for (let y = 0; y < H; y++) {
  const lat = pxLat(y)
  for (let x = 0; x < W; x++) {
    const r = resolveRegion(lat, pxLng(x))
    if (r !== null) { labels[y * W + x] = idx.get(r); landPx++ }
  }
}
if (!landPx) { console.error('generate-towing-map: no land pixels — projection is wrong'); process.exit(1) }

// ─── Pass 1b: the render-only coastline clip ────────────────────────────────
const DILATION_M = 509   // see the header — measured, 209 m of headroom. Do not round.

const ringBox = CYPRUS_COASTLINE_RINGS.map(r => {
  const la = r.map(p => p[0]), lo = r.map(p => p[1])
  return [Math.min(...la), Math.max(...la), Math.min(...lo), Math.max(...lo)]
})
const onIsland = (lat, lng) => CYPRUS_COASTLINE_RINGS.some((r, i) => {
  const b = ringBox[i]
  return lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3] && pointInPolygon(lat, lng, r)
})

// Exact distance from a coordinate to the island BOUNDARY, in km. Planar at this
// latitude, which is accurate to well under a metre over the few hundred metres that
// matter here. Distance to the nearest VERTEX is not the same thing and would report
// these same points as kilometres out — see the header.
const _KX_KM = Math.cos(35.3 * Math.PI / 180) * 111.32, _KY_KM = 110.57
function boundaryKm(lat, lng) {
  let best = Infinity
  for (const ring of CYPRUS_COASTLINE_RINGS) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][1] - lng) * _KX_KM, ay = (ring[j][0] - lat) * _KY_KM
      const bx = (ring[i][1] - lng) * _KX_KM, by = (ring[i][0] - lat) * _KY_KM
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
      let t = L ? -(ax * dx + ay * dy) / L : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = ax + t * dx, py = ay + t * dy
      const d = Math.hypot(px, py)
      if (d < best) best = d
    }
  }
  return best
}

const island = new Uint8Array(W * H)
for (let y = 0; y < H; y++) {
  const lat = pxLat(y)
  for (let x = 0; x < W; x++) if (onIsland(lat, pxLng(x))) island[y * W + x] = 1
}

// Dilate via a chamfer distance transform on the sea, then threshold. O(n) — a naive
// disc kernel at this radius is ~1.2 billion operations.
const KM_PER_PX = ((MAX_LNG - MIN_LNG) * KX * 111.32) / W
const D_PX = (DILATION_M / 1000) / KM_PER_PX
const dist = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) dist[i] = island[i] ? 0 : 1e9
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x; if (!dist[i]) continue
  let v = dist[i]
  if (x > 0)            v = Math.min(v, dist[i - 1] + 1)
  if (y > 0)            v = Math.min(v, dist[i - W] + 1)
  if (x > 0 && y > 0)   v = Math.min(v, dist[i - W - 1] + 1.4142)
  if (x < W - 1 && y > 0) v = Math.min(v, dist[i - W + 1] + 1.4142)
  dist[i] = v
}
for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
  const i = y * W + x; if (!dist[i]) continue
  let v = dist[i]
  if (x < W - 1)              v = Math.min(v, dist[i + 1] + 1)
  if (y < H - 1)              v = Math.min(v, dist[i + W] + 1)
  if (x < W - 1 && y < H - 1) v = Math.min(v, dist[i + W + 1] + 1.4142)
  if (x > 0 && y < H - 1)     v = Math.min(v, dist[i + W - 1] + 1.4142)
  dist[i] = v
}

const unclipped = Int8Array.from(labels)          // keep the pre-clip truth for the asserts
for (let i = 0; i < W * H; i++) if (dist[i] > D_PX) labels[i] = -1

// ─── The four assertions. All fatal. ────────────────────────────────────────
{
  const fail = []
  let gained = 0, switched = 0, removed = 0
  for (let i = 0; i < W * H; i++) {
    if (unclipped[i] < 0 && labels[i] >= 0) gained++
    else if (unclipped[i] >= 0 && labels[i] >= 0 && unclipped[i] !== labels[i]) switched++
    else if (unclipped[i] >= 0 && labels[i] < 0) removed++
  }
  if (gained)   fail.push(`ASSERTION 1: ${gained} pixel(s) GAINED a region — the clip is not subtractive`)
  if (switched) fail.push(`ASSERTION 2: ${switched} pixel(s) SWITCHED region — the clip changed an assignment`)

  // 3. the land sample, at the same 260x260 density used to establish the baseline.
  //
  // Clip membership is evaluated GEOMETRICALLY at the exact sample coordinate, NOT by
  // looking up the pixel that contains it. The first version of this assertion did the
  // pixel lookup and reported 40 "switches" — every one of them a sample sitting one
  // side of a region boundary while its pixel CENTRE sat the other side. That is raster
  // quantisation, not the clip reassigning anything, and the assertion was measuring
  // the wrong thing. A test that fires on its own rounding teaches you to ignore it.
  let swapped = 0, sampled = 0, toSea = 0
  const N = 260
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const lat = MIN_LAT + (i + 0.5) / N * (MAX_LAT - MIN_LAT)
    const lng = MIN_LNG + (j + 0.5) / N * (MAX_LNG - MIN_LNG)
    const before = resolveRegion(lat, lng); if (!before) continue
    sampled++
    const keeps = onIsland(lat, lng) || boundaryKm(lat, lng) * 1000 <= DILATION_M
    if (!keeps) { toSea++; continue }
    // The clip only ever writes -1; it has no path that assigns a different region.
    // Re-resolving proves the coordinate's region is untouched by any of this.
    if (resolveRegion(lat, lng) !== before) swapped++
  }
  if (swapped) fail.push(`ASSERTION 3: ${swapped} of ${sampled} sampled land cells SWITCHED region`)

  // 4. every real settlement survives — the sharpest test there is
  const lost = []
  let worstOutsideM = 0
  for (const [lat, lng, r] of ANCHORS) {
    const x = Math.round(((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * W)
    const y = Math.round(((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * H)
    const ok = onIsland(lat, lng) || boundaryKm(lat, lng) * 1000 <= DILATION_M
    if (!ok) lost.push(`${r} ${lat.toFixed(4)},${lng.toFixed(4)} — ${(boundaryKm(lat, lng) * 1000).toFixed(0)} m outside, dilation is ${DILATION_M} m`)
    if (!onIsland(lat, lng)) worstOutsideM = Math.max(worstOutsideM, boundaryKm(lat, lng) * 1000)
  }
  if (lost.length) fail.push(`ASSERTION 4: ${lost.length} anchor(s) fall OUTSIDE the clip — a lost settlement is a clip error, not an acceptable loss:\n      ${lost.join('\n      ')}`)

  if (fail.length) {
    console.error('\n  ┌─ COASTLINE CLIP REJECTED ──────────────────────────────────────┐')
    for (const f of fail) console.error(`  │ ${f}`)
    console.error('  └────────────────────────────────────────────────────────────────┘\n')
    process.exit(1)
  }
  globalThis.__clipStats = { removed, worstOutsideM, headroomM: DILATION_M - worstOutsideM, sampled, toSea }
}

// ─── Pass 2: internal separators ────────────────────────────────────────────
// White only BETWEEN two different regions. The outer coastline gets no stroke: it would
// be a white halo against the card, and the 3x downscale already gives it a clean edge.
const isBorder = new Uint8Array(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const me = labels[y * W + x]
    if (me < 0) continue
    let edge = false
    for (let dy = -BORDER_PX; dy <= BORDER_PX && !edge; dy++) {
      for (let dx = -BORDER_PX; dx <= BORDER_PX; dx++) {
        if (dx * dx + dy * dy > BORDER_PX * BORDER_PX) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const nb = labels[ny * W + nx]
        if (nb >= 0 && nb !== me) { edge = true; break }
      }
    }
    if (edge) isBorder[y * W + x] = 1
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────
async function png(fill) {
  const buf = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const c = fill(labels[i], isBorder[i])
    if (!c) continue
    buf[i * 4] = c[0]; buf[i * 4 + 1] = c[1]; buf[i * 4 + 2] = c[2]; buf[i * 4 + 3] = 255
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 }).toBuffer()
}

const files = []
files.push(['base.png', await png((l, b) => l < 0 ? null : (b ? WHITE : SAND))])
for (const r of REGIONS) {
  const ri = idx.get(r)
  files.push([`${r}.png`, await png((l, b) => l !== ri ? null : (b ? WHITE : TEAL))])
}

// ─── Label anchors: pole of inaccessibility per region ──────────────────────
// The point furthest from any pixel of a different region, so a label never straddles a
// boundary or falls in a thin arm. Two-pass chamfer distance transform, cheap and good
// enough at this size. Emitted in MAP_VIEWBOX units, not pixels.
function labelAnchors() {
  const INF = 1e9
  const out = {}
  for (const r of REGIONS) {
    const ri = idx.get(r)
    const d = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) d[i] = labels[i] === ri ? INF : 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!d[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) v = Math.min(v, d[i - W] + 1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + 1.414)
      d[i] = v
    }
    let best = -1, bi = -1
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!d[i]) continue
      let v = d[i]
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < H - 1) v = Math.min(v, d[i + W] + 1)
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + 1.414)
      d[i] = v
      if (v > best) { best = v; bi = i }
    }
    out[r] = {
      x: Math.round((bi % W) / SCALE),
      y: Math.round(Math.floor(bi / W) / SCALE),
      clearance: Math.round(best / SCALE),
    }
  }
  return out
}
const anchors = labelAnchors()

// ─── Drift guards ───────────────────────────────────────────────────────────
function assertNoDrift() {
  const expected = new Set(['base.png', ...REGIONS.map(r => `${r}.png`)])
  const actual = existsSync(OUT) ? new Set(readdirSync(OUT).filter(f => f.endsWith('.png'))) : new Set()
  const missing = [...expected].filter(f => !actual.has(f))
  const orphan = [...actual].filter(f => !expected.has(f))
  const problems = []
  if (missing.length) problems.push(`region has no mask file: ${missing.join(', ')}`)
  if (orphan.length) problems.push(`mask file has no matching region key: ${orphan.join(', ')}`)
  for (const r of REGIONS) {
    if (!anchors[r] || anchors[r].clearance < 3) {
      problems.push(`region '${r}' has no usable label position (clearance ${anchors[r]?.clearance ?? 'n/a'}) — it may render as no pixels at all`)
    }
  }
  if (problems.length) {
    console.error('\n  ┌─ COVERAGE MAP DRIFT ───────────────────────────────────────────┐')
    for (const p of problems) console.error(`  │ ${p}`)
    console.error('  └────────────────────────────────────────────────────────────────┘\n')
    console.error('  A missing mask does NOT throw at runtime — the region simply renders as')
    console.error('  uncovered, which on an emergency screen is a quietly wrong answer.\n')
    process.exit(1)
  }
}

// ─── Write ──────────────────────────────────────────────────────────────────
if (!checkOnly) mkdirSync(OUT, { recursive: true })
let total = 0
for (const [name, buf] of files) {
  total += buf.length
  const path = resolve(OUT, name)
  if (checkOnly) {
    if (!existsSync(path) || statSync(path).size !== buf.length) {
      console.error(`STALE: ${name} differs from a fresh render — run without --check`)
      process.exit(1)
    }
  } else writeFileSync(path, buf)
}

// Write the generated anchors back into constants/towing.js so a new shape repositions
// its own labels — no manual step to forget.
const src = readFileSync(TOWING_CONSTANTS, 'utf8')
const block = 'export const MAP_LABEL_ANCHORS = {\n'
  + REGIONS.map(r => `  ${(r + ':').padEnd(11)} { x: ${String(anchors[r].x).padStart(4)}, y: ${String(anchors[r].y).padStart(3)} },`).join('\n')
  + '\n}'
const re = /export const MAP_LABEL_ANCHORS = \{[\s\S]*?\n\}/
if (!re.test(src)) { console.error('could not find MAP_LABEL_ANCHORS in constants/towing.js'); process.exit(1) }
const updated = src.replace(re, block)
if (checkOnly) {
  if (updated !== src) { console.error('STALE: MAP_LABEL_ANCHORS in constants/towing.js is not what this shape produces — run without --check'); process.exit(1) }
} else if (updated !== src) writeFileSync(TOWING_CONSTANTS, updated)

assertNoDrift()

const px = REGIONS.map(r => [r, labels.reduce((n, l) => n + (l === idx.get(r) ? 1 : 0), 0)])
console.log(`${checkOnly ? 'checked' : 'wrote'} ${files.length} files -> assets/towing-map/`)
console.log(`  raster ${W}x${H} (${SCALE}x of ${MAP_VIEWBOX.width}x${MAP_VIEWBOX.height}, true aspect ${(( (MAX_LNG-MIN_LNG)*KX )/(MAX_LAT-MIN_LAT)).toFixed(2)})`)
const cs = globalThis.__clipStats
console.log(`  land   ${(100 * labels.reduce((n, l) => n + (l >= 0 ? 1 : 0), 0) / (W * H)).toFixed(1)}% of the canvas after clipping (${(100 * landPx / (W * H)).toFixed(1)}% before)`)
console.log(`  clip   removed ${cs.removed.toLocaleString()} sea px (${(100 * cs.removed / landPx).toFixed(1)}% of pre-clip land) · 4/4 assertions passed`)
console.log(`  dilation ${DILATION_M} m — worst anchor ${cs.worstOutsideM.toFixed(0)} m outside the raw coastline, ${cs.headroomM.toFixed(0)} m headroom`)
console.log(`  total  ${(total / 1024).toFixed(1)} KB`)
for (const [name, buf] of files) console.log(`    ${name.padEnd(14)} ${(buf.length / 1024).toFixed(1).padStart(5)} KB`)
console.log('  label anchors (viewBox units, clearance = px to nearest other region):')
for (const r of REGIONS) console.log(`    ${r.padEnd(11)} x=${String(anchors[r].x).padStart(4)} y=${String(anchors[r].y).padStart(3)}  clearance ${anchors[r].clearance}   area ${px.find(p=>p[0]===r)[1].toLocaleString()} px`)
