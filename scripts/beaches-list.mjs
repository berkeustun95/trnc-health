#!/usr/bin/env node
// Explore beaches — the curated LIST (step one; no migration exists yet, Berke approves this first).
//
//   node scripts/beaches-list.mjs                    REBUILD data/explore/beaches.json from the LOCAL OSM snapshot (SNAPSHOT below;
//                                                    data/osm/ is gitignored on purpose, so a fresh clone has none), then run the checks
//   node scripts/beaches-list.mjs --check [file]     OFFLINE, no snapshot, no network. Proves, from the data file alone: ids unique,
//                                                    source/source_id shape, region = resolveRegion(pin) and one of the 7, area valid for
//                                                    its region, pin inside the TRNC frame, >= 300 m between rows and from every LIVE
//                                                    beach, no row already in 20261179, OSM rows carry no description/amenities/
//                                                    blue_flag/access_type, name_evidence well-formed, the 4 live translation blocks
//                                                    complete (and equal to beaches-live-translations.json), counts match the arrays,
//                                                    rows in canonical order, file byte-stable (parse + re-serialise == file).
//                                                    It does NOT prove a pin lies on its OSM outline.
//   node scripts/beaches-list.mjs --verify-geometry [snapshot.json]
//                                                    NEEDS OSM GEOMETRY: re-fetches exactly the rows' elements by id through
//                                                    scripts/lib/osm-snapshot.mjs (main Overpass, <= 72 h), or reuses a local snapshot
//                                                    (the original, or any file that contains them). Proves: every row's element exists,
//                                                    pin lies inside/on its outline (<= 1 m), private_resort == (the element itself is
//                                                    tagged leisure=beach_resort), the OSM name matches the row, each name_evidence
//                                                    distance_m re-measures, no LIVE pin lies on a row's outline; with a FULL snapshot
//                                                    also that every named element is accounted for in DROP / MERGED / KEEP / MINISTRY.
//
// Translations (name_i18n for every row, description_i18n for the 2 Ministry rows) live in data/explore/beaches-translations.json, keyed by source_id;
// build() copies them onto the rows and --check proves the rows equal the file and every rule below (9 exact keys, ar/fa parentheses, amenity slugs backed by a recorded quote, ...).
//
// Inputs: the local OSM snapshot (Overpass `out geom`, North only) for a rebuild, data/explore/beaches-live-translations.json,
// and the CURATION block below (every drop/keep/area decision, with its reason). Deterministic: the only timestamp is
// the snapshot's own osm_base, which the data file carries (osm_base) so the file is self-sufficient for provenance;
// nothing reads the clock or the network except --verify-geometry's re-fetch.
// Data © OpenStreetMap contributors, ODbL 1.0. OSM rows carry NAME + PIN only (+ the resort tag evidence).
// Exit 1 on any validation failure.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveRegion, pointInPolygon } from '../utils/resolveRegion.js'
import { inTrncFrame } from '../constants/mapSources.js'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'
import { osmSnapshot } from './lib/osm-snapshot.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = 'data/osm/beaches-20261115T1853.json'
const OUT = 'data/explore/beaches.json'
const TRANSLATIONS = 'data/explore/beaches-live-translations.json'
const TRANSLATIONS_NEW = 'data/explore/beaches-translations.json'
const LOCALES9 = ['en', 'tr', 'ar', 'ru', 'el', 'fr', 'es', 'de', 'fa']   // ISO keys: what the app reader extractI18n resolves (the live name_i18n uses en/tr already)
const RETIRED_EL = ['Εσεντεπέ', 'Καραογλανόγλου', 'Λάπτα', 'Αλσάντζακ', 'Λεφκέ', 'Μποαζιτσί', 'Καπλίτζα', 'Μπάφρα', 'Αϊφίλον']   // Greek-script transliterations of Turkish village names, superseded: el now carries the Turkish name itself (Berke 2026-11-16)
const AMENITY_SLUGS = ['parking', 'toilets', 'sunbeds', 'food_bar', 'lifeguard']
const ACCESS_TYPES = ['public', 'private']
const REGIONS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
const NEW_LOCALES = ['ar', 'ru', 'el', 'fr', 'es', 'de', 'fa']
const PIN_METHODS = ['node', 'open_way_middle_vertex', 'centroid', 'centroid_of_largest_outer_ring', 'pole_of_inaccessibility']
const EVIDENCE_KINDS = ['a', 'b', 'c', 'd']
const MIN_SEP_M = 300
const MAX_EVIDENCE_M = 200
const VISITNCY = 'https://www.visitncy.com/discover/beaches/'

// The 4 LIVE beaches (places, category 'beach', read with the anon key 2026-11-15, count exact = 4).
// Alagadi's pin was moved in production 2026-11-16 (Berke); it was 35.3302, 33.4972.
const LIVE = [
  { id: 'fa39492b-57e6-4ebd-b22c-89a9cf20ffe2', name: 'Alagadi Turtle Beach', lat: 35.332504, lng: 33.48512 },
  { id: '4a29cce8-8c3a-4541-8a07-fc7ceda6a4ff', name: 'Escape Beach', lat: 35.3471, lng: 33.2343 },
  { id: 'b52cdf3a-ce3f-4e6f-88b8-57afb95f2e67', name: 'Glapsides Beach', lat: 35.1541, lng: 33.9129 },
  { id: '95b6d924-e3c0-40e4-a2bd-b55ca1a105ef', name: 'Golden Beach (Altın Kumsal)', lat: 35.6412, lng: 34.5423 },
]

