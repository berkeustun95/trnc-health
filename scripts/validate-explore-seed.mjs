#!/usr/bin/env node
// ─── seed-explore-photos.mjs — refusal-path harness ──────────────────────────
//
//   node scripts/validate-explore-seed.mjs
//
// Every guard in the seed script is asserted to actually REJECT a manifest that
// violates it, by running the real script against a deliberately broken fixture and
// requiring a non-zero exit AND the expected message.
//
// This exists because of the house rule that a green check nobody has watched go red is
// a decoration, not a check — and because these particular guards protect a legal
// obligation, not a preference. A licence gate that silently passes everything looks
// exactly like a licence gate that works.
//
// The fixtures are generated from the REAL manifest and mutated in memory, so they never
// drift from the shape the script actually parses, and nothing broken is left on disk.
//
// ⚠ WATCHED RED, TWICE, ON PURPOSE:
//     • removing the beach-licence branch  → the two beach assertions fail
//     • `assertSize` short-circuited to always pass → 16/17, the ceiling assertion fails
//   And it caught two real defects rather than merely passing: the HEAD stage had no
//   throttle (429s read as dead links), and then the resize probe had the same hole —
//   its first run silently dropped three photos and printed a 5-photo total as if it
//   were the whole set. Both fixed at the source, not by loosening the assertion.
//
// ─── 2026-11-15: OFFLINE always, LIVE only with .env ────────────────────────────────────────
// The harness had been red since 2026-11-08 (9990ff4e) without anyone seeing it: that commit cut the
// manifest to pass 3 (2 beaches, CC BY-SA) and widened the beach gate to the CC licences the detail
// page credits, while this file still indexed places[2] and named Enkomi / Bellapais / Bedesten from
// the old 21-place manifest, and still expected CC BY-SA on a beach to be refused. It stayed hidden
// because explore:validate runs validate-photo-attribution first with `&&`, and that was red too.
//
// So the test data now uses only places[0] / places[1] and names taken from the manifest at run time,
// and the beach assertions follow the current gate (CC accepted; a licence outside the list refused).
// The refusal paths run OFFLINE every time: the seed script exits on a missing Supabase URL before it
// parses anything, so the child gets a dummy unreachable URL — every one of these refusals fires before
// the first database read. Anything that needs the real database or the network (row existence,
// reachability, the post-resize ceiling, the accepts) runs only when .env is present and otherwise
// prints "skipped: no .env" with the count, instead of failing.


import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REAL = resolve(ROOT, 'scripts/data/explore-photo-manifest.json')
const SEED = resolve(ROOT, 'scripts/seed-explore-photos.mjs')
const tmp  = mkdtempSync(join(tmpdir(), 'ada-seed-'))
const LIVE = existsSync(resolve(ROOT, '.env')) || !!process.env.EXPO_PUBLIC_SUPABASE_URL

