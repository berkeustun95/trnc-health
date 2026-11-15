#!/usr/bin/env node
// Explore beaches — the curated LIST (step one; no migration exists yet, Berke approves this first).
//
//   node scripts/beaches-list.mjs                 rebuild data/explore/beaches.json from the committed OSM snapshot, validate
//   node scripts/beaches-list.mjs --check [file]  validate a committed (or any) beaches.json; without a file also
//                                                 asserts that a fresh rebuild is byte-identical to the committed one
//
// Inputs (all committed): data/osm/beaches-<base>.json  (Overpass `out geom`, North only, via scripts/lib/osm-snapshot.mjs)
//                         data/explore/beaches-live-translations.json (the 4 live rows, 7 missing locales)
//                         the CURATION block below (every drop/keep/area decision, with its reason).
// Deterministic: generated_at is the snapshot's own osm_base, nothing reads the clock or the network.
// Data © OpenStreetMap contributors, ODbL 1.0. OSM rows carry NAME + PIN only (+ the resort tag evidence).
// Exit 1 on any validation failure.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveRegion, pointInPolygon } from '../utils/resolveRegion.js'
import { inTrncFrame } from '../constants/mapSources.js'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = 'data/osm/beaches-20261115T1853.json'
const OUT = 'data/explore/beaches.json'
const TRANSLATIONS = 'data/explore/beaches-live-translations.json'
const REGIONS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
const NEW_LOCALES = ['ar', 'ru', 'el', 'fr', 'es', 'de', 'fa']
const MIN_SEP_M = 300
const VISITNCY = 'https://www.visitncy.com/discover/beaches/'

// The 4 LIVE beaches (places, category 'beach', read with the anon key 2026-11-15, count exact = 4).
const LIVE = [
  { id: 'fa39492b-57e6-4ebd-b22c-89a9cf20ffe2', name: 'Alagadi Turtle Beach', lat: 35.3302, lng: 33.4972 },
  { id: '4a29cce8-8c3a-4541-8a07-fc7ceda6a4ff', name: 'Escape Beach', lat: 35.3471, lng: 33.2343 },
  { id: 'b52cdf3a-ce3f-4e6f-88b8-57afb95f2e67', name: 'Glapsides Beach', lat: 35.1541, lng: 33.9129 },
  { id: '95b6d924-e3c0-40e4-a2bd-b55ca1a105ef', name: 'Golden Beach (Altın Kumsal)', lat: 35.6412, lng: 34.5423 },
]

// ─── CURATION: every NAMED snapshot element must appear in exactly one of DROP / REVIEW / MERGED / MINISTRY / KEEP ───
const LIVE_DUP = 'Duplicate of a LIVE beach'
const GENERIC = 'Generic name, not a proper name'
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
  'way/606238634': 'resolveRegion(35.083471, 33.98153) is null: the point lies outside constants/regions.js TRNC_OUTLINE. Context from OSM: it is the beach at the Derinya (Deryneia) coast; 2 of its 5 outline vertices fall inside the "Kapalı Maraş" restricted-area relation r12196193 (tagged "Very approximate"), none inside the UN buffer-zone relation r3263735; OSM has an access=no military landuse checkpoint at 35.0834 N 33.9565 E (note "Only Northern Cyprus and Turkish Citizens allowed") 1.6 km west',
  'node/5860707914': 'Probable duplicate of way/608212204 (Bella Marin Beach): the node "Bella Marin" (leisure=beach_resort, fee=yes) is 452 m from the way and NOT on its outline, so same-beach is a guess by name; the way is kept (pin on the outline), and the node\'s tags are NOT applied to the row — question for Berke',
}
// Kept as ONE row from two OSM elements: the dropped element's resort tags are carried onto the kept row.
const MERGED = { 'way/608212204': 'node/5860707914' }