// ─── CURATION: every NAMED snapshot element must appear in exactly one of DROP / MERGED(sibling) / MINISTRY / KEEP ───
const LIVE_DUP = 'Duplicate of a LIVE beach'
const GENERIC = 'Generic name, not a proper name'
const BERKE_MARASH = 'beside closed Maraş / army base; left out by Berke 2026-11-16'
const DROP = {
  'way/208118413': `${LIVE_DUP}: Escape Beach`,
  'way/226555170': `${LIVE_DUP}: Alagadi Turtle Beach (OSM "Alagadi 2")`,
  'way/226555171': `${LIVE_DUP}: Alagadi Turtle Beach (OSM "Alagadi Beach 3")`,
  'way/487959702': `${LIVE_DUP}: Alagadi Turtle Beach (OSM "Alagadi Beach 1")`,
  'way/334299834': `${LIVE_DUP}: Glapsides Beach`,
  'relation/13016306': `${LIVE_DUP}: Golden Beach / Altın Kumsal`,
  'way/180583742': `${GENERIC}: "Beach" (natural=beach + leisure=beach_resort, fee=yes, charge 5.00 EUR, 35.350 N 33.226 E, about 0.7 km west of Escape Beach)`,
  'way/225385316': `${GENERIC}: "Beach" (35.3515 N 33.1696 E, beside Suna's Beach and Restaurant)`,
  'way/606238633': `${GENERIC}: "Beach Club" (35.167 N 33.910 E, between Glapsides and Silver Beach)`,
  'way/606238634': 'resolveRegion(35.083471, 33.98153) is null: the point lies outside constants/regions.js TRNC_OUTLINE. Context from OSM: it is the beach at the Derinya (Deryneia) coast; 2 of its 5 outline vertices fall inside the "Kapalı Maraş" restricted-area relation r12196193 (tagged "Very approximate"), none inside the UN buffer-zone relation r3263735; OSM has an access=no military landuse checkpoint at 35.0834 N 33.9565 E (note "Only Northern Cyprus and Turkish Citizens allowed") about 2.3 km west',
  'node/5860707914': 'Duplicate of way/608212204 (Bella Marin Beach): the node "Bella Marin" (leisure=beach_resort, fee=yes) is 452 m from the way and not on its outline; Berke 2026-11-16: Bella Marin Beach stays as the way row, access empty, private_resort false; the node\'s tags are not applied to the row',
  'node/6595054185': 'Sibling of way/208111924, merged into the Lapta Belediye Plajı row (Berke 2026-11-16): the node is the beach_resort point on that outline; its names and tags are recorded on the row',
  'way/396559851': `Palm beach: ${BERKE_MARASH}. OSM test result: 9 of its 47 outline vertices fall inside the "Kapalı Maraş" relation r12196193 (tagged "Very approximate"); the OSM node "Varosha Entrance" (barrier=gate, access=no) is 355 m from the pin`,
  'relation/12567504': `Glossa Beach: ${BERKE_MARASH}. OSM test result: 47 of its 93 outline vertices fall inside r12196193, 20 inside the military-landuse relation r12567503 "Gazimağusa Orduevi" (name:en "Turkish Army Base"); military checkpoints at 35.1014 N 33.9646 E and 35.1057 N 33.9615 E`,
}
// Kept as ONE row from two OSM elements: the sibling's tags are recorded on the kept row (merged_duplicate_tags), never applied.
const MERGED = { 'way/608212204': 'node/5860707914', 'way/208111924': 'node/6595054185' }

// Ministry beaches (visitncy.com/discover/beaches/, credit "Turizm Bakanlığı"). Text verbatim from the page.
const MINISTRY = [
  {
    source_id: 'long-beach', name: 'Long Beach', osm: 'way/1568098280', area: 'Long Beach',
    pin_note: 'Pinned by Berke\'s decision 2026-11-16 on the İskele resort outline at about 35.266 N 33.916 E (the page says only "Situated on the Salamis Bay, 15 kilometres north of Famagusta"). OSM has no element named Long Beach. Two unnamed leisure=beach_resort ways (area=yes) sit there: way/1568098280 (35.2655-35.2670 N, about 150 m of shore, the larger, and the one that contains 35.266 N 33.916 E) and way/1568098281 (35.2670-35.2677 N, about 90 m, the next strip north). A bbox query over 35.24-35.30 N 33.89-33.94 E (2026-11-16) found no unnamed natural=beach way on that shore, so the larger beach_resort strip is the outline. The element itself is tagged leisure=beach_resort; private_resort stays false because this is a Ministry-listed public beach row (Berke to confirm)',
    amenities: [], access_type: 'public',
    description_en_site: 'Situated on the Salamis Bay, 15 kilometres north of Famagusta and near to the ruins of Salamis, this magnificent sandy beach is ideal to spend time relaxing with a range of available facilities. A shuttle service also runs from town to the beach.',
    facts: [
      { quote: 'this magnificent sandy beach is ideal to spend time relaxing with a range of available facilities', relates_to: null, note: 'facilities are not itemised on the page' },
      { quote: 'A shuttle service also runs from town to the beach.', relates_to: null, note: 'no allowed slug covers a shuttle' },
      { quote: 'We have compiled a unique list for visitors searching for public beaches to spend their days and even have their own picnic.', relates_to: 'access_type', quote_source: 'page_intro', note: 'the page says this about its whole LIST of beaches, not about Long Beach alone; recorded verbatim from the page intro (Berke 2026-11-16: access_type public only with this sentence on record)' },
    ],
  },
  {
    source_id: 'kervansaray-beach', name: 'Kervansaray Beach', osm: 'way/217651068', area: null,
    amenities: ['sunbeds', 'food_bar', 'lifeguard'], access_type: 'public',
    description_en_site: 'Operated by the Municipality of Kyrenia, this is a popular leisure area to be enjoyed by the public. In the heart of Kyrenia in the Kervansaray area, this beach has a range of facilities. Sunbeds and umbrellas, dressing rooms and showers, restaurants and even an additional artificial grass sunbathing area for those who don’t like to get sand in their feet. The beach also has a car park for the disabled with easy access to the beach side. As the cove of Kervansaray is a stop for most boat tours from Kyrenia Harbour, a designated swimming area is separated by buoys to ensure safety of swimmers. The beach also has a lifeguard tower with first aid and lifeguard supplies.',
    facts: [
      { quote: 'Sunbeds and umbrellas', relates_to: 'sunbeds' },
      { quote: 'restaurants', relates_to: 'food_bar' },
      { quote: 'The beach also has a car park for the disabled with easy access to the beach side.', relates_to: 'parking', note: 'the page says a car park FOR THE DISABLED, not general parking' },
      { quote: 'The beach also has a lifeguard tower with first aid and lifeguard supplies.', relates_to: 'lifeguard' },
      { quote: 'dressing rooms and showers', relates_to: null, note: 'no allowed slug; toilets are not mentioned' },
      { quote: 'Operated by the Municipality of Kyrenia, this is a popular leisure area to be enjoyed by the public.', relates_to: 'access_type', note: 'municipal, "enjoyed by the public"; the page never says free or paid' },
    ],
    area_note: 'The page says "in the Kervansaray area"; constants/areas.js has no Kervansaray area, so area stays null (Berke 2026-11-16).',
  },
]

