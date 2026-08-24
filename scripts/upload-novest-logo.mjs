#!/usr/bin/env node
// ─── Novest agency logo — optimise, upload, publish ──────────────────────────
//
//   npm run novest:logo -- ~/Downloads/coldwell-banker-novest.png
//   npm run novest:logo -- <file> --dry
//
// Does all three steps in one: optimises the file, uploads it to the bucket the rest of
// the partner's assets already live in, and sets estate_agencies.logo_url so it renders.
//
// NO NEW BUCKET AND NO NEW POLICY, deliberately. It goes to the EXISTING public
// `property-images` bucket under `partner/novest/`, which is already:
//   • public-read, so the app can render it with no signed URL
//   • closed to every authenticated user for writes — the INSERT policy pins
//     (storage.foldername(name))[1] <> 'partner' (20260904 §13), so only service_role
//     writes here
// A new `agency-logos` bucket would need its own policies for one file. `towing-logos`
// exists as a precedent for a per-module logo bucket, but it was created when towing had
// no other assets; Novest already has 703 objects under this prefix.
//
// The path is FIXED — partner/novest/agency-logo.<ext> — so replacing the logo later is
// the same command with a new file, and upsert overwrites in place. No orphans.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { AGENCY_ID } from '../supabase/functions/_shared/novest-feed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUCKET = 'property-images'
const PREFIX = 'partner/novest'

// ⚠ THE OLD MAX_H OF 180 IS WHAT CAPPED THE FIRST UPLOAD AT 427x180.
// That was an arbitrary number chosen against a 26pt render, and it silently became the
// ceiling on how large the mark could be drawn — 142pt wide at 3x, which was only just
// enough once the sub-line had to be legible. The constraint was mine, not the partner's
// file.
//
// Raised so the asset is never the limit again. A wordmark PNG at this size is still only
// a few KB, and `fit: 'inside'` + `withoutEnlargement` means a smaller source is passed
// through untouched rather than upscaled — so this cannot make anything worse.
const MAX_W = 900
const MAX_H = 400

const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const file = args.find(a => !a.startsWith('--'))
if (!file) fail('Usage: npm run novest:logo -- <path-to-logo> [--dry]')
if (!existsSync(file)) fail(`Not found: ${file}`)

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

const src = readFileSync(file)
const meta = await sharp(src).metadata()

// TRANSPARENCY IS KEPT WHEN IT IS REAL. A logo on a white rectangle sits as a white slab
// on the contact bar; the same logo with a real alpha channel sits ON the bar. hasAlpha
// alone is not the test — plenty of PNGs carry a fully opaque alpha channel — so
// stats().isOpaque decides, the same rule the image mirror uses.
const stats = await sharp(src).stats()
const keepAlpha = meta.hasAlpha === true && stats.isOpaque === false

const pipeline = sharp(src).resize({
  width: MAX_W, height: MAX_H, fit: 'inside', withoutEnlargement: true,
})
const buffer = keepAlpha
  ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
  : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()

const ext = keepAlpha ? 'png' : 'jpg'
const path = `${PREFIX}/agency-logo.${ext}`
const out = await sharp(buffer).metadata()

console.log(`\n  source     ${meta.width}x${meta.height} ${meta.format}  ${(src.length / 1024).toFixed(1)} KB`)
console.log(`  alpha      ${keepAlpha ? 'REAL — kept as PNG so it sits on the bar, not in a white slab'
                                      : 'none/opaque — flattened to JPEG'}`)
console.log(`  optimised  ${out.width}x${out.height} ${ext}  ${(buffer.length / 1024).toFixed(1)} KB`)
// The number that actually matters, printed every run so the comment in
// PropertyDetailScreen can be checked against reality rather than remembered.
console.log(`  largest CRISP render at 3x: ${(out.width / 3).toFixed(0)}pt x ${(out.height / 3).toFixed(0)}pt`)
console.log(`  the bar draws it at 54pt tall (${(54 * out.width / out.height).toFixed(0)}pt wide) -> ` +
  (out.height >= 54 * 3 ? 'CRISP' : '⚠ SOFT — this source is too small for that render'))
console.log(`  path       ${BUCKET}/${path}`)

if (dry) { console.log('\n  (dry) nothing uploaded, logo_url unchanged.\n'); process.exit(0) }

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })

const { error: upErr } = await supabase.storage.from(BUCKET)
  .upload(path, buffer, { contentType: keepAlpha ? 'image/png' : 'image/jpeg', upsert: true })
if (upErr) fail(`upload failed: ${upErr.message}`)

const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

// Cache-bust on replacement: the path is fixed, so a CDN or a device that already fetched
// the old file would keep serving it. The query string changes the URL without moving
// the object.
const url = `${publicUrl}?v=${out.width}x${out.height}-${buffer.length}`

const { error: dbErr } = await supabase.from('estate_agencies')
  .update({ logo_url: url }).eq('id', AGENCY_ID)
if (dbErr) fail(`estate_agencies update failed: ${dbErr.message}`)

// Read it back as ANON — service_role can see rows and objects the app cannot.
const anon = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } })
const { data: seen } = await anon.from('estate_agencies').select('logo_url').eq('id', AGENCY_ID).maybeSingle()
const head = await fetch(url, { method: 'GET' })

console.log(`\n  logo_url as ANON sees it : ${seen?.logo_url ?? 'NULL — the app will still show the name'}`)
console.log(`  fetched                  : HTTP ${head.status}  ${head.headers.get('content-type')}`)
console.log(head.ok && seen?.logo_url ? '\n  done — the contact bar will show the mark on next load.\n'
                                      : '\n  ⚠ something is off; the bar falls back to the agency name, so nothing is broken.\n')
