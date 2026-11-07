#!/usr/bin/env node
// ─── Araçlar Preview seed: one INACTIVE test dealer, six cars, eight CC0 photos ─
//
//   node scripts/seed-araclar-preview.mjs --dry          # plan only (the default in CI too)
//   gh workflow run araclar-preview-seed                 # dry, in CI
//   gh workflow run araclar-preview-seed -f apply=true   # write
//
// Production never shows any of it: dealers.is_active stays false, so vehicles_select_public skips the cars and
// only ADA Preview (is_previewer(), the preview-key header) reads them (20261165). Fixed ids and paths, so a re-run
// upserts instead of duplicating. Photos are uploaded and verified BEFORE their vehicle_images rows are written
// (a row pointing at no file would still count as "has a photo"). After the write it reads back as anon and
// REFUSES to finish green if anon can see a single seeded row. Output: counts and fixed keys only (public logs).
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
prodWriteGuard({ wouldWrite: apply, workflow: 'araclar-preview-seed', dryHint: 'node scripts/seed-araclar-preview.mjs --dry' })

const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
const BUCKET = 'vehicle-images'
const DIR = resolve(ROOT, 'data/araclar-preview')

const DEALER = {
  id: '6a1f3c5e-7b9d-4e2f-8a10-c3e5a7b9d100', slug: 'ada-test-oto', name: 'ADA Test Oto',
  phone: '+900000000001', whatsapp: '+900000000001', region: 'kyrenia', area: 'alsancak',
  website: null, logo_path: null, is_rental_company: true, is_active: false,
}
const NOTE = 'ADA Preview test ilanı — gerçek bir araç değildir.'
const car = (id, o, photos) => ({
  row: { id, source: 'dealer', dealer_id: DEALER.id, owner_id: null, status: 'active', published_at: '2026-11-07T12:00:00Z',
    contact_phone: null, whatsapp: null, description: NOTE, price: null, price_per_day: null, ...o },
  photos,
})
const CARS = [
  car('0c2e4a6b-8d1f-4a3c-9e50-b1d3f5a7c901', { intent: 'sale', make: 'Toyota', model: 'Yaris Hybrid', year: 2021, km: 28500, fuel: 'hybrid', gearbox: 'automatic', body_type: 'hatchback', colour: 'white', steering: 'right', price: 13950, currency: 'GBP', region: 'kyrenia', area: 'alsancak' },
    ['3c1e2f6a-6b7d-4f0e-9a51-0e7c2b8d4a01']),
  car('1d3f5b7c-9e2a-4b4d-8f61-c2e4a6b8d902', { intent: 'sale', make: 'Mercedes-Benz', model: 'C 200', year: 1995, km: 186000, fuel: 'petrol', gearbox: 'automatic', body_type: 'sedan', colour: 'beige', steering: 'left', price: 4250, currency: 'GBP', region: 'nicosia', area: 'batikent' },
    // Side view only: the front and rear shots of this car show a readable plate (security review, 2026-11-07).
    ['71a3c5e7-9b0d-4f2a-8c46-1e2f3a4b5c05']),
  car('2e4a6c8d-0f3b-4c5e-9a72-d3f5b7c9e003', { intent: 'rent', make: 'Hyundai', model: 'Tucson', year: 2017, km: 74000, fuel: 'diesel', gearbox: 'automatic', body_type: 'suv', colour: 'silver', steering: 'left', price_per_day: 45, currency: 'GBP', region: 'famagusta', area: 'merkez' },
    ['a8c0e2f4-6b1d-4c3e-9f58-7a8b9c0d1e06']),
  car('3f5b7d9e-1a4c-4d6f-8b83-e4a6c8d0f104', { intent: 'sale', make: 'Volkswagen', model: 'Golf 1.4', year: 2003, km: 210000, fuel: 'petrol', gearbox: 'manual', body_type: 'hatchback', colour: 'silver', steering: 'right', price: 285000, currency: 'TRY', region: 'kyrenia', area: 'bogaz' },
    ['2f4b6d8a-0c1e-4a3b-8d59-3e4f5a6b7c07', 'c6e8a0b2-4d1f-4e3a-9b60-8c9d0e1f2a08']),
  car('4a6c8e0f-2b5d-4e7a-9c94-f5b7d9e1a205', { intent: 'sale', make: 'Toyota', model: 'Yaris Cross Hybrid', year: 2022, km: 18000, fuel: 'hybrid', gearbox: 'automatic', body_type: 'suv', colour: 'white', steering: 'right', price: 1450000, currency: 'TRY', region: 'nicosia', area: 'cihangir' },
    ['e0a2c4e6-8b1d-4f3c-a761-4d5e6f7a8b09', '4b6d8f0a-2c1e-4b3d-8e62-9f0a1b2c3d10']),
  car('5b7d9f1a-3c6e-4f8b-8da5-a6c8e0f2b306', { intent: 'rent', make: 'Nissan', model: 'Note Aura', year: 2022, km: 22000, fuel: 'hybrid', gearbox: 'automatic', body_type: 'hatchback', colour: 'white', steering: 'right', price_per_day: 1600, currency: 'TRY', region: 'kyrenia', area: 'alsancak' },
    ['8d0f2b4d-6a1c-4e3f-9b63-5a6b7c8d9e11']),
]

