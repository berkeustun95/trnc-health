#!/usr/bin/env node
// ─── Novest images — mirror to our storage ───────────────────────────────────
//
//   node scripts/mirror-novest-images.mjs --dry     # plan only
//   node scripts/mirror-novest-images.mjs
//   node scripts/mirror-novest-images.mjs --limit 20
//
// RESUMABLE BY CONSTRUCTION. Run it, kill it, run it again — it picks up where it
// stopped and never duplicates. ~712 images across 88 listings is a long first run and
// it WILL be interrupted, so resumption is the primary design constraint, not a nicety.
//
// HOW RESUMPTION WORKS, and why it is keyed on the DB and not on storage:
//   A mirrored image is "done" when a property_images row exists whose source_url is
//   the partner's original URL for that media id. That column exists for exactly this
//   ("kept untouched so a mirrored image can always be re-fetched", 20260904).
//
//   The order is UPLOAD THEN INSERT. If the process dies between the two, the object is
//   in storage with no row — and the next run re-uploads it (upsert: true, same
//   deterministic path, so it overwrites itself) and then inserts. The failure window
//   costs one redundant upload and can never produce a duplicate row.
//
//   Keying on storage instead would be wrong: a listObjects call cannot tell a
//   half-written object from a finished one.
//
// PATHS are deterministic and keyed on the MEDIA ID, not a sequence number:
//     partner/novest/{external_id}/{media_id}.{ext}
//   A sequence number would shift the moment Novest reorders a gallery, and every
//   subsequent run would re-upload every image after the insertion point. The media id
//   never moves. This follows the prefix convention set in 20260904 §13; only the
//   filename differs from the `{n}.{ext}` sketched there, for the reason above.
//
// Only service_role can write under partner/ — storage policy property_images_upload
// pins (storage.foldername(name))[1] <> 'partner' for authenticated users.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { SOURCE, getAll, metaArray } from '../supabase/functions/_shared/novest-feed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUCKET = 'property-images'
const PREFIX = 'partner/novest'

// Egress, not aesthetics — identical to the Gişe Kıbrıs pipeline so both modules serve
// images at the same cost. The Supabase free tier shares 5 GB/month across everything.
const MAX_WIDTH = 1200
const JPEG_QUALITY = 80
const OPTIMISE_FLOOR = 300 * 1024

// ─── WHICH VARIANT WE PULL ───────────────────────────────────────────────────
//
// Not `full`. WordPress pre-renders size variants and `1536x1536` is 1536x864 against
// full's 2560x1440 — SAME ASPECT RATIO, ~4x less bandwidth off their single LiteSpeed
// host, and still comfortably above our 1200px target so the downscale loses nothing.
//
// ⚠ `houzez-gallery` (1170x785) was considered and REJECTED. It is close to 1200 and
//   looks like the obvious choice, but its aspect is 1.49 against full's 1.78 — it is a
//   CROP, not a resize. Using it would silently crop every image in the module.
//
// Fall back downward through larger variants, then `full`. Never upward: a variant
// smaller than MAX_WIDTH would be upscaled, and withoutEnlargement would leave it small.
const VARIANTS = ['1536x1536', '2048x2048']

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const limitArg = args.indexOf('--limit')
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity

// Polite to a partner's shared host. Sequential-ish: 4 in flight, each spaced.
const CONCURRENCY = 4
const SPACING_MS = 150

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }

// ─── Credentials ─────────────────────────────────────────────────────────────
if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
let KEY
try {
  KEY = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch { fail('Keychain entry "ada-supabase-service-role" not found.') }
if (!process.env.EXPO_PUBLIC_SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })

// ─── Image pipeline ──────────────────────────────────────────────────────────

