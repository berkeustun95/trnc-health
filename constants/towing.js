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
// 1020 x 436 is TRUE equirectangular aspect (2.34) for TRNC at lat 35.4°. The design
// mockup used 1020 x 360 (2.83), which stretched the island horizontally by ~21% — a
// distorted map of real roads, shown to people who drive them daily.
export const MAP_VIEWBOX = { width: 1020, height: 436 }

// NO POLYGONS. The coverage map is rendered per-pixel by evaluating resolveRegion()
// itself (scripts/generate-towing-map.mjs), so the image IS the decision function rather
// than a hand-drawn approximation of it. The freehand mockup polygons that used to live
// here were never real geography and have been deleted rather than left to mislead.
//
// This also means the map and the region filter CANNOT disagree: there is one definition
// (ANCHORS + TRNC_OUTLINE in constants/regions.js) and both read it.
// Label anchor points, in the SAME viewBox space, from the mockup's <text> x/y.
// CoverageMap converts these to percentages so the labels track the image at any width.
// The mockup anchors text at its LEFT baseline; these are converted to CENTRES so an RN
// <Text> can be centred on them regardless of how long the translated label is.
export const MAP_LABEL_ANCHORS = {
  nicosia:    { x:  383, y: 320 },
  kyrenia:    { x:  237, y: 255 },
  famagusta:  { x:  534, y: 348 },
  morphou:    { x:  174, y: 317 },
  iskele:     { x:  633, y: 245 },
  lefke:      { x:   66, y: 337 },
  karpaz:     { x:  800, y: 127 },
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
  const labels = Object.keys(MAP_LABEL_ANCHORS).sort()
  const canon  = [...REGIONS].sort()
  if (JSON.stringify(labels) !== JSON.stringify(canon)) {
    throw new Error(`towing coverage map drift: MAP_LABEL_ANCHORS keys [${labels}] != REGIONS [${canon}]`)
  }
  return true
}

// Runs on import. A drift here must break loudly and immediately, not at render.
assertMapKeysMatchRegions()
