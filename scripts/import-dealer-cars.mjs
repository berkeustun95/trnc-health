#!/usr/bin/env node
// ─── Araçlar: a dealer's stock, from the CSV in data/dealers/<slug>/ and the photos staged in dealer-intake ───
//
//   node scripts/import-dealer-cars.mjs --dealer <slug> --offline   # no network: what the CSV maps to, what is skipped
//   gh workflow run araclar-dealer-import -f dealer=<slug>                 # dry, in CI: the add / change / remove list
//   gh workflow run araclar-dealer-import -f dealer=<slug> -f apply=true   # write
//
// Berke, 2026-11-10: the first real dealer comes from a CSV he collects by hand (the owner consented), never from a
// website. data/dealers/<slug>/ holds:
//   dealer.json          the dealer row (name, region, phone / WhatsApp for the buttons, consent date and note)
//   cars.csv             one row per car, matched by ilan_no (scripts/lib/dealer-csv.mjs maps and validates it)
// Photos are NEVER in the repo (it is public, and a sold car's photos would stay in its history). Berke stages them
// from his Mac with scripts/upload-dealer-photos.mjs into the private bucket dealer-intake (20261188) as
// <slug>/<ilan_no>/<n>.<jpg|png|webp>, 1 = the cover.
//
// What a run does:
//   • a new ilan_no is added; a changed row is updated (content_hash); a car missing from the CSV is set to 'removed'
//     and its photos are deleted. More than a couple of removals at once needs confirm_remove=<count> (a truncated
//     file must not empty the stock). A row that cannot be mapped is skipped and reported; what is live under its
//     reference is left alone. A car in the CSV that is not active in ADA (rejected or removed) is HELD and left
//     alone: --reactivate <ref,ref> brings it back.
//   • photos go through the same stripper as sellers' uploads (supabase/functions/_shared/image-metadata.mjs: all
//     Exif / XMP / GPS removed at byte level, proved clean, refused otherwise), are stored under the listing's folder
//     and read back before their rows are written; then the staged copies are deleted. A staged set REPLACES the
//     car's photos. A car with nothing staged keeps the photos it has; with none it stays hidden
//     (vehicles_hide_photoless).
//   • a logo staged as <slug>/logo/1.<ext> (upload-dealer-photos --logo) is stripped the same way, stored in
//     vehicle-images under partner/dealer/<slug>/ (a folder the nightly photo sweep never touches) and set as
//     dealers.logo_path; the previous logo file is deleted. dealer.json does not carry logo_path.
//   • the dealer row is created INACTIVE and this script never activates it: production does not show the cars, ADA
//     Preview does. After a write it reads back as anon and fails if anon sees a car of an inactive dealer.
//
// CI only for writes (prod-write-guard). The log names cars by reference, make and model: stock data, no user data.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { parseCsv, mapCar, planSync, removalRefusal, contentHash, orderPhotos, incompleteSet, HASH_FIELDS } from './lib/dealer-csv.mjs'
import { stripImageMetadata, metadataFound, FORMAT_EXT, FORMAT_MIME } from '../supabase/functions/_shared/image-metadata.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : (args.find(a => a.startsWith(`--${name}=`)) ?? '').split('=')[1] }
const apply = args.includes('--apply')
const offline = args.includes('--offline')
prodWriteGuard({ wouldWrite: apply, workflow: 'araclar-dealer-import', dryHint: 'node scripts/import-dealer-cars.mjs --dealer <slug> --offline' })

const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
const slug = arg('dealer')
if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug ?? '')) fail('usage: --dealer <slug> [--offline | --apply] [--confirm-remove <n>] [--reactivate <ref,ref>]')
const confirmed = arg('confirm-remove') ? Number(arg('confirm-remove')) : null
const reactivate = (arg('reactivate') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const DIR = resolve(ROOT, 'data/dealers', slug)
if (!existsSync(resolve(DIR, 'dealer.json')) || !existsSync(resolve(DIR, 'cars.csv'))) fail(`data/dealers/${slug}/ needs dealer.json and cars.csv`)

const BUCKET = 'vehicle-images'
const INTAKE = 'dealer-intake'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_PHOTOS = 30
const DEALER = JSON.parse(readFileSync(resolve(DIR, 'dealer.json'), 'utf8'))
if (DEALER.slug !== slug) fail('dealer.json: slug does not match its folder')
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(DEALER.id ?? '')) fail('dealer.json: id is not a uuid')
if ('is_active' in DEALER) fail('dealer.json must not carry is_active: this script never activates a dealer')
if ('logo_path' in DEALER) fail('dealer.json must not carry logo_path: the logo is staged with upload-dealer-photos --logo and set by this script')
if (!/^\d{4}-\d{2}-\d{2}$/.test(DEALER.consent_date ?? '') || !DEALER.consent_note) fail('dealer.json: consent_date and consent_note are required (no consent, no import)')