// ─── Offline checks: every photo is committed, CC0, and byte-identical to its recorded hash ─
const manifest = JSON.parse(readFileSync(resolve(DIR, 'photos.json'), 'utf8'))
const byFile = new Map(manifest.map(m => [m.file, m]))
const photoIds = CARS.flatMap(c => c.photos)
if (new Set(photoIds).size !== photoIds.length) fail('a photo is used twice')
if (photoIds.length !== manifest.length) fail(`photos.json lists ${manifest.length} files, the seed uses ${photoIds.length}`)
const bytes = new Map()
for (const id of photoIds) {
  const m = byFile.get(`${id}.jpg`)
  if (!m) fail(`${id}.jpg is not in photos.json`)
  if (m.license !== 'CC0') fail(`${id}.jpg is ${m.license}, not CC0`)
  const p = resolve(DIR, `${id}.jpg`)
  if (!existsSync(p)) fail(`${id}.jpg is missing from data/araclar-preview/`)
  const b = readFileSync(p)
  if (createHash('sha256').update(b).digest('hex') !== m.sha256) fail(`${id}.jpg does not match its recorded sha256`)
  bytes.set(id, b)
}
const path = id => `partner/${DEALER.slug}/${id}.jpg`
console.log(`plan: dealer ${DEALER.slug} (inactive), ${CARS.length} cars (${CARS.filter(c => c.row.intent === 'sale').length} sale, ${CARS.filter(c => c.row.intent === 'rent').length} rent), ${photoIds.length} photos, all CC0 and hash-checked`)
for (const c of CARS) console.log(`  ${c.row.id.slice(0, 8)} ${c.row.intent} ${c.row.make} ${c.row.model} ${c.row.year} · ${c.photos.length} photo(s)`)
if (!apply) { console.log('dry run: nothing written. Apply: gh workflow run araclar-preview-seed -f apply=true'); process.exit(0) }

// ─── Write ───────────────────────────────────────────────────────────────────
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !ANON) fail('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing')
const db = createClient(URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// A dealer that is already ACTIVE means somebody published it: refuse rather than quietly re-hiding or reusing it.
{
  const { data, error } = await db.from('dealers').select('id, is_active').eq('id', DEALER.id).maybeSingle()
  if (error) fail(`read dealer: ${error.message}`)
  if (data?.is_active) fail('REFUSED: the test dealer is ACTIVE in production. Nothing written.')
}
{
  const { error } = await db.from('dealers').upsert(DEALER, { onConflict: 'id' })
  if (error) fail(`upsert dealer: ${error.message}`)
}

// Photos first, each verified by fetching its public URL back and comparing the bytes.
for (const id of photoIds) {
  const { error } = await db.storage.from(BUCKET).upload(path(id), bytes.get(id), { contentType: 'image/jpeg', upsert: true })
  if (error) fail(`upload ${id}: ${error.message}`)
  const url = db.storage.from(BUCKET).getPublicUrl(path(id)).data.publicUrl
  const res = await fetch(`${url}?v=${Date.now()}`)
  const got = Buffer.from(await res.arrayBuffer())
  if (!res.ok || !got.equals(bytes.get(id))) fail(`verify ${id}: HTTP ${res.status}, ${got.length} bytes back`)
}
console.log(`photos: ${photoIds.length}/${photoIds.length} uploaded and read back byte-identical`)

{
  const { error } = await db.from('vehicles').upsert(CARS.map(c => c.row), { onConflict: 'id' })
  if (error) fail(`upsert vehicles: ${error.message}`)
}
{
  const rows = CARS.flatMap(c => c.photos.map((id, i) => ({ vehicle_id: c.row.id, storage_path: path(id), sort_order: i, is_primary: i === 0 })))
  const { error } = await db.from('vehicle_images').upsert(rows, { onConflict: 'vehicle_id,storage_path' })
  if (error) fail(`upsert vehicle_images: ${error.message}`)
}

// ─── Read back ───────────────────────────────────────────────────────────────
const ids = CARS.map(c => c.row.id)
const { data: back, error: backErr } = await db.from('vehicles').select('id, status, vehicle_images(storage_path)').in('id', ids)
if (backErr) fail(`read back: ${backErr.message}`)
const short = back.filter(v => v.status !== 'active' || v.vehicle_images.length !== CARS.find(c => c.row.id === v.id).photos.length)
if (back.length !== CARS.length || short.length) fail(`read back: ${back.length} cars, ${short.length} with the wrong status or photo count`)
const { data: d2 } = await db.from('dealers').select('is_active').eq('id', DEALER.id).single()
if (d2.is_active !== false) fail('read back: the test dealer is not inactive')

// Production must not see any of it.
const { data: seen, error: anonErr } = await anon.from('vehicles').select('id').in('id', ids)
if (anonErr) fail(`anon read: ${anonErr.message}`)
const { data: seenDealer, error: anonDealerErr } = await anon.from('dealers').select('id').eq('id', DEALER.id)
if (anonDealerErr) fail(`anon dealer read: ${anonDealerErr.message}`)
const { data: seenImages, error: anonImgErr } = await anon.from('vehicle_images').select('id').in('vehicle_id', ids)
if (anonImgErr) fail(`anon photo-row read: ${anonImgErr.message}`)
if (seen.length || seenDealer.length || seenImages.length) {
  fail(`LEAK: anon sees ${seen.length} seeded car(s), ${seenDealer.length} dealer row(s), ${seenImages.length} photo row(s)`)
}
console.log(`read back: dealer inactive, ${back.length}/${CARS.length} cars active with all their photos; anon sees 0 cars, 0 dealer rows, 0 photo rows`)
