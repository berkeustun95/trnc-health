// utils/partnerClearance.js: nothing a free pin or cluster draws may overlap a partner logo.
import assert from 'node:assert/strict'
import { clearOfPartners, toScreen, markerBox } from '../utils/partnerClearance.js'

const W = 400, H = 800
// ~0.004° lat across 800 dp → 1 dp ≈ 0.000005°, a close old-city zoom.
const region = { latitude: 35.175, longitude: 33.362, latitudeDelta: 0.004, longitudeDelta: 0.002 }
const dLat = dp => (dp / H) * region.latitudeDelta
const dLng = dp => (dp / W) * region.longitudeDelta
const partner = { lat: 35.175, lng: 33.362 }
const pinAt = (dx, dy, extra = {}) => ({ type: 'Feature', properties: { pin: { kind: 'place', ...extra } },
  geometry: { coordinates: [partner.lng + dLng(dx), partner.lat - dLat(dy)] } })
const clusterAt = (dx, dy, n = 10) => ({ type: 'Feature', properties: { cluster: true, cluster_id: 1, point_count: n },
  geometry: { coordinates: [partner.lng + dLng(dx), partner.lat - dLat(dy)] } })

// A default pin standing just SOUTH of the partner (its body reaches up over the logo): hidden.
let out = clearOfPartners([pinAt(0, 30)], [partner], region, W, H)
assert.equal(out.length, 0, 'pin whose body covers the logo is hidden')
// Far away: kept.
out = clearOfPartners([pinAt(120, 120)], [partner], region, W, H)
assert.equal(out.length, 1, 'far pin kept')
// Directly north of the logo, standing above it: its box ends at its point, above the logo → kept.
out = clearOfPartners([pinAt(0, -40)], [partner], region, W, H)
assert.equal(out.length, 1, 'pin above the logo, not overlapping, kept')
// Icon disc overlapping: hidden.
out = clearOfPartners([pinAt(10, 10, { iconPin: true })], [partner], region, W, H)
assert.equal(out.length, 0, 'icon disc overlapping hidden')

// A cluster on top of the partner: moved below, and the moved box no longer overlaps.
out = clearOfPartners([clusterAt(5, 10)], [partner], region, W, H)
assert.equal(out.length, 1, 'cluster kept (moved)')
assert.ok(out[0].drawAt, 'cluster has drawAt')
const p = toScreen(partner.lng, partner.lat, region, W, H)
const m = toScreen(out[0].drawAt.longitude, out[0].drawAt.latitude, region, W, H)
const b = markerBox(out[0])
assert.ok(m.y + b.t >= p.y + 26, `moved cluster top ${m.y + b.t} clears logo bottom ${p.y + 26}`)

// No partners: identity.
const cs = [pinAt(0, 30)]
assert.equal(clearOfPartners(cs, [], region, W, H), cs)

console.log('partner clearance: OK (hide overlapping pins/discs, move clusters below, keep the rest)')
