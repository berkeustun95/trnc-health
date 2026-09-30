// ─── Overpass → a dated local snapshot, refusing stale data ─────────────────
// Found 2026-09-29: the overpass.kumi.systems mirror served data from 2026-06-01 while the main
// server was busy, and a fallback silently changed a dry run's inputs (100 → 81 pharmacies).
// So: main server only, retried with backoff; the response's own timestamp_osm_base must be
// fresh; the result is written to data/osm/ so an --apply can reuse exactly what a dry run saw.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const MAX_AGE_H = 72

export async function osmSnapshot(root, name, query, fromFile) {
  if (fromFile) {
    const snap = JSON.parse(readFileSync(resolve(root, fromFile), 'utf8'))
    console.log(`OSM snapshot (reused): ${fromFile} · base ${snap.osm3s?.timestamp_osm_base} · ${snap.elements.length} elements`)
    return snap
  }
  let last = ''
  for (let i = 0; i < 6; i++) {
    const res = await fetch(ENDPOINT, { method: 'POST', body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ADA-app geocoding (berkeustun95)' } })
      .catch(e => ({ ok: false, status: e.message }))
    if (res.ok) {
      const text = await res.text()
      let snap
      try { snap = JSON.parse(text) } catch { last = 'non-JSON (server busy)'; await new Promise(r => setTimeout(r, 10000 * (i + 1))); continue }
      const base = snap.osm3s?.timestamp_osm_base
      const ageH = (Date.now() - Date.parse(base)) / 36e5
      if (!(ageH <= MAX_AGE_H)) throw new Error(`Overpass data is stale (${base}); refusing`)
      mkdirSync(resolve(root, 'data/osm'), { recursive: true })
      const file = `data/osm/${name}-${base.replace(/[-:]/g, '').slice(0, 13)}.json`
      writeFileSync(resolve(root, file), JSON.stringify(snap))
      console.log(`OSM snapshot (fresh): ${file} · base ${base} · ${snap.elements.length} elements`)
      return snap
    }
    last = `HTTP ${res.status}`
    await new Promise(r => setTimeout(r, 10000 * (i + 1)))
  }
  throw new Error(`Overpass unavailable (${last})`)
}
