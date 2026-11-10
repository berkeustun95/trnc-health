#!/usr/bin/env node
// ─── Araçlar: a dealer's stock, from the CSV and photo folders in data/dealers/<slug>/ ───
//
//   node scripts/import-dealer-cars.mjs --dealer <slug> --offline   # no network: what the CSV maps to, what is skipped
//   gh workflow run araclar-dealer-import -f dealer=<slug>                 # dry, in CI: the add / change / remove list
//   gh workflow run araclar-dealer-import -f dealer=<slug> -f apply=true   # write
//
// Berke, 2026-11-10: the first real dealer comes from a CSV he collects by hand (the owner consented), never from a
// website. data/dealers/<slug>/ holds:
//   dealer.json          the dealer row (name, region, phone / WhatsApp for the buttons, consent date and note)
//   cars.csv             one row per car, matched by ilan_no (scripts/lib/dealer-csv.mjs maps and validates it)
//   photos/<ilan_no>/    1.jpg (the cover), 2.jpg, … — optional per car
//
// What a run does:
//   • a new ilan_no is added; a changed row is updated (content_hash); a car missing from the CSV is set to 'removed'
//     and its photos are deleted. More than a couple of removals at once needs confirm_remove=<count> (a truncated
//     file must not empty the stock). A row that cannot be mapped is skipped and reported; what is live under its
//     reference is left alone.
//   • photos go through the same stripper as sellers' uploads (supabase/functions/_shared/image-metadata.mjs: all
//     Exif / XMP / GPS removed at byte level, proved clean, refused otherwise), are stored under the listing's folder
//     and read back before their rows are written. A car with no photo folder keeps the photos it has; with none it
//     stays hidden (vehicles_hide_photoless).
//   • the dealer row is created INACTIVE and this script never activates it: production does not show the cars, ADA
//     Preview does. After a write it reads back as anon and fails if anon sees a car of an inactive dealer.
//
// CI only for writes (prod-write-guard). The log names cars by reference, make and model: stock data, no user data.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { parseCsv, mapCar, planSync, removalRefusal, contentHash, orderPhotos, HASH_FIELDS } from './lib/dealer-csv.mjs'
import { stripImageMetadata, metadataFound, FORMAT_EXT, FORMAT_MIME } from '../supabase/functions/_shared/image-metadata.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : (args.find(a => a.startsWith(`--${name}=`)) ?? '').split('=')[1] }
const apply = args.includes('--apply')
const offline = args.includes('--offline')
prodWriteGuard({ wouldWrite: apply, workflow: 'araclar-dealer-import', dryHint: 'node scripts/import-dealer-cars.mjs --dealer <slug> --offline' })

const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
const slug = arg('dealer')
if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug ?? '')) fail('usage: --dealer <slug> [--offline | --apply] [--confirm-remove <n>]')
const confirmed = arg('confirm-remove') ? Number(arg('confirm-remove')) : null
const DIR = resolve(ROOT, 'data/dealers', slug)
if (!existsSync(resolve(DIR, 'dealer.json')) || !existsSync(resolve(DIR, 'cars.csv'))) fail(`data/dealers/${slug}/ needs dealer.json and cars.csv`)

const BUCKET = 'vehicle-images'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_PHOTOS = 30
const DEALER = JSON.parse(readFileSync(resolve(DIR, 'dealer.json'), 'utf8'))
if (DEALER.slug !== slug) fail('dealer.json: slug does not match its folder')
if ('is_active' in DEALER) fail('dealer.json must not carry is_active: this script never activates a dealer')
if (!/^\d{4}-\d{2}-\d{2}$/.test(DEALER.consent_date ?? '') || !DEALER.consent_note) fail('dealer.json: consent_date and consent_note are required (no consent, no import)')

// ─── The CSV ─────────────────────────────────────────────────────────────────
const cars = parseCsv(readFileSync(resolve(DIR, 'cars.csv'), 'utf8')).map(mapCar)
const label = c => `${c.ref}  ${c.row ? `${c.row.make} ${c.row.model} ${c.row.year}` : ''}`.trim()

