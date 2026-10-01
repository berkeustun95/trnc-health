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
// CREDENTIALS — production is written only from GitHub Actions (gisekibris-feed),
// with the repository secret SUPABASE_SERVICE_ROLE_KEY. Outside CI a write-mode run
// stops at prodWriteGuard() before anything is read (scripts/lib/prod-write-guard.mjs).
// The key bypasses RLS on every table: never logged, never prefixed EXPO_PUBLIC_.
//
//   node scripts/import-gisekibris-events.mjs --selftest   # offline: no network, no DB
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
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_PATH   = resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')
const VENUES_PATH = resolve(ROOT, 'scripts/gisekibris-venues.json')
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
// An unknown flag is refused, never ignored: this script WRITES by default, so a
// mistyped `--dyr` or a `--selftest` it does not have used to run a real import
// (2026-10-01: a `--selftest` loop over the feed scripts wrote one prod row).
const selftest = args.includes('--selftest')
const unknownArgs = args.filter(a => !['--dry', '--remirror', '--selftest'].includes(a))
if (unknownArgs.length) {
  console.error(`Unknown argument(s): ${unknownArgs.join(' ')} — this script takes only --dry, --remirror and --selftest. Nothing was run.`)
  process.exit(1)
}
prodWriteGuard({ wouldWrite: !dry && !selftest, workflow: 'gisekibris-feed',
  dryHint: 'node scripts/import-gisekibris-events.mjs --dry  (needs a service key to read)' })

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