// KEEP: element ref -> { area: constants/areas.js NAME or null, why }. area only where the NAME, an OSM tag or Berke says the locality.
// name / name_en override the OSM name; provenance records what OSM calls the element(s); private_resort_note explains a false despite a resort tag on a sibling.
const KEEP = {
  'way/225383964': { area: 'Alsancak', why: 'name contains "Alsancak"' },
  'way/208150337': { area: 'Karaoğlanoğlu', why: 'name contains "Karaoğlanoğlu"' },
  'way/603986283': { area: 'Esentepe', why: 'name contains "Esentepe"' },
  'way/435772839': { area: 'Bafra', why: 'name contains "Bafra" (name:en "Bafra Beach"); the name also says "Mehmetçik", a second karpaz area: Bafra chosen' },
  'way/208111924': {
    area: 'Lapta', why: 'Berke 2026-11-16: one row, area Lapta',
    name: 'Lapta Belediye Plajı', name_en: 'Lapta Municipality Public Beach',
    provenance: { osm_names: [
      { element: 'way/208111924', name: 'Güzelyalı Beach', role: 'outline the pin lies on; source_id' },
      { element: 'node/6595054185', name: 'Lapta Belediye Plajı', name_en: 'Lapta Municipality Public Beach', role: 'beach_resort point on that outline; name of the row' },
    ] },
    private_resort_note: 'the sibling node carries leisure=beach_resort but also fee=no: a free municipal beach, so private_resort is false (Berke 2026-11-16)',
  },
  'way/208241783': { area: null }, 'way/225382750': { area: null },
  'way/225386412': { area: null }, 'way/229043037': { area: null }, 'way/244561269': { area: null },
  'way/286275732': { area: null }, 'way/286276160': { area: null }, 'way/435771323': { area: null },
  'way/510986434': { area: null }, 'way/603896219': { area: null }, 'way/606238631': { area: null },
  'way/608212204': { area: null }, 'way/666114116': { area: null }, 'way/952236170': { area: null },
  'way/1395325670': { area: null }, 'way/1484271058': { area: null },
  'node/1951274050': { area: null }, 'node/11231014679': { area: null }, 'node/11994931556': { area: null },
  'relation/13040159': { area: null },
  'relation/15456405': { area: null, why: 'Berke 2026-11-16: a named beach in Famagusta, nothing flagged' },
}

// ADDED (Part B): beaches OSM left UNNAMED. The PIN is OSM-derived (on the unnamed outline); the NAME comes from an independent
// public source. `at` is the evidence's own coordinate; its distance to the outline is measured at build time (0 = on/inside it).
// kind: a = official page, b = Wikipedia/Wikidata coordinates, c = geotagged Commons file whose title/description names the beach,
// d = named OSM POI adjacent to the outline.
const ADDED = [
  {
    ref: 'way/309623318', name: 'Kaplıca Plajı', area: 'Kaplıca',
    area_why: 'the evidence names Kaplıca (constants/areas.js iskele)',
    name_evidence: [
      { kind: 'c', url: 'https://commons.wikimedia.org/wiki/File:Kaplica_beach.jpg', quote_or_title: 'File:Kaplica beach.jpg — "Davlos (Kaplıca) beach in Northern Cyprus."', at: [35.42555556, 33.89916667] },
      { kind: 'd', url: 'https://www.openstreetmap.org/way/603957024', quote_or_title: 'OSM way/603957024 name="Kaplica Holiday Resort Beach Cafe" (amenity=cafe)', at: [35.425507, 33.8996264] },
      { kind: 'd', url: 'https://www.openstreetmap.org/way/603957023', quote_or_title: 'OSM way/603957023 name="Kaplica Beach Resort" (tourism=hotel)', at: [35.4252397, 33.8992183] },
    ],
  },
  {
    ref: 'way/1365670207', name: 'Yeni Boğaziçi Halk Plajı', area: 'Yeni Boğaziçi',
    area_why: 'the evidence names Yeni Boğaziçi (constants/areas.js famagusta)',
    name_note: 'OSM spells the POI "Yeni bogazici halk plaji"; the Turkish diacritics and capitals are ours',
    name_evidence: [
      { kind: 'd', url: 'https://www.openstreetmap.org/node/5893518286', quote_or_title: 'OSM node/5893518286 name="Yeni bogazici halk plaji" name:en="bogazici beach" (amenity=restaurant)', at: [35.2010729, 33.9001119] },
    ],
  },
]
// ADDITIONS_REJECTED: candidates considered and NOT added (Berke / principal-engineer 2026-11-16: leave out anything uncertain). Printed in the data file.
const ADDITIONS_REJECTED = [
  {
    name: 'Barış Plajı', osm: 'way/229043958',
    reason: 'Too weak: the only evidence is one OSM node (name "barış plajı", tourism=attraction) 102 m from the unnamed outline; no second independent source.',
    evidence: [{ kind: 'd', url: 'https://www.openstreetmap.org/node/4339471206', quote_or_title: 'OSM node/4339471206 name="barış plajı" (tourism=attraction)', at: [35.3313485, 33.4118723], distance_m: 102 }],
  },
  {
    name: 'Yedidalga', osm: null,
    reason: 'Probably the same beach as the kept row "Lefke Belediyesi Halk Plajı" (way/1395325670), but that is not proven, so no second row is added.',
    evidence: [
      { kind: 'area', note: 'constants/areaPoints.js lists the area point of Yedidalga (Lefke region) at 35.14491 N 32.8013 E; the Lefke Belediyesi Halk Plajı pin (35.148549 N 32.803607 E) is 456 m from it' },
      { kind: 'c', url: 'https://commons.wikimedia.org/wiki/File:Yedidalga_%C3%A7e%C5%9Fme_1953.jpg', quote_or_title: 'File:Yedidalga çeşme 1953.jpg (geotagged 35.142088 N 32.813474 E; a village fountain, not a beach; 1149 m from that pin)' },
      { kind: 'd', url: 'https://www.openstreetmap.org/way/1288399087', quote_or_title: 'OSM way/1288399087 name="Yedidalga Sosyal Tesisleri" landuse=military (bounds 35.1489-35.1503 N, 32.7982-32.8005 E): a military social facility beside the same shore, not a beach' },
    ],
  },
]
// Pairs allowed to sit closer than MIN_SEP_M (a, b are source_ids / live ids), each with its reason.
const ALLOW_CLOSE = []

// ─── geometry ───────────────────────────────────────────────────────────────
const toR = x => x * Math.PI / 180
export function metres(aLat, aLng, bLat, bLng) {
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1]
const ringArea = ring => {
  const k = Math.cos(toR(ring[0][0])); let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][1] * k) * ring[i][0] - (ring[i][1] * k) * ring[j][0]
  return s / 2
}
function centroid(ring) {
  const k = Math.cos(toR(ring[0][0])); let a = 0, cx = 0, cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][1] * k, y0 = ring[j][0], x1 = ring[i][1] * k, y1 = ring[i][0], f = x0 * y1 - x1 * y0
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f
  }
  a /= 2
  return [cy / (6 * a), cx / (6 * a) / k]
}
function segDistM(pLat, pLng, aLat, aLng, bLat, bLng) {
  const k = Math.cos(toR(pLat)) * 111320, m = 110540
  const px = pLng * k, py = pLat * m, ax = aLng * k, ay = aLat * m, bx = bLng * k, by = bLat * m
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
export const edgeDistM = (lat, lng, ring) => {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segDistM(lat, lng, ring[j][0], ring[j][1], ring[i][0], ring[i][1]))
  return best
}