const REVIEW = {
  'way/396559851': 'Palm beach — OSM test result: 9 of its 47 outline vertices fall inside the "Kapalı Maraş" restricted-area relation r12196193 (OSM tags that relation "Very approximate"; its stitched rings did not contain the pin itself); 0 inside the UN buffer zone r3263735. The OSM node "Varosha Entrance" (barrier=gate, access=no, fee=no, foot:conditional=permissive in daily opening hours, motor_vehicle=no) is 355 m from the pin. OSM cannot establish whether this stretch is open to the public',
  'relation/12567504': 'Glossa Beach — OSM test result: 47 of its 93 outline vertices fall inside the "Kapalı Maraş" relation r12196193 ("Very approximate"), 20 inside the military-landuse relation r12567503 "Gazimağusa Orduevi" (name:en "Turkish Army Base"), 0 inside the UN buffer zone; OSM carries military checkpoints at 35.1014 N 33.9646 E (access=no) and 35.1057 N 33.9615 E. A 2.7 km shore strip; OSM cannot establish that it is open to the public',
  'relation/15456405': 'Makenzi Plajı (OSM name:en "Mckenzie Beach") — 1.5 km multipolygon near Salamis Bay at about 35.251 N 33.905 E; possible Long Beach candidate (Salamis Bay), not confident',
  'node/6595054185': 'Lapta Belediye Plajı (name:en Lapta Municipality Public Beach) — a beach_resort point tagged fee=no that sits on the way/208111924 "Güzelyalı Beach" outline: one beach with two names or two neighbours; also the resort rule would call a free municipal beach private_resort=true',
}

// Ministry beaches (visitncy.com/discover/beaches/, credit "Turizm Bakanlığı"). Text verbatim from the page.
const MINISTRY = [
  {
    source_id: 'long-beach', name: 'Long Beach', osm: null, area: null,
    description_en_site: 'Situated on the Salamis Bay, 15 kilometres north of Famagusta and near to the ruins of Salamis, this magnificent sandy beach is ideal to spend time relaxing with a range of available facilities. A shuttle service also runs from town to the beach.',
    facts: [
      { quote: 'this magnificent sandy beach is ideal to spend time relaxing with a range of available facilities', relates_to: null, note: 'facilities are not itemised on the page' },
      { quote: 'A shuttle service also runs from town to the beach.', relates_to: null, note: 'no allowed slug covers a shuttle' },
    ],
    pending: 'No OSM element is named "Long Beach"; coordinates, region and area wait for Berke (see needs_review)',
  },
  {
    source_id: 'kervansaray-beach', name: 'Kervansaray Beach', osm: 'way/217651068', area: null,
    description_en_site: 'Operated by the Municipality of Kyrenia, this is a popular leisure area to be enjoyed by the public. In the heart of Kyrenia in the Kervansaray area, this beach has a range of facilities. Sunbeds and umbrellas, dressing rooms and showers, restaurants and even an additional artificial grass sunbathing area for those who don’t like to get sand in their feet. The beach also has a car park for the disabled with easy access to the beach side. As the cove of Kervansaray is a stop for most boat tours from Kyrenia Harbour, a designated swimming area is separated by buoys to ensure safety of swimmers. The beach also has a lifeguard tower with first aid and lifeguard supplies.',
    facts: [
      { quote: 'Sunbeds and umbrellas', relates_to: 'sunbeds' },
      { quote: 'restaurants', relates_to: 'food_bar' },
      { quote: 'The beach also has a car park for the disabled with easy access to the beach side.', relates_to: 'parking', note: 'the page says a car park FOR THE DISABLED, not general parking' },
      { quote: 'The beach also has a lifeguard tower with first aid and lifeguard supplies.', relates_to: 'lifeguard' },
      { quote: 'dressing rooms and showers', relates_to: null, note: 'no allowed slug; toilets are not mentioned' },
      { quote: 'Operated by the Municipality of Kyrenia, this is a popular leisure area to be enjoyed by the public.', relates_to: 'access_type', note: 'municipal, "enjoyed by the public"; the page never says free or paid' },
    ],
    area_note: 'The page says "in the Kervansaray area"; constants/areas.js has no Kervansaray area, so area stays null. 20261179 files two Kervansaray Mevkii addresses under "Karaoğlanoğlu Caddesi": Karaoğlanoğlu is a possible pick if Berke wants one.',
  },
]