function toRow(ev, resolve) {
  const coords = resolve(ev.venue) ?? {}
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

// ─── Planning — pure: no client, no network, no clock (callers pass `now`) ───
//
// Everything the import DECIDES lives here, so --selftest can run the same code the
// real import runs, against a fixture.

function planChanges({ feed, existing, resolve, known }) {
  const byExternalId = new Map(existing.map(r => [r.external_id, r]))
  const inserts = []
  const updates = []
  let unchanged = 0
  for (const ev of feed) {
    const row = toRow(ev, resolve)
    const prev = byExternalId.get(row.external_id)
    if (!prev) { inserts.push(row); continue }
    const diff = MUTABLE.filter(f => !sameValue(f, prev[f], row[f]))
    if (diff.length) updates.push({ row, diff, prev })
    else unchanged++
  }
  // Reported, never deleted — the removal call is the owner's.
  const vanished = existing.filter(r => !feed.some(ev => ev.external_id === r.external_id))
  // ONE list, used for both the venue names and the event count, so the two can
  // never disagree. The count once used the entry's own pin instead, and reported
  // Lions Garden and the Rauf Denktaş venue (pinned through `aliases`) as unpinned.
  // Alias-aware on both: a renamed venue that inherits a pin is neither missing
  // coordinates nor unknown.
  const unpinnedEvents = feed.filter(ev => resolve(ev.venue)?.latitude == null)
  const missingCoords = [...new Set(unpinnedEvents.map(ev => ev.venue))].sort()
  const unknownVenues = [...new Set(
    feed.filter(ev => !known.has(ev.venue) && !resolve(ev.venue)).map(ev => ev.venue))].sort()
  return { inserts, updates, unchanged, vanished, unpinnedEvents, missingCoords, unknownVenues }
}

function buildPayloads(inserts, updates, now) {
  // New rows: status is set here and only here.
  const insertPayload = inserts.map(r => ({ ...r, status: 'approved', updated_at: now }))
  // Existing rows: no status (never re-approve a deliberately hidden row) and no
  // images (the mirror pass owns that column).
  const updatePayload = updates.map(u => ({ ...u.row, updated_at: now }))
  assertHomogeneous('insert', insertPayload)
  assertHomogeneous('update', updatePayload)
  return { insertPayload, updatePayload }
}

// ─── --selftest: the planning logic on a fixture, with the network trapped ───
//
// Runs BEFORE .env is read, before any key is looked up and before a client exists.
// globalThis.fetch is replaced by a trap that records and throws: supabase-js does
// every read and write through fetch, so a single trapped call fails the test. The
// trap is proven live first (a real supabase-js upsert must land in it), or a broken
// trap would let a writing selftest pass.
if (selftest) {
  let bad = 0
  const t = (label, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want), ok = g === w
    if (!ok) bad++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${g}${ok ? '' : `  wanted ${w}`}`)
  }
  const trapped = []
  globalThis.fetch = async (input, init) => {
    trapped.push(`${init?.method ?? 'GET'} ${String(input?.url ?? input)}`)
    throw new Error('SELFTEST: network is forbidden')
  }

  console.log('\n  the trap is live (positive control)')
  {
    const probe = createClient('https://selftest.invalid', 'selftest-not-a-key', { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await probe.from('events').upsert([{ external_id: 'gk-X' }])
    t('a supabase-js upsert is caught by the trap', trapped.length === 1 && /POST/.test(trapped[0]), true)
    t('…and surfaces as an error, not a write', Boolean(error), true)
    trapped.length = 0
  }

  const venueFixture = [
    { venue: 'Cage Club', latitude: 35.1, longitude: 33.1 },
    { venue: 'Lions Garden', latitude: null, longitude: null, aliases: ['LEO Club'] },
    { venue: 'LEO Club', latitude: 35.2, longitude: 33.2 },
    { venue: 'Nowhere Bar', latitude: null, longitude: null },
  ]
  const known = new Map(venueFixture.map(v => [v.venue, v]))
  const resolve = makeResolver(venueFixture)
  const ev = (id, venue) => ({
    external_id: id, title: `T ${id}`, venue, city: 'Girne', category: 'music',
    start_date: '2026-12-01T18:00:00.000Z', end_date: null,
    description_tr: 'açıklama', description_en: 'description',
    source_image_url: `https://img.example/event/${id}/banner.jpg`,
    ticket_url: `https://www.gisekibris.com/etkinlikler/x--${id}`,
  })
  const feedFx = [ev('gk-NEW1', 'Cage Club'), ev('gk-UPD1', 'Lions Garden'), ev('gk-SAME', 'Cage Club'),
                  ev('gk-UNP1', 'Nowhere Bar'), ev('gk-UNK1', 'Brand New Venue')]
  const same = toRow(feedFx[2], resolve)
  const existingFx = [
    // Stored before Lions Garden's pin resolved: coordinates NULL, so an update.
    { ...toRow(feedFx[1], resolve), latitude: null, longitude: null, status: 'approved' },
    // Postgres timestamp form + a tokenised image URL: both must read as UNCHANGED.
    { ...same, start_date: '2026-12-01 18:00:00+00', source_image_url: same.source_image_url + '?alt=media&token=abc', status: 'approved' },
    { external_id: 'gk-GONE', title: 'gone from the feed', status: 'approved' },
  ]
  const plan = planChanges({ feed: feedFx, existing: existingFx, resolve, known })

  console.log('\n  planChanges')
  t('inserts', plan.inserts.map(r => r.external_id), ['gk-NEW1', 'gk-UNP1', 'gk-UNK1'])
  t('updates and their diff', plan.updates.map(u => [u.row.external_id, u.diff]), [['gk-UPD1', ['latitude', 'longitude']]])
  t('the update carries the ALIAS pin', [plan.updates[0]?.row.latitude, plan.updates[0]?.row.longitude], [35.2, 33.2])
  t('unchanged (timestamp form + token are equal)', plan.unchanged, 1)
  t('vanished is reported, not deleted', plan.vanished.map(r => r.external_id), ['gk-GONE'])
  t('unpinned count excludes the alias-pinned venue', plan.unpinnedEvents.length, 2)
  t('venues needing coordinates', plan.missingCoords, ['Brand New Venue', 'Nowhere Bar'])
  t('venues missing from the lookup', plan.unknownVenues, ['Brand New Venue'])

  console.log('\n  buildPayloads')
  const { insertPayload, updatePayload } = buildPayloads(plan.inserts, plan.updates, '2026-10-01T00:00:00.000Z')
  t("inserts land as status='approved'", insertPayload.map(r => r.status), ['approved', 'approved', 'approved'])
  t('updates never carry status (no silent re-approve)', updatePayload.some(r => 'status' in r), false)
  t('nothing carries images (the mirror pass owns it)', [...insertPayload, ...updatePayload].some(r => 'images' in r), false)

  console.log('\n  isolation')
  // supabase-js is lazy and async: a stray call reaches fetch only after a few
  // microtasks, so let pending work drain or this check passes before the write lands.
  await new Promise(r => setTimeout(r, 100))
  t('network calls made by the planning code', trapped, [])

  console.log(bad ? `\n  ${bad} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(bad ? 1 : 0)
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

// ─── Venue rename: a new name INHERITS the old name's pin ───────────────────
//
// Matching is byte-for-byte, so a venue the partner renames arrives as a stranger
// and would import unpinned — silently undoing coordinates somebody supplied by
// hand. Two of them renamed between the 2026-09-20 file drop and the live feed:
//   LEO Club            -> Lions Garden                                   (4 events)
//   Mısırlızade Sahnesi -> Rauf Denktaş Üniversitesi Kültür Merkezi (…)   (2 events)
//
// The new entry declares the old name in `aliases` and carries NO pin of its own;
// it inherits through the alias. That keeps ONE owner per pin — copying the
// coordinates onto both entries would create two values that can drift, and the
// one that drifts is the one nobody is looking at. Old entries stay, because older
// `events` rows still hold the old name in organizer_name.
//
// Resolution: exact name; then, if that entry has no pin, the first alias that
// does; then, for a name that has no entry at all, any entry listing it as an
// alias. Returns undefined only for a genuinely unknown venue.
function makeResolver(venueList) {
  const venues = new Map(venueList.map(v => [v.venue, v]))
  return function resolveVenue(name) {
    const direct = venues.get(name)
    if (direct?.latitude != null) return direct
    for (const a of direct?.aliases ?? []) {
      const t = venues.get(a)
      if (t?.latitude != null) return t
    }
    if (!direct) {
      for (const v of venueList) {
        if ((v.aliases ?? []).includes(name) && v.latitude != null) return v
      }
    }
    return direct
  }
}
const resolveVenue = makeResolver(venueList)

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
      'The service key was found but rejected: a truncated or wrong-project value in the',
      'SUPABASE_SERVICE_ROLE_KEY repository secret (Settings → Secrets → Actions).',
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

const { inserts, updates, unchanged, vanished, unpinnedEvents, missingCoords, unknownVenues } =
  planChanges({ feed, existing: existing ?? [], resolve: resolveVenue, known: venues })

// ─── Write ───────────────────────────────────────────────────────────────────

let written = 0
let writeError = null

// A PostgREST bulk upsert derives ONE column list from the union of the keys across
// every object in the array, and fills that column with NULL wherever an object does
// not supply it. So mixing inserts (which carry status:'approved') with updates (which
// deliberately omit status) in a single call writes status=NULL to every update —
// silently, because the status CHECK is `status IN (…)` and a CHECK passes on NULL.
//
// That is exactly what happened on the first 72-event run: 69 rows lost
// status='approved' and disappeared from the app, while the 3 inserts were fine. It
// could not happen the round before, when the batch was 69 inserts and no updates.
//
// So: one homogeneous batch per shape, never a mixed one, and assertHomogeneous()
// below fails loudly if a future edit reintroduces a ragged payload.
function assertHomogeneous(label, rows) {
  if (rows.length < 2) return
  const shape = Object.keys(rows[0]).sort().join(',')
  const odd = rows.findIndex(r => Object.keys(r).sort().join(',') !== shape)
  if (odd !== -1) {
    fail(
      `Refusing to upsert a ragged "${label}" payload — row ${odd} has a different`,
      'column set than row 0. PostgREST would NULL every column the shorter rows omit.',
      `  row 0    : ${shape}`,
      `  row ${odd}: ${Object.keys(rows[odd]).sort().join(',')}`,
    )
  }
}

if (inserts.length || updates.length) {
  // Deliberately OUTSIDE the `!dry` guard (inside buildPayloads): the payloads are
  // built identically either way, so a ragged shape is fully detectable without
  // writing anything. `--dry` is where this class of bug is supposed to die.
  const { insertPayload, updatePayload } = buildPayloads(inserts, updates, new Date().toISOString())

  if (dry) {
    const shape = p => (p.length ? Object.keys(p[0]).sort().join(', ') : '—')
    console.log(`\n  (dry) upsert batches, shape-checked:`)
    console.log(`    insert  ${String(insertPayload.length).padStart(3)} row(s)`)
    console.log(`      columns: ${shape(insertPayload)}`)
    console.log(`    update  ${String(updatePayload.length).padStart(3)} row(s)`)
    console.log(`      columns: ${shape(updatePayload)}`)
    if (insertPayload.length && updatePayload.length) {
      const only = (a, b) => Object.keys(a[0]).filter(k => !(k in b[0]))
      const iOnly = only(insertPayload, updatePayload)
      const uOnly = only(updatePayload, insertPayload)
      console.log(`    the two batches differ by: ${[...iOnly.map(k => `+${k}`), ...uOnly.map(k => `-${k}`)].join(', ') || 'nothing'}`)
      console.log(`    (sent as SEPARATE upserts — one mixed batch would NULL every`)
      console.log(`     column the other shape omits)`)
    }
  } else {
    for (const payload of [insertPayload, updatePayload]) {
      if (!payload.length) continue
      const { data, error } = await supabase
        .from('events')
        .upsert(payload, { onConflict: 'external_id' })
        .select('id')
      if (error) { writeError = error; break }
      written += data?.length ?? 0
    }
  }
}

// On EVERY row present in the feed — changed or not. updated_at only moves when the
// partner edits something, so it cannot tell a quiet day from a dead scheduler;
// check-gisekibris-staleness.mjs reads max(last_seen_at) for that. (20261058)
let stamped = 0
if (!dry && !writeError) {
  const { data, error } = await supabase.from('events')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('source', SOURCE).in('external_id', feed.map(ev => ev.external_id))
    .select('id')
  if (error) writeError = error
  else stamped = data?.length ?? 0
}

// ─── Post-write invariant ────────────────────────────────────────────────────
//
// The read policy is `status = 'approved'`, so a row with status NULL is not
// "slightly wrong" — it is invisible to every user in the app while still looking
// present in every admin query that does not filter on status. The ragged-payload
// bug above nulled 69 of them and nothing complained.
//
// This is the check that would have caught it in seconds instead of during a guest
// read test. It runs on every non-dry run and reports loudly; it does not repair,
// because guessing which status a row *should* have is exactly the judgement a
// script must not make on its own.
let statusAlarm = null
if (!dry && !writeError) {
  const { data: bad, error: stErr } = await supabase
    .from('events')
    .select('external_id, title, status')
    .eq('source', SOURCE)
    .is('status', null)
  if (stErr) {
    statusAlarm = `could not verify status column: ${stErr.message}`
  } else if (bad?.length) {
    statusAlarm =
      `${bad.length} row(s) have status NULL and are INVISIBLE to every user ` +
      `(the read policy requires status='approved'). Restore with:\n` +
      `      UPDATE public.events SET status='approved'\n` +
      `      WHERE source='${SOURCE}' AND status IS NULL;`
  }
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
console.log(`  ${n(stamped)}  last_seen_at stamped`)
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

if (!missingCoords.length) {
  console.log(`\n  ✓ every event has coordinates — 0 unpinned of ${feed.length}`)
} else {
  console.log(`\n  ${missingCoords.length} venue(s) still need coordinates — ${unpinnedEvents.length} event(s) affected:`)
  for (const v of missingCoords) console.log(`      ${v}`)
  console.log('    Imported with NULL lat/lng (correct). They are invisible under the Events')
  console.log('    district filter until coords land; they show fine with no district filter.')
}

if (statusAlarm) {
  console.error(`\n  ✗✗ STATUS ALARM — ${statusAlarm}`)
  process.exitCode = 1
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