// Outer rings of a way (closed ring) or relation (outer members stitched by endpoints) + inner rings.
export function shapeOf(el) {
  if (el.type === 'node') return { kind: 'node', point: [el.lat, el.lon] }
  if (el.type === 'way') {
    const g = el.geometry.map(p => [p.lat, p.lon])
    return g.length > 3 && same(g[0], g[g.length - 1]) ? { kind: 'ring', outers: [g], inners: [] } : { kind: 'line', line: g }
  }
  const pieces = role => el.members.filter(m => m.type === 'way' && m.role === role && m.geometry).map(m => m.geometry.map(p => [p.lat, p.lon]))
  return { kind: 'ring', outers: stitch(pieces('outer')), inners: stitch(pieces('inner')) }
}
function stitch(pieces) {
  const rings = [], left = pieces.map(p => p.slice())
  while (left.length) {
    let cur = left.shift()
    for (let grew = true; grew && !same(cur[0], cur[cur.length - 1]);) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const p = left[i], e = cur[cur.length - 1]
        if (same(p[0], e)) cur = cur.concat(p.slice(1))
        else if (same(p[p.length - 1], e)) cur = cur.concat(p.slice().reverse().slice(1))
        else if (same(p[p.length - 1], cur[0])) cur = p.concat(cur.slice(1))
        else if (same(p[0], cur[0])) cur = p.slice().reverse().concat(cur.slice(1))
        else continue
        left.splice(i, 1); grew = true; break
      }
    }
    if (cur.length > 3 && same(cur[0], cur[cur.length - 1])) rings.push(cur)
  }
  return rings
}
const insideShape = (lat, lng, outer, inners) => pointInPolygon(lat, lng, outer) && !inners.some(r => pointInPolygon(lat, lng, r))
// Pole of inaccessibility by grid refinement (used when the centroid is not inside the shape).
function pole(outer, inners) {
  let best = null
  let [minLat, maxLat, minLng, maxLng] = outer.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [90, -90, 180, -180])
  for (let pass = 0; pass < 6; pass++) {
    const N = 24
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const lat = minLat + (maxLat - minLat) * i / N, lng = minLng + (maxLng - minLng) * j / N
      if (!insideShape(lat, lng, outer, inners)) continue
      const d = Math.min(edgeDistM(lat, lng, outer), ...inners.map(r => edgeDistM(lat, lng, r)))
      if (!best || d > best.d) best = { lat, lng, d }
    }
    if (!best) return null
    const hLat = (maxLat - minLat) / N * 2, hLng = (maxLng - minLng) / N * 2
    ;[minLat, maxLat, minLng, maxLng] = [best.lat - hLat, best.lat + hLat, best.lng - hLng, best.lng + hLng]
  }
  return [best.lat, best.lng]
}
const r6 = x => Math.round(x * 1e6) / 1e6

// Returns { lat, lng, pin_method } for an element.
export function pinOf(el) {
  const s = shapeOf(el)
  if (s.kind === 'node') return { lat: s.point[0], lng: s.point[1], pin_method: 'node' }
  if (s.kind === 'line') { const m = s.line[Math.floor(s.line.length / 2)]; return { lat: m[0], lng: m[1], pin_method: 'open_way_middle_vertex' } }
  const outer = s.outers.slice().sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0]
  const inners = s.inners.filter(r => pointInPolygon(r[0][0], r[0][1], outer))
  const c = centroid(outer)
  if (insideShape(r6(c[0]), r6(c[1]), outer, inners)) return { lat: r6(c[0]), lng: r6(c[1]), pin_method: s.outers.length > 1 ? 'centroid_of_largest_outer_ring' : 'centroid' }
  const p = pole(outer, inners)
  return { lat: r6(p[0]), lng: r6(p[1]), pin_method: 'pole_of_inaccessibility' }
}
// True when (lat,lng) lies inside (or within 1 m of the edge of) the element's shape; nodes must match exactly.
export function onElement(el, lat, lng) {
  const s = shapeOf(el)
  if (s.kind === 'node') return lat === s.point[0] && lng === s.point[1]
  if (s.kind === 'line') return edgeDistM(lat, lng, s.line) <= 1
  return s.outers.some(o => (insideShape(lat, lng, o, s.inners.filter(r => pointInPolygon(r[0][0], r[0][1], o))) || edgeDistM(lat, lng, o) <= 1))
}


const insideRing = (el, lat, lng) => {
  const s = shapeOf(el)
  return s.kind === 'ring' && s.outers.some(o => insideShape(lat, lng, o, s.inners.filter(r => pointInPolygon(r[0][0], r[0][1], o))))
}
// Metres from (lat,lng) to an element: 0 inside an area, else to the nearest edge / line / node.
export function distToElement(el, lat, lng) {
  const s = shapeOf(el)
  if (s.kind === 'node') return metres(lat, lng, s.point[0], s.point[1])
  if (s.kind === 'line') return edgeDistM(lat, lng, s.line)
  if (insideRing(el, lat, lng)) return 0
  return Math.min(...s.outers.map(o => edgeDistM(lat, lng, o)))
}

// ─── build (needs the local snapshot) ───────────────────────────────────────
const refOf = e => `${e.type}/${e.id}`
const nameOf = t => t.name || t['name:tr'] || t['name:en'] || null
const seen = t => { const o = {}; for (const k of ['surface', 'access', 'fee', 'operator']) if (t[k] != null) o[k] = t[k]; return o }
// Decision 5 (Berke 2026-11-16): the ELEMENT ITSELF tagged leisure=beach_resort, nothing else.
const resortEvidence = t => (t.leisure === 'beach_resort' ? ['leisure=beach_resort'] : [])
const resortTagsOf = t => { const o = {}; for (const k of ['leisure', 'fee', 'access', 'operator']) if (t[k] != null) o[k] = t[k]; return o }
const areaFor = (region, name) => {
  if (name == null) return null
  const hit = (AREAS_BY_REGION[region] || []).find(n => n === name)
  return hit ? areaSlug(hit) : { invalid: name }
}
const regionIdx = r => (r ? REGIONS.indexOf(r) : 99)
const rowOrder = (a, b) => (a.source === 'osm') - (b.source === 'osm') || regionIdx(a.region) - regionIdx(b.region) || a.name.localeCompare(b.name, 'tr') || a.source_id.localeCompare(b.source_id)
const idsOf = refs => {
  const by = { node: [], way: [], relation: [] }
  for (const r of refs) { const [t, i] = r.split('/'); by[t].push(i) }
  return by
}

