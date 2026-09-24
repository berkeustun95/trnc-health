#!/usr/bin/env node
// ─── Live legal parity — what the PUBLISHED URLs actually serve ─────────────
//
//   npm run legal:live            # fail on drift
//   npm run legal:live -- --self  # prove every failure path is reachable
//
// ─── WHY THIS EXISTS, AND WHAT IT IS NOT ────────────────────────────────────
//
// check-privacy-parity.mjs answers "do the FILES in this repo agree?" Its own header says,
// in as many words, that it cannot answer "do the three published URLs agree?" — because
// each copy publishes by a different action, so all the files can match while three
// different versions are live. That gap is not theoretical: it is how the copies reached
// June 2026 / July 2026 / July 11 2026 at the same time.
//
// On 2026-09-20 it happened again and the file guard was GREEN throughout. The repo said
// 2026-09-20; getadaapp.com/privacy and berkeustun95.github.io both served 2026-09 and
// still promised "your data is never visible to other customers", which the Student Hub
// makes false. It was found by hand, with curl, because nothing in the repo could see it.
// A guard that cannot see the thing it exists to prevent is not a guard.
//
// So this one asks the other half of the question: fetch what is live, compare it to what
// the repo says, and name the publish action for whatever is behind.
//
// ─── THE FOURTH COPY IS NOT HERE, AND PRETENDING OTHERWISE WOULD BE THE BUG ──
//
// There are FOUR published copies and only THREE are URL-addressable. The in-app bodies
// (constants/legal/*.js) ship inside the JS bundle via EAS Update. They have no URL, no
// HTTP status, and nothing this script can fetch. There is no honest way to include them,
// and inventing a fourth row that always passed would be the instrument-that-cannot-fail
// failure this repo has removed three times.
//
//   The in-app copy is verified by LAUNCHING THE APP — two open/wait/kill/reopen cycles
//   on the Play Store build, reading the version line at the top of the policy screen.
//   A preview APK has no production channel and never receives the update.
//
// Same limit, second form: the URLs are ENGLISH ONLY. privacy.tr.js is in-app, so the
// Turkish half of GOLIVE_STALE is unreachable from here and is checked against files by
// check-privacy-parity.mjs. That is the worse half to get wrong — the Turkish reader is
// the one most likely to be a student — so it is stated rather than quietly skipped.
//
// ─── ⚠ NO CACHE-BUSTING QUERY STRING. EVER. ─────────────────────────────────
//
// `?cb=$(date +%s)` on getadaapp.com/privacy sends the route PAST the Cloudflare Worker to
// Vercel and returns 404 — against a deploy that is completely healthy. A probe written
// that way once reported both store-registered URLs as dead and its stated pass condition
// would have rolled back a good deploy, which would then have "fixed" it and confirmed the
// wrong diagnosis. Freshness is requested with cache: 'no-store', which is a header and
// does not touch the route.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOLIVE_STALE, readLegalVersion } from './lib/legal-claims.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = 20000

// Each row carries the action that publishes it, so a failure can say what to RUN rather
// than only what is wrong.
const TARGETS = [
  { url: 'https://getadaapp.com/privacy',
    from: 'web/privacy.html',  publish: 'npm run web:deploy',
    note: 'store-registered Privacy URL' },
  { url: 'https://berkeustun95.github.io/trnc-health/privacy.html',
    from: 'docs/privacy.html', publish: 'git push (main — GitHub Pages serves main/docs)' },
  { url: 'https://berkeustun95.github.io/trnc-health/terms.html',
    from: 'docs/terms.html',   publish: 'git push (main — GitHub Pages serves main/docs)' },
]