const base = () => JSON.parse(readFileSync(REAL, 'utf8'))
if (base().places.length < 2) {
  console.error(`validate-explore-seed: the fixtures need at least 2 places in ${REAL}, found ${base().places.length}`)
  process.exit(1)
}
// A substring that names exactly one place: the first word of its name.
const needle = i => base().places[i].name.split(/[\s(]/)[0]
let pass = 0, fail = 0, skipped = 0

// Offline runs get a dummy, unreachable database so no refusal can be confused with a network error and
// nothing is read from .env. Live runs inherit the real environment (the seed script loads .env itself).
const OFFLINE_ENV = { ...process.env, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'offline-fixture' }

// Runs the real script against a fixture. Returns {code, out}.
function run(manifest, live, extra = []) {
  const path = join(tmp, `m-${Math.abs(JSON.stringify(manifest).length)}-${pass + fail + skipped}.json`)
  writeFileSync(path, JSON.stringify(manifest, null, 2))
  try {
    const out = execFileSync(process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, '--manifest', path, ...(live === 'net' ? [] : ['--skip-reachability']), ...extra],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: live ? process.env : OFFLINE_ENV })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

const skip = name => { skipped++; console.log(`  skip ${name} — skipped: no .env`) }

// A guard passes only if the run FAILED and said why. A non-zero exit with the wrong
// message would mean something else broke, which is not evidence the guard works.
// live: false = offline (always runs), true = needs the database, 'net' = database + network.
function rejects(name, mutate, expect, live = false, extra = []) {
  if (live && !LIVE) return skip(`rejects ${name}`)
  const m = base(); mutate(m)
  const { code, out } = run(m, live, extra)
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '')
  if (code !== 0 && clean.includes(expect)) { pass++; console.log(`  ok   rejects ${name}`) }
  else {
    fail++
    console.log(`  FAIL rejects ${name}`)
    console.log(`       exit ${code}, expected message: ${JSON.stringify(expect)}`)
    console.log(clean.split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

// Every accept needs the database: a clean run ends with the row-existence read.
function accepts(name, mutate, live = true, extra = []) {
  if (!LIVE) return skip(`accepts ${name}`)
  const m = base(); if (mutate) mutate(m)
  const { code, out } = run(m, live, extra)
  if (code === 0) { pass++; console.log(`  ok   accepts ${name}`) }
  else {
    fail++
    console.log(`  FAIL accepts ${name} — exited ${code}`)
    console.log(out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

console.log(LIVE ? '\n(.env found: offline AND live checks run)' : '\n(no .env: offline checks only; live checks print "skipped: no .env")')

console.log('\n— the manifest as committed must pass, as it is applied (standard ceiling) —')
accepts('the committed manifest', null, 'net')

console.log('\n— requirement: credit, license and source_url are all mandatory —')
rejects('a missing credit',     m => { delete m.places[1].photos[0].credit },     'missing "credit"')
rejects('a blank credit',       m => { m.places[1].photos[0].credit = '   ' },    'missing "credit"')
rejects('a missing license',    m => { delete m.places[1].photos[0].license },    'missing "license"')
rejects('a missing source_url', m => { delete m.places[1].photos[0].source_url }, 'missing "source_url"')

console.log('\n— the own-photography exemption, enforced in BOTH directions —')
accepts('own photography with source_url null', m => {
  m.places[1].photos[0] = { src: m.places[1].photos[0].src, credit: 'Berke Üstün',
    license: '© ADA', license_url: null, source_url: null, source: 'own' }
})
rejects('own photography carrying a source_url', m => {
  m.places[1].photos[0] = { src: m.places[1].photos[0].src, credit: 'Berke Üstün',
    license: '© ADA', license_url: null, source: 'own',
    source_url: 'https://commons.wikimedia.org/wiki/File:X' }
}, "source:'own' must have source_url null")

console.log('\n— the beach licence gate (since 9990ff4e: own, Unsplash, Pexels or a CC licence the page credits) —')
rejects('an all-rights-reserved photo on a beach', m => {
  m.places[0].category = 'beach'
  m.places[0].photos[0].license = 'All rights reserved'
}, 'BEACH photos may only be own photography')
rejects('a CC BY-NC photo on a beach', m => {
  m.places[1].category = 'beach'
  m.places[1].photos[0].license = 'CC BY-NC 4.0'
}, 'BEACH photos may only be own photography')
accepts('a CC BY-SA photo on a beach', m => {
  m.places[1].category = 'beach'
  m.places[1].photos[0].license = 'CC BY-SA 4.0'
})
accepts('an Unsplash photo on a beach', m => {
  m.places[1].category = 'beach'
  m.places[1].photos[0].license = 'Unsplash License'
})
accepts('own photography on a beach', m => {
  m.places[1].category = 'beach'
  m.places[1].photos[0] = { src: m.places[1].photos[0].src, credit: 'Berke Üstün',
    license: '© ADA', license_url: null, source_url: null, source: 'own' }
})

console.log('\n— rows must already exist; this script never inserts —')
rejects('an unknown uuid', m => {
  m.places[1].id = '00000000-0000-4000-8000-000000000000'
}, 'do not exist', true)
rejects('a malformed uuid', m => { m.places[1].id = 'not-a-uuid' }, 'not a uuid')

console.log('\n— a photo that is not reachable as an image —')
rejects('a 404 photo url', m => {
  m.places[1].photos[0].src = 'https://upload.wikimedia.org/wikipedia/commons/0/00/ADA_no_such_file_xyz.jpg'
}, 'not reachable as an image', 'net')

console.log('\n— the post-resize byte ceiling must refuse an oversized photo —')
// --max-kb 1 is a ceiling nothing can meet, so this asserts the CHECK fires, not that a
// particular photo is big. Needs the network: the size is measured after a real resize.
rejects('a photo over the post-resize ceiling',
  m => { m.places = [m.places[0]] }, 'over the 1 KB ceiling', 'net', ['--max-kb', '1'])
accepts('the same photo under the standard ceiling',
  m => { m.places = [m.places[0]] }, 'net', ['--max-kb', '600'])

console.log('\n— --except must scope the run, and refuse anything ambiguous —')
rejects('an --except needle that matches nothing',
  () => {}, 'matched no place in the manifest', false, ['--except', 'NoSuchPlaceXyz'])
rejects('an --except that excludes every place',
  m => { m.places = [m.places[1]] }, 'excluded every place', false, ['--except', needle(1)])
rejects('--only and --except together',
  () => {}, 'mutually exclusive', false, ['--only', needle(0), '--except', needle(1)])
accepts('a valid --except run', null, true, ['--except', needle(0)])

console.log('\n— --apply with a fixture manifest must be refused —')
// Locally the outer refusal is prodWriteGuard (production is written only from GitHub Actions, since
// 9990ff4e named the explore-photos workflow): it fires before the --apply/--manifest exclusivity line,
// which is reachable only on the runner. So off the runner the guard's refusal is what is asserted.
{
  const path = join(tmp, 'apply-guard.json')
  writeFileSync(path, JSON.stringify(base()))
  let code = 0, out = ''
  try {
    out = execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, '--apply', '--manifest', path],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: OFFLINE_ENV })
  } catch (e) { code = e.status ?? 1; out = (e.stdout ?? '') + (e.stderr ?? '') }
  const want = process.env.GITHUB_ACTIONS === 'true' ? 'mutually exclusive' : 'would write to the production database'
  if (code !== 0 && out.includes(want)) { pass++; console.log(`  ok   rejects --apply --manifest together (${want})`) }
  else { fail++; console.log(`  FAIL rejects --apply --manifest together — exited ${code}, expected ${JSON.stringify(want)}`) }
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped: no .env` : ''}\n`)
process.exit(fail ? 1 : 0)
