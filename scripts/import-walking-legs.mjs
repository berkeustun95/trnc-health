#!/usr/bin/env node
// ─── Walking legs: route every stop-to-stop leg once, through openrouteservice ─
//
//   node scripts/import-walking-legs.mjs --dry    # route + print the quality table, write nothing
//   node scripts/import-walking-legs.mjs          # route + write walking_legs (service_role)
//   node scripts/import-walking-legs.mjs --force  # re-route legs that already look current
//
// REQUIRES 20261049_walking_legs.sql for a write run (a --dry run works without it).
// Key: macOS Keychain `ada-ors-api-key` (never printed). DB: Keychain `ada-supabase-service-role`.
//
// ─── WHAT IT DOES ───────────────────────────────────────────────────────────
// For every consecutive pair of stops on every route (from the places' CURRENT coordinates),
// asks ORS foot-walking for the path and stores it as one directed leg. A leg already in the
// table is skipped while its path still starts and ends within STALE_M of the two places —
// the same test the app uses — so a re-run only re-routes what a moved pin made stale.
//
// ─── QUALITY GATE: A FLAGGED LEG IS NOT WRITTEN ─────────────────────────────
// Ratio routed/straight > MAX_RATIO, or a stop more than MAX_SNAP_M from where the router
// joined the path network, means the router probably found a different place or a long way
// round (a gate it could not see, a missing footpath). Those legs are printed and SKIPPED —
// the app draws them as dashed straight lines — and the run exits 1, so a flag is a
// decision for a person, never something a re-run quietly accepts. Very short legs (< 60 m
// straight) are exempt from the ratio: stop pins sit inside buildings, so 30 m can route 80.
//
// Rate: ORS Standard allows 40 directions/minute and 2,000/day; one call per 1.6 s.
// Attribution for the stored geometry: © openrouteservice by HeiGIT, © OpenStreetMap
// contributors (CC-BY-SA 4.0 / ODbL) — shown on the map wherever these paths are drawn.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { metresBetween } from '../constants/walkingRoutes.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'
const GAP_MS = 1600
const MAX_RATIO = 2.5
// A stop pin often sits ON a monument the footpath network does not enter (Gazimağusa's
// walled city: Othello, Martinengo, Carmelite). The path is stored ending at the nearest
// walkable point and the app draws a short DASHED STUB from there to the pin (Berke,
// 2026-09-24). Up to MAX_STUB_M is accepted — kept under the app's STALE_M (50 m), or the
// leg would read as stale the moment it was written.
const MAX_STUB_M = 45
const SHORT_LEG_M = 60
// Short legs are exempt from the RATIO (pins sit inside buildings), but not from this: a
// 16 m leg routed as 135 m (Girne 2→3, 2026-09-24) draws a loop that reads as a bug.
const MAX_EXTRA_M = 100
const STALE_M = 50
const dry = process.argv.includes('--dry')
const force = process.argv.includes('--force')

const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
function keychain(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { fail(`Keychain entry "${service}" not found.`) }
}
function loadEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const pt = ([lng, lat]) => ({ latitude: lat, longitude: lng })
const r5 = n => Math.round(n * 1e5) / 1e5

loadEnv()
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, keychain('ada-supabase-service-role'),
  { auth: { persistSession: false, autoRefreshToken: false } })
const ORS_KEY = keychain('ada-ors-api-key')

const { data: routes, error: re } = await db.from('walking_routes')
  .select('source_id, name_i18n, walking_route_stops(position, places(id, name, latitude, longitude))')
  .order('sort_order')
if (re) fail(`Reading routes: ${re.message}`)

let existing = new Map(), tableReady = true
{
  const { data, error } = await db.from('walking_legs').select('from_place_id, to_place_id, path')
  if (error) {
    tableReady = false
    if (!dry) fail(`walking_legs is not readable (${error.message}). Apply 20261049_walking_legs.sql first.`)
  } else existing = new Map(data.map(l => [`${l.from_place_id}>${l.to_place_id}`, l.path]))
}

// Unique directed pairs across all routes (a pair shared by two routes is routed once).
const pairs = new Map()
for (const r of routes) {
  const st = r.walking_route_stops.sort((a, b) => a.position - b.position).map(s => s.places)
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i]
    const key = `${a.id}>${b.id}`
    if (!pairs.has(key)) pairs.set(key, { a, b, route: r.name_i18n.en, leg: `${i}→${i + 1}` })
  }
}