// ─── Photos: read, strip, prove clean (offline too, so a bad file is found before any write) ─
const photoProblems = []
const photosOf = new Map()   // ref → [{ path suffix, bytes, mime }]; absent = no folder (keep what is stored)
for (const c of cars) {
  const dir = resolve(DIR, 'photos', c.ref ?? '')
  if (!c.row || !existsSync(dir)) continue
  const { files, problems } = orderPhotos(readdirSync(dir).filter(n => !n.startsWith('.')))
  for (const p of problems) photoProblems.push(`${c.ref}: ${p}`)
  if (files.length > MAX_PHOTOS) photoProblems.push(`${c.ref}: ${files.length} photos (at most ${MAX_PHOTOS})`)
  const out = []
  for (const name of files) {
    try {
      const clean = stripImageMetadata(new Uint8Array(readFileSync(resolve(dir, name))))
      const left = metadataFound(clean.bytes)
      if (left.found.length || left.gps) throw new Error('metadata left after stripping')
      if (clean.bytes.length > MAX_BYTES) throw new Error('over 5 MB')
      out.push({ file: `${createHash('sha256').update(clean.bytes).digest('hex').slice(0, 32)}.${FORMAT_EXT[clean.format]}`, bytes: Buffer.from(clean.bytes), mime: FORMAT_MIME[clean.format] })
    } catch (e) { photoProblems.push(`${c.ref}/${name}: ${e.message}`) }
  }
  if (new Set(out.map(o => o.file)).size !== out.length) photoProblems.push(`${c.ref}: the same photo is there twice`)
  photosOf.set(c.ref, out)
}

function report(plan, existing) {
  const line = (tag, c, extra = '') => console.log(`  ${tag.padEnd(7)} ${label(c)}${extra}`)
  console.log(`\n${DEALER.name}: ${cars.length} CSV row(s) → add ${plan.add.length} · change ${plan.change.length} · unchanged ${plan.same.length} · remove ${plan.remove.length} · skipped ${plan.skipped.length}`)
  for (const c of plan.add) line('ADD', c)
  for (const c of plan.change) line('CHANGE', c, `  [${c.fields.map(f => f === 'description' || f === 'status' ? f : `${f}: ${c.was[f]} → ${c.row[f]}`).join(', ')}]`)
  for (const e of plan.remove) console.log(`  REMOVE  ${e.external_id}  ${e.make} ${e.model} ${e.year}`)
  for (const c of plan.skipped) line('SKIPPED', c, `  ${c.problems.join('; ')}`)
  const flagged = cars.filter(c => c.flags.length)
  if (flagged.length) console.log('\nflags:')
  for (const c of flagged) for (const f of c.flags) console.log(`  ${c.ref}  ${f}`)
  const live = new Set(existing.filter(e => e.photos > 0).map(e => e.external_id))
  const noPhoto = cars.filter(c => c.row && !(photosOf.get(c.ref)?.length) && !live.has(c.ref))
  console.log(`\nphotos: ${[...photosOf.values()].filter(p => p.length).length} car(s) with a photo folder · ${noPhoto.length} car(s) with no photo (hidden until one arrives)`)
  if (photoProblems.length) { console.log('\nphoto problems:'); for (const p of photoProblems) console.log(`  ${p}`) }
}

if (offline) {
  const plan = planSync(cars, [])
  console.log('OFFLINE: the database was not read; every mapped car is shown as ADD.')
  report(plan, [])
  process.exit(photoProblems.length ? 1 : 0)
}

