#!/usr/bin/env node
// ─── Novest import — post-write verification ─────────────────────────────────
//
//   node scripts/verify-novest-import.mjs
//
// Reads the DATABASE, not the feed. Everything here is a fact the app depends on and
// that no CHECK constraint can express on its own, or that a CHECK could express but
// which would fail the whole batch without naming the row.
//
// Run after every import. It is deliberately cheap enough to be habitual.
//
// The five gate checks are 1-5. 6-9 are the invariants that would otherwise only
// surface as a rendering bug on a phone.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { SOURCE, AGENCY_ID, PHONE_RE } from '../supabase/functions/_shared/novest-feed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = Number(process.env.NOVEST_EXPECTED ?? 88)

const envPath = resolve(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const key = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
  { encoding: 'utf8' }).trim()
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, key,
  { auth: { persistSession: false, autoRefreshToken: false } })

const { data: rows, error } = await supabase
  .from('properties')
  .select('id,external_id,source,status,agency_id,agent_id,location_precision,latitude,longitude,title,description,price,currency,property_type,intent,amenities,last_seen_at,content_hash')
  .eq('source', SOURCE)
if (error) { console.error('read failed:', error.message); process.exit(1) }

let failed = 0
const check = (n, label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${String(n).padStart(2)}. ${label}${detail ? '  — ' + detail : ''}`)
  if (!pass) failed++
}
const countWhere = fn => rows.filter(fn).length
const idsWhere = fn => rows.filter(fn).map(r => r.external_id).slice(0, 8).join(', ')

// ⚠ EVERY "all rows satisfy X" CHECK MUST GO THROUGH THIS.
//
// `countWhere(fn) === rows.length` is 0 === 0 on an empty table, so a universal check
// PASSES VACUOUSLY when there is nothing to check. The first version of this file did
// exactly that: run against an empty `properties`, checks 2-9 all reported ✓ while
// verifying nothing at all — the same defect as the towing seed validator that reported
// "all 4 rows valid" having parsed zero rows.
//
// A check that cannot fail is worse than no check, because it buys confidence it has not
// earned. An empty population is a FAILURE here, not a pass: "every row has an
// agency_id" is not a true statement about a table with no rows, it is a meaningless one.
const allRows = fn => rows.length > 0 && countWhere(fn) === rows.length

console.log(`\n── Novest import verification (${rows.length} row(s) with source='${SOURCE}') ──\n`)

// ── THE FIVE GATE CHECKS ─────────────────────────────────────────────────────
check(1, `${EXPECTED} rows, all source='${SOURCE}'`,
  rows.length === EXPECTED, `found ${rows.length}`)

// properties_feed_precision_check enforces this, but the column DEFAULTs to 'exact' —
// so this is the assertion that the default never won.
check(2, "location_precision='area' on every row",
  allRows(r => r.location_precision === 'area'),
  `${countWhere(r => r.location_precision !== 'area')} wrong: ${idsWhere(r => r.location_precision !== 'area') || '—'}`)

// All 91 feed listings carry the Houzez Miami default. Any coordinate here means the
// importer started writing them, which it must not do without a Slice 1 amendment.
check(3, 'latitude and longitude NULL on every row',
  allRows(r => r.latitude === null && r.longitude === null),
  `${countWhere(r => r.latitude !== null || r.longitude !== null)} carry coordinates: ${idsWhere(r => r.latitude !== null || r.longitude !== null) || '—'}`)

// THE C2 BUG. Slice 3 embeds estate_agencies through properties.agency_id; a NULL here
// renders a listing with no agency name, which is the one attribution the partner
// relationship requires. It is invisible in SQL and obvious on a phone.
check(4, 'agency_id set to the Novest agency on every row',
  allRows(r => r.agency_id === AGENCY_ID),
  `${countWhere(r => r.agency_id !== AGENCY_ID)} wrong/NULL: ${idsWhere(r => r.agency_id !== AGENCY_ID) || '—'}`)

// Reads what was STORED, not what the mapper produced — the only version that matters.
const leaks = rows.filter(r => PHONE_RE.test(r.title || '') || PHONE_RE.test(r.description || ''))
check(5, 'zero phone-shaped strings in any stored title or description',
  rows.length > 0 && leaks.length === 0, leaks.length ? leaks.map(r => r.external_id).join(', ') : (rows.length ? 'clean' : 'NO ROWS — nothing was checked'))

// ── SUPPORTING INVARIANTS ────────────────────────────────────────────────────
console.log('')

// The XOR constraint guarantees this, so a failure means the constraint is gone — and
// with it the thing that stops an agent buying free visibility by setting source.
check(6, 'agent_id NULL on every row (XOR with source holds)',
  allRows(r => r.agent_id === null),
  `${countWhere(r => r.agent_id !== null)} carry an agent_id`)

// props_select_public requires status='active'. Anything else is invisible to users.
check(7, 'every row is status=active',
  allRows(r => r.status === 'active'),
  Object.entries(rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}))
    .map(([k, v]) => `${k}:${v}`).join(' '))

// properties_amenities_shape_check rejects an empty array; this catches the mapper
// regressing from null to [].
check(8, 'no row carries an EMPTY amenities array',
  rows.length > 0 && countWhere(r => Array.isArray(r.amenities) && r.amenities.length === 0) === 0,
  idsWhere(r => Array.isArray(r.amenities) && r.amenities.length === 0) || 'clean')

// last_seen_at is the ONLY health signal the module has — the staleness banner reads
// max(last_seen_at). A row without it is invisible to that banner.
check(9, 'last_seen_at stamped on every row',
  allRows(r => r.last_seen_at !== null),
  `${countWhere(r => r.last_seen_at === null)} unstamped`)

// ── IMAGE INVARIANTS ─────────────────────────────────────────────────────────
const { data: imgs, error: iErr } = await supabase
  .from('property_images').select('property_id,url,source_url,is_primary,sort_order')
  .in('property_id', rows.map(r => r.id))
if (iErr) { console.error('image read failed:', iErr.message); process.exit(1) }

console.log('')
const imgsBy = imgs.reduce((a, i) => ((a[i.property_id] ??= []).push(i), a), {})
const noImages = rows.filter(r => !imgsBy[r.id]?.length)

// ─── PINNED, not asserted-zero ───────────────────────────────────────────────
//
// novest-20111 has no images and CANNOT have any: all six of its media references
// (20104-20109) are absent from Novest's own media library — 404 from /wp/v2/media.
// Nothing on our side can fix that; it renders the placeholder, which is a supported
// path (Slice 3 seed row #10 exercises it).
//
// So this check does NOT assert zero, because that would be permanently red — and a
// check that always cries wolf teaches you to ignore it, which is how you miss the
// second one. It pins the exact known set instead, the same shape as
// "tier=unknown is still a one-off (exactly 1 row)" in verify_schema.sql.
//
// It goes red in BOTH useful directions: a NEW listing losing its images, and 20111
// gaining some (which means Novest fixed it and this pin should be deleted).
const KNOWN_IMAGELESS = new Set(['novest-20111'])
const unexpectedEmpty = noImages.filter(r => !KNOWN_IMAGELESS.has(r.external_id))
const fixedSince = [...KNOWN_IMAGELESS].filter(id =>
  rows.some(r => r.external_id === id) && !noImages.some(r => r.external_id === id))
check(10, `image-less listings are exactly the known set (${[...KNOWN_IMAGELESS].join(', ')})`,
  rows.length > 0 && unexpectedEmpty.length === 0 && fixedSince.length === 0,
  unexpectedEmpty.length ? `NEW image-less listing(s): ${unexpectedEmpty.map(r => r.external_id).join(', ')}`
    : fixedSince.length ? `${fixedSince.join(', ')} now HAS images — remove it from KNOWN_IMAGELESS`
    : `${noImages.length} image-less, as expected`)

// property_images_primary_unique enforces "at most one"; nothing enforces "at least one".
// Without a primary, the card falls back to sort_order and may show a bathroom.
const noPrimary = rows.filter(r => imgsBy[r.id]?.length && !imgsBy[r.id].some(i => i.is_primary))
check(11, 'every listing with images has exactly one primary',
  rows.length > 0 && noPrimary.length === 0,
  noPrimary.length ? `${noPrimary.length} without: ${noPrimary.map(r => r.external_id).join(', ')}` : 'all set')

// If a url still points at their host we are hotlinking a partner's bandwidth and the
// image dies the day they reorganise. source_url SHOULD point there; url must not.
const hotlinked = imgs.filter(i => /coldwellbankernovest\.com/.test(i.url || ''))
check(12, 'no stored url hotlinks the partner host',
  imgs.length > 0 && hotlinked.length === 0, `${hotlinked.length} hotlinked`)

// The resume key is (property_id, source_url). A duplicate means that key regressed.
const pairs = imgs.map(i => `${i.property_id}|${i.source_url}`)
check(13, 'no duplicate (property_id, source_url) image rows',
  imgs.length > 0 && pairs.length === new Set(pairs).size,
  `${pairs.length - new Set(pairs).size} duplicate(s)`)

console.log(`\n  images: ${imgs.length} row(s) across ${Object.keys(imgsBy).length} listing(s)`)
{
  const counts = rows.map(r => imgsBy[r.id]?.length ?? 0).sort((a, b) => a - b)
  console.log(`  per listing  min ${counts[0]} · median ${counts[Math.floor(counts.length / 2)]} · max ${counts[counts.length - 1]}`)
}

const stalest = rows.reduce((a, r) => (!a || r.last_seen_at < a ? r.last_seen_at : a), null)
console.log(`\n  oldest last_seen_at: ${stalest ?? '—'}`)
console.log(`  price range: ${rows.length ? Math.min(...rows.map(r => Number(r.price))) : '—'} – ${rows.length ? Math.max(...rows.map(r => Number(r.price))) : '—'} ${rows[0]?.currency ?? ''}`)
const byType = rows.reduce((a, r) => (a[r.property_type] = (a[r.property_type] || 0) + 1, a), {})
console.log(`  by type: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`)

console.log(failed ? `\nFAILED — ${failed} check(s)\n` : '\nall checks pass\n')
process.exit(failed ? 1 : 0)
