#!/usr/bin/env node
// ─── Gişe Kıbrıs events import ───────────────────────────────────────────────
//
// Idempotent upsert of the Gişe Kıbrıs catalogue into `events`.
// Next week's drop is: replace the JSON, run this, done.
//
//   node scripts/import-gisekibris-events.mjs --dry     # report only, no writes
//   node scripts/import-gisekibris-events.mjs
//
// REQUIRES migration 20260830_events_gisekibris_import.sql to be applied first —
// it adds description_i18n / source_image_url and swaps the partial unique index
// on external_id for a real UNIQUE constraint (ON CONFLICT cannot infer a partial
// index, so the upsert fails without it).
//
// CREDENTIALS — macOS Keychain, never .env:
//   security add-generic-password -a "$USER" -s ada-supabase-service-role -w
// The service_role key bypasses RLS on every table. It is read at runtime and
// never written to disk, never logged, and never prefixed EXPO_PUBLIC_ (Expo
// inlines those into the client bundle). If the Keychain entry is missing this
// exits non-zero — there is no fallback and no inline prompt.
//
// WHY service_role is required: `events` rows must land as status='approved' to be
// publicly visible, and the ev_guard_write trigger only lets a caller set status
// when auth.uid() IS NULL (service_role) or the caller is an admin. Image mirroring
// (slice 4) additionally writes to a storage path no authenticated user may write.
//
// UPSERT SEMANTICS — two columns are deliberately NEVER updated:
//   • images  — the image-mirror pass owns it. Including it here would wipe
//     previously mirrored URLs on every weekly re-run.
//   • status  — rows are INSERTED as 'approved', never re-approved. If a row is
//     deliberately hidden, a re-import must not silently un-hide it. Same
//     principle as never deleting rows that vanish from the feed.
// `updated_at` is set explicitly: `events` has no bump trigger (only ev_guard_write).
//
// VANISHED ROWS are reported, never deleted — removal from the feed may be
// intentional on their side or ours, and that call is the owner's.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_PATH   = resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')
const VENUES_PATH = resolve(ROOT, 'scripts/gisekibris-venues.json')
const KEYCHAIN_SERVICE = 'ada-supabase-service-role'
const SOURCE = 'gisekibris'

// Reuses the existing public event-images bucket. The `events/gisekibris/…` prefix
// is unreachable to every authenticated user — the bucket's INSERT policy requires
// foldername[2] = auth.uid() (20260817_tighten_loose_storage_inserts.sql) — so only
// service_role can write here. Stricter than a new bucket, and needs no new policy.
const BUCKET = 'event-images'
const PREFIX = 'events/gisekibris'
const MIRROR_CONCURRENCY = 6
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
}

// Downsizing targets. Egress, not aesthetics: the Supabase Free tier shares 5 GB/month
// across every module, and an un-downsized full-list scroll was ~47 MB.
const MAX_WIDTH = 1200
const JPEG_QUALITY = 80
const OPTIMISE_FLOOR = 300 * 1024   // already small enough — leave it alone

const args = process.argv.slice(2)
const dry = args.includes('--dry')
// Reprocess rows that already carry an image (used to re-mirror at a new size).
const remirror = args.includes('--remirror')

// ─── Credentials ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (!m) continue
    const val = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = val
  }
}