// ─── The database ────────────────────────────────────────────────────────────
const { createClient } = await import('@supabase/supabase-js')
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) fail('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing')
const db = createClient(URL_, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = db.storage.from(BUCKET)

const { data: dealerRow, error: dErr } = await db.from('dealers').select('id, slug, is_active').or(`id.eq.${DEALER.id},slug.eq.${slug}`)
if (dErr) fail(`read dealer: ${dErr.message}`)
if (dealerRow.length > 1 || (dealerRow[0] && (dealerRow[0].id !== DEALER.id || dealerRow[0].slug !== slug))) fail('REFUSED: a different dealer row already uses this id or slug')
const dealerLive = dealerRow[0]?.is_active === true

const COLS = `id, external_id, status, content_hash, ${HASH_FIELDS.join(', ')}, vehicle_images(id, storage_path, sort_order, is_primary)`
const { data: rows, error: vErr } = await db.from('vehicles').select(COLS).eq('dealer_id', DEALER.id).eq('source', 'dealer').not('external_id', 'is', null)
if (vErr) fail(`read vehicles: ${vErr.message}`)
const existing = rows.map(r => ({ ...r, photos: r.vehicle_images.length }))

let plan
try { plan = planSync(cars, existing) } catch (e) { fail(`REFUSED: ${e.message}`) }
console.log(`dealer row: ${dealerRow[0] ? (dealerLive ? 'exists, ACTIVE (cars are public)' : 'exists, inactive (ADA Preview only)') : 'new, will be created inactive'}`)
report(plan, existing)
const refusal = removalRefusal(plan, existing, confirmed)
if (refusal) fail(`\nREFUSED: ${refusal}`)
if (photoProblems.length) fail('\nREFUSED: fix the photo problems above first. Nothing written.')
if (!apply) { console.log('\nDRY RUN: nothing written.'); process.exit(0) }

// ─── Write ───────────────────────────────────────────────────────────────────
const errors = []
const must = (what, error) => { if (error) fail(`${what}: ${error.message ?? error}`) }
{
  const { error } = await db.from('dealers').upsert({ ...DEALER }, { onConflict: 'id' })
  must('upsert dealer', error)
}
const base = c => ({ ...c.row, source: 'dealer', dealer_id: DEALER.id, owner_id: null, contact_phone: null, whatsapp: null, content_hash: contentHash(c.row) })
const idOf = new Map(existing.map(e => [e.external_id, e.id]))
for (const c of plan.add) {
  const { data, error } = await db.from('vehicles').insert({ ...base(c), status: 'active', published_at: new Date().toISOString() }).select('id').single()
  must(`add ${c.ref}`, error)
  idOf.set(c.ref, data.id)
}
for (const c of plan.change) {
  const patch = { ...base(c), status: 'active' }
  if (c.was.status !== 'active') patch.published_at = new Date().toISOString()
  const { error } = await db.from('vehicles').update(patch).eq('id', c.id)
  must(`change ${c.ref}`, error)
}

// Rows first, then files: a file with no row is invisible; a row with no file is a broken photo.
async function dropPhotos(images) {
  if (!images.length) return
  const { error } = await db.from('vehicle_images').delete().in('id', images.map(i => i.id))
  if (error) { errors.push(`delete photo rows: ${error.code}`); return }
  const { error: rmErr } = await bucket.remove(images.map(i => i.storage_path))
  if (rmErr) errors.push(`delete photo files: ${rmErr.message}`)
}
for (const e of plan.remove) {
  const { error } = await db.from('vehicles').update({ status: 'removed' }).eq('id', e.id)
  must(`remove ${e.external_id}`, error)
  await dropPhotos(e.vehicle_images)
}

for (const [ref, wanted] of photosOf) {
  if (!wanted.length) continue
  const id = idOf.get(ref)
  const have = existing.find(e => e.external_id === ref)?.vehicle_images ?? []
  const paths = wanted.map(w => `${id}/${w.file}`)
  for (const [i, w] of wanted.entries()) {
    if (have.some(h => h.storage_path === paths[i])) continue
    const { error } = await bucket.upload(paths[i], w.bytes, { contentType: w.mime, upsert: true, cacheControl: '31536000' })
    must(`upload ${ref} photo ${i + 1}`, error)
    const { data: back, error: rErr } = await bucket.download(paths[i])
    if (rErr || !Buffer.from(await back.arrayBuffer()).equals(w.bytes)) fail(`verify ${ref} photo ${i + 1}: the stored file differs`)
  }
  const { error } = await db.from('vehicle_images')
    .upsert(paths.map((p, i) => ({ vehicle_id: id, storage_path: p, sort_order: i, is_primary: i === 0 })), { onConflict: 'vehicle_id,storage_path' })
  must(`photo rows ${ref}`, error)
  await dropPhotos(have.filter(h => !paths.includes(h.storage_path)))
}

// ─── Read back ───────────────────────────────────────────────────────────────
const { data: after, error: aErr } = await db.from('vehicles').select('id, external_id, status, content_hash, vehicle_images(id)').eq('dealer_id', DEALER.id).not('external_id', 'is', null)
must('read back', aErr)
const want = new Map(cars.filter(c => c.row).map(c => [c.ref, contentHash(c.row)]))
const wrong = [...want].filter(([ref, h]) => { const r = after.find(a => a.external_id === ref); return !r || r.status !== 'active' || r.content_hash !== h })
const stillLive = plan.remove.filter(e => after.find(a => a.id === e.id)?.status !== 'removed')
if (wrong.length || stillLive.length) fail(`read back: ${wrong.length} car(s) not as written, ${stillLive.length} not removed`)
const { data: d2, error: d2Err } = await db.from('dealers').select('is_active').eq('id', DEALER.id).single()
must('read back dealer', d2Err)
if (d2.is_active !== dealerLive) fail('read back: the dealer changed its active state during the run')
if (!d2.is_active) {
  const { data: seen, error } = await anon.from('vehicles').select('id').eq('dealer_id', DEALER.id)
  must('anon read', error)
  const { data: seenDealer, error: sdErr } = await anon.from('dealers').select('id').eq('id', DEALER.id)
  must('anon dealer read', sdErr)
  if (seen.length || seenDealer.length) fail(`LEAK: the dealer is inactive but anon sees ${seen.length} car(s), ${seenDealer.length} dealer row(s)`)
  console.log('\nproduction check: anon sees none of it (dealer inactive)')
}
const shown = after.filter(a => a.status === 'active' && a.vehicle_images.length).length
console.log(`applied: ${after.filter(a => a.status === 'active').length} car(s) live for this dealer, ${shown} with photos${errors.length ? ` · errors: ${[...new Set(errors)].join('; ')}` : ''}`)
process.exit(errors.length ? 1 : 0)