function coverage(snap) {
  const byRef = new Map(snap.elements.map(e => [refOf(e), e]))
  const accounted = new Set([...Object.keys(DROP), ...Object.keys(MERGED), ...Object.values(MERGED), ...Object.keys(KEEP), ...MINISTRY.map(m => m.osm), ...ADDED.map(a => a.ref)])
  const problems = []
  for (const e of snap.elements) if (nameOf(e.tags || {}) && !accounted.has(refOf(e))) problems.push(`named element ${refOf(e)} is in no curation list`)
  for (const r of accounted) if (!byRef.has(r)) problems.push(`curation names ${r}, not in the snapshot`)
  for (const a of ADDED) if (byRef.has(a.ref) && nameOf(byRef.get(a.ref).tags || {})) problems.push(`ADDED ${a.ref} is already named in OSM`)
  return problems
}

const insertAfter = (o, after, extra) => {
  const out = {}
  for (const [k, v] of Object.entries(o)) { out[k] = v; if (k === after) Object.assign(out, extra) }
  return out
}
export function build(snap) {
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, TRANSLATIONS_NEW), 'utf8'))
  const byRef = new Map(snap.elements.map(e => [refOf(e), e]))
  const problems = coverage(snap)
  const rows = []
  for (const m of MINISTRY) {
    const el = byRef.get(m.osm)
    const base = { name: m.name, name_tr: null, name_en: null, source: 'visitncy_beaches', source_id: m.source_id, source_url: VISITNCY, credit: 'Turizm Bakanlığı' }
    if (!el) { problems.push(`MINISTRY ${m.source_id}: ${m.osm} not in the snapshot`); continue }
    const t = el.tags, pin = pinOf(el), region = resolveRegion(pin.lat, pin.lng)
    rows.push({ ...base, name_tr: t['name:tr'] || null, name_en: t['name:en'] || null, region, area: areaFor(region, m.area), latitude: pin.lat, longitude: pin.lng, osm: { type: el.type, id: el.id }, pin_method: pin.pin_method, private_resort: false, resort_evidence: [], osm_tags_seen: seen(t), description_en_site: m.description_en_site, facts: m.facts, ...(m.pin_note ? { pin_note: m.pin_note } : {}), ...(m.area_note ? { area_note: m.area_note } : {}) })
  }
  const osmRow = (el, cfg, over) => {
    const t = el.tags, pin = pinOf(el), region = resolveRegion(pin.lat, pin.lng)
    const merged = MERGED[refOf(el)] || null
    const sib = merged && byRef.get(merged) ? resortTagsOf(byRef.get(merged).tags) : null
    const ev = resortEvidence(t)
    return {
      name: over.name, name_tr: t['name:tr'] || null, name_en: over.name_en !== undefined ? over.name_en : t['name:en'] || null, name_source: over.name_source,
      region, area: areaFor(region, cfg.area), area_why: cfg.why || cfg.area_why || null, latitude: pin.lat, longitude: pin.lng,
      source: 'osm', source_id: refOf(el), osm: { type: el.type, id: el.id }, merged_duplicate: merged, merged_duplicate_tags: sib, pin_method: pin.pin_method,
      private_resort: ev.length > 0, resort_evidence: ev, ...(cfg.private_resort_note ? { private_resort_note: cfg.private_resort_note } : {}), osm_tags_seen: seen(t),
      ...(cfg.provenance ? { provenance: cfg.provenance } : {}), ...(over.name_evidence ? { name_evidence: over.name_evidence, ...(cfg.name_note ? { name_note: cfg.name_note } : {}) } : {}),
      description: null, amenities: [], blue_flag: null, access_type: null,
    }
  }
  for (const [ref, cfg] of Object.entries(KEEP)) {
    const el = byRef.get(ref)
    if (!el) continue
    rows.push(osmRow(el, cfg, { name: cfg.name || nameOf(el.tags), name_en: cfg.name_en, name_source: cfg.name ? 'berke_decision' : 'osm' }))
  }
  for (const a of ADDED) {
    const el = byRef.get(a.ref)
    if (!el) continue
    const evidence = a.name_evidence.map(x => ({ kind: x.kind, url: x.url, quote_or_title: x.quote_or_title, evidence_point: x.at, distance_m: Math.round(distToElement(el, x.at[0], x.at[1])) }))
    rows.push(osmRow(el, a, { name: a.name, name_source: 'external_evidence', name_evidence: evidence }))
  }
  rows.sort(rowOrder)
  const decorated = rows.map(r => {
    const nm = tr.name_i18n?.[r.source_id]
    if (!nm) problems.push(`${r.source_id}: no name_i18n in ${TRANSLATIONS_NEW}`)
    let o = insertAfter(r, 'name_en', { name_i18n: nm || null })
    if (r.source === 'visitncy_beaches') {
      const m = MINISTRY.find(x => x.source_id === r.source_id)
      o = insertAfter(o, 'description_en_site', { description_i18n: tr.description_i18n?.[r.source_id] || null, amenities: m.amenities, access_type: m.access_type, blue_flag: null })
    }
    return o
  })
  for (const k of Object.keys(tr.name_i18n || {})) if (!rows.some(r => r.source_id === k)) problems.push(`${TRANSLATIONS_NEW} has name_i18n for ${k}, which is not a row`)
  for (const k of Object.keys(tr.description_i18n || {})) if (!rows.some(r => r.source_id === k && r.source === 'visitncy_beaches')) problems.push(`${TRANSLATIONS_NEW} has description_i18n for ${k}, which is not a Ministry row`)
  rows.length = 0; rows.push(...decorated)
  const dropped = Object.entries(DROP).map(([ref, reason]) => ({ name: nameOf(byRef.get(ref)?.tags || {}), osm: ref, reason })).sort((a, b) => a.osm.localeCompare(b.osm))
  const base = snap.osm3s.timestamp_osm_base
  return {
    obj: {
      generated_at: base, osm_base: [base],
      attribution: { osm: '© OpenStreetMap contributors, ODbL 1.0', ministry: 'Turizm Bakanlığı (visitncy.com)' },
      counts: { rows: rows.length, dropped: dropped.length, additions_rejected: ADDITIONS_REJECTED.length, needs_review: 0 },
      rows, dropped, additions_rejected: ADDITIONS_REJECTED, needs_review: [], live_translations: JSON.parse(fs.readFileSync(path.join(ROOT, TRANSLATIONS), 'utf8')),
    },
    problems,
  }
}