// Fails loudly. Never falls back to a hardcoded value, an env var, or a prompt —
// a silent fallback here would either fail confusingly or use the wrong key.
function serviceRoleKey() {
  let out
  try {
    out = execFileSync('security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    fail(
      `Keychain entry "${KEYCHAIN_SERVICE}" not found.`,
      '',
      'Create it with:',
      `  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`,
      '(paste the Supabase service_role key at the prompt — it is not echoed)',
    )
  }
  const key = out.trim()
  if (!key) fail(`Keychain entry "${KEYCHAIN_SERVICE}" is empty.`)

  // Reject ONLY what is unambiguously the wrong key, and let the server diagnose
  // everything else — whether a legacy JWT still works is a project setting this
  // script must not second-guess. A publishable key is a different matter: it is
  // bound by RLS, so it silently cannot write status='approved' rows or mirror
  // images, and would fail confusingly downstream rather than here.
  if (key.startsWith('sb_publishable_')) {
    fail(
      `Keychain entry "${KEYCHAIN_SERVICE}" holds the PUBLISHABLE key, not the secret one.`,
      'It is the client-side key and is bound by RLS, so it cannot write',
      "status='approved' rows or mirror images.",
      '',
      'Dashboard → Project Settings → API Keys → Secret keys → reveal / create.',
      'Copy it, then store it (the interactive -w prompt truncates at 128 chars via',
      'macOS getpass, so pass the value as an argument instead):',
      `  security add-generic-password -U -a "$USER" -s ${KEYCHAIN_SERVICE} -w "$(pbpaste)"`,
    )
  }
  return key
}

function fail(...lines) {
  for (const l of lines) console.error(l)
  process.exit(1)
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

// `events` has no city column — district is derived from lat/lng — so the city is
// folded into the location text. It stays useful until coordinates land.
function locationLabel(ev) {
  return ev.city ? `${ev.venue}, ${ev.city}` : ev.venue
}

// The partner's English is byte-identical to the Turkish on 29 of 60 real
// descriptions — untranslated Turkish, not a translation. Writing it under an "en"
// key would hide that; omitting the key lets the read helper fall back to tr and
// keeps the real gap visible. TBA rows carry "TBA" in both, exactly as supplied.
function descriptionI18n(ev) {
  const tr = ev.description_tr?.trim() || null
  const en = ev.description_en?.trim() || null
  if (!tr && !en) return null
  const out = {}
  if (tr) out.tr = tr
  if (en && en !== tr) out.en = en
  return Object.keys(out).length ? out : null
}

function toRow(ev, venues) {
  const coords = venues.get(ev.venue) ?? {}
  return {
    external_id:      ev.external_id,
    source:           SOURCE,
    title:            ev.title,
    organizer_name:   ev.venue,          // the venue IS the promoter for these rows
    location:         locationLabel(ev),
    category:         ev.category,
    start_date:       ev.start_date,
    end_date:         ev.end_date,
    description:      ev.description_tr?.trim() || null,   // legacy text column
    description_i18n: descriptionI18n(ev),
    source_image_url: ev.source_image_url,
    latitude:         coords.latitude  ?? null,
    longitude:        coords.longitude ?? null,
    // Straight from the seed. NEVER hardcode this back to null: ticket_url is in
    // MUTABLE, so a constant here does not merely fail to populate the column — it
    // actively overwrites every real URL with NULL on the next run. The seed value
    // is already null for any page that failed check-gisekibris-urls.mjs, and the
    // app hides the Buy Ticket button on null.
    ticket_url:       ev.ticket_url ?? null,
  }
}

// Columns compared to decide inserted / updated / unchanged, and the exact set
// written by DO UPDATE. `images` and `status` are absent by design (see header).
const MUTABLE = [
  'title', 'organizer_name', 'location', 'category', 'start_date', 'end_date',
  'description', 'description_i18n', 'source_image_url', 'latitude', 'longitude',
  'ticket_url',
]

function normalise(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(sortKeys(v))
  return String(v)
}

function sortKeys(o) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return o
  return Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])]))
}

// Timestamps come back from Postgres in a different string form than the ISO the
// feed carries, so compare instants rather than text.
function sameValue(field, a, b) {
  if (field === 'start_date' || field === 'end_date') {
    if (a == null || b == null) return a == null && b == null
    return new Date(a).getTime() === new Date(b).getTime()
  }
  if (field === 'latitude' || field === 'longitude') {
    if (a == null || b == null) return a == null && b == null
    return Number(a) === Number(b)
  }
  // The committed seed file has its Firebase query strings stripped (this repo is
  // public and `?token=` is the partner's access token). The DB keeps the full
  // tokenised URL, which is what the mirror pass actually fetches. A stored URL
  // that merely EXTENDS the feed's URL is the same object with credentials
  // attached — treat it as equal so a re-run never downgrades it to a
  // non-fetchable one. A genuinely different image still differs before the '?'.
  if (field === 'source_image_url' && a && b) {
    return String(a) === String(b) || String(a).split('?')[0] === String(b)
  }
  return normalise(a) === normalise(b)
}