// KEEP: element ref -> area NAME (constants/areas.js) or null. area only where the NAME or an OSM tag says the locality.
const KEEP = {
  'way/225383964': { area: 'Alsancak', why: 'name contains "Alsancak"' },
  'way/208150337': { area: 'Karaoğlanoğlu', why: 'name contains "Karaoğlanoğlu"' },
  'way/603986283': { area: 'Esentepe', why: 'name contains "Esentepe"' },
  'way/435772839': { area: 'Bafra', why: 'name contains "Bafra" (name:en "Bafra Beach"); the name also says "Mehmetçik", a second karpaz area: Bafra chosen' },
  'way/208111924': { area: null }, 'way/208241783': { area: null }, 'way/225382750': { area: null },
  'way/225386412': { area: null }, 'way/229043037': { area: null }, 'way/244561269': { area: null },
  'way/286275732': { area: null }, 'way/286276160': { area: null }, 'way/435771323': { area: null },
  'way/510986434': { area: null }, 'way/603896219': { area: null }, 'way/606238631': { area: null },
  'way/608212204': { area: null }, 'way/666114116': { area: null }, 'way/952236170': { area: null },
  'way/1395325670': { area: null }, 'way/1484271058': { area: null },
  'node/1951274050': { area: null }, 'node/11231014679': { area: null }, 'node/11994931556': { area: null },
  'relation/13040159': { area: null },
}
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
const edgeDistM = (lat, lng, ring) => {
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

// ─── build ──────────────────────────────────────────────────────────────────
const refOf = e => `${e.type}/${e.id}`
const nameOf = t => t.name || t['name:tr'] || t['name:en'] || null
const seen = t => { const o = {}; for (const k of ['surface', 'access', 'fee', 'operator']) if (t[k] != null) o[k] = t[k]; return o }
const resortEvidence = t => {
  const ev = []
  if (t.leisure === 'beach_resort') ev.push('leisure=beach_resort')
  if (t.access === 'private') ev.push('access=private')
  return ev
}
const resortTagsOf = t => { const o = {}; for (const k of ['leisure', 'fee', 'access', 'operator']) if (t[k] != null) o[k] = t[k]; return o }
const areaFor = (region, name) => {
  if (name == null) return null
  const hit = (AREAS_BY_REGION[region] || []).find(n => n === name)
  return hit ? areaSlug(hit) : { invalid: name }
}

export function build() {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, SNAPSHOT), 'utf8'))
  const byRef = new Map(snap.elements.map(e => [refOf(e), e]))
  const named = snap.elements.filter(e => nameOf(e.tags || {}))
  const accounted = new Set([...Object.keys(DROP), ...Object.keys(REVIEW), ...Object.keys(MERGED), ...Object.keys(KEEP), ...MINISTRY.map(m => m.osm).filter(Boolean)])
  const problems = []
  for (const e of named) if (!accounted.has(refOf(e))) problems.push(`named element ${refOf(e)} is in no curation list`)
  for (const r of accounted) if (!byRef.has(r)) problems.push(`curation names ${r}, not in the snapshot`)

  const rows = []
  const rowFor = (el, extra) => {
    const t = el.tags, pin = pinOf(el), region = resolveRegion(pin.lat, pin.lng)
    return { el, t, pin, region, extra }
  }
  for (const m of MINISTRY) {
    const base = { name: m.name, name_tr: null, name_en: null, source: 'visitncy_beaches', source_id: m.source_id, source_url: VISITNCY, credit: 'Turizm Bakanlığı' }
    if (!m.osm) {
      rows.push({ ...base, region: null, area: null, latitude: null, longitude: null, osm: null, pin_method: null, private_resort: false, resort_evidence: [], osm_tags_seen: {}, description_en_site: m.description_en_site, facts: m.facts, pending: m.pending })
      continue
    }
    const { el, t, pin, region } = rowFor(byRef.get(m.osm))
    const area = areaFor(region, m.area)
    rows.push({ ...base, name_tr: t['name:tr'] || null, name_en: t['name:en'] || null, region, area, latitude: pin.lat, longitude: pin.lng, osm: { type: el.type, id: el.id }, pin_method: pin.pin_method, private_resort: false, resort_evidence: [], osm_tags_seen: seen(t), description_en_site: m.description_en_site, facts: m.facts, area_note: m.area_note })
  }
  for (const [ref, cfg] of Object.entries(KEEP)) {
    const el = byRef.get(ref)
    if (!el) continue
    const { t, pin, region } = rowFor(el)
    const ev = resortEvidence(t), tags = seen(t)
    const merged = MERGED[ref] || null
    const sibTags = merged ? resortTagsOf(byRef.get(merged).tags) : null
    rows.push({
      name: nameOf(t), name_tr: t['name:tr'] || null, name_en: t['name:en'] || null,
      region, area: areaFor(region, cfg.area), area_why: cfg.why || null, latitude: pin.lat, longitude: pin.lng,
      source: 'osm', source_id: ref, osm: { type: el.type, id: el.id }, merged_duplicate: merged, merged_duplicate_tags_for_berke: sibTags, pin_method: pin.pin_method,
      private_resort: ev.length > 0, resort_evidence: ev, osm_tags_seen: tags,
      description: null, amenities: [], blue_flag: null, access_type: null,
    })
  }
  const regionIdx = r => (r ? REGIONS.indexOf(r) : 99)
  rows.sort((a, b) => (a.source === 'osm') - (b.source === 'osm') || regionIdx(a.region) - regionIdx(b.region) || a.name.localeCompare(b.name, 'tr'))
  const dropped = Object.entries(DROP).map(([ref, reason]) => ({ name: nameOf(byRef.get(ref)?.tags || {}), osm: ref, reason })).sort((a, b) => a.osm.localeCompare(b.osm))
  const needs_review = Object.entries(REVIEW).map(([ref, note]) => {
    const el = byRef.get(ref), p = el ? pinOf(el) : null
    return { name: nameOf(el?.tags || {}), osm: ref, at: p ? [p.lat, p.lng] : null, resolveRegion: p ? resolveRegion(p.lat, p.lng) : null, note }
  })
  const LB = ['way/1568098280', 'way/1568098281', 'way/1365670207', 'way/309630489', 'way/435771324', 'relation/15456405']
  needs_review.push({ name: 'Long Beach (Ministry)', osm: null, at: null, resolveRegion: null,
    note: 'No OSM element is named Long Beach; the row exists with null coordinates/region/area until Berke picks a pin. Candidates (all unnamed except Makenzi) with what resolveRegion says at each pin:',
    candidates: LB.filter(r => byRef.has(r)).map(r => { const p = pinOf(byRef.get(r)); const t = byRef.get(r).tags; return { osm: r, name: nameOf(t), tags: { natural: t.natural, leisure: t.leisure, surface: t.surface }, at: [p.lat, p.lng], resolveRegion: resolveRegion(p.lat, p.lng) } }) })
  const unnamed = snap.elements.length - named.length
  return {
    obj: {
      generated_at: snap.osm3s.timestamp_osm_base, osm_snapshot: SNAPSHOT, osm_base: snap.osm3s.timestamp_osm_base,
      attribution: { osm: '© OpenStreetMap contributors, ODbL 1.0', ministry: 'Turizm Bakanlığı (visitncy.com)' },
      counts: { snapshot_elements: snap.elements.length, named: named.length, unnamed_not_candidates: unnamed, rows: rows.length, dropped: dropped.length, needs_review: needs_review.length },
      rows, dropped, needs_review, live_translations: JSON.parse(fs.readFileSync(path.join(ROOT, TRANSLATIONS), 'utf8')),
    },
    snap, byRef, problems,
  }
}