// ─── The CSV ─────────────────────────────────────────────────────────────────
const cars = parseCsv(readFileSync(resolve(DIR, 'cars.csv'), 'utf8')).map(mapCar)
const label = c => `${c.ref}  ${c.row ? `${c.row.make} ${c.row.model} ${c.row.year}` : ''}`.trim()

const photoProblems = []
const photosOf = new Map()    // ref → [{ file, bytes, mime }]; absent = nothing staged (keep what is stored)
const stagedOf = new Map()    // ref → the staged files as read ({ path, stamp }), deleted once the car's photos are written
const strayStaged = []        // staged for a car that is in the CSV but not importable now (skipped / held): left to wait
const goneStaged = []         // staged for a reference that is not in the CSV at all (sold): deleted on apply
let logo = null               // { file, bytes, mime, staged: [{ path, stamp }] } when a logo is staged

function report(plan, existing) {
  const line = (tag, c, extra = '') => console.log(`  ${tag.padEnd(7)} ${label(c)}${extra}`)
  console.log(`\n${DEALER.name}: ${cars.length} CSV row(s) → add ${plan.add.length} · change ${plan.change.length} · unchanged ${plan.same.length} · remove ${plan.remove.length} · held ${plan.held.length} · skipped ${plan.skipped.length}`)
  for (const c of plan.add) line('ADD', c)
  for (const c of plan.change) line(c.fields[0] === 'status' ? 'REACTIVATE' : 'CHANGE', c, `  [${c.fields.map(f => f === 'description' || f === 'content_hash' ? f : f === 'status' ? `status: ${c.was.status} → active` : `${f}: ${c.was[f]} → ${c.row[f]}`).join(', ')}]`)
  for (const c of plan.held) line('HELD', c, `  status ${c.was.status} in ADA: left alone (--reactivate ${c.ref} to bring it back)`)
  for (const e of plan.remove) console.log(`  REMOVE  ${e.external_id}  ${e.make} ${e.model} ${e.year}`)
  for (const c of plan.skipped) line('SKIPPED', c, `  ${c.problems.join('; ')}`)
  const flagged = cars.filter(c => c.flags.length)
  if (flagged.length) console.log('\nflags:')
  for (const c of flagged) for (const f of c.flags) console.log(`  ${c.ref}  ${f}`)
  const live = new Set(existing.filter(e => e.photos > 0).map(e => e.external_id))
  const noPhoto = cars.filter(c => c.row && !(photosOf.get(c.ref)?.length) && !live.has(c.ref))
  console.log(offline ? '\nphotos: not read offline (they are staged in the private bucket)'
    : `\nphotos: ${[...photosOf.values()].filter(p => p.length).length} car(s) with staged photos · ${noPhoto.length} car(s) with no photo (hidden until one arrives)`)
  for (const [ref, p] of photosOf) if (p.length) console.log(`  PHOTOS  ${ref}  ${p.length} staged`)
  if (logo) console.log('  LOGO    a dealer logo is staged')
  for (const x of strayStaged) console.log(`  STAGED, WAITING  ${x}`)
  for (const x of goneStaged) console.log(`  STAGED, NOT IN THE CSV  ${x}  (deleted from staging on apply)`)
  if (photoProblems.length) { console.log('\nphoto problems:'); for (const p of photoProblems) console.log(`  ${p}`) }
}

if (offline) {
  const plan = planSync(cars, [])
  console.log('OFFLINE: the database was not read; every mapped car is shown as ADD.')
  report(plan, [])
  process.exit(0)
}

