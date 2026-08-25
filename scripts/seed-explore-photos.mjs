#!/usr/bin/env node
// ─── Explore — photo + attribution backfill ──────────────────────────────────
//
//   node scripts/seed-explore-photos.mjs            # DRY RUN — the default
//   node scripts/seed-explore-photos.mjs --apply    # mirror + write
//
// ⚠ DRY-RUN IS THE DEFAULT, WHICH INVERTS scripts/import-novest-properties.mjs
//   (that one applies unless you pass --dry). The inversion is deliberate and was
//   specified: this script writes to rows that are ALREADY LIVE, so the safe default
//   must be the one you get by forgetting a flag. Do not "fix" this for consistency.
//
// WHAT IT DOES: reads scripts/data/explore-photo-manifest.json, mirrors each upstream
// photo into the place-photos bucket, and UPDATEs the existing `places` row —
// photos, cover_image_url, photo_attribution (keyed by the MIRRORED url) and the
// derived legacy photo_credits.
//
// IT ADDS NO ROWS AND CREATES NOTHING. Every manifest entry names an existing UUID and
// the run refuses if any of them is missing. `places` already holds 42 active rows;
// inserting would have produced duplicate landmarks.
//
// ─── RESIZE ONLY. NEVER CROP. THE LICENCE BASIS. ────────────────────────────
//
// CC 4.0 §2(a)(4) authorises the licensee to make "technical modifications necessary to
// exercise the Licensed Rights in Other Media and Formats", and states that
// modifications made under that section NEVER produce Adapted Material. Downscaling and
// re-encoding for a mobile client fall squarely inside it, so they do not trigger
// ShareAlike and do not change the attribution owed.
//
// CROPPING IS NOT A TECHNICAL MODIFICATION. It is an adaptation, it produces Adapted
// Material, and for a CC BY-SA photo it drags the ShareAlike obligation onto whatever it
// is embedded in. That is the whole reason this distinction is written down here.
//
// WHAT THAT MEANS FOR THE PIPELINE — precisely, because sharp's fit modes are easy to
// get wrong and only one of them is safe:
//     fit: 'inside'   scales down to fit the box, aspect preserved, NO crop, NO padding.
//                     ← the only one used here.
//     fit: 'cover'    CROPS to fill.            FORBIDDEN — sharp's DEFAULT, so an
//                                                omitted `fit` is the dangerous case.
//     fit: 'fill'     distorts the aspect.      FORBIDDEN.
//     fit: 'contain'  letterboxes with bars.    not a crop, but not wanted either.
//     .extract()      an explicit crop.         FORBIDDEN.
//
// If a photo ever needs to fill a fixed frame, do it at RENDER time with contain, never
// here. mirror-novest-images.mjs learned the same lesson from the other end: it rejected
// a ready-made WordPress variant because its aspect ratio revealed it to be a crop.
//
// The mirrored file is a TECHNICAL DERIVATIVE, not a new source. source_url keeps
// pointing at the Commons file page, which is where the licence and the creator live.
//
// CREDENTIALS — macOS Keychain, never .env (house convention):
//   security add-generic-password -a "$USER" -s ada-supabase-service-role -w
// service_role is required: these rows have provider_id NULL and no RLS role may write
// them.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

import { legacyCreditString } from '../utils/photoAttribution.js'
import { categoryToGroup, groupVisible, GROUP_ORDER, GROUP_TILE_THRESHOLD, LIVE_TILE_GROUPS }
  from '../constants/exploreCategories.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --manifest exists so the refusal paths can be EXERCISED against deliberately broken
// fixtures (scripts/validate-explore-seed.mjs). A guard nobody has watched reject
// something is not a guard. It is refused together with --apply: pointing a write run at
// an arbitrary file is not a thing this script should make easy.
const mIdx = process.argv.indexOf('--manifest')
const MANIFEST = mIdx !== -1
  ? resolve(process.cwd(), process.argv[mIdx + 1] ?? '')
  : resolve(ROOT, 'scripts/data/explore-photo-manifest.json')
