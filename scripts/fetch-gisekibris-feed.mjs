#!/usr/bin/env node
// ─── Gişe Kıbrıs LIVE partner feed → raw file ────────────────────────────────
//
//   node scripts/fetch-gisekibris-feed.mjs              # fetch, validate, write
//   node scripts/fetch-gisekibris-feed.mjs --out <path>
//   node scripts/fetch-gisekibris-feed.mjs --selftest   # prove the guards fire
//
// Then the pipeline is unchanged:
//   node scripts/prepare-gisekibris-feed.mjs <raw.json>
//   node scripts/check-gisekibris-urls.mjs --apply
//   node scripts/import-gisekibris-events.mjs --dry
//
// The partner shipped automation on 2026-09-23, replacing the emailed file drops.
// A FILE PATH STILL WORKS EVERYWHERE — prepare takes one as its argument, so a drop
// remains a first-class input and this script is only a new way to obtain one.
//
// ─── THE TOKEN IS OUR PARTNER KEY ───────────────────────────────────────────
// It is a path segment of GISEKIBRIS_FEED_URL, read from .env (gitignored,
// untracked). Deliberately NOT named EXPO_PUBLIC_*: Expo inlines every variable
// with that prefix into the client bundle, which would publish the key to every
// user. Nothing here ever prints the URL unmasked — see mask().
//
// ─── WHY THIS REFUSES RATHER THAN RETURNS EMPTY ─────────────────────────────
// This is the wipe guard for the whole pipeline, and it is the reason the fetch is
// its own step instead of three lines inside prepare.
//
// The feed is a ROLLING FULL CATALOGUE: every view is the complete active set, so
// the importer treats "in the DB, absent from the feed" as a row to REPORT. An
// empty or truncated response is therefore indistinguishable, downstream, from
// "the partner cancelled everything" — prepare would happily write a 0-event seed
// and the import would report all 100+ rows vanished. Nothing after this point can
// tell the difference, so the refusal has to happen HERE, before a bad response
// becomes a file that looks exactly like a good one.
//
// It exits non-zero and writes NOTHING on: a non-200, a body that is not JSON, a
// payload that is not a non-empty array, or rows missing the fields the pipeline
// reads. There is no "best effort" path on purpose.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = resolve(ROOT, 'supabase/seed/gisekibris-feed-raw.json')
const TIMEOUT_MS = 30000

// Every field prepare-gisekibris-feed.mjs reads off a row. Listed here so a feed
// that quietly drops one is caught at the door rather than as a confusing error
// three scripts later.
const REQUIRED = ['name', 'url', 'image', 'venue', 'category', 'startdate']

const args = process.argv.slice(2)
const selftest = args.includes('--selftest')
const outIdx = args.indexOf('--out')
const outPath = outIdx !== -1 ? resolve(args[outIdx + 1]) : DEFAULT_OUT

function fail(...lines) { for (const l of lines) console.error(l); process.exit(1) }

// The token is the last path segment. Masked in EVERY log line, including errors —
// an error message is exactly where a secret gets pasted into a chat window.
const mask = u => String(u).replace(/\/[A-Za-z0-9_-]{8,}\/?$/, '/<TOKEN>')

function loadEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

// ─── Validation, as one function so --selftest can exercise the real thing ───
// Returns the parsed array or throws. The selftest below feeds it the failure
// cases; a guard nobody has watched reject anything is a decoration.
export function validateFeed(text, { status = 200 } = {}) {
  if (status !== 200) throw new Error(`HTTP ${status} from the feed`)
  let data
  try { data = JSON.parse(text) } catch (e) { throw new Error(`response is not JSON: ${e.message}`) }
  const rows = Array.isArray(data) ? data : (data.events ?? data.data ?? null)
  if (!Array.isArray(rows)) throw new Error('payload is not an array (and has no events/data array)')
  if (!rows.length) {
    throw new Error(
      'feed returned ZERO events. Refusing to write. The catalogue is rolling and ' +
      'full, so an empty response is indistinguishable downstream from "everything ' +
      'was cancelled" — it would produce a 0-event seed and report every stored row ' +
      'as vanished.')
  }
  const bad = []
  rows.forEach((r, i) => {
    const missing = REQUIRED.filter(k => !r || r[k] == null || r[k] === '')
    if (missing.length) bad.push(`row ${i + 1} (${r?.name ?? 'unnamed'}): missing ${missing.join(', ')}`)
  })
  if (bad.length) throw new Error(`${bad.length} row(s) missing required fields:\n    ` + bad.slice(0, 5).join('\n    '))
  return rows
}

