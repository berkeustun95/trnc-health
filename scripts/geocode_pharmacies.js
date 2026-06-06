#!/usr/bin/env node
/**
 * Geocodes all pharmacies in seed_pharmacies.sql using Nominatim (OpenStreetMap).
 * Outputs seed_pharmacies_geocoded.sql with latitude/longitude columns.
 *
 * Fallback strategy per address:
 *   1. Full address + ", North Cyprus"
 *   2. Last 2 comma-parts (neighbourhood + city) + ", North Cyprus"
 *   3. Last comma-part (city/region) + ", North Cyprus"
 *
 * Nominatim policy: max 1 req/sec, must set User-Agent.
 * Progress saved to scripts/geocode_cache.json — re-run safely after interruption.
 *
 * Run: node scripts/geocode_pharmacies.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

const SEED_IN    = resolve(ROOT, 'seed_pharmacies.sql')
const SEED_OUT   = resolve(ROOT, 'seed_pharmacies_geocoded.sql')
const CACHE_FILE = resolve(__dir, 'geocode_cache.json')
const DELAY_MS   = 1200  // Nominatim: 1 req/sec max

const NOMINATIM  = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'ADA-Health-App-Geocoder/1.0 (berke.ustun95@gmail.com)'

// ── SQL parser ────────────────────────────────────────────────────────────────

function parseRow(line) {
  line = line.trim().replace(/^[(]/, '').replace(/[),;\s]+$/, '')
  const values = []
  let i = 0
  while (i < line.length) {
    if (line[i] === "'") {
      let str = ''
      i++
      while (i < line.length) {
        if (line[i] === "'" && line[i + 1] === "'") { str += "'"; i += 2 }
        else if (line[i] === "'") { i++; break }
        else { str += line[i++] }
      }
      values.push(str)
    } else if (line.slice(i, i + 4) === 'true')  { values.push(true);  i += 4 }
    else if (line.slice(i, i + 4) === 'null')     { values.push(null);  i += 4 }
    else if (line[i] === ',' || line[i] === ' ')  { i++ }
    else { i++ }
  }
  return values
}

function parseSeed(sql) {
  const lines = sql.split('\n')
  const rows  = []
  let inValues = false
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('INSERT INTO')) { inValues = true; continue }
    if (!inValues || !t.startsWith("('")) continue
    const vals = parseRow(t)
    if (vals.length >= 7) {
      rows.push({ name: vals[0], type: vals[1], address: vals[2], phone: vals[3],
                  is_public: vals[4], provider_id: vals[5], contact_person: vals[6] })
    }
  }
  return rows
}

// ── Nominatim geocoder ────────────────────────────────────────────────────────

async function nominatimSearch(q, retries = 3) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=cy`
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await sleep(3000 * attempt)  // back off: 3s, 6s
    try {
      const res  = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      const text = await res.text()
      if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) {
        // Rate-limited or error page (XML/HTML) — wait longer and retry
        await sleep(5000)
        continue
      }
      const data = JSON.parse(text)
      if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      return null
    } catch {
      // network error — retry
    }
  }
  return null
}

async function geocodeWithFallback(address) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)

  // 1. Full address
  let result = await nominatimSearch(`${address}, North Cyprus`)
  if (result) return { ...result, level: 'full' }
  await sleep(DELAY_MS)

  // 2. Last 2 parts (neighbourhood + city)
  if (parts.length >= 2) {
    result = await nominatimSearch(`${parts.slice(-2).join(', ')}, North Cyprus`)
    if (result) return { ...result, level: 'neighbourhood' }
    await sleep(DELAY_MS)
  }

  // 3. Last part (city/region only)
  if (parts.length >= 1) {
    result = await nominatimSearch(`${parts[parts.length - 1]}, North Cyprus`)
    if (result) return { ...result, level: 'city' }
    await sleep(DELAY_MS)
  }

  // 4. Second-to-last part alone (village name, bypasses unknown region suffix)
  if (parts.length >= 2) {
    result = await nominatimSearch(`${parts[parts.length - 2]}, North Cyprus`)
    if (result) return { ...result, level: 'city' }
    await sleep(DELAY_MS)
  }

  return null
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── SQL escaping ──────────────────────────────────────────────────────────────

function sqlStr(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean')        return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

// ── Main ──────────────────────────────────────────────────────────────────────

const sql  = readFileSync(SEED_IN, 'utf8')
const rows = parseSeed(sql)
console.log(`Parsed ${rows.length} pharmacies.\n`)

const cache = existsSync(CACHE_FILE)
  ? JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  : {}

const stats = { full: 0, neighbourhood: 0, city: 0, failed: 0 }

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  const key = row.name

  if (cache[key] !== undefined) {
    const lvl = cache[key]?.level ?? 'failed'
    stats[lvl] = (stats[lvl] ?? 0) + 1
    process.stdout.write(`\r[${i + 1}/${rows.length}] cached — ${row.name.slice(0, 45).padEnd(45)}`)
    continue
  }

  const result = await geocodeWithFallback(row.address)
  cache[key] = result ?? null
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))

  if (result) {
    stats[result.level] = (stats[result.level] ?? 0) + 1
    process.stdout.write(`\r[${i + 1}/${rows.length}] ${result.level.padEnd(12)} ${row.name.slice(0, 45).padEnd(45)}`)
  } else {
    stats.failed++
    process.stdout.write(`\r[${i + 1}/${rows.length}] MISS         ${row.name.slice(0, 45).padEnd(45)}`)
  }

  await sleep(DELAY_MS)
}

console.log(`\n\nResults:`)
console.log(`  Street-level  : ${stats.full ?? 0}`)
console.log(`  Neighbourhood : ${stats.neighbourhood ?? 0}`)
console.log(`  City-level    : ${stats.city ?? 0}`)
console.log(`  Failed        : ${stats.failed ?? 0}`)

// ── Write output SQL ──────────────────────────────────────────────────────────

const valueLines = rows.map(row => {
  const geo = cache[row.name]
  const lat  = geo?.lat  ?? null
  const lng  = geo?.lng  ?? null
  return `(${sqlStr(row.name)}, ${sqlStr(row.type)}, ${sqlStr(row.address)}, ${sqlStr(row.phone)}, true, null, ${sqlStr(row.contact_person)}, ${lat ?? 'null'}, ${lng ?? 'null'})`
})

const outSql = `-- ${rows.length} pharmacies from KTEB official list — geocoded via Nominatim/OSM
-- Run in Supabase SQL editor
INSERT INTO facilities (name, type, address, phone, is_public, provider_id, contact_person, latitude, longitude) VALUES
${valueLines.join(',\n')};
`

writeFileSync(SEED_OUT, outSql)
console.log(`\nWritten: ${SEED_OUT}`)

const misses = rows.filter(r => !cache[r.name])
if (misses.length) {
  console.log(`\nFailed addresses (${misses.length}):`)
  misses.forEach(r => console.log(`  - ${r.name}: ${r.address}`))
}