// ─── The verdict, as a pure function, so the fixtures below exercise the REAL one ──
// A network-shaped check whose logic can only be reached by making a request is a check
// nobody can test offline, and one that therefore gets tested by shipping it.
export function inspect(html, status, expectVersion) {
  if (status !== 200) return { problems: [`HTTP ${status} — the page did not serve`], version: null }
  const m = /Version\s+(\d{4}-\d{2}(?:-\d{2})?)/.exec(html)
  const version = m ? m[1] : null
  const problems = []
  if (!version) {
    // NOT "assume it is fine". A page with no version line is a page this check cannot
    // read, and unreadable must never collapse into pass.
    problems.push('no "Version YYYY-MM" line found — cannot tell what is published')
  } else if (version !== expectVersion) {
    problems.push(`serves ${version}, the repo says ${expectVersion}`)
  }
  for (const st of GOLIVE_STALE) {
    if (st.en.test(html)) problems.push(`still carries "${st.key}" — ${st.why}`)
  }
  return { problems, version }
}

async function main() {
  const expect = readLegalVersion(readFileSync(join(ROOT, 'constants/legal/index.js'), 'utf8'))
  console.log(`\n  live legal parity — repo says LEGAL_VERSION ${expect}\n`)

  const drift = [], unreachable = []
  for (const t of TARGETS) {
    let res, html
    try {
      res = await fetch(t.url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
      html = await res.text()
    } catch (e) {
      // UNREACHABLE IS NOT DRIFT AND IT IS NOT HEALTH. Three states, three exit codes.
      unreachable.push(`${t.url} — ${e && e.message}`)
      console.log(`    ?  ${t.url}\n       could not fetch: ${e && e.message}`)
      continue
    }
    const { problems, version } = inspect(html, res.status, expect)
    if (!problems.length) {
      console.log(`    ✓  ${t.url}\n       ${version}${t.note ? `  (${t.note})` : ''}`)
    } else {
      for (const p of problems) drift.push(`${t.url}: ${p}`)
      console.log(`    ✗  ${t.url}`)
      for (const p of problems) console.log(`       ${p}`)
      console.log(`       publish it with: ${t.publish}    (source: ${t.from})`)
    }
  }

  console.log('\n  the in-app copy is NOT checked here — it has no URL. Verify it by launching')
  console.log('  the Play Store build twice and reading the version line on the policy screen.')

  if (unreachable.length && !drift.length) {
    console.error(`\n  UNREACHABLE — ${unreachable.length} URL(s) could not be fetched. This is NOT a`)
    console.error('  pass and NOT a drift report; the question was not answered. Re-run on a network.')
    process.exit(2)
  }
  if (drift.length) {
    console.error('\n  FAIL — what is LIVE does not match this repo.')
    for (const d of drift) console.error('    • ' + d)
    process.exit(1)
  }
  console.log('\n  PASS — every URL-addressable legal copy matches the repo.\n')
  process.exit(0)
}

// ─── --self: every failure path, offline, on the real inspect() ─────────────
function self() {
  const V = '2026-09-24'
  const good = `<p class="updated">Version ${V} · Last updated: September 20, 2026</p><p>All data is stored on Supabase.</p>`
  const cases = [
    [true,  'current page, no stale sentence',  good, 200],
    [false, 'version behind the repo',           good.replace(V, '2026-09'), 200],
    [false, 'stale sentence still published',    good + '<p>Your data is never visible to other customers.</p>', 200],
    [false, 'second stale sentence',             good + '<p>there is no student list in the app yet</p>', 200],
    [false, 'third stale sentence',              good + '<p>nothing in the app reads them</p>', 200],
    [false, 'no version line at all',            '<p>Privacy Policy</p>', 200],
    [false, 'page 404s',                         good, 404],
  ]
  let bad = 0
  console.log('\n  --self: each fixture must get the verdict on the left\n')
  for (const [want, name, html, status] of cases) {
    const got = inspect(html, status, V).problems.length === 0
    if (got === want) console.log(`    ✓ ${name.padEnd(34)} ${want ? 'pass' : 'FAIL'}`)
    else { bad++; console.error(`    ✗ ${name.padEnd(34)} expected ${want ? 'pass' : 'FAIL'}, got ${got ? 'pass' : 'FAIL'}`) }
  }
  console.log(`\n  ${cases.length - bad}/${cases.length} paths behave as specified`)
  if (bad) { console.error('  --self FAIL — the instrument is wrong.\n'); process.exit(1) }
  console.log('  --self PASS — every failure path goes red.\n')
  process.exit(0)
}

if (process.argv.includes('--self')) self()
else main()