const BUCKET = 'place-photos'

// Longest edge, not width: a portrait original constrained only on width would still
// come through enormous on its height. 2000px is comfortably above any render size the
// app asks for (the gallery is device-width at 280pt tall), so the downscale is
// invisible on screen and the saving is not.
const MAX_EDGE = 2000
const JPEG_QUALITY = 80

// Hard ceiling on the MIRRORED bytes, checked AFTER the resize. The 9 originals total
// ~77 MB — Othello alone is 18.2 MB — and every one of those bytes would be paid for on
// mobile data and in Supabase egress, forever, on a live surface, for no visual gain.
// Target is 300-500 KB; this is the refuse-to-write line above it, not the target.
// Override with --max-kb <n> if a genuinely detailed photo needs headroom, deliberately.
const kbIdx = process.argv.indexOf('--max-kb')
const MAX_BYTES = (kbIdx !== -1 ? Number(process.argv[kbIdx + 1]) : 600) * 1024
const UA = 'ADA-TRNC-Health/1.0 (berke.ustun95@gmail.com) explore-photo-mirror'

const APPLY = process.argv.includes('--apply')

// --only <uuid|name substring> narrows the run to one place. Everything downstream —
// validation, the probe, the rollback block — then covers exactly what was written and
// nothing else, which is what makes a single-row fix safe to re-apply. Matching is done
// AFTER the manifest is parsed, so a typo that matches nothing stops the run rather than
// quietly doing nothing.
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx !== -1 ? (process.argv[onlyIdx + 1] ?? '').trim() : null

if (APPLY && mIdx !== -1) {
  console.error('\x1b[31m--apply and --manifest are mutually exclusive. --manifest is for exercising the refusal paths against broken fixtures, never for writing.\x1b[0m')
  process.exit(1)
}

// Licences a BEACH photo may carry. Beaches render in production TODAY through the
// shipped credit-only renderer (the Home Beaches tile is not behind MODULE_FLAGS.explore),
// and that renderer cannot show a licence notice or link — so a CC BY-SA beach photo
// would be published non-compliantly. Unsplash and Pexels require no attribution at all,
// and own photography is ours. HARD ERROR, not a warning.
//
// This gate is future-proofing: there are no beach entries in the manifest today because
// no compliant beach photo was found to exist. It is here so that adding one later fails
// loudly instead of shipping quietly.
const BEACH_LICENSES = ['Unsplash License', 'Pexels License']