// ─── validate ───────────────────────────────────────────────────────────────
export function validate(obj, snap, byRef) {
  const f = []
  const ids = new Set()
  const geo = []
  for (const r of obj.rows) {
    const tag = `${r.source_id}`
    if (ids.has(r.source_id)) f.push(`duplicate source_id ${tag}`)
    ids.add(r.source_id)
    if (!['osm', 'visitncy_beaches'].includes(r.source)) f.push(`${tag}: bad source ${r.source}`)
    if (r.source === 'osm') {
      for (const k of ['description', 'blue_flag', 'access_type']) if (r[k] != null) f.push(`${tag}: OSM row carries ${k}`)
      if ((r.amenities || []).length) f.push(`${tag}: OSM row carries amenities`)
      if (!/^(node|way|relation)\/\d+$/.test(r.source_id)) f.push(`${tag}: source_id is not <type>/<id>`)
    }
    if (r.latitude == null || r.longitude == null) {
      if (!r.pending) f.push(`${tag}: null coordinates without a pending note`)
      if (r.region != null || r.area != null) f.push(`${tag}: region/area set without a pin`)
      continue
    }
    if (!inTrncFrame(r.latitude, r.longitude)) f.push(`${tag}: outside inTrncFrame`)
    const rr = resolveRegion(r.latitude, r.longitude)
    if (!REGIONS.includes(r.region)) f.push(`${tag}: region ${r.region} not one of the 7`)
    else if (rr !== r.region) f.push(`${tag}: region ${r.region} but resolveRegion gives ${rr}`)
    if (r.area != null) {
      const names = AREAS_BY_REGION[r.region] || []
      if (!names.some(n => areaSlug(n) === r.area)) f.push(`${tag}: area ${r.area} not valid for ${r.region}`)
    }
    const el = byRef.get(`${r.osm?.type}/${r.osm?.id}`)
    if (!el) f.push(`${tag}: osm element ${JSON.stringify(r.osm)} not in the snapshot`)
    else if (!onElement(el, r.latitude, r.longitude)) f.push(`${tag}: pin ${r.latitude},${r.longitude} is NOT on/inside OSM ${r.osm.type}/${r.osm.id}`)
    if (r.source === 'osm' && r.source_id !== `${r.osm?.type}/${r.osm?.id}`) f.push(`${tag}: source_id disagrees with osm ref`)
    geo.push({ id: r.source_id, lat: r.latitude, lng: r.longitude, el })
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
      if (geo[i].el && onElement(geo[i].el, L.lat, L.lng) && !allowed(geo[i].id, L.id)) f.push(`LIVE ${L.name} pin lies on the outline of ${geo[i].id}`)
    }
  }
  const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261179_osm_free_listings.sql'), 'utf8')
  const used = new Set([...mig.matchAll(/'osm', '((?:node|way|relation)\/\d+)'/g)].map(m => m[1]))
  if (used.size < 100) f.push(`20261179 ids parsed: only ${used.size} (parser broken?)`)
  for (const r of obj.rows) if (used.has(r.source_id)) f.push(`${r.source_id} already exists in 20261179`)
  const lt = obj.live_translations || {}
  if (Object.keys(lt).sort().join() !== LIVE.map(l => l.id).sort().join()) f.push('live_translations keys are not exactly the 4 live ids')
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
    if (/Caretta caretta/.test(t.source?.description_i18n?.en || '')) for (const code of NEW_LOCALES) if (!t.description_i18n?.[code]?.includes('Caretta caretta')) f.push(`live ${L.name} description ${code} lost "Caretta caretta"`)
  }
  return f
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const file = args.find(a => !a.startsWith('--'))
  const { obj, snap, byRef, problems } = build()
  const text = JSON.stringify(obj, null, 2) + '\n'
  let target = obj
  if (check && file) target = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  const fails = [...problems, ...validate(target, snap, byRef)]
  if (check && !file) {
    const committed = fs.existsSync(path.join(ROOT, OUT)) ? fs.readFileSync(path.join(ROOT, OUT), 'utf8') : ''
    if (committed !== text) fails.push(`${OUT} is not byte-identical to a fresh rebuild`)
  }
  if (!check) { fs.mkdirSync(path.join(ROOT, 'data/explore'), { recursive: true }); fs.writeFileSync(path.join(ROOT, OUT), text) }
  const c = target.counts
  console.log(`beaches-list: snapshot ${c.snapshot_elements} elements (${c.named} named, ${c.unnamed_not_candidates} unnamed) -> rows ${target.rows.length} (kept ${target.rows.length}) + dropped ${target.dropped.length} + needs_review ${target.needs_review.length} + merged/ministry accounted`)
  if (fails.length) { console.log(`RED: ${fails.length} failure(s)`); for (const x of fails) console.log('  - ' + x); process.exit(1) }
  console.log(`GREEN: ${target.rows.length} rows validated${check ? '' : `, wrote ${OUT}`}`)
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