// ─── Main ────────────────────────────────────────────────────────────────────

loadEnv()

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')

if (!existsSync(SEED_PATH)) fail(`Seed file not found: ${SEED_PATH}`)
if (!existsSync(VENUES_PATH)) fail(`Venue lookup not found: ${VENUES_PATH}`)

const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'))
const feed = seed.events ?? []

// The lookup is an array of {venue, city, latitude, longitude}; key it by venue
// name. Venue names must match the feed BYTE-FOR-BYTE — both files are NFC, and a
// mismatch would silently import NULL coords instead of erroring, so unmatched
// names are reported below rather than swallowed.
const venueList = JSON.parse(readFileSync(VENUES_PATH, 'utf8')).venues ?? []
if (!Array.isArray(venueList)) fail(`${VENUES_PATH}: "venues" must be an array.`)
const venues = new Map(venueList.map(v => [v.venue, v]))

if (!feed.length) fail('Seed file contains no events.')

const supabase = createClient(SUPABASE_URL, serviceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: existing, error: readErr } = await supabase
  .from('events')
  .select(`id, external_id, status, ${MUTABLE.join(', ')}`)
  .eq('source', SOURCE)

if (readErr) {
  // An auth failure here almost always means the Keychain holds a truncated or
  // wrong-project key rather than anything being wrong with the query.
  const authish = /invalid api key|jwt|unauthorized|permission denied/i.test(readErr.message)
  fail(
    `Could not read existing ${SOURCE} events: ${readErr.message}`,
    ...(authish ? [
      '',
      `The Keychain entry "${KEYCHAIN_SERVICE}" was found but the key was rejected.`,
      'Dashboard → Project Settings → API Keys → Secret keys. Copy it, then store it',
      '(the interactive -w prompt truncates at 128 chars via macOS getpass, so pass',
      'the value as an argument instead):',
      `  security add-generic-password -U -a "$USER" -s ${KEYCHAIN_SERVICE} -w "$(pbpaste)"`,
    ] : []),
  )
}

// ─── Migration guard ─────────────────────────────────────────────────────────
//
// Rows are keyed on the partner's own event id ('gk-' + 20-25 alphanumerics) since
// 20260831_events_external_id_remap.sql. The superseded key was a content hash,
// 'gk-' + 12 lowercase hex. The two shapes cannot collide.
//
// If that migration has not been applied, EVERY feed row looks new: nothing matches
// on the real id, so the upsert would INSERT a full duplicate set alongside the
// originals — 69 duplicate events, live, with the originals still present. This is
// the `facilities.area` failure class (committed but never applied), and it is
// silent without this check. Bail before writing anything.
const SYNTHETIC_KEY = /^gk-[0-9a-f]{12}$/
const stale = (existing ?? []).filter(r => SYNTHETIC_KEY.test(r.external_id ?? ''))
if (stale.length) {
  fail(
    `${stale.length} existing ${SOURCE} row(s) still carry the superseded synthetic external_id.`,
    '',
    'Apply supabase/migrations/20260831_events_external_id_remap.sql first (SQL editor,',
    'Role → postgres). Importing now would insert a duplicate of every row in the feed',
    'rather than updating the existing ones.',
    '',
    ...stale.slice(0, 5).map(r => `  ${r.external_id}  ${r.title}`),
    ...(stale.length > 5 ? [`  … and ${stale.length - 5} more`] : []),
  )
}

const byExternalId = new Map((existing ?? []).map(r => [r.external_id, r]))

const inserts = []
const updates = []
let unchanged = 0