async function optimise(body, sourceExt) {
  if (body.length < OPTIMISE_FLOOR) return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  const img = sharp(body, { failOn: 'none' })
  const [m, stats] = await Promise.all([img.metadata(), img.stats()])
  // hasAlpha alone is not enough — plenty of PNGs carry a fully opaque alpha channel.
  const keepAlpha = m.hasAlpha === true && stats.isOpaque === false
  const pipeline = sharp(body, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
  const buffer = keepAlpha
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  if (buffer.length >= body.length) return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  return { buffer, ext: keepAlpha ? 'png' : 'jpg', contentType: keepAlpha ? 'image/png' : 'image/jpeg', skipped: false }
}

function pickVariant(media) {
  const sizes = media.media_details?.sizes ?? {}
  for (const v of VARIANTS) {
    const s = sizes[v]
    if (s?.source_url && s.width >= MAX_WIDTH) return { url: s.source_url, variant: v, width: s.width }
  }
  return { url: media.source_url, variant: 'full', width: media.media_details?.width ?? null }
}

let lastFetchAt = 0
async function politeFetch(url) {
  const wait = SPACING_MS - (Date.now() - lastFetchAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastFetchAt = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': 'ADA-TRNC-Health/1.0 (+partner image mirror)' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' }
}

// ─── Gather ──────────────────────────────────────────────────────────────────

const { data: props, error: pErr } = await supabase
  .from('properties').select('id,external_id').eq('source', SOURCE)
if (pErr) fail(`Reading properties failed: ${pErr.message}`)
if (!props.length) fail(`No ${SOURCE} listings in the database. Run import-novest-properties.mjs first.`)

const { data: haveImages, error: iErr } = await supabase
  .from('property_images').select('property_id,source_url,is_primary')
  .in('property_id', props.map(p => p.id))
if (iErr) fail(`Reading property_images failed: ${iErr.message}`)

// THE RESUME KEY — (property_id, source_url), NOT source_url alone.
//
// 21 of the 712 references are the SAME media id used by two different listings. Keyed
// on source_url alone, the first listing's insert would mark the media "done" globally
// and every OTHER listing sharing it would be skipped on the next run — silently, and
// permanently, leaving those listings short an image with no error anywhere.
//
// Caught by counting: 712 references resolve to 691 distinct media ids.
const done = new Set((haveImages ?? []).map(r => `${r.property_id}|${r.source_url}`))
const hasPrimary = new Set((haveImages ?? []).filter(r => r.is_primary).map(r => r.property_id))

console.log(`\n${props.length} listing(s) · ${done.size} image(s) already mirrored`)

console.log('fetching the feed for media ids…')
const feed = await getAll('/properties', { orderby: 'modified', order: 'desc' })
const byExternalId = new Map(props.map(p => [p.external_id, p]))

// featured_media FIRST and deduped: it is the primary, and for 71 of 91 listings it is
// NOT in fave_property_images — but for the other 20 it is, and uploading it twice would
// violate property_images_primary_unique on the second insert.
const jobs = []
const perListing = new Map()
for (const p of feed) {
  const prop = byExternalId.get(`${SOURCE}-${p.id}`)
  if (!prop) continue                       // skipped at import (21853, 21924, 17947)
  const ids = []
  if (p.featured_media) ids.push(String(p.featured_media))
  for (const m of metaArray(p, 'fave_property_images')) if (!ids.includes(String(m))) ids.push(String(m))
  perListing.set(prop.external_id, ids.length)
  ids.forEach((mediaId, i) => jobs.push({ prop, mediaId, sortOrder: i, isPrimary: false }))
}

console.log(`  ${jobs.length} image reference(s) across ${perListing.size} listing(s)`)

// Resolve media -> URLs, in batches of 100 (the endpoint's per_page ceiling).
const needIds = [...new Set(jobs.map(j => j.mediaId))]
const media = new Map()
for (let i = 0; i < needIds.length; i += 100) {
  const batch = needIds.slice(i, i + 100)
  const list = await getAll('/media', { include: batch.join(','), _fields: 'id,source_url,mime_type,media_details' })
  for (const m of list) media.set(String(m.id), m)
  process.stdout.write(`\r  resolving media… ${media.size}/${needIds.length}`)
}
console.log('')

const missingMedia = needIds.filter(id => !media.has(id))

// ─── PRIMARY GOES TO THE FIRST *RESOLVABLE* IMAGE ────────────────────────────
//
// Decided HERE and not when the jobs were built, because at that point we do not yet
// know which media ids actually exist. featured_media is the intended primary, but on
// listing novest-20799 the featured id (20796) is absent from their media library — so
// blindly marking job 0 primary left that listing with SEVEN images and NO primary,
// which falls back to sort_order and can put a bathroom on the card.
//
// Skipped entirely for a listing that already has a primary: property_images_primary_unique
// is a UNIQUE index, so a second one is an error, not an overwrite.
for (const [, group] of Object.entries(jobs.reduce((a, j) => ((a[j.prop.id] ??= []).push(j), a), {}))
  .map(([k, v]) => [k, v])) {
  if (hasPrimary.has(group[0].prop.id)) continue
  const first = group.find(j => media.has(j.mediaId))
  if (first) first.isPrimary = true
}
const pending = jobs.filter(j =>
  media.has(j.mediaId) && !done.has(`${j.prop.id}|${pickVariant(media.get(j.mediaId)).url}`))

console.log(`\n── plan ──`)
console.log(`  total references   ${String(jobs.length).padStart(4)}`)
console.log(`  already mirrored   ${String(jobs.length - pending.length - missingMedia.length).padStart(4)}   (skipped — resumable)`)
console.log(`  to mirror          ${String(pending.length).padStart(4)}`)
if (missingMedia.length) console.log(`  media 404/absent   ${String(missingMedia.length).padStart(4)}   ${missingMedia.slice(0, 10).join(', ')}`)

if (dry) { console.log('\n(dry) nothing written.'); process.exit(0) }

// ─── REPAIR: a listing with images but no primary ────────────────────────────
//
// Runs on EVERY invocation, before and independently of any mirroring, because the
// condition it fixes is a state of the DATABASE and not of the queue — a run with
// nothing left to mirror is exactly when it would otherwise never execute.
//
// It exists because the bug it repairs already shipped: primary used to be assigned to
// job index 0 before media resolution, so listing novest-20799 — whose featured_media
// (20796) is absent from their library — got seven images and no primary. The mapper is
// fixed, but a fixed mapper does not go back and repair rows it already wrote.
//
// Lowest sort_order wins, which is the same fallback Slice 3 already applies at render.
{
  const { data: cur, error } = await supabase.from('property_images')
    .select('id,property_id,sort_order,is_primary').in('property_id', props.map(p => p.id))
  if (error) fail(`primary repair read failed: ${error.message}`)
  const grouped = cur.reduce((a, i) => ((a[i.property_id] ??= []).push(i), a), {})
  const repairs = Object.values(grouped)
    .filter(g => g.length && !g.some(i => i.is_primary))
    .map(g => g.slice().sort((a, b) => a.sort_order - b.sort_order)[0])
  for (const r of repairs) {
    const { error: uErr } = await supabase.from('property_images')
      .update({ is_primary: true }).eq('id', r.id)
    if (uErr) fail(`primary repair failed for ${r.property_id}: ${uErr.message}`)
  }
  console.log(repairs.length
    ? `\n  repaired ${repairs.length} listing(s) that had images but no primary`
    : '\n  primaries: every listing with images has one')
}

if (!pending.length) { console.log('\nnothing to mirror — every image is already mirrored.\n'); process.exit(0) }

// ─── Mirror ──────────────────────────────────────────────────────────────────

const work = pending.slice(0, LIMIT)
let uploaded = 0, failedJobs = []
let cursor = 0

async function worker() {
  for (;;) {
    const j = work[cursor++]
    if (!j) return
    const m = media.get(j.mediaId)
    const { url, variant } = pickVariant(m)
    try {
      const { body, contentType } = await politeFetch(url)
      const srcExt = MIME_EXT[(contentType.split(';')[0] || '').trim()] ?? 'jpg'
      const opt = await optimise(body, srcExt)
      const path = `${PREFIX}/${j.prop.external_id}/${j.mediaId}.${opt.ext}`

      // upsert: true so a re-run after a partial failure overwrites cleanly. The path is
      // deterministic, so this can never accumulate orphans.
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, opt.buffer, { contentType: opt.contentType ?? contentType, upsert: true })
      if (upErr) throw new Error(`upload: ${upErr.message}`)

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      // INSERT AFTER UPLOAD — see the header. This is the row that makes the job "done".
      const { error: rowErr } = await supabase.from('property_images').insert({
        property_id: j.prop.id, url: publicUrl, source_url: url,
        sort_order: j.sortOrder, is_primary: j.isPrimary,
      })
      if (rowErr) throw new Error(`row: ${rowErr.message}`)

      uploaded++
      process.stdout.write(`\r  mirrored ${uploaded}/${work.length}  (${variant})            `)
    } catch (e) {
      failedJobs.push(`${j.prop.external_id}/${j.mediaId}: ${e.message}`)
    }
  }
}

console.log('')
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log('')

if (failedJobs.length) {
  console.log(`\n  ${failedJobs.length} failure(s) — re-run to retry, they are simply not marked done:`)
  for (const f of failedJobs.slice(0, 15)) console.log(`    ${f}`)
}
console.log(`\n── done ──\n  ${uploaded} image(s) mirrored this run\n`)