// ─── validate: OFFLINE (no geometry) ────────────────────────────────────────
export function validate(obj) {
  const f = []
  const ids = new Set(), refs = new Set(), geo = []
  if (!Array.isArray(obj.osm_base) || !obj.osm_base.length || obj.osm_base.some(x => !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x))) f.push('osm_base must be a non-empty array of ISO timestamps')
  for (const r of obj.rows) {
    const tag = `${r.source_id}`
    if (ids.has(r.source_id)) f.push(`duplicate source_id ${tag}`)
    ids.add(r.source_id)
    if (!['osm', 'visitncy_beaches'].includes(r.source)) f.push(`${tag}: bad source ${r.source}`)
    if ('pending' in r) f.push(`${tag}: carries a pending note (no row may lack a pin any more)`)
    if (typeof r.name !== 'string' || !r.name.trim()) f.push(`${tag}: empty name`)
    if (!r.osm || !['node', 'way', 'relation'].includes(r.osm.type) || !Number.isInteger(r.osm.id)) f.push(`${tag}: osm must be {type,id}`)
    else { const ref = `${r.osm.type}/${r.osm.id}`; if (refs.has(ref)) f.push(`${tag}: osm ${ref} used by another row`); refs.add(ref) }
    if (!PIN_METHODS.includes(r.pin_method)) f.push(`${tag}: pin_method ${r.pin_method}`)
    {
      // name_i18n: ALL rows, exactly the 9 ISO keys, non-empty strings; ar/fa carry no parentheses
      const keys = Object.keys(r.name_i18n || {}).sort().join(), want = LOCALES9.slice().sort().join()
      if (keys !== want) f.push(`${tag}: name_i18n keys [${keys}] != [${want}]`)
      for (const code of LOCALES9) if (typeof r.name_i18n?.[code] !== 'string' || r.name_i18n[code].trim().length < 2 || r.name_i18n[code] !== r.name_i18n[code].trim()) f.push(`${tag}: name_i18n.${code} empty or untrimmed`)
      for (const code of ['ar', 'fa']) if (/[()]/.test(r.name_i18n?.[code] || '')) f.push(`${tag}: name_i18n.${code} contains parentheses`)
      for (const w of RETIRED_EL) if ((r.name_i18n?.el || '').includes(w)) f.push(`${tag}: name_i18n.el uses the retired Turkish-village transliteration ${w} (el policy = the official Turkish name)`)
      if (r.name_i18n?.el !== r.name_i18n?.tr) f.push(`${tag}: name_i18n.el "${r.name_i18n?.el}" != tr "${r.name_i18n?.tr}" (el policy, Berke 2026-11-16: the official Turkish name in Latin letters, no Greek words)`)
    }
    if (r.source === 'visitncy_beaches') {
      const dk = Object.keys(r.description_i18n || {}).sort().join(), want = LOCALES9.slice().sort().join()
      if (dk !== want) f.push(`${tag}: description_i18n keys [${dk}] != [${want}]`)
      for (const code of LOCALES9) if (typeof r.description_i18n?.[code] !== 'string' || r.description_i18n[code].trim().length < 40) f.push(`${tag}: description_i18n.${code} missing or too short`)
      if (!Array.isArray(r.amenities)) f.push(`${tag}: amenities must be an array`)
      for (const a of r.amenities || []) {
        if (!AMENITY_SLUGS.includes(a)) f.push(`${tag}: amenity ${JSON.stringify(a)} not in ${AMENITY_SLUGS.join('/')}`)
        if (!(r.facts || []).some(x => x.relates_to === a && x.quote)) f.push(`${tag}: amenity ${a} has no recorded quote`)
      }
      if (new Set(r.amenities || []).size !== (r.amenities || []).length) f.push(`${tag}: duplicate amenity`)
      if (r.access_type != null) {
        if (!ACCESS_TYPES.includes(r.access_type)) f.push(`${tag}: access_type ${r.access_type}`)
        if (!(r.facts || []).some(x => x.relates_to === 'access_type' && x.quote)) f.push(`${tag}: access_type ${r.access_type} has no recorded quote`)
      }
      if (r.blue_flag != null) f.push(`${tag}: blue_flag set without any page stating it`)
      // every recorded quote is a verbatim substring of the stored page text, or of the page-intro sentence (quote_source page_intro)
      for (const x of r.facts || []) if (x.quote_source !== 'page_intro' && !String(r.description_en_site).includes(x.quote)) f.push(`${tag}: fact quote ${JSON.stringify(x.quote.slice(0, 40))} is not in description_en_site`)
      for (const x of r.facts || []) if (x.quote_source === 'page_intro' && !/^We have compiled a unique list for visitors searching for public beaches/.test(x.quote)) f.push(`${tag}: page_intro quote is not the recorded sentence`)
      // the 15 km of Long Beach must survive every translation (a faithful translation adds and loses no fact)
      if (r.source_id === 'long-beach') for (const code of LOCALES9) if (!/15/.test(r.description_i18n?.[code] || '')) f.push(`${tag}: description_i18n.${code} lost "15"`)
    }
    if (r.source === 'osm') {
      for (const k of ['description', 'description_i18n', 'blue_flag', 'access_type']) if (r[k] != null) f.push(`${tag}: OSM row carries ${k}`)
      if ((r.amenities || []).length) f.push(`${tag}: OSM row carries amenities`)
      if (!/^(node|way|relation)\/\d+$/.test(r.source_id)) f.push(`${tag}: source_id is not <type>/<id>`)
      else if (r.osm && r.source_id !== `${r.osm.type}/${r.osm.id}`) f.push(`${tag}: source_id disagrees with osm ref`)
      if (!['osm', 'berke_decision', 'external_evidence'].includes(r.name_source)) f.push(`${tag}: name_source ${r.name_source}`)
      if (r.private_resort !== (r.resort_evidence || []).length > 0) f.push(`${tag}: private_resort disagrees with resort_evidence`)
      if (r.name_source === 'external_evidence') {
        const ev = r.name_evidence
        if (!Array.isArray(ev) || !ev.length) f.push(`${tag}: external_evidence name without name_evidence`)
        for (const x of ev || []) {
          if (!EVIDENCE_KINDS.includes(x.kind)) f.push(`${tag}: evidence kind ${x.kind}`)
          if (!/^https:\/\//.test(x.url || '')) f.push(`${tag}: evidence url ${x.url}`)
          if (typeof x.quote_or_title !== 'string' || x.quote_or_title.trim().length < 5) f.push(`${tag}: evidence quote_or_title missing`)
          if (x.kind === 'a' && x.distance_m == null) continue
          if (!Number.isFinite(x.distance_m) || x.distance_m > MAX_EVIDENCE_M) f.push(`${tag}: evidence ${x.kind} distance_m ${x.distance_m} (max ${MAX_EVIDENCE_M})`)
          if (!Array.isArray(x.evidence_point) || x.evidence_point.length !== 2 || !inTrncFrame(x.evidence_point[0], x.evidence_point[1])) f.push(`${tag}: evidence_point outside the frame`)
        }
      } else if (r.name_evidence) f.push(`${tag}: name_evidence on a ${r.name_source} name`)
      if (r.name_source === 'berke_decision' && !r.provenance?.osm_names?.length) f.push(`${tag}: berke_decision name without provenance.osm_names`)
    }
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') { f.push(`${tag}: coordinates missing`); continue }
    if (!inTrncFrame(r.latitude, r.longitude)) f.push(`${tag}: outside inTrncFrame`)
    const rr = resolveRegion(r.latitude, r.longitude)
    if (!REGIONS.includes(r.region)) f.push(`${tag}: region ${r.region} not one of the 7`)
    else if (rr !== r.region) f.push(`${tag}: region ${r.region} but resolveRegion gives ${rr}`)
    if (r.area != null) {
      const names = AREAS_BY_REGION[r.region] || []
      if (!names.some(n => areaSlug(n) === r.area)) f.push(`${tag}: area ${JSON.stringify(r.area)} not valid for ${r.region}`)
    }
    geo.push({ id: r.source_id, lat: r.latitude, lng: r.longitude })
  }
  const allowed = (a, b) => ALLOW_CLOSE.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a))
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      const d = metres(geo[i].lat, geo[i].lng, geo[j].lat, geo[j].lng)
      if (d < MIN_SEP_M && !allowed(geo[i].id, geo[j].id)) f.push(`${geo[i].id} and ${geo[j].id} are ${Math.round(d)} m apart (< ${MIN_SEP_M})`)
    }
    for (const L of LIVE) {
      const d = metres(geo[i].lat, geo[i].lng, L.lat, L.lng)
      if (d < MIN_SEP_M && !allowed(geo[i].id, L.id)) f.push(`${geo[i].id} is ${Math.round(d)} m from LIVE ${L.name}`)
    }
  }
  const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261179_osm_free_listings.sql'), 'utf8')
  const used = new Set([...mig.matchAll(/'osm', '((?:node|way|relation)\/\d+)'/g)].map(m => m[1]))
  if (used.size < 100) f.push(`20261179 ids parsed: only ${used.size} (parser broken?)`)
  for (const r of obj.rows) if (used.has(r.source_id)) f.push(`${r.source_id} already exists in 20261179`)
  const lt = obj.live_translations || {}
  const fileLt = JSON.parse(fs.readFileSync(path.join(ROOT, TRANSLATIONS), 'utf8'))
  if (JSON.stringify(lt) !== JSON.stringify(fileLt)) f.push(`live_translations differ from ${TRANSLATIONS}`)
  const META = ['needs_native_check', 'source_discrepancies_live_today', '_source_discrepancies_note']
  if (Object.keys(lt).filter(k => !META.includes(k)).sort().join() !== LIVE.map(l => l.id).sort().join()) f.push('live_translations keys are not exactly the 4 live ids')
  for (const L of LIVE) {
    const t = lt[L.id]
    if (!t) continue
    if (t.live_name !== L.name) f.push(`live ${L.id}: live_name ${t.live_name} != ${L.name}`)
    for (const k of ['name_i18n', 'description_i18n']) {
      const have = Object.keys(t[k] || {}).sort().join(), want = NEW_LOCALES.slice().sort().join()
      if (have !== want) f.push(`live ${L.name} ${k}: locales ${have} != ${want}`)
      for (const code of NEW_LOCALES) if (typeof t[k]?.[code] !== 'string' || t[k][code].trim().length < 3) f.push(`live ${L.name} ${k}.${code} is empty`)
      for (const code of ['en', 'tr']) if (typeof t.source?.[k]?.[code] !== 'string' || !t.source[k][code]) f.push(`live ${L.name} source.${k}.${code} missing`)
    }
    for (const code of ['ar', 'fa']) if (/[()]/.test(t.name_i18n?.[code] || '')) f.push(`live ${L.name} name_i18n.${code} contains parentheses`)
    if (t.name_i18n?.el !== t.source?.name_i18n?.tr) f.push(`live ${L.name} name_i18n.el "${t.name_i18n?.el}" != tr "${t.source?.name_i18n?.tr}" (el policy: the official Turkish name)`)
    if (/Caretta caretta/.test(t.source?.description_i18n?.en || '')) for (const code of NEW_LOCALES) if (!t.description_i18n?.[code]?.includes('Caretta caretta')) f.push(`live ${L.name} description ${code} lost "Caretta caretta"`)
  }
  const ar = obj.additions_rejected
  if (!Array.isArray(ar) || !ar.length) f.push('additions_rejected must be a non-empty array')
  for (const a of ar || []) {
    if (!a.name || !a.reason || !Array.isArray(a.evidence) || !a.evidence.length) f.push(`additions_rejected ${a.name}: name, reason and evidence are required`)
    if (obj.rows.some(r => r.name === a.name)) f.push(`additions_rejected ${a.name} is also a row`)
  }
  const fileNew = JSON.parse(fs.readFileSync(path.join(ROOT, TRANSLATIONS_NEW), 'utf8'))
  for (const r of obj.rows) {
    if (JSON.stringify(r.name_i18n) !== JSON.stringify(fileNew.name_i18n?.[r.source_id])) f.push(`${r.source_id}: name_i18n differs from ${TRANSLATIONS_NEW}`)
    if (r.source === 'visitncy_beaches' && JSON.stringify(r.description_i18n) !== JSON.stringify(fileNew.description_i18n?.[r.source_id])) f.push(`${r.source_id}: description_i18n differs from ${TRANSLATIONS_NEW}`)
  }
  if (Object.keys(fileNew.name_i18n || {}).length !== obj.rows.length) f.push(`${TRANSLATIONS_NEW}: ${Object.keys(fileNew.name_i18n || {}).length} name_i18n entries for ${obj.rows.length} rows`)
  if (Object.keys(fileNew.description_i18n || {}).sort().join() !== obj.rows.filter(r => r.source === 'visitncy_beaches').map(r => r.source_id).sort().join()) f.push(`${TRANSLATIONS_NEW}: description_i18n keys are not exactly the Ministry rows`)
  if (!Array.isArray(fileNew.needs_native_check) || !fileNew.needs_native_check.length) f.push(`${TRANSLATIONS_NEW}: needs_native_check missing`)
  const c = obj.counts || {}
  if (c.rows !== obj.rows.length || c.dropped !== obj.dropped.length || c.needs_review !== obj.needs_review.length || c.additions_rejected !== (ar || []).length) f.push(`counts ${JSON.stringify(c)} do not match the arrays`)
  for (let i = 1; i < obj.rows.length; i++) if (rowOrder(obj.rows[i - 1], obj.rows[i]) > 0) { f.push(`rows are not in canonical order at ${obj.rows[i].source_id}`); break }
  const dr = obj.dropped.map(d => d.osm)
  if (dr.join() !== dr.slice().sort((a, b) => a.localeCompare(b)).join()) f.push('dropped is not sorted by osm ref')
  return f
}