for (const ev of feed) {
  const row = toRow(ev, venues)
  const prev = byExternalId.get(row.external_id)
  if (!prev) { inserts.push(row); continue }
  const diff = MUTABLE.filter(f => !sameValue(f, prev[f], row[f]))
  if (diff.length) updates.push({ row, diff, prev })
  else unchanged++
}

// Reported, never deleted — the removal call is the owner's.
const vanished = (existing ?? []).filter(
  r => !feed.some(ev => ev.external_id === r.external_id))

const missingCoords = [...new Set(
  feed.filter(ev => venues.get(ev.venue)?.latitude == null).map(ev => ev.venue))].sort()

const unknownVenues = [...new Set(
  feed.filter(ev => !venues.has(ev.venue)).map(ev => ev.venue))].sort()

// ─── Write ───────────────────────────────────────────────────────────────────

let written = 0
let writeError = null

if (!dry && (inserts.length || updates.length)) {
  const now = new Date().toISOString()
  const payload = [
    ...inserts.map(r => ({ ...r, status: 'approved', updated_at: now })),
    ...updates.map(u => ({ ...u.row, updated_at: now })),   // no status, no images
  ]
  const { data, error } = await supabase
    .from('events')
    .upsert(payload, { onConflict: 'external_id' })
    .select('id')
  if (error) writeError = error
  else written = data?.length ?? 0
}

// ─── Image mirror ────────────────────────────────────────────────────────────
//
// Their images are Firebase Storage URLs carrying a revocable ?token=, served on
// their bandwidth. Mirror them to our own bucket and store our URL on the row.
// `source_image_url` is left untouched so a re-fetch is always possible.

// The extension lives in the DECODED pathname, before the query string:
//   /v0/b/…/o/events-v2%2FuHqm…%2Fbanner.png?alt=media&token=…
//   → /v0/b/…/o/events-v2/uHqm…/banner.png → png
// Falls back to the response Content-Type, then jpg — never to the raw ?alt=media.
function extensionFor(url, contentType) {
  try {
    const decoded = decodeURIComponent(new URL(url).pathname)
    const ext = decoded.split('/').pop().split('.').pop().toLowerCase()
    if (ALLOWED_EXT.has(ext)) return ext === 'jpeg' ? 'jpg' : ext
  } catch { /* fall through to content-type */ }
  return MIME_EXT[(contentType || '').split(';')[0].trim().toLowerCase()] ?? 'jpg'
}

// Resize to MAX_WIDTH and re-encode. PNG becomes JPEG unless the source ACTUALLY
// uses transparency — hasAlpha alone is not enough, plenty of PNGs carry a fully
// opaque alpha channel, so stats().isOpaque is the real test. Anything already under
// OPTIMISE_FLOOR is passed through untouched.
async function optimise(body, sourceExt) {
  if (body.length < OPTIMISE_FLOOR) {
    return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  }
  const img = sharp(body, { failOn: 'none' })
  const [meta, stats] = await Promise.all([img.metadata(), img.stats()])
  const keepAlpha = meta.hasAlpha === true && stats.isOpaque === false

  const pipeline = sharp(body, { failOn: 'none' })
    .rotate()                                            // honour EXIF orientation
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })

  const buffer = keepAlpha
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()

  // Never let "optimisation" make a file bigger.
  if (buffer.length >= body.length) {
    return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  }
  return {
    buffer,
    ext: keepAlpha ? 'png' : 'jpg',
    contentType: keepAlpha ? 'image/png' : 'image/jpeg',
    skipped: false,
  }
}

// The stored object path, extracted from a public URL we previously wrote.
function objectPathFrom(publicUrl) {
  const marker = `/${BUCKET}/`
  const i = publicUrl?.indexOf(marker) ?? -1
  return i === -1 ? null : publicUrl.slice(i + marker.length)
}