// ─── The database ────────────────────────────────────────────────────────────
const { createClient } = await import('@supabase/supabase-js')
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) fail('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing')
const db = createClient(URL_, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = db.storage.from(BUCKET)
const intake = db.storage.from(INTAKE)

const { data: dealerRow, error: dErr } = await db.from('dealers').select('id, slug, is_active').or(`id.eq.${DEALER.id},slug.eq.${slug}`)
if (dErr) fail(`read dealer: ${dErr.message}`)
if (dealerRow.length > 1 || (dealerRow[0] && (dealerRow[0].id !== DEALER.id || dealerRow[0].slug !== slug))) fail('REFUSED: a different dealer row already uses this id or slug')
const dealerLive = dealerRow[0]?.is_active === true

const COLS = `id, external_id, status, content_hash, ${HASH_FIELDS.join(', ')}, vehicle_images(id, storage_path, sort_order, is_primary)`
const { data: rows, error: vErr } = await db.from('vehicles').select(COLS).eq('dealer_id', DEALER.id).eq('source', 'dealer').not('external_id', 'is', null)
if (vErr) fail(`read vehicles: ${vErr.message}`)
const existing = rows.map(r => ({ ...r, photos: r.vehicle_images.length }))

let plan
try { plan = planSync(cars, existing, reactivate) } catch (e) { fail(`REFUSED: ${e.message}`) }

// ─── Staged photos: read, strip, prove clean — before any write, so a bad file stops the run ─
{
  const usable = new Set([...plan.add, ...plan.change, ...plan.same].map(c => c.ref))
  const { data: folders, error } = await intake.list(slug, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  // Before 20261188 is applied there is no staging bucket: cars still sync, with no photos to move.
  if (error && !/^Bucket not found$/i.test(error.message)) fail(`list staged photos: ${error.message}`)
  if (error) console.log('staging bucket dealer-intake does not exist yet (20261188): no photos read')
  for (const f of folders ?? []) {
    const ref = f.name
    if (f.id) { photoProblems.push(`${ref}: a file outside a car folder in staging`); continue }
    if (ref === 'logo') {
      const { data: entries, error: lErr } = await intake.list(`${slug}/logo`, { limit: 10 })
      if (lErr) fail(`list the staged logo: ${lErr.message}`)
      const files = entries.filter(e => e.id)
      if (files.length !== 1 || !/^1\.(jpg|png|webp)$/.test(files[0].name)) { photoProblems.push('logo: staging must hold exactly one file, 1.jpg / 1.png / 1.webp'); continue }
      try {
        const { data, error: dlErr } = await intake.download(`${slug}/logo/${files[0].name}`)
        if (dlErr) throw new Error(`download failed (${dlErr.message})`)
        const clean = stripImageMetadata(new Uint8Array(await data.arrayBuffer()))
        const left = metadataFound(clean.bytes)
        if (left.found.length || left.gps) throw new Error('metadata left after stripping')
        logo = { file: `logo-${createHash('sha256').update(clean.bytes).digest('hex').slice(0, 16)}.${FORMAT_EXT[clean.format]}`, bytes: Buffer.from(clean.bytes), mime: FORMAT_MIME[clean.format],
          staged: files.map(e => ({ path: `${slug}/logo/${e.name}`, stamp: `${e.name}|${e.id}|${e.updated_at}` })) }
      } catch (e) { photoProblems.push(`logo: ${e.message}`) }
      continue
    }
    if (!cars.some(c => c.ref === ref)) { goneStaged.push(ref); continue }
    if (!usable.has(ref)) { strayStaged.push(`${ref} (its car is skipped or held: the photos wait)`); continue }
    const { data: entries, error: lErr } = await intake.list(`${slug}/${ref}`, { limit: 200 })
    if (lErr) fail(`list staged photos of ${ref}: ${lErr.message}`)
    const { files, problems } = orderPhotos(entries.filter(e => e.id).map(e => e.name))
    for (const p of problems) photoProblems.push(`${ref}: ${p}`)
    const partial = incompleteSet(files)
    if (partial) { photoProblems.push(`${ref}: ${partial}`); continue }
    if (files.length > MAX_PHOTOS) photoProblems.push(`${ref}: ${files.length} photos (at most ${MAX_PHOTOS})`)
    const out = []
    for (const name of files) {
      try {
        const { data, error: dlErr } = await intake.download(`${slug}/${ref}/${name}`)
        if (dlErr) throw new Error(`download failed (${dlErr.message})`)
        const clean = stripImageMetadata(new Uint8Array(await data.arrayBuffer()))
        const left = metadataFound(clean.bytes)
        if (left.found.length || left.gps) throw new Error('metadata left after stripping')
        if (clean.bytes.length > MAX_BYTES) throw new Error('over 5 MB')
        out.push({ file: `${createHash('sha256').update(clean.bytes).digest('hex').slice(0, 32)}.${FORMAT_EXT[clean.format]}`, bytes: Buffer.from(clean.bytes), mime: FORMAT_MIME[clean.format] })
      } catch (e) { photoProblems.push(`${ref}/${name}: ${e.message}`) }
    }
    if (new Set(out.map(o => o.file)).size !== out.length) photoProblems.push(`${ref}: the same photo is there twice`)
    photosOf.set(ref, out)
    stagedOf.set(ref, entries.filter(e => e.id).map(e => ({ path: `${slug}/${ref}/${e.name}`, stamp: `${e.name}|${e.id}|${e.updated_at}` })))
  }
}
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
// true = the rows are gone (a file that could not be removed is an orphan the nightly sweep takes).
async function dropPhotos(images) {
  if (!images.length) return true
  const { error } = await db.from('vehicle_images').delete().in('id', images.map(i => i.id))
  if (error) { errors.push(`delete photo rows: ${error.code}`); return false }
  const { error: rmErr } = await bucket.remove(images.map(i => i.storage_path))
  if (rmErr) errors.push(`delete photo files: ${rmErr.message}`)
  return true
}
for (const e of plan.remove) {
  const { error } = await db.from('vehicles').update({ status: 'removed' }).eq('id', e.id)
  must(`remove ${e.external_id}`, error)
}
// Every car that is not live and not in the CSV loses its photos, not only the ones removed in THIS run: a run that
// died between the status change and the photo delete is finished by the next one.
const inCsv = new Set(cars.map(c => c.ref))
for (const e of existing) {
  if (!inCsv.has(e.external_id) && e.vehicle_images.length) await dropPhotos(e.vehicle_images)
}

const heldRefs = new Set(plan.held.map(c => c.ref))
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
  // Old rows go BEFORE the new ones are linked: a run that dies in between leaves the car with no photo (hidden) and
  // its set still staged, which the next run repairs; the other order could leave a mixed set nobody repairs.
  if (!(await dropPhotos(have.filter(h => !paths.includes(h.storage_path))))) { errors.push(`${ref}: old photos not removed; its staged set is kept for the next run`); continue }
  const { error } = await db.from('vehicle_images')
    .upsert(paths.map((p, i) => ({ vehicle_id: id, storage_path: p, sort_order: i, is_primary: i === 0 })), { onConflict: 'vehicle_id,storage_path' })
  must(`photo rows ${ref}`, error)
  // Stored, read back and linked: the staged copies have done their job — unless the set was replaced while this run
  // was working (same names, new files): then it is left for the next run.
  const read = stagedOf.get(ref)
  const { data: nowStaged, error: nErr } = await intake.list(`${slug}/${ref}`, { limit: 200 })
  const same = !nErr && nowStaged.filter(e => e.id).map(e => `${e.name}|${e.id}|${e.updated_at}`).sort().join() === read.map(r => r.stamp).sort().join()
  if (!same) { errors.push(`${ref}: its staged set changed during the run; left in staging, run the import again`); continue }
  const { error: sErr } = await intake.remove(read.map(r => r.path))
  if (sErr) errors.push(`empty staging ${ref}: ${sErr.message}`)
}

// ─── The logo: store, read back, point the dealer row at it, drop the old file, unstage ─
if (logo) {
  const path = `partner/dealer/${slug}/${logo.file}`
  const { data: cur, error: cErr } = await db.from('dealers').select('logo_path').eq('id', DEALER.id).single()
  must('read the current logo', cErr)
  const { error: upErr } = await bucket.upload(path, logo.bytes, { contentType: logo.mime, upsert: true, cacheControl: '31536000' })
  must('upload the logo', upErr)
  const { data: back, error: rErr } = await bucket.download(path)
  if (rErr || !Buffer.from(await back.arrayBuffer()).equals(logo.bytes)) fail('verify the logo: the stored file differs')
  const { error: setErr } = await db.from('dealers').update({ logo_path: path }).eq('id', DEALER.id)
  must('set the logo', setErr)
  if (cur.logo_path && cur.logo_path !== path && cur.logo_path.startsWith(`partner/dealer/${slug}/`)) {
    const { error } = await bucket.remove([cur.logo_path])
    if (error) errors.push(`delete the old logo: ${error.message}`)
  }
  const { data: nowStaged, error: nErr } = await intake.list(`${slug}/logo`, { limit: 10 })
  const same = !nErr && nowStaged.filter(e => e.id).map(e => `${e.name}|${e.id}|${e.updated_at}`).sort().join() === logo.staged.map(r => r.stamp).sort().join()
  if (!same) errors.push('the staged logo changed during the run; left in staging, run the import again')
  else { const { error } = await intake.remove(logo.staged.map(r => r.path)); if (error) errors.push(`empty the logo staging: ${error.message}`) }
  console.log('logo: set')
}

// Photos staged for a reference that is not in the CSV (the car was sold before they were used) must not linger.
for (const ref of goneStaged) {
  const { data: entries, error: lErr } = await intake.list(`${slug}/${ref}`, { limit: 200 })
  if (lErr) { errors.push(`list staging ${ref}: ${lErr.message}`); continue }
  const paths = entries.filter(e => e.id).map(e => `${slug}/${ref}/${e.name}`)
  const { error } = paths.length ? await intake.remove(paths) : { error: null }
  if (error) errors.push(`empty staging ${ref}: ${error.message}`)
}

// ─── Read back ───────────────────────────────────────────────────────────────
const { data: after, error: aErr } = await db.from('vehicles').select('id, external_id, status, content_hash, vehicle_images(id)').eq('dealer_id', DEALER.id).not('external_id', 'is', null)
must('read back', aErr)
const want = new Map(cars.filter(c => c.row && !heldRefs.has(c.ref)).map(c => [c.ref, contentHash(c.row)]))
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
