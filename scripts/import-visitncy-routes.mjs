#!/usr/bin/env node
// ─── Visit NCY walking maps — routes (slice 2) ───────────────────────────────
//
//   node scripts/import-visitncy-routes.mjs --dry   # resolve + compute + print, write nothing
//   node scripts/import-visitncy-routes.mjs         # write routes (inactive) and their stops
//
// REQUIRES 20261048_walking_routes.sql and the slice-1 stop import (every stop must already
// be a places row). The order of each MapHub map's features IS the walk — recon measured it
// within 6–8% of the optimal tour on the three big maps.
//
// ─── WHAT IT COMPUTES, AND FROM WHAT ────────────────────────────────────────
// Every stop resolves to a places ROW — imported Visit NCY stops by source_id, the 22 stops we
// already had through scripts/data/visitncy/matches.json — and legs are measured between those
// rows' CURRENT coordinates, never MapHub's raw pins. That is Berke's rule, and it matters
// where the two differ: Kutup Osman moved 363 m to its OSM position on 2026-09-23.
//
// TRAILING TAIL: after the LAST leg longer than TAIL_JUMP_M, the rest of the list is the map's
// "other sights in town", not the walk, and is dropped. Long legs earlier in the route stay.
// A route needs MIN_STOPS after trimming, or there is no route (İskele has 3 pins).
//
// ─── WRITES ──────────────────────────────────────────────────────────────────
// Routes are upserted on (source, source_id) and is_active is NEVER in the payload: a new route
// lands with the column DEFAULT (false, dark) and an existing route keeps whatever it has — a
// re-run can neither publish a route nor pull a live one. Stops are a full recompute per route:
// delete, then insert. That is not atomic over REST; a failure between the two leaves a route
// with no stops, and re-running heals it.
//
// CREDENTIALS — macOS Keychain, service_role (the only role that can write these tables).

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'scripts/data/visitncy')
const SOURCE = 'visitncy'
const TAIL_JUMP_M = 1000
const MIN_STOPS = 4
const dry = process.argv.includes('--dry')

// Map → route identity. Names mirror Visit NCY's own map titles ("Kyrenia City Map / Girne
// Şehir Haritası"); sort_order is the order the region chips list the cities in.
const MAPS = [
  { slug: 'lefkosa-city-map-sehir-haritasi',              region: 'nicosia',   en: 'Nicosia City Walk',   tr: 'Lefkoşa Şehir Yürüyüşü' },
  { slug: 'kyrenia-city-map-girne-sehir-haritasi',        region: 'kyrenia',   en: 'Kyrenia City Walk',   tr: 'Girne Şehir Yürüyüşü' },
  { slug: 'famagusta-city-map-gazimagusa-sehir-haritasi', region: 'famagusta', en: 'Famagusta City Walk', tr: 'Gazimağusa Şehir Yürüyüşü' },
  { slug: 'Guzelyurt-City-Map',                           region: 'morphou',   en: 'Güzelyurt City Walk', tr: 'Güzelyurt Şehir Yürüyüşü' },
  { slug: 'lefke',                                        region: 'lefke',     en: 'Lefke Town Walk',     tr: 'Lefke Kasaba Yürüyüşü' },
  { slug: 'Iskele',                                       region: 'iskele',    en: 'İskele Walk',         tr: 'İskele Yürüyüşü' },
]

const fail = (...lines) => { for (const l of lines) console.error(l); process.exit(1) }

function loadEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
function serviceRoleKey() {
  let out
  try {
    out = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { fail('Keychain entry "ada-supabase-service-role" not found.') }
  const key = out.trim()
  if (!key || key.startsWith('sb_publishable_')) fail('Keychain entry "ada-supabase-service-role" is empty or holds the publishable key.')
  return key
}
function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

loadEnv()
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')
const db = createClient(URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })

// Pre-flight: 20261048 applied.
{
  const { error } = await db.from('walking_routes').select('id').limit(1)
  if (error) fail(`Pre-flight: walking_routes is not readable (${error.code ?? ''} ${error.message}).`, 'Apply 20261048_walking_routes.sql first.')
}

const { data: places, count, error: pe } = await db.from('places')
  .select('id, name, status, source, source_id, latitude, longitude', { count: 'exact' }).range(0, 9999)
if (pe) fail(`Reading places: ${pe.message}`)
if (count !== places.length) fail(`Reading places: ${count} exist but ${places.length} arrived — truncated.`)
const bySource = new Map(places.filter(p => p.source === SOURCE).map(p => [p.source_id, p]))
const byId = new Map(places.map(p => [p.id, p]))
const matched = new Map(JSON.parse(readFileSync(join(DATA, 'matches.json'), 'utf8')).matches.map(m => [m.maphub_id, m.place_id]))