const rows = [], flagged = [], skipped = []
let n = 0
for (const [key, { a, b, route, leg }] of pairs) {
  const straight = metresBetween(a, b)
  const old = existing.get(key)
  if (old && !force && metresBetween(pt(old[0]), a) <= STALE_M && metresBetween(pt(old[old.length - 1]), b) <= STALE_M) {
    skipped.push(key); continue
  }
  if (n++ > 0) await sleep(GAP_MS)
  const res = await fetch(ORS_URL, {
    method: 'POST',
    headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify({ coordinates: [[a.longitude, a.latitude], [b.longitude, b.latitude]] }),
  })
  if (!res.ok) {
    flagged.push({ route, leg, a: a.name, b: b.name, why: `ORS HTTP ${res.status}` })
    if (res.status === 401 || res.status === 403) fail('ORS rejected the key (HTTP ' + res.status + ').')
    continue
  }
  const f = (await res.json()).features?.[0]
  const coords = f?.geometry?.coordinates ?? []
  const metres = Math.round(f?.properties?.summary?.distance ?? 0)
  const seconds = Math.round(f?.properties?.summary?.duration ?? 0)
  if (coords.length < 2 || metres <= 0) { flagged.push({ route, leg, a: a.name, b: b.name, why: 'no path' }); continue }
  const snapA = metresBetween(pt(coords[0]), a), snapB = metresBetween(pt(coords[coords.length - 1]), b)
  const ratio = metres / Math.max(straight, 1)
  const why = [
    straight >= SHORT_LEG_M && ratio > MAX_RATIO ? `ratio ${ratio.toFixed(2)}` : null,
    metres - straight > MAX_EXTRA_M && ratio > MAX_RATIO ? `+${Math.round(metres - straight)} m over the straight line` : null,
    snapA > MAX_STUB_M ? `start stub ${Math.round(snapA)} m` : null,
    snapB > MAX_STUB_M ? `end stub ${Math.round(snapB)} m` : null,
  ].filter(Boolean).join(', ')
  const line = { route, leg, a: a.name, b: b.name, straight: Math.round(straight), metres, seconds,
                 ratio: ratio.toFixed(2), snap: `${Math.round(snapA)}/${Math.round(snapB)}`, points: coords.length }
  console.log(`  ${why ? '✗' : '✓'} ${route.padEnd(20)} ${leg.padEnd(6)} ${String(line.straight).padStart(4)} m → ${String(metres).padStart(5)} m  ×${line.ratio}  snap ${line.snap} m  ${coords.length} pts${why ? '   ⇐ ' + why : ''}   ${a.name} → ${b.name}`)
  if (why) { flagged.push({ ...line, why }); continue }
  // The walk includes the stubs (pin → path, path → pin), at the router's own pace.
  const stubs = snapA + snapB
  rows.push({ from_place_id: a.id, to_place_id: b.id, path: coords.map(([x, y]) => [r5(x), r5(y)]),
              metres: Math.round(metres + stubs), seconds: Math.round(seconds * (metres + stubs) / metres),
              source: 'ors', fetched_at: new Date().toISOString() })
}

const routedM = rows.reduce((s, r) => s + r.metres, 0)
const straightM = rows.reduce((s, r) => s + metresBetween(pairs.get(`${r.from_place_id}>${r.to_place_id}`).a, pairs.get(`${r.from_place_id}>${r.to_place_id}`).b), 0)
console.log(`\n${pairs.size} legs · ${rows.length} routed OK · ${flagged.length} flagged · ${skipped.length} already current`)
if (rows.length) console.log(`distance-weighted detour over the good legs: ×${(routedM / straightM).toFixed(2)} (the straight-line estimate used ×1.3)`)

if (!dry && rows.length) {
  const { error } = await db.from('walking_legs').upsert(rows, { onConflict: 'from_place_id,to_place_id' })
  if (error) fail(`Writing walking_legs: ${error.message}`)
  const { count } = await db.from('walking_legs').select('*', { count: 'exact', head: true })
  console.log(`wrote ${rows.length} legs · walking_legs now holds ${count}`)
} else if (dry) console.log(`(dry) nothing written${tableReady ? '' : ' — walking_legs does not exist yet'}`)

if (flagged.length) {
  console.error(`\n${flagged.length} leg(s) NOT written — check each on a map; the app draws them dashed:`)
  for (const f of flagged) console.error(`  • ${f.route} ${f.leg}: ${f.a} → ${f.b} — ${f.why}`)
  process.exit(1)
}