// ─── Self-test ───────────────────────────────────────────────────────────────
if (selftest) {
  const good = JSON.stringify([{ name: 'x', url: 'u', image: 'i', venue: 'v', category: 'c', startdate: 's' }])
  const cases = [
    ['accepts a well-formed feed',      () => validateFeed(good),                       true],
    ['rejects a non-200',               () => validateFeed(good, { status: 502 }),      false],
    ['rejects non-JSON',                () => validateFeed('<html>nope</html>'),        false],
    ['rejects an EMPTY array',          () => validateFeed('[]'),                       false],
    ['rejects a non-array payload',     () => validateFeed('{"ok":true}'),              false],
    ['rejects a row missing url',       () => validateFeed(JSON.stringify([{ name: 'x', image: 'i', venue: 'v', category: 'c', startdate: 's' }])), false],
    ['rejects a row with empty venue',  () => validateFeed(JSON.stringify([{ name: 'x', url: 'u', image: 'i', venue: '', category: 'c', startdate: 's' }])), false],
  ]
  let bad = 0
  console.log('\n  feed validation (no network)')
  for (const [label, fn, shouldPass] of cases) {
    let passed
    try { fn(); passed = true } catch { passed = false }
    const ok = passed === shouldPass
    if (!ok) bad++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(32)} ${passed ? 'accepted' : 'rejected'}${ok ? '' : `  (wanted ${shouldPass ? 'accepted' : 'rejected'})`}`)
  }
  console.log('\n  token masking')
  const sample = 'https://core.gisekibris.com/partners/feed/73d290a16358b536bdd2'
  const masked = mask(sample)
  const leaks = masked.includes('73d290a16358b536bdd2')
  if (leaks) bad++
  console.log(`    ${leaks ? '✗ LEAKS' : '✓'} ${masked}`)
  console.log(bad ? `\n  ${bad} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(bad ? 1 : 0)
}

// ─── Fetch ───────────────────────────────────────────────────────────────────
loadEnv()
const url = process.env.GISEKIBRIS_FEED_URL
if (!url) {
  fail(
    'GISEKIBRIS_FEED_URL is not set.',
    '',
    'It belongs in .env (gitignored, untracked), as the FULL feed URL — the partner',
    'key is a path segment of it:',
    '  GISEKIBRIS_FEED_URL=https://core.gisekibris.com/partners/feed/<TOKEN>',
    '',
    'Do NOT name it EXPO_PUBLIC_* — that prefix is inlined into the client bundle.')
}

const ctl = new AbortController()
const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
let res, body
try {
  res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
  body = await res.text()
} catch (e) {
  fail(`Could not reach the feed (${mask(url)}): ${e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message}`)
} finally { clearTimeout(timer) }

let rows
try { rows = validateFeed(body, { status: res.status }) }
catch (e) { fail(`Refusing to write ${outPath.replace(ROOT + '/', '')} — ${e.message}`, '', 'Nothing was written.') }

writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n')

const dates = rows.map(r => r.startdate).sort()
console.log('')
console.log(`Gişe Kıbrıs live feed → ${outPath.replace(ROOT + '/', '')}`)
console.log(`  source: ${mask(url)}`)
console.log(`  ${String(rows.length).padStart(4)}  events`)
console.log(`  ${String(new Set(rows.map(r => String(r.venue).trim())).size).padStart(4)}  venues`)
console.log(`  range: ${dates[0]}  →  ${dates[dates.length - 1]}`)
console.log('')
console.log(`  Next: node scripts/prepare-gisekibris-feed.mjs ${outPath.replace(ROOT + '/', '')}`)
console.log('')