const plans = []
const problems = []
MAPS.forEach((m, sortIndex) => {
  const features = JSON.parse(readFileSync(join(DATA, `${m.slug}.geojson`), 'utf8')).features
  const stops = features.map(f => {
    const p = bySource.get(String(f.id)) ?? byId.get(matched.get(f.id))
    if (!p) problems.push(`${m.slug}: MapHub feature ${f.id} resolves to no places row`)
    else if (p.status === 'rejected') problems.push(`${m.slug}: stop "${p.name}" is REJECTED`)
    else if (p.latitude == null) problems.push(`${m.slug}: stop "${p.name}" has no coordinates`)
    return p
  })
  if (stops.some(s => !s || s.latitude == null)) return
  const legs = stops.slice(1).map((s, i) => Math.round(metres(stops[i], s)))
  let lastJump = -1
  legs.forEach((l, i) => { if (l > TAIL_JUMP_M) lastJump = i })
  const kept = lastJump >= 0 ? stops.slice(0, lastJump + 1) : stops
  const keptLegs = legs.slice(0, kept.length - 1)
  plans.push({ ...m, sortIndex, all: stops.length, kept, keptLegs,
               trimmed: stops.slice(kept.length).map(s => s.name),
               km: Math.round(keptLegs.reduce((a, b) => a + b, 0) / 10) / 100,
               route: kept.length >= MIN_STOPS })
})
if (problems.length) fail(`REFUSING — ${problems.length} stop(s) cannot be placed:`, ...problems.map(p => `  • ${p}`))

console.log('Visit NCY routes — computed from the places rows\' CURRENT coordinates')
for (const p of plans) {
  const head = `  ${p.tr.padEnd(28)} ${String(p.all).padStart(2)} pins → `
  if (!p.route) { console.log(head + `no route (${p.kept.length} < ${MIN_STOPS} stops)`); continue }
  console.log(head + `${p.kept.length} stops · ${p.km.toFixed(2)} km straight · longest leg ${Math.max(...p.keptLegs)} m` +
    (p.trimmed.length ? ` · tail trimmed: ${p.trimmed.join(', ')}` : ''))
  const pending = p.kept.filter(s => s.status !== 'active').length
  if (pending) console.log(`  ${''.padEnd(28)}    ${pending} of its stops are not active yet — the route shows them only after activation`)
}
const routes = plans.filter(p => p.route)
if (dry) { console.log(`\n(dry) ${routes.length} routes computed, nothing written.`); process.exit(0) }

// ─── Write ───────────────────────────────────────────────────────────────────
for (const p of routes) {
  const { data: r, error: re } = await db.from('walking_routes')
    .upsert({ region: p.region, name_i18n: { en: p.en, tr: p.tr }, straight_line_km: p.km,
              sort_order: p.sortIndex, source: SOURCE, source_id: p.slug },
            { onConflict: 'source,source_id' })
    .select('id, is_active').single()
  if (re) fail(`Route ${p.slug}: ${re.message}`)
  const { error: de } = await db.from('walking_route_stops').delete().eq('route_id', r.id)
  if (de) fail(`Route ${p.slug}: clearing stops failed — ${de.message}. Re-run.`)
  const rows = p.kept.map((s, i) => ({ route_id: r.id, position: i + 1, place_id: s.id, leg_m: i === 0 ? null : p.keptLegs[i - 1] }))
  const { error: ie } = await db.from('walking_route_stops').insert(rows)
  if (ie) fail(`Route ${p.slug}: inserting stops failed — ${ie.message}. The route has NO stops until a re-run.`)
  console.log(`  wrote ${p.tr}: ${rows.length} stops (is_active ${r.is_active})`)
}

// ─── Verify what the database now says ───────────────────────────────────────
const { data: back, error: be } = await db.from('walking_routes')
  .select('source_id, is_active, straight_line_km, walking_route_stops(position, place_id)').eq('source', SOURCE)
if (be) fail(`Verify: ${be.message}`)
for (const p of routes) {
  const b = back.find(x => x.source_id === p.slug)
  const got = (b?.walking_route_stops ?? []).sort((x, y) => x.position - y.position).map(x => x.place_id)
  const want = p.kept.map(s => s.id)
  if (!b || got.join() !== want.join()) fail(`Verify: ${p.slug} stops in the database are not the computed order.`)
}
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const anon = createClient(URL, anonKey, { auth: { persistSession: false } })
const a = await anon.from('walking_routes').select('id', { count: 'exact', head: true })
const c = await anon.from('places').select('id', { count: 'exact', head: true }).eq('status', 'active')
console.log(`\nVerified: ${routes.length} routes, stops in computed order. anon sees ${a.count} routes (expected 0 while dark) · ${c.count} active places (control).`)
if (a.error || a.count !== 0) fail('Verify: anon can see walking routes — they are not dark.')