// ─── validate: GEOMETRY (needs OSM elements) ────────────────────────────────
export function validateGeometry(obj, byRef) {
  const f = []
  for (const r of obj.rows) {
    const tag = r.source_id, ref = `${r.osm?.type}/${r.osm?.id}`
    const el = byRef.get(ref)
    if (!el) { f.push(`${tag}: osm element ${ref} not found`); continue }
    if (!onElement(el, r.latitude, r.longitude)) f.push(`${tag}: pin ${r.latitude},${r.longitude} is NOT on/inside OSM ${ref}`)
    const t = el.tags || {}
    if (r.source === 'osm') {
      if (r.private_resort !== (t.leisure === 'beach_resort')) f.push(`${tag}: private_resort ${r.private_resort} but the element's leisure tag is ${t.leisure}`)
      if (r.name_source === 'osm' && nameOf(t) !== r.name) f.push(`${tag}: OSM name is now ${JSON.stringify(nameOf(t))}, row says ${JSON.stringify(r.name)}`)
      if (r.name_source === 'external_evidence' && nameOf(t)) f.push(`${tag}: the outline is named in OSM now (${JSON.stringify(nameOf(t))})`)
      for (const x of r.name_evidence || []) {
        if (x.evidence_point) { const d = Math.round(distToElement(el, x.evidence_point[0], x.evidence_point[1])); if (d !== x.distance_m) f.push(`${tag}: evidence ${x.kind} distance_m ${x.distance_m} but re-measured ${d}`) }
      }
    }
    for (const L of LIVE) if (onElement(el, L.lat, L.lng)) f.push(`LIVE ${L.name} pin lies on the outline of ${tag}`)
  }
  return f
}

