// Çekici & Yol Yardım — module constants.
//
// Region keys are NOT redefined here. They come from constants/regions.js (REGIONS,
// REGION_LABEL_KEY), which is the same source the offline resolver, the DB CHECK
// constraints and the coverage map all use. A second copy is exactly how the map and
// the filter would silently drift apart.
// Extension is explicit (most of the app omits it) so plain Node can import this
// module — scripts/generate-towing-map.mjs reads the polygons from here rather than
// keeping a copy. Same reason utils/resolveRegion.js spells its imports out. Metro
// resolves both forms.
import { REGIONS } from './regions.js'

// ─── Vehicle classes — EXACTLY TWO ──────────────────────────────────────────
// 'car'   covers otomobil, hafif ticari AND motosiklet
// 'heavy' covers kamyon / otobüs
// `İş makinesi` is a SERVICE tag (machinery_transport), not a third class. Adding a
// third here would also violate towing_vehicle_classes_check in the DB.
export const VEHICLE_CLASSES = [
  { key: 'car',   labelKey: 'towingClassCar' },
  { key: 'heavy', labelKey: 'towingClassHeavy' },
]
export const DEFAULT_VEHICLE_CLASS = 'car'

// Sub-types listed on the DETAIL screen only, to make plain what 'car' includes. These
// are display-only — they are not stored and never filter.
export const CAR_SUBTYPES   = ['towingSubCar', 'towingSubLightCommercial', 'towingSubMotorcycle']
export const HEAVY_SUBTYPES = ['towingSubTruck', 'towingSubBus']

// ─── Services ───────────────────────────────────────────────────────────────
// Keys must match towing_services_check in 20260905_towing_companies.sql.
export const SERVICES = [
  { key: 'towing',              labelKey: 'towingSvcTowing' },
  { key: 'tyre',                labelKey: 'towingSvcTyre' },
  { key: 'battery',             labelKey: 'towingSvcBattery' },
  { key: 'fuel',                labelKey: 'towingSvcFuel' },
  { key: 'recovery',            labelKey: 'towingSvcRecovery' },
  { key: 'vehicle_transport',   labelKey: 'towingSvcVehicleTransport' },
  { key: 'machinery_transport', labelKey: 'towingSvcMachineryTransport' },
]
export const SERVICE_ORDER = SERVICES.map(s => s.key)
const SERVICE_LABEL = Object.fromEntries(SERVICES.map(s => [s.key, s.labelKey]))
export const serviceLabelKey = key => SERVICE_LABEL[key] || key

// ─── Coverage map geometry ──────────────────────────────────────────────────
//
// Lifted verbatim from the design mockup (ada-cekici-mockup.html), viewBox 0 0 1020 360,
// and mapped to canonical region keys by which <text> label sits inside each polygon.
//
// THE POLYGONS THEMSELVES ARE NOT USED AT RUNTIME. React Native cannot draw a polygon
// without react-native-svg, which this project does not have and cannot add without a
// native build (see the module log). scripts/generate-towing-map.mjs rasterises these
// into PNG masks at build time; CoverageMap stacks the masks. They live here so the
// generator, the drift check and the label positions all read one source.
export const MAP_VIEWBOX = { width: 1020, height: 360 }

export const MAP_POLYGONS = {
  lefke:     '40,215 120,150 150,160 160,250 100,250',
  morphou:   '120,150 250,120 265,150 270,255 160,250 150,160',
  kyrenia:   '250,120 330,95 430,105 520,140 500,185 400,175 300,170 265,150',
  nicosia:   '265,150 300,170 400,175 500,185 490,255 380,290 300,265 270,255',
  famagusta: '500,185 610,175 620,255 620,300 560,325 470,320 380,290 490,255',
  iskele:    '610,175 700,190 740,235 660,250 620,255',
  karpaz:    '700,190 790,140 870,85 950,35 985,60 900,140 820,200 740,235',
}

// Label anchor points, in the SAME viewBox space, from the mockup's <text> x/y.
// CoverageMap converts these to percentages so the labels track the image at any width.
// The mockup anchors text at its LEFT baseline; these are converted to CENTRES so an RN
// <Text> can be centred on them regardless of how long the translated label is.
export const MAP_LABEL_ANCHORS = {
  lefke:     { x: 103, y: 207 },
  morphou:   { x: 213, y: 195 },
  kyrenia:   { x: 372, y: 137 },
  nicosia:   { x: 378, y: 223 },
  famagusta: { x: 505, y: 267 },
  iskele:    { x: 668, y: 217 },
  karpaz:    { x: 838, y: 145 },
}

// ─── The drift guard the whole map design rests on ──────────────────────────
//
// If a polygon key ever stops matching a canonical region key, the auto-detected region
// simply finds no mask and the map renders as if the firm covers nothing — no error, no
// crash, just a quietly wrong answer on an emergency screen. So it is asserted rather
// than assumed, in TWO places: here at import time (so the app cannot boot with a
// drifted key), and in scripts/generate-towing-map.mjs, which additionally checks the
// mask FILES both ways — a region with no mask, and a mask with no region. Verify
// without rewriting: `node scripts/generate-towing-map.mjs --check`.
export function assertMapKeysMatchRegions() {
  const poly   = Object.keys(MAP_POLYGONS).sort()
  const labels = Object.keys(MAP_LABEL_ANCHORS).sort()
  const canon  = [...REGIONS].sort()
  const problems = []
  if (JSON.stringify(poly) !== JSON.stringify(canon)) {
    problems.push(`MAP_POLYGONS keys [${poly}] != REGIONS [${canon}]`)
  }
  if (JSON.stringify(labels) !== JSON.stringify(canon)) {
    problems.push(`MAP_LABEL_ANCHORS keys [${labels}] != REGIONS [${canon}]`)
  }
  if (problems.length) throw new Error(`towing coverage map drift:\n  ${problems.join('\n  ')}`)
  return true
}

// Runs on import. A drift here must break loudly and immediately, not at render.
assertMapKeysMatchRegions()
