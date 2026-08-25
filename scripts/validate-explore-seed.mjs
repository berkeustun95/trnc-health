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

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REAL = resolve(ROOT, 'scripts/data/explore-photo-manifest.json')
const SEED = resolve(ROOT, 'scripts/seed-explore-photos.mjs')
const tmp  = mkdtempSync(join(tmpdir(), 'ada-seed-'))

const base = () => JSON.parse(readFileSync(REAL, 'utf8'))
let pass = 0, fail = 0

// Runs the real script against a fixture. Returns {code, out}.
function run(manifest, net = false, extra = []) {
  const path = join(tmp, `m-${Math.abs(JSON.stringify(manifest).length)}-${pass + fail}.json`)
  writeFileSync(path, JSON.stringify(manifest, null, 2))
  try {
    const out = execFileSync(process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, '--manifest', path, ...(net ? [] : ['--skip-reachability']), ...extra],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

// A guard passes only if the run FAILED and said why. A non-zero exit with the wrong
// message would mean something else broke, which is not evidence the guard works.
function rejects(name, mutate, expect, net = false, extra = []) {
  const m = base(); mutate(m)
  const { code, out } = run(m, net, extra)
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '')
  if (code !== 0 && clean.includes(expect)) { pass++; console.log(`  ok   rejects ${name}`) }
  else {
    fail++
    console.log(`  FAIL rejects ${name}`)
    console.log(`       exit ${code}, expected message: ${JSON.stringify(expect)}`)
    console.log(clean.split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

function accepts(name, mutate, net = false, extra = []) {
  const m = base(); if (mutate) mutate(m)
  const { code, out } = run(m, net, extra)
  if (code === 0) { pass++; console.log(`  ok   accepts ${name}`) }
  else {
    fail++
    console.log(`  FAIL accepts ${name} — exited ${code}`)
    console.log(out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

console.log('\n— the manifest as committed must pass, AS IT IS ACTUALLY APPLIED —')
// Two assertions, not one, because the manifest is applied by TWO commands and a single
// `accepts(default ceiling)` would be asserting something false: Enkomi (Alasia) resizes
// to 783 KB and is applied deliberately at a raised ceiling (see its _note in the
// manifest). Asserting the whole manifest at 600 KB would fail on a place that is not
// broken, and the tempting "fix" — raising the default — would silently lift the ceiling
// for all 21.
//
// So the harness verifies the two real commands. If the exception is ever removed, the
// second assertion fails and points at itself.
accepts('the 20 at the standard ceiling  (--except Enkomi)',
  null, true, ['--except', 'Enkomi'])
accepts('the Enkomi exception at its documented ceiling  (--only Enkomi --max-kb 800)',
  null, true, ['--only', 'Enkomi', '--max-kb', '800'])

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

console.log('\n— the beach licence gate (no compliant beach photo exists yet) —')
rejects('a CC BY-SA photo on a beach', m => {
  m.places[1].category = 'beach'
}, 'BEACH photos may only be own photography')
rejects('a CC BY photo on a beach', m => {
  m.places[2].category = 'beach'
}, 'BEACH photos may only be own photography')
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
}, 'do not exist')
rejects('a malformed uuid', m => { m.places[1].id = 'not-a-uuid' }, 'not a uuid')

console.log('\n— a photo that is not reachable as an image —')
rejects('a 404 photo url', m => {
  m.places[1].photos[0].src = 'https://upload.wikimedia.org/wikipedia/commons/0/00/ADA_no_such_file_xyz.jpg'
}, 'not reachable as an image', true)

console.log('\n— the post-resize byte ceiling must refuse an oversized photo —')
// --max-kb 1 is a ceiling nothing can meet, so this asserts the CHECK fires, not that a
// particular photo is big. Needs the network: the size is measured after a real resize,
// which is the whole point — a ceiling checked against the SOURCE bytes would pass
// anything that compresses well and fail things that are fine.
rejects('a photo over the post-resize ceiling',
  m => { m.places = [m.places[2]] },              // Bellapais: smallest source, 264 KB out
  'over the 1 KB ceiling', true, ['--max-kb', '1'])
accepts('the same photo under a sane ceiling',
  m => { m.places = [m.places[2]] }, true, ['--max-kb', '600'])

console.log('\n— --except must scope the run, and refuse anything ambiguous —')
// --except carries a deliberate ceiling exception: the excluded place is applied
// separately at a raised --max-kb. Every failure mode here ends the same way — the held-
// back place silently going through at the STANDARD ceiling, which is the one outcome the
// flag exists to prevent, arriving disguised as a successful run.
rejects('an --except needle that matches nothing',
  () => {}, 'matched no place in the manifest', false, ['--except', 'NoSuchPlaceXyz'])
rejects('an --except that excludes every place',
  m => { m.places = [m.places[1]] }, 'excluded every place', false,
  ['--except', 'a'])
rejects('--only and --except together',
  () => {}, 'mutually exclusive', false, ['--only', 'Bedesten', '--except', 'Enkomi'])
accepts('a valid --except run', null, false, ['--except', 'Enkomi'])

console.log('\n— --apply must refuse to run against an arbitrary manifest —')
{
  const path = join(tmp, 'apply-guard.json')
  writeFileSync(path, JSON.stringify(base()))
  let code = 0, out = ''
  try {
    out = execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, '--apply', '--manifest', path],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { code = e.status ?? 1; out = (e.stdout ?? '') + (e.stderr ?? '') }
  if (code !== 0 && out.includes('mutually exclusive')) { pass++; console.log('  ok   rejects --apply --manifest together') }
  else { fail++; console.log(`  FAIL rejects --apply --manifest together — exited ${code}`) }
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