function loadLocal(file) {
  const p = path.resolve(file)
  if (!fs.existsSync(p)) { console.log(`RED: snapshot ${file} not found (data/osm/ is gitignored; a rebuild or --verify-geometry without a file needs a local snapshot or a re-fetch)`); process.exit(1) }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function summary(target) {
  const by = {}
  for (const r of target.rows) by[r.region] = (by[r.region] || 0) + 1
  return `rows ${target.rows.length} (${REGIONS.map(g => `${g} ${by[g] || 0}`).join(', ')}) + dropped ${target.dropped.length} + needs_review ${target.needs_review.length}`
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check'), verify = args.includes('--verify-geometry')
  const file = args.find(a => !a.startsWith('--'))
  if (verify) {
    const obj = JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'))
    const refs = [...new Set(obj.rows.map(r => `${r.osm.type}/${r.osm.id}`))]
    let snap, mode
    if (file) { snap = loadLocal(file); mode = `reused ${file}` } else {
      const by = idsOf(refs)
      const q = '[out:json][timeout:120];(' + ['node', 'way', 'relation'].filter(t => by[t].length).map(t => `${t}(id:${by[t].join(',')});`).join('') + ');out geom;'
      snap = await osmSnapshot(ROOT, 'beaches-verify', q)
      mode = 're-fetched by id'
    }
    const f = []
    if (snap.remark) f.push(`Overpass remark: ${snap.remark}`)
    const byRef = new Map(snap.elements.map(e => [refOf(e), e]))
    if (!file && snap.elements.length !== refs.length) f.push(`asked for ${refs.length} elements, got ${snap.elements.length}`)
    const full = snap.elements.length > refs.length + 20
    if (full) f.push(...coverage(snap))
    f.push(...validateGeometry(obj, byRef))
    console.log(`beaches-list --verify-geometry (${mode}; osm_base of the data ${obj.osm_base.join(',')}, of this geometry ${snap.osm3s?.timestamp_osm_base}): ${refs.length} elements requested, ${snap.elements.length} received${full ? ' (full snapshot: curation coverage checked)' : ''}`)
    if (f.length) { console.log(`RED: ${f.length} failure(s)`); for (const x of f) console.log('  - ' + x); process.exit(1) }
    console.log(`GREEN: ${obj.rows.length} rows: every pin on/inside its outline, private_resort = element's own leisure tag, names and evidence distances re-measured`)
    return
  }
  if (check) {
    const p = path.resolve(file || path.join(ROOT, OUT))
    const text = fs.readFileSync(p, 'utf8')
    const obj = JSON.parse(text)
    const fails = validate(obj)
    if (JSON.stringify(obj, null, 2) + '\n' !== text) fails.push(`${path.basename(p)} is not byte-stable (parse + re-serialise differs from the file)`)
    console.log(`beaches-list --check (offline, no geometry): ${summary(obj)}`)
    if (fails.length) { console.log(`RED: ${fails.length} failure(s)`); for (const x of fails) console.log('  - ' + x); process.exit(1) }
    console.log(`GREEN: ${obj.rows.length} rows validated offline`)
    return
  }
  const snap = loadLocal(SNAPSHOT)
  const { obj, problems } = build(snap)
  const fails = [...problems, ...validate(obj), ...validateGeometry(obj, new Map(snap.elements.map(e => [refOf(e), e])))]
  console.log(`beaches-list: snapshot ${snap.elements.length} elements -> ${summary(obj)}`)
  if (fails.length) { console.log(`RED: ${fails.length} failure(s)`); for (const x of fails) console.log('  - ' + x); process.exit(1) }
  fs.mkdirSync(path.join(ROOT, 'data/explore'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(obj, null, 2) + '\n')
  console.log(`GREEN: ${obj.rows.length} rows validated, wrote ${OUT}`)
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