const c = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`,
            b: s => `\x1b[1m${s}\x1b[0m` }

const errors = []
const warns  = []
const fail = (...lines) => { for (const l of lines) console.error(c.r(l)); process.exit(1) }

// ─── Credentials ─────────────────────────────────────────────────────────────

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
if (!process.env.EXPO_PUBLIC_SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')

function serviceRoleKey() {
  let out
  try {
    out = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    fail('Keychain entry "ada-supabase-service-role" not found.', '',
      'Create it with:', '  security add-generic-password -a "$USER" -s ada-supabase-service-role -w')
  }
  const key = out.trim()
  if (!key) fail('Keychain entry "ada-supabase-service-role" is empty.')
  if (key.startsWith('sb_publishable_')) {
    fail('Keychain holds the PUBLISHABLE key, not the secret one.',
      'It is bound by RLS and cannot update rows with provider_id NULL.')
  }
  return key
}

// The anon key is enough to READ the current state, and a dry run must never need a
// secret. Only --apply reaches for the Keychain.
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  APPLY ? serviceRoleKey() : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })

// ─── 1. Manifest validation — refuse rather than write something wrong ───────

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
let places = manifest.places ?? []

if (ONLY) {
  const needle = ONLY.toLowerCase()
  places = places.filter(p => p.id === ONLY || p.name.toLowerCase().includes(needle))
  if (!places.length) {
    fail(`--only ${JSON.stringify(ONLY)} matched no place in the manifest.`,
      '', 'Manifest contains:', ...(manifest.places ?? []).map(p => `  ${p.id}  ${p.name}`))
  }
  console.log(`\x1b[33m--only ${ONLY} → ${places.length} of ${manifest.places.length} place(s): ${places.map(p => p.name).join(', ')}\x1b[0m`)
}

function validatePhoto(place, photo, i) {
  const at = `${place.name} [photo ${i + 1}]`
  const has = v => typeof v === 'string' && v.trim().length > 0

  if (!has(photo.credit))  errors.push(`${at}: missing "credit"`)
  if (!has(photo.license)) errors.push(`${at}: missing "license"`)
  if (!has(photo.existing ? photo.url : photo.src)) {
    errors.push(`${at}: missing "${photo.existing ? 'url' : 'src'}"`)
  }

  // source_url: required for everything EXCEPT own photography, which has no upstream
  // page to point at. Enforced in BOTH directions — an 'own' entry carrying a source_url
  // is equally an error, so the exemption cannot be used to slip a sourced photo through
  // by relabelling it.
  if (photo.source === 'own') {
    if (photo.source_url != null) {
      errors.push(`${at}: source:'own' must have source_url null, got ${JSON.stringify(photo.source_url)}`)
    }
  } else if (!has(photo.source_url)) {
    errors.push(`${at}: missing "source_url" (required unless source is 'own')`)
  }

  // Beach licence gate — see BEACH_LICENSES.
  if (place.category === 'beach') {
    const ok = photo.source === 'own' || BEACH_LICENSES.includes(photo.license)
    if (!ok) {
      errors.push(
        `${at}: BEACH photos may only be own photography, ${BEACH_LICENSES.join(' or ')} — got "${photo.license}".`,
        `${' '.repeat(at.length)}  Beaches render in production today through the credit-only renderer,`,
        `${' '.repeat(at.length)}  which cannot show a licence notice or link.`)
    }
  }
}

for (const p of places) {
  if (!/^[0-9a-f-]{36}$/.test(p.id ?? '')) errors.push(`${p.name ?? '(unnamed)'}: id is not a uuid`)
  if (!p.photos?.length) errors.push(`${p.name}: no photos`)
  p.photos?.forEach((ph, i) => validatePhoto(p, ph, i))
}

if (errors.length) {
  console.error(c.r(c.b('\n✖ MANIFEST REJECTED — nothing was read from the database, nothing written.\n')))
  for (const e of errors) console.error('  ' + c.r(e))
  console.error(`\n  ${errors.length} error(s)\n`)
  process.exit(1)
}

// ─── 2. Current DB state — the rollback baseline, captured BEFORE any write ──

const ids = places.map(p => p.id)
const { data: live, error: readErr } = await supabase
  .from('places')
  .select('id, name, category, region, status, photos, photo_credits, photo_attribution, cover_image_url')
  .in('id', ids)

if (readErr) fail(`Could not read places: ${readErr.message}`)

const byId = new Map((live ?? []).map(r => [r.id, r]))
const absent = places.filter(p => !byId.has(p.id))
if (absent.length) {
  fail('Manifest names rows that do not exist (or are not readable):',
    ...absent.map(p => `  ${p.id}  ${p.name}`),
    '', 'This script UPDATES existing places. It never inserts.')
}

for (const p of places) {
  const row = byId.get(p.id)
  if (row.name !== p.name)         warns.push(`${p.name}: db name is "${row.name}" — manifest may be stale`)
  if (row.category !== p.category) warns.push(`${p.name}: db category is "${row.category}", manifest says "${p.category}"`)
  if (row.status !== 'active')     warns.push(`${p.name}: status is "${row.status}", not active — it will not render`)
  const existingCount = (row.photos ?? []).length
  const keptCount = p.photos.filter(x => x.existing).length
  if (existingCount > keptCount) {
    warns.push(`${p.name}: row has ${existingCount} photo(s) but the manifest preserves only ${keptCount} — ${existingCount - keptCount} would be DROPPED`)
  }
}

// ─── 3. Reachability — HEAD every upstream photo ─────────────────────────────

const nap = ms => new Promise(r => setTimeout(r, ms))

// Wikimedia rate-limits, and this stage is a burst of requests to one host. Spacing plus
// backoff on 429/5xx is the polite form AND the correct one: without it a rate-limit is
// indistinguishable from a dead link, and the run refuses over a transient 429.
//
// FOUND BY THE GUARD HARNESS, not by reasoning: validate-explore-seed.mjs runs this
// script ~15 times in a row, which is ~135 HEADs at commons in a few seconds. Three
// guard assertions went red with "not reachable as an image" against URLs that are
// perfectly fine. The first instinct was to relax the assertion; that would have left a
// check that cries wolf. The defect was here.
const HEAD_SPACING_MS = 120
const HEAD_RETRIES = 3

async function head(url) {
  let last = { ok: false, status: 0, ct: '', bytes: null, transient: false }
  for (let attempt = 0; attempt < HEAD_RETRIES; attempt++) {
    if (attempt) await nap(400 * 2 ** attempt)
    try {
      const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' })
      const ct = r.headers.get('content-type') ?? ''
      const transient = r.status === 429 || r.status >= 500
      last = { ok: r.ok && ct.startsWith('image/'), status: r.status, ct, transient,
               bytes: Number(r.headers.get('content-length')) || null }
      if (last.ok || !transient) return last
    } catch (e) {
      last = { ok: false, status: 0, ct: '', bytes: null, transient: true, err: e.message }
    }
  }
  return last
}

const SKIP_REACH = process.argv.includes('--skip-reachability')
if (SKIP_REACH && APPLY) fail('--skip-reachability cannot be combined with --apply.')

console.log(c.b('\n─── Photo reachability ────────────────────────────────────────'))
if (SKIP_REACH) {
  console.log(c.y('  skipped (--skip-reachability) — manifest validation only'))
} else {
  for (const p of places) {
    for (const ph of p.photos) {
      const url = ph.existing ? ph.url : ph.src
      const r = await head(url)
      await nap(HEAD_SPACING_MS)
      const size = r.bytes ? `${(r.bytes / 1024 / 1024).toFixed(1)} MB` : '?'
      console.log(`  ${r.ok ? c.g('200') : c.r(String(r.status || 'ERR'))}  ${p.name.padEnd(24)} ${c.d(`${r.ct || r.err || ''} ${size}`)}`)
      if (!r.ok) {
        // A rate-limit is not a missing file. Saying so keeps the operator from deleting
        // a perfectly good manifest entry because the host was busy.
        errors.push(r.transient
          ? `${p.name}: upstream is rate-limiting or erroring (${r.status || r.err}) — TRANSIENT, retry rather than change the manifest — ${url}`
          : `${p.name}: photo not reachable as an image — ${url} (${r.status} ${r.ct}${r.err ? ' ' + r.err : ''})`)
      }
    }
  }
}

// ─── 4. Group gating — through the REAL groupVisible(), never a copy ─────────
//
// This backfill changes NO row's category and adds NO row, so the tile counts are
// arithmetically unchanged. The table is printed anyway, from the live RPC, because the
// point is to SHOW that it does not move — an earlier version of this plan claimed a
// 4→10 jump for nature and was wrong.

const { data: counts, error: cntErr } = await supabase.rpc('explore_category_counts')
console.log(c.b('\n─── Group tile gating (unchanged by this backfill) ─────────────'))
if (cntErr) {
  warns.push(`explore_category_counts unavailable (${cntErr.message}) — gating not verified`)
  console.log(c.y('  RPC unavailable — skipped'))
} else {
  const g = {}
  for (const { category, n } of counts) {
    const grp = categoryToGroup(category)
    if (grp) g[grp] = (g[grp] || 0) + Number(n)
  }
  for (const grp of GROUP_ORDER) {
    const n = g[grp] || 0
    const vis = groupVisible(grp, n, false)          // false = a normal customer, not an admin
    const why = LIVE_TILE_GROUPS.includes(grp) ? 'exempt' : n >= GROUP_TILE_THRESHOLD ? `>= ${GROUP_TILE_THRESHOLD}` : `< ${GROUP_TILE_THRESHOLD}`
    console.log(`  ${vis ? c.g('visible') : c.d('hidden ')}  ${grp.padEnd(10)} ${String(n).padStart(3)}  ${c.d(why)}`)
  }
  console.log(c.d(`  threshold ${GROUP_TILE_THRESHOLD}, exempt ${JSON.stringify(LIVE_TILE_GROUPS)} — read from constants/exploreCategories.js, not restated here`))
}

// ─── 5. Rollback SQL — captured state, scoped to the manifest UUIDs ──────────
//
// Restores the values that were in the database BEFORE this run, not blanks. That
// distinction is load-bearing: Kyrenia Castle already had a photo and a credit, so a
// naive "set it all to empty" revert would destroy real data rather than undo this run.

const sqlLit = v => {
  if (v === null || v === undefined) return 'NULL'
  if (Array.isArray(v)) return v.length ? `ARRAY[${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(', ')}]::text[]` : `'{}'::text[]`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function rollbackSQL() {
  const lines = [
    '-- ═══ ROLLBACK — restores the state captured before this run ═══════════════',
    '-- Scoped to the manifest UUIDs only. Cannot touch any other place, including the',
    '-- four live beaches. Paste into the SQL editor, Role = postgres.',
    'BEGIN;',
  ]
  for (const p of places) {
    const r = byId.get(p.id)
    lines.push(
      `UPDATE public.places SET`,
      `  photos            = ${sqlLit(r.photos ?? [])},`,
      `  photo_credits     = ${sqlLit(r.photo_credits ?? null)},`,
      `  photo_attribution = ${sqlLit(r.photo_attribution ?? null)},`,
      `  cover_image_url   = ${sqlLit(r.cover_image_url ?? null)}`,
      `WHERE id = '${p.id}';   -- ${p.name}`)
  }
  lines.push('COMMIT;',
    '-- Mirrored objects are left in the place-photos bucket on purpose: they are',
    '-- harmless once unreferenced, and deleting them would make a re-run re-upload.')
  return lines.join('\n')
}

// ─── 6. Mirror + write ───────────────────────────────────────────────────────

const publicUrl = path =>
  `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

// Downloading ~75 MB from one host in a burst gets rate-limited, exactly as the HEAD
// stage did. Found the same way and it must not be tolerated in a different form: the
// FIRST run of the resize probe silently dropped three photos to 429s and reported a
// total of 44 MB across 5 photos as though that were the whole set. A dry run that
// quietly covers part of the work is worse than one that fails, because the number it
// prints looks like an answer.
async function getWithRetry(url, tries = 4) {
  let last
  for (let a = 0; a < tries; a++) {
    if (a) await nap(600 * 2 ** a)
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (r.ok) return Buffer.from(await r.arrayBuffer())
      last = `HTTP ${r.status}`
      if (r.status !== 429 && r.status < 500) break     // permanent — stop retrying
    } catch (e) { last = e.message }
  }
  throw new Error(last ?? 'unknown fetch failure')
}

// THE ONE PLACE PIXELS ARE TOUCHED. fit:'inside' + withoutEnlargement is an
// aspect-preserving downscale and nothing else — see the licence note in the header
// before changing any argument here.
async function shrink(body) {
  return sharp(body, { failOn: 'none' })
    .rotate()                                            // EXIF orientation only
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

// The ceiling, in one place, so the dry-run probe and the real mirror cannot disagree
// about what is too big. Throws — a photo over the line stops the run.
function assertSize(place, i, bytes) {
  if (bytes <= MAX_BYTES) return
  throw new Error(
    `${place.name} #${i + 1}: still ${kb(bytes)} after resize, over the ${kb(MAX_BYTES)} ceiling. ` +
    `Lower JPEG_QUALITY, or raise it deliberately with --max-kb.`)
}

const kb = b => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`

// Fetch + resize WITHOUT uploading, so a dry run can report the real mirrored size
// rather than a prediction. Also where the ceiling is enforced: a photo that is still
// too big after the resize must stop the run, not be quietly published.
async function probe(photo) {
  const body = await getWithRetry(photo.src)
  const out  = await shrink(body)
  const meta = await sharp(out).metadata()
  return { before: body.length, after: out.length, w: meta.width, h: meta.height, buffer: out }
}

// Deterministic, keyed on the place UUID and the photo's position IN THE MANIFEST, so a
// re-run overwrites itself rather than accumulating copies.
//
// ⚠ POSITION-KEYED, which is the scheme mirror-novest-images.mjs explicitly REJECTED —
//   there, a gallery reorder shifts every path and re-uploads everything after the
//   insertion point, so it keys on the partner's stable media id instead. Accepted here
//   deliberately: this is a one-shot backfill of 9 hand-curated photos, there is no
//   upstream id to key on (a Commons file page is not a media id we control), and the
//   rollback block captures the exact prior URLs. If this ever becomes a repeating sync,
//   revisit it — do not assume the difference was an oversight.
const mirrorPath = (placeId, i) => `places/${placeId}/${i + 1}.jpg`

async function mirror(place, photo, i) {
  const body = await getWithRetry(photo.src)

  const buffer = await shrink(body)
  assertSize(place, i, buffer.length)

  const path = mirrorPath(place.id, i)
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`upload: ${error.message}`)

  return { url: publicUrl(path), before: body.length, after: buffer.length }
}

// The row payload for one place, given the resolved (mirrored or existing) urls.
function buildRow(place, urls) {
  const attribution = {}
  place.photos.forEach((ph, i) => {
    attribution[urls[i]] = {
      credit: ph.credit, license: ph.license,
      license_url: ph.license_url ?? null,
      source_url: ph.source_url ?? null,
      source: ph.source ?? null,
    }
  })

  // Turkish, because the app's primary audience reads Turkish and the legacy renderer
  // shows exactly one string with no language switch of its own.
  const credits = place.photos.map(ph => legacyCreditString(ph, 'tr'))

  // photo_attribution keys must be EXACTLY the photos array. Asserted rather than
  // assumed — a mismatch means every credit on the row silently resolves to nothing.
  const keys = Object.keys(attribution)
  if (keys.length !== urls.length || !urls.every(u => keys.includes(u))) {
    throw new Error(`${place.name}: photo_attribution keys do not match photos[]`)
  }

  return {
    photos: urls,
    cover_image_url: urls[0] ?? null,   // both card surfaces fall back to photos[0] anyway; set it so the fallback stays a safety net
    photo_attribution: attribution,
    photo_credits: credits,
  }
}

// ─── 7. Report ───────────────────────────────────────────────────────────────

console.log(c.b('\n─── What will be written ──────────────────────────────────────'))
let totalBefore = 0, totalAfter = 0
for (const p of places) {
  const row = byId.get(p.id)
  console.log(`\n  ${c.b(p.name)} ${c.d(`${p.category} · ${p.region}`)}`)
  console.log(c.d(`    now: ${(row.photos ?? []).length} photo(s), attribution ${row.photo_attribution ? 'set' : 'NULL'}`))
  for (const [i, ph] of p.photos.entries()) {
    const tag = ph.existing ? c.y('keep') : c.g('new ')
    console.log(`    ${tag} ${ph.credit} / ${ph.license}`)
    console.log(c.d(`         legacy credit → ${legacyCreditString(ph, 'tr')}`))
    console.log(c.d(`         source        → ${ph.source_url ?? '(own photography — no source page)'}`))

    if (ph.existing) {
      // Berke's instruction: the file already in the bucket is left alone. It is not
      // re-fetched, not re-encoded, and not size-checked — only its credit string changes.
      console.log(c.d(`         bucket file   → untouched (only its credit string changes)`))
      continue
    }
    if (SKIP_REACH) { console.log(c.d(`         mirror to     → ${mirrorPath(p.id, i)}`)); continue }

    // Actually download and resize, so the number below is measured, not predicted.
    try {
      const r = await probe(ph)
      await nap(HEAD_SPACING_MS)
      totalBefore += r.before; totalAfter += r.after
      // The SAME assertSize() the real mirror calls — not a second comparison against
      // MAX_BYTES. Two spellings of one rule is how a dry run comes to disagree with the
      // run it is supposed to predict.
      let over = null
      try { assertSize(p, i, r.after) } catch (e) { over = e.message }
      console.log(c.d(`         mirror to     → ${mirrorPath(p.id, i)}`))
      console.log(`         ${over ? c.r('resize') : c.g('resize')}        → ${kb(r.before)} → ${c.b(kb(r.after))}  ${c.d(`${r.w}x${r.h}`)}${over ? c.r('  OVER CEILING') : ''}`)
      if (over) errors.push(over)
    } catch (e) {
      console.log(`         ${c.r('resize')}        → ${c.r(`FAILED — ${e.message}`)}`)
      errors.push(`${p.name} #${i + 1}: resize probe failed — ${e.message}`)
    }
  }
}
if (totalAfter) {
  console.log(c.b(`\n  mirrored total: ${kb(totalBefore)} → ${c.g(kb(totalAfter))}  ${c.d(`(${Math.round(100 - totalAfter / totalBefore * 100)}% smaller, ceiling ${kb(MAX_BYTES)}/photo)`)}`))
}

if (warns.length) {
  console.log(c.b(c.y('\n─── Warnings ──────────────────────────────────────────────────')))
  for (const w of warns) console.log('  ' + c.y(w))
}

if (errors.length) {
  console.error(c.r(c.b('\n✖ REFUSING TO WRITE\n')))
  for (const e of errors) console.error('  ' + c.r(e))
  console.error('')
  process.exit(1)
}

if (!APPLY) {
  console.log(c.b('\n─── Rollback (also printed after every --apply) ────────────────'))
  console.log(c.d(rollbackSQL()))
  console.log(c.b(c.g('\n✔ DRY RUN — nothing was written.')))
  console.log(`  Re-run with ${c.b('--apply')} to mirror and write.\n`)
  process.exit(0)
}

console.log(c.b('\n─── Applying ──────────────────────────────────────────────────'))
let written = 0
for (const p of places) {
  const urls = []
  for (const [i, ph] of p.photos.entries()) {
    if (ph.existing) { urls.push(ph.url); continue }
    try {
      const m = await mirror(p, ph, i)
      urls.push(m.url)
      console.log(`  ${c.g('mirrored')} ${p.name} #${i + 1}  ${c.d(`${(m.before / 1024 / 1024).toFixed(1)} MB → ${(m.after / 1024 / 1024).toFixed(1)} MB`)}`)
    } catch (e) {
      fail(`${p.name} #${i + 1}: mirror failed — ${e.message}`,
        '', 'Nothing was written for this place. Re-run: mirroring is idempotent.')
    }
  }

  const payload = buildRow(p, urls)
  const { error } = await supabase.from('places').update(payload).eq('id', p.id)
  if (error) fail(`${p.name}: update failed — ${error.message}`)
  written++
  console.log(`  ${c.g('updated ')} ${p.name}  ${c.d(`${urls.length} photo(s)`)}`)
}

console.log(c.b(c.g(`\n✔ ${written} place(s) updated.`)))
console.log(c.b('\n─── ROLLBACK — keep this ──────────────────────────────────────'))
console.log(rollbackSQL())
console.log('')
