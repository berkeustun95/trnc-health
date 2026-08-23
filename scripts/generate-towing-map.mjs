#!/usr/bin/env node
// ─── Coverage-map raster generator ───────────────────────────────────────────
//
//   node scripts/generate-towing-map.mjs          # regenerate assets/towing-map/*.png
//   node scripts/generate-towing-map.mjs --check   # verify only, write nothing (CI-safe)
//
// WHY PNGs AND NOT SVG: react-native-svg is NOT in this project — it is absent from
// package.json, from node_modules, and has ZERO occurrences in package-lock.json. Adding
// it means a native module, a new AAB, and a Play Store rollout before MODULE_FLAGS.towing
// could ever be flipped, which breaks the module's OTA-only constraint.
//
// The trap that settled it: react-native-svg ships INSIDE the Expo Go app. Adding it
// would render perfectly on the SDK-54 test phone and then crash the production
// standalone build the moment the OTA landed, because that binary contains no such
// native module. "It worked on the test phone" is a FALSE POSITIVE for this dependency.
//
// So the polygons are rasterised here, at build time, into flat masks that CoverageMap
// stacks as plain <Image>s. Renders offline, no tiles, no network, no native code.
//
// ─── SWAPPING IN A CORRECTED TRNC SHAPE ─────────────────────────────────────
// The polygons currently in constants/towing.js were drawn freehand for the design
// mockup. They are NOT real geography and are known to be wrong. A corrected shape is
// being sourced. Do NOT redraw them by eye in the meantime — a plausible-looking wrong
// coastline is harder to spot than an obviously schematic one.
//
// When the real shape arrives it is a DATA edit, not a code edit:
//   1. Replace MAP_POLYGONS in constants/towing.js. Keep the same seven keys and keep
//      MAP_VIEWBOX consistent with the new coordinate space.
//   2. Move MAP_LABEL_ANCHORS to match — they are in the same viewBox space, and a new
//      outline will put the old anchors in the wrong place or outside their region.
//   3. node scripts/generate-towing-map.mjs      (rewrites all 8 PNGs)
//   4. node scripts/generate-towing-map.mjs --check   (must be clean)
//   5. Look at it on device. The drift guard checks KEYS, not geography — it cannot
//      tell a correct coastline from a wrong one.
// Verified reversible: regenerating from unchanged constants reproduces byte-identical
// PNGs, so a bad shape can be reverted with `git checkout` plus one regenerate.
//
// LABELS ARE DELIBERATELY NOT BAKED IN. They are RN <Text> at runtime, positioned from
// MAP_LABEL_ANCHORS and translated per locale. Baking them would (a) need 9 locales x 8
// files and (b) hide exactly the drift this script exists to catch.

import sharp from 'sharp'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGIONS } from '../constants/regions.js'
import { MAP_POLYGONS, MAP_VIEWBOX, assertMapKeysMatchRegions } from '../constants/towing.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = resolve(ROOT, 'assets/towing-map')
const checkOnly = process.argv.includes('--check')

// ─── Palette ────────────────────────────────────────────────────────────────
// TEAL is colors.primary from constants/theme.js. SAND has no theme equivalent — it is
// the mockup's uncovered fill and is mirrored into theme.js as `colors.sand` so the
// legend swatch and the map agree. If you change one, change both.
const SAND   = '#EFEBE2'
const TEAL   = '#0E7C7B'
const STROKE = '#FFFFFF'
const STROKE_W = 2.5
const SCALE  = 3   // ONE density. 3x downscales cleanly on every phone we support and
                   // keeps this at 8 files instead of 24.

// ─── Drift guards — the whole point of committing this script ───────────────
function assertNoDrift() {
  assertMapKeysMatchRegions()          // polygons + label anchors vs canonical REGIONS

  // Both directions, as required: a region with no mask, AND a mask with no region.
  const expected = new Set(['base.png', ...REGIONS.map(r => `${r}.png`)])
  const actual   = existsSync(OUT)
    ? new Set(readdirSync(OUT).filter(f => f.endsWith('.png')))
    : new Set()

  const missing = [...expected].filter(f => !actual.has(f))
  const orphan  = [...actual].filter(f => !expected.has(f))
  const problems = []
  if (missing.length) problems.push(`region has no mask file: ${missing.join(', ')}`)
  if (orphan.length)  problems.push(`mask file has no matching region key: ${orphan.join(', ')}`)
  if (problems.length) {
    console.error('')
    console.error('  ┌─ COVERAGE MAP DRIFT ───────────────────────────────────────────┐')
    for (const p of problems) console.error(`  │ ${p}`)
    console.error('  └────────────────────────────────────────────────────────────────┘')
    console.error('')
    console.error('  The map and the region resolver have diverged. A missing mask does NOT')
    console.error('  throw at runtime — the region simply renders as uncovered, which on an')
    console.error('  emergency screen is a quietly wrong answer. Fix the keys, then re-run:')
    console.error('      node scripts/generate-towing-map.mjs')
    console.error('')
    process.exit(1)
  }
}

// ─── SVG builders ───────────────────────────────────────────────────────────
const { width: W, height: H } = MAP_VIEWBOX

// width/height ONLY — do NOT also pass sharp a `density`. librsvg applies both, and the
// output silently comes out at SCALE^2. Measured: a "3x" render landed at 9180x3240.
const svg = inner =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * SCALE}" height="${H * SCALE}">${inner}</svg>`

// Every polygon carries its own white stroke, on the base AND on each overlay. Stroke is
// centred on the path, so an overlay filling only to its edge would cover the inner half
// of the base's stroke and leave 1.25px borders on covered regions against 2.5px
// elsewhere. Drawing the stroke on both keeps every border identical whatever is covered.
const poly = (pts, fill) =>
  `<polygon points="${pts}" fill="${fill}" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linejoin="round"/>`

async function render(inner) {
  return sharp(Buffer.from(svg(inner)))
    .png({ compressionLevel: 9, effort: 10 })   // lossless: the whole set is ~70KB, so
    .toBuffer()                                 // there is no reason to quantise
}

// ─── Run ────────────────────────────────────────────────────────────────────
if (!checkOnly) mkdirSync(OUT, { recursive: true })
if (checkOnly) assertNoDrift()

const files = []
const base = REGIONS.map(r => poly(MAP_POLYGONS[r], SAND)).join('')
files.push(['base.png', await render(base)])
for (const r of REGIONS) files.push([`${r}.png`, await render(poly(MAP_POLYGONS[r], TEAL))])

let total = 0
for (const [name, buf] of files) {
  const path = resolve(OUT, name)
  total += buf.length
  if (checkOnly) {
    const on = statSync(path).size
    if (on !== buf.length) {
      console.error(`STALE: ${name} on disk is ${on}B, regenerating gives ${buf.length}B — run without --check`)
      process.exit(1)
    }
  } else {
    writeFileSync(path, buf)
  }
}

if (!checkOnly) assertNoDrift()   // after writing, so a rename leaves an orphan visible

const m = await sharp(files[0][1]).metadata()
console.log(`${checkOnly ? 'checked' : 'wrote'} ${files.length} files -> assets/towing-map/`)
console.log(`  raster ${m.width}x${m.height} (${SCALE}x of ${W}x${H})`)
console.log(`  total  ${(total / 1024).toFixed(1)} KB`)
for (const [name, buf] of files) console.log(`    ${name.padEnd(14)} ${(buf.length / 1024).toFixed(1).padStart(5)} KB`)
