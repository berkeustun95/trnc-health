// Partner pins always fully visible (Berke 2026-11-08). On Android a marker's zIndex never reaches the
// native view on this build (react-native-maps 1.20.1, new-architecture interop — measured), and Google
// Maps draws whatever lies further south on top. So the map keeps the space around a partner clear
// instead: a free pin whose drawn box would overlap a partner's logo is hidden, and a cluster is moved
// just below the logo (its count stays visible). Pure, screen-space, in dp; scripts/test-partner-clearance.mjs.
//
// Boxes relative to the marker's coordinate, y down: a partner logo is centred (anchor 0.5,0.5, 44 dp + its
// star); a default pin stands on its point (≈ 28 × 44 dp, above it); a cluster or icon disc is centred.
const PARTNER = { l: -26, r: 26, t: -26, b: 26 }
const GAP = 4

export function markerBox(c) {
  if (c.properties?.cluster) {
    const n = c.properties.point_count
    const h = (n < 10 ? 38 : n < 100 ? 46 : 54) / 2   // ExploreMapScreen ClusterMarker sizes
    return { l: -h, r: h, t: -h, b: h }
  }
  const pin = c.properties?.pin
  if (pin?.kind === 'place' && pin.iconPin) return { l: -15, r: 15, t: -15, b: 15 }
  return { l: -14, r: 14, t: -44, b: 0 }
}

// lng/lat → dp offset from the region centre (equirectangular; exact enough at map zooms within a city).
export function toScreen(lng, lat, region, width, height) {
  return {
    x: ((lng - region.longitude) / region.longitudeDelta) * width,
    y: ((region.latitude - lat) / region.latitudeDelta) * height,
  }
}

const hit = (a, ax, ay, b, bx, by) =>
  ax + a.l < bx + b.r + GAP && ax + a.r > bx + b.l - GAP && ay + a.t < by + b.b + GAP && ay + a.b > by + b.t - GAP

// clusters: Supercluster features. partners: pins {lat, lng}. Returns the features to draw; a moved cluster
// carries `drawAt` = { latitude, longitude } (the tap still expands the real cluster).
export function clearOfPartners(clusters, partners, region, width, height) {
  if (!partners.length || !region || !width || !height) return clusters
  const ps = partners.map(p => toScreen(p.lng, p.lat, region, width, height))
  const out = []
  for (const c of clusters) {
    const [lng, lat] = c.geometry.coordinates
    const s = toScreen(lng, lat, region, width, height)
    const box = markerBox(c)
    const over = ps.find(p => hit(box, s.x, s.y, PARTNER, p.x, p.y))
    if (!over) { out.push(c); continue }
    if (!c.properties.cluster) continue   // a free pin under a partner: hidden at this zoom
    // A cluster: straight below the logo, clear of it; drop it if that spot is taken by another partner.
    const y = over.y + PARTNER.b + GAP - box.t
    if (ps.some(p => hit(box, s.x, y, PARTNER, p.x, p.y))) continue
    out.push({ ...c, drawAt: {
      latitude: region.latitude - (y / height) * region.latitudeDelta,
      longitude: lng,
    } })
  }
  return out
}
