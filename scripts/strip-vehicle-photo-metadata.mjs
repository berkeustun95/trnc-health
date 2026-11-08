#!/usr/bin/env node
// ─── Araçlar: no stored car photo may carry metadata (location included) ────
//
//   node scripts/strip-vehicle-photo-metadata.mjs --check   # read-only: exit 1 if ANY file still carries metadata (daily-health)
//   gh workflow run araclar-photo-metadata                   # the same check, in CI
//   gh workflow run araclar-photo-metadata -f apply=true     # replace every file that needs it with a clean copy
//
// Berke, 2026-11-08 (go-live gate): location data (all Exif) stripped from car photos on the server, for new uploads
// AND for the photos already in the bucket. New uploads: the vehicle-photo edge function (20261182 left it the only
// writer). Existing files: this script, with the same stripper (supabase/functions/_shared/image-metadata.mjs), then
// the same scan proves the result. Every object in vehicle-images is read, partner/… (the dealer mirror) included.
//
// Apply writes the clean copy to a NEW path (a fresh uuid in the same folder), repoints the vehicle_images row(s) to it,
// then deletes the original. Never an overwrite at the same URL: a CDN or a phone's image cache could keep serving the
// original, GPS and all, under that URL (review 2026-11-08). A dirty file no row points at is simply deleted (an orphan).
// A file the stripper refuses (not JPEG / PNG / WebP, or unparseable) is reported and left alone: the check stays red
// until a person looks at it. Public logs: yes/no lines and error codes, no paths, no counts.
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { randomUUID } from 'node:crypto'
import { stripImageMetadata, metadataFound, FORMAT_MIME, FORMAT_EXT } from '../supabase/functions/_shared/image-metadata.mjs'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
prodWriteGuard({ wouldWrite: apply, workflow: 'araclar-photo-metadata', dryHint: 'node scripts/strip-vehicle-photo-metadata.mjs --check' })

const BUCKET = 'vehicle-images'
const PAGE = 1000
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const db = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = db.storage.from(BUCKET)

// Every file, recursively. A folder is an entry with no id. Pages until an empty page (never trusts a short one).
async function listAll(prefix = '') {
  const files = []
  for (let offset = 0; ; ) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    if (!data.length) break
    offset += data.length
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id) files.push(path)
      else files.push(...(await listAll(path)))
    }
  }
  return files
}

let files
try { files = await listAll() } catch (e) { console.error(`list: ${e?.statusCode || e?.message}`); process.exit(2) }

const dirty = []
const refused = []
const errors = []
for (const path of files) {
  const { data, error } = await bucket.download(path)
  if (error) { errors.push(`download: ${error.statusCode || error.name}`); continue }
  const bytes = new Uint8Array(await data.arrayBuffer())
  const m = metadataFound(bytes)
  if (!m.found.length && !m.gps) continue
  let clean
  try { clean = stripImageMetadata(bytes) } catch (e) { refused.push(e.message); continue }
  dirty.push({ path, clean, gps: m.gps })
}

const yes = n => (n ? 'YES' : 'none')
console.log(`scanned the bucket: files ${files.length ? 'yes' : 'none'} · with metadata ${yes(dirty.length)} (GPS ${yes(dirty.filter(d => d.gps).length)}) · unstrippable ${yes(refused.length)} · read errors ${yes(errors.length)}`)

if (apply) {
  for (const d of dirty) {
    const { data: rows, error: rowsErr } = await db.from('vehicle_images').select('id').eq('storage_path', d.path)
    if (rowsErr) { errors.push(`read rows: ${rowsErr.code}`); continue }
    if (rows.length) {
      const next = `${d.path.slice(0, d.path.lastIndexOf('/'))}/${randomUUID()}.${FORMAT_EXT[d.clean.format]}`
      const { error: upErr } = await bucket.upload(next, d.clean.bytes, { contentType: FORMAT_MIME[d.clean.format], upsert: false, cacheControl: '31536000' })
      if (upErr) { errors.push(`upload: ${upErr.statusCode || upErr.name}`); continue }
      const { data: back, error: rErr } = await bucket.download(next)
      const after = rErr ? null : metadataFound(new Uint8Array(await back.arrayBuffer()))
      if (!after || after.found.length || after.gps) { errors.push('read back: the clean copy is not clean'); await bucket.remove([next]); continue }
      const { error: moveErr } = await db.from('vehicle_images').update({ storage_path: next }).eq('storage_path', d.path)
      if (moveErr) { errors.push(`repoint rows: ${moveErr.code}`); await bucket.remove([next]); continue }
    }
    const { error: rmErr } = await bucket.remove([d.path])
    if (rmErr) errors.push(`delete original: ${rmErr.statusCode || rmErr.name}`)
  }
  console.log(`applied: stripped ${yes(dirty.length)} · errors ${yes(errors.length)}`)
  if (errors.length || refused.length) { console.error([...new Set([...errors, ...refused.map(r => `refused: ${r}`)])].join('\n')); process.exit(1) }
  process.exit(0)
}

if (errors.length) console.error([...new Set(errors)].join('\n'))
if (dirty.length || refused.length) {
  console.error('::error::a car photo in vehicle-images still carries metadata. Strip it: gh workflow run araclar-photo-metadata -f apply=true')
  process.exit(1)
}
process.exit(errors.length ? 1 : 0)
