#!/usr/bin/env node
// ─── Araçlar: delete the photo files of listings that are gone ──────────────
//
//   node scripts/cleanup-vehicle-photos.mjs --dry      # plan only (the default, also in CI on dispatch)
//   gh workflow run araclar-photo-cleanup               # dry, in CI
//   gh workflow run araclar-photo-cleanup -f apply=true # delete; the nightly schedule always applies
//
// The go-live gate for private listings (Berke, 2026-11-07): a seller's photos must not outlive their listing.
// Which listings and when is constants/cars.js photoCleanupReason(): removed after 3 days (final), rejected after 14
// (the seller can fix and resubmit until then), hidden by reports after 30 (an admin can restore until then).
// Expired listings keep their photos: they are one tap from renewed. Dealer and imported listings are never due, and
// their folders are never "gone" because every listing of every source is read below.
// Also swept: files in a listing folder that no vehicle_images row points at, older than a day (an upload whose row
// insert failed), and whole folders whose listing no longer exists (the owner deleted their account: the rows
// cascade, the files do not). partner/… (the dealer mirror) is never listed.
//
// Rows first, then files: a file with no row is invisible and swept next night; a row with no file is a broken photo.
// storage.objects refuses SQL deletes (protect_objects_delete), so this goes through the Storage API with the
// service key, from GitHub Actions only (prod-write-guard). Public logs: yes/no lines and error codes, no ids, no counts.
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { VEHICLE_BUCKET, ORPHAN_GRACE_HOURS, photoCleanupReason } from '../constants/cars.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
prodWriteGuard({ wouldWrite: apply, workflow: 'araclar-photo-cleanup', dryHint: 'node scripts/cleanup-vehicle-photos.mjs --dry' })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PAGE = 1000
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!URL) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const db = createClient(URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = db.storage.from(VEHICLE_BUCKET)
const now = Date.now()
const errors = []
const fail = (what, e) => errors.push(`${what}: ${String(e?.statusCode || e?.code || e?.message || e).slice(0, 60)}`)

// EVERY listing, all sources and states: a folder whose listing is missing from this set is deleted as gone, so a
// partial set over-deletes. Hence no source filter (photoCleanupReason refuses non-private rows itself), and paging
// runs until an EMPTY page: a short page may only mean the server caps rows per request (max_rows) below PAGE.
const listings = []
for (let from = 0; ; ) {
  const { data, error } = await db.from('vehicles')
    .select('id, source, status, updated_at, hidden_at, vehicle_images(id, storage_path)')
    .order('id').range(from, from + PAGE - 1)
  if (error) { console.error(`read vehicles: ${error.message}`); process.exit(2) }
  if (!data.length) break
  listings.push(...data)
  from += data.length
}
const byId = new Map(listings.map(v => [v.id, v]))

async function listFolder(prefix) {
  const out = []
  for (let offset = 0; ; ) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    if (!data.length) break
    out.push(...data)
    offset += data.length
  }
  return out
}

// ── 1. Listings past their grace period: rows, then every file in their folder ──
const due = listings.filter(v => photoCleanupReason(v, now))
const plan = { listings: due.length, files: [], rows: [] }
for (const v of due) {
  plan.rows.push(...(v.vehicle_images || []).map(i => i.id))
  try { plan.files.push(...(await listFolder(v.id)).filter(o => o.id).map(o => `${v.id}/${o.name}`)) }
  catch (e) { fail('list listing folder', e) }
}

// ── 2. Folders: a listing that no longer exists, or files no row points at ──
const referenced = new Set(listings.flatMap(v => (v.vehicle_images || []).map(i => i.storage_path)))
let root = []
try { root = await listFolder('') } catch (e) { fail('list bucket root', e) }
const dueIds = new Set(due.map(v => v.id))
for (const entry of root) {
  if (entry.id || !UUID.test(entry.name) || dueIds.has(entry.name)) continue   // files at the root, partner/, done above
  let files = []
  try { files = (await listFolder(entry.name)).filter(o => o.id) } catch (e) { fail('list folder', e); continue }
  const gone = !byId.has(entry.name)
  for (const o of files) {
    const path = `${entry.name}/${o.name}`
    const age = now - Date.parse(o.created_at || o.updated_at || 0)
    if ((gone || !referenced.has(path)) && age >= ORPHAN_GRACE_HOURS * 3600000) plan.files.push(path)
  }
}

const yes = n => (n ? 'yes' : 'none')
console.log(`plan: listings past grace ${yes(plan.listings)} · photo rows ${yes(plan.rows.length)} · files ${yes(plan.files.length)}`)
if (!apply) {
  console.log('dry run: nothing deleted. Apply: gh workflow run araclar-photo-cleanup -f apply=true')
  if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
  process.exit(0)
}

// ── Apply: rows, then files (100 per call, the Storage API's comfortable batch) ──
for (let i = 0; i < plan.rows.length; i += 100) {
  const { error } = await db.from('vehicle_images').delete().in('id', plan.rows.slice(i, i + 100))
  if (error) fail('delete photo rows', error)
}
for (let i = 0; i < plan.files.length; i += 100) {
  const { error } = await bucket.remove(plan.files.slice(i, i + 100))
  if (error) fail('delete files', error)
}

// Read back: nothing that was due may still have a row.
if (due.length) {
  const { data: left, error: leftErr } = await db.from('vehicle_images').select('id').in('vehicle_id', due.map(v => v.id).slice(0, 500))
  if (leftErr) fail('read back', leftErr)
  else if (left.length) errors.push('read back: photo rows remain on a listing past its grace period')
}

console.log(`applied: rows ${yes(plan.rows.length)} · files ${yes(plan.files.length)} · errors ${errors.length ? 'YES' : 'none'}`)
if (errors.length) { console.error([...new Set(errors)].join('\n')); process.exit(1) }
