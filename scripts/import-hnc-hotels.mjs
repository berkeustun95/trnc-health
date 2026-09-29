#!/usr/bin/env node
// ─── KITOB guide content → our hotels (photo + description + guide page) ─────
//
//   node scripts/import-hnc-hotels.mjs --dry-run   # download + resize photos locally, report; no DB
//   node scripts/import-hnc-hotels.mjs --apply     # upload to hotel-images, write the columns (needs 20261063)
//
// Input: data/hnc/match.json (scripts/match-hnc-hotels.mjs). Permission, credit and politeness:
// see crawl-hnc-hotels.mjs. Photos are COPIED into our storage (no hotlinking): the main photo
// only, re-encoded to JPEG, longest side ≤ 1200 px (macOS `sips`), at hotel-images/<external_id>.jpg.
// Descriptions: English only (the guide has no Turkish); taglines (< 120 chars) and Lorem ipsum
// were already dropped by the matcher.
//
// --apply writes ONLY these four columns, only on the matched external_id, and refuses to
// replace a photo whose photo_source is not 'hnc' (a future hotel-supplied photo wins).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run'), APPLY = args.includes('--apply')
if (DRY === APPLY) { console.error('Pass exactly one of --dry-run or --apply.'); process.exit(1) }
const UA = 'ADA-app hotel import (KITOB-approved; contact berkeustun95 via getadaapp.com)'
const DIR = resolve(ROOT, 'data/hnc/photos')
mkdirSync(DIR, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const match = JSON.parse(readFileSync(resolve(ROOT, 'data/hnc/match.json'), 'utf8'))
const todo = match.filter(m => m.site_url)
let fetched = 0
for (const m of todo.filter(m => m.photo)) {
  const out = resolve(DIR, `${m.external_id}.jpg`)
  m.local = out
  if (existsSync(out)) continue
  if (fetched++) await sleep(2000)
  // The server drops the odd long transfer ("other side closed"): retry with backoff, and a
  // photo that still fails is reported and skipped (the card shows the placeholder), never fatal.
  let buf = null, why = ''
  for (let i = 0; i < 4 && !buf; i++) {
    if (i) await sleep(10000 * i)
    try {
      const r = await fetch(m.photo, { headers: { 'User-Agent': UA } })
      if (r.ok) buf = Buffer.from(await r.arrayBuffer()); else why = `HTTP ${r.status}`
    } catch (e) { why = e.cause?.code || e.message }
  }
  if (!buf) { console.log(`  ✗ photo failed (${why}): ${m.name} ${m.photo}`); m.local = null; continue }
  const raw = `${out}.src`
  writeFileSync(raw, buf)
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1200', raw, '--out', out], { stdio: 'ignore' })
  execFileSync('rm', [raw])
}
const withPhoto = todo.filter(m => m.local && existsSync(m.local))
const kb = withPhoto.map(m => statSync(m.local).size / 1024)
const tooBig = withPhoto.filter(m => statSync(m.local).size > 2097152)
console.log(`matched ${todo.length} · photos ready ${withPhoto.length} (downloaded ${fetched}) · sizes ${Math.round(Math.min(...kb))}–${Math.round(Math.max(...kb))} KB, total ${(kb.reduce((a, b) => a + b, 0) / 1024).toFixed(1)} MB · over 2 MB ${tooBig.length}`)
console.log(`descriptions ${todo.filter(m => m.description_en).length} · no photo on the site: ${todo.filter(m => !m.photo).map(m => m.name).join(', ') || 'none'}`)
if (tooBig.length) { console.error('photos over the bucket limit — refusing'); process.exit(1) }
if (DRY) { console.log('DRY RUN — nothing uploaded or written.'); process.exit(0) }

const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n').map(l => l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'], { encoding: 'utf8' }).trim(), { auth: { persistSession: false } })
const { data: rows, error, count } = await sb.from('hotels').select('id, external_id, photo_source', { count: 'exact' })
if (error) throw error
if (rows.length !== count) throw new Error(`read ${rows.length} of ${count}`)
const byExt = new Map(rows.map(r => [r.external_id, r]))

let photos = 0, texts = 0, skipped = 0
for (const m of todo) {
  const row = byExt.get(m.external_id)
  if (!row) { console.log(`  ✗ not in the DB: ${m.external_id}`); continue }
  if (row.photo_source && row.photo_source !== 'hnc') { skipped++; continue }
  const patch = { kitob_page_url: m.site_url, description_i18n: m.description_en ? { English: m.description_en } : null }
  if (m.local && existsSync(m.local)) {
    const path = `${m.external_id}.jpg`
    const { error: ue } = await sb.storage.from('hotel-images').upload(path, readFileSync(m.local), { contentType: 'image/jpeg', upsert: true })
    if (ue) throw new Error(`upload ${m.name}: ${ue.message}`)
    patch.photo_url = sb.storage.from('hotel-images').getPublicUrl(path).data.publicUrl
    patch.photo_source = 'hnc'
    photos++
  }
  const { data, error: we } = await sb.from('hotels').update(patch).eq('id', row.id).select('id')
  if (we) throw new Error(`write ${m.name}: ${we.message}`)
  if (data.length !== 1) throw new Error(`write ${m.name}: ${data.length} rows`)
  if (patch.description_i18n) texts++
}
console.log(`APPLIED: ${photos} photos uploaded + linked, ${texts} descriptions, ${todo.length - skipped} guide links; skipped (non-hnc photo) ${skipped}`)
// Positive control, as the store role: the public URL serves bytes without any auth.
const sample = todo.find(m => m.local)
if (sample) {
  const url = sb.storage.from('hotel-images').getPublicUrl(`${sample.external_id}.jpg`).data.publicUrl
  const r = await fetch(url)
  console.log(`public URL check (no auth): ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length')} bytes — ${sample.name}`)
  if (!r.ok) process.exit(1)
}