// Firebase Storage serves the OBJECT'S METADATA as JSON unless ?alt=media is present
// — a 200 with content-type application/json, not an error. The committed seed has the
// whole query string stripped (it carried the partner's token and this repo is public),
// so a row inserted from the seed arrives with a bare object path that downloads 580
// bytes of JSON instead of an image. Add the parameter back when there is no query.
//
// The token is NOT needed for reads: verified byte-identical downloads (same sha256)
// with and without it, so their bucket allows public reads. That is why the stripped
// seed is still a re-fetchable record. If they ever lock the bucket down, this fetch
// starts 403-ing and the import needs the tokenised URL threaded through again.
function fetchableImageUrl(url) {
  if (!url) return url
  return url.includes('?') ? url : `${url}?alt=media`
}

async function mirrorOne(row) {
  const res = await fetch(fetchableImageUrl(row.source_image_url))
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`)
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`not an image (content-type: ${contentType})`)
  }
  const body = Buffer.from(await res.arrayBuffer())
  if (!body.length) throw new Error('empty response body')

  const sourceExt = extensionFor(row.source_image_url, contentType)
  const opt = await optimise(body, sourceExt)

  const path = `${PREFIX}/${row.external_id}.${opt.ext}`
  // upsert:true so a re-run after a partial failure overwrites cleanly rather than
  // colliding on an object that was uploaded but never written to the row.
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, opt.buffer, {
    contentType: opt.contentType ?? contentType,
    upsert: true,
  })
  if (upErr) throw new Error(`upload: ${upErr.message}`)

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

  // Point the row at the new object BEFORE deleting the old one. The reverse order
  // has a window where the object is gone but the row still references it, which
  // renders as a broken image in production if the update then fails; this order's
  // worst case is a harmless orphaned file. The window matters most on a
  // --remirror pass, where every row changes path at once.
  const { error: rowErr } = await supabase
    .from('events')
    .update({ images: [publicUrl], updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (rowErr) throw new Error(`row update: ${rowErr.message}`)

  // The old object is orphaned whenever the path changed — a PNG→JPEG conversion
  // changes the extension, and the external_id remap changed the filename. Left
  // behind it keeps billing storage and serves stale bytes to anyone holding the
  // old URL.
  const oldPath = objectPathFrom(row.images?.[0])
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(BUCKET).remove([oldPath])
  }

  return { publicUrl, before: body.length, after: opt.buffer.length, skipped: opt.skipped }
}

// Fixed-size worker pool. One failure is captured per item and never rejects the
// pool, so a dead image cannot abort the run.
async function runPool(items, worker, size) {
  let cursor = 0
  const results = new Array(items.length)
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      try { results[i] = { ok: true, value: await worker(items[i]) } }
      catch (e) { results[i] = { ok: false, error: e.message } }
    }
  })
  await Promise.all(workers)
  return results
}

let mirrored = 0
let alreadyMirrored = 0
const imageFailures = []
const imageSizes = []   // { title, before, after } for the weight report

if (!writeError) {
  const { data: toMirror, error: mirrorReadErr } = await supabase
    .from('events')
    .select('id, external_id, title, images, source_image_url')
    .eq('source', SOURCE)
    .not('source_image_url', 'is', null)

  if (mirrorReadErr) {
    imageFailures.push({ title: '(could not list rows)', error: mirrorReadErr.message })
  } else {
    // Skip anything already carrying an image — makes the pass re-runnable.
    // --remirror reprocesses everything, for a re-encode at a new size.
    const pending = remirror ? (toMirror ?? []) : (toMirror ?? []).filter(r => !r.images?.length)
    alreadyMirrored = (toMirror ?? []).length - pending.length

    if (!dry && pending.length) {
      const results = await runPool(pending, mirrorOne, MIRROR_CONCURRENCY)
      results.forEach((r, i) => {
        if (r.ok) {
          mirrored++
          imageSizes.push({ title: pending[i].title, ...r.value })
        } else {
          imageFailures.push({ title: pending[i].title, external_id: pending[i].external_id, error: r.error })
        }
      })
    } else if (dry) {
      console.log(`\n  (dry) ${pending.length} image(s) would be mirrored, ${alreadyMirrored} already done`)
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

const n = s => String(s).padStart(4)
console.log('')
console.log(`Gişe Kıbrıs import${dry ? '  (DRY RUN — nothing written)' : ''}`)
console.log(`  feed:  ${feed.length} events, ${seed.meta?.venue_count ?? '?'} venues`)
console.log(`  range: ${seed.meta?.date_range?.join('  →  ') ?? '?'}`)
console.log('')
console.log(`  ${n(inserts.length)}  inserted`)
console.log(`  ${n(updates.length)}  updated`)
console.log(`  ${n(unchanged)}  unchanged`)
console.log(`  ${n(mirrored)}  images mirrored`)
console.log(`  ${n(alreadyMirrored)}  images skipped (already mirrored)`)
console.log(`  ${n(imageFailures.length)}  image failures`)

if (imageSizes.length) {
  const mb = b => (b / 1048576)
  const before = imageSizes.reduce((s, x) => s + x.before, 0)
  const after  = imageSizes.reduce((s, x) => s + x.after, 0)
  const passed = imageSizes.filter(x => x.skipped).length
  const biggest = [...imageSizes].sort((a, b) => b.after - a.after).slice(0, 3)
  console.log('\n  Image weight')
  console.log(`    total   : ${mb(before).toFixed(1)} MB  →  ${mb(after).toFixed(1)} MB` +
    `   (−${(100 - (after / before) * 100).toFixed(0)}%)`)
  console.log(`    average : ${mb(before / imageSizes.length).toFixed(2)} MB  →  ${mb(after / imageSizes.length).toFixed(2)} MB`)
  console.log(`    largest : ${mb(Math.max(...imageSizes.map(x => x.before))).toFixed(2)} MB  →  ${mb(biggest[0].after).toFixed(2)} MB`)
  for (const b of biggest) console.log(`                ${mb(b.after).toFixed(2)} MB  ${b.title}`)
  if (passed) console.log(`    ${passed} left untouched (already under ${Math.round(OPTIMISE_FLOOR / 1024)} KB, or re-encode was larger)`)
}

if (imageFailures.length) {
  console.log('\n  ⚠ Image failures — the event row is imported and correct, only its')
  console.log('    image is missing. Re-run to retry just these (mirrored rows are skipped):')
  for (const f of imageFailures) {
    console.log(`      ${f.title}`)
    console.log(`        ${f.external_id ?? ''} ${f.error}`)
  }
}

if (updates.length) {
  console.log('\n  Changed fields:')
  for (const u of updates) {
    console.log(`    ${u.row.external_id}  ${u.row.title}`)
    console.log(`      ${u.diff.join(', ')}`)
  }
}

if (vanished.length) {
  console.log(`\n  ⚠ ${vanished.length} row(s) in the DB are NOT in this feed.`)
  console.log('    NOT deleted — decide yourself, then remove by external_id if you want them gone:')
  for (const v of vanished) console.log(`      ${v.external_id}  ${v.title}`)
}

if (unknownVenues.length) {
  console.log(`\n  ⚠ ${unknownVenues.length} venue(s) missing from scripts/gisekibris-venues.json:`)
  for (const v of unknownVenues) console.log(`      ${v}`)
  console.log('    Add them there (coords may stay null) so next week inherits the entry.')
}

if (missingCoords.length) {
  const affected = feed.filter(ev => venues.get(ev.venue)?.latitude == null).length
  console.log(`\n  ${missingCoords.length} venue(s) still need coordinates — ${affected} event(s) affected:`)
  for (const v of missingCoords) console.log(`      ${v}`)
  console.log('    Imported with NULL lat/lng (correct). They are invisible under the Events')
  console.log('    district filter until coords land; they show fine with no district filter.')
}

if (writeError) {
  console.error(`\n  ✗ Write failed: ${writeError.message}`)
  if (writeError.details) console.error(`    ${writeError.details}`)
  if (writeError.hint) console.error(`    hint: ${writeError.hint}`)
  process.exit(1)
}

if (!dry) console.log(`\n  ✓ ${written} row(s) written.`)
else if (inserts.length || updates.length) console.log('\n  Re-run without --dry to apply.')
console.log('')
