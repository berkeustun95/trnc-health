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
function run(manifest, net = false) {
  const path = join(tmp, `m-${Math.abs(JSON.stringify(manifest).length)}-${pass + fail}.json`)
  writeFileSync(path, JSON.stringify(manifest, null, 2))
  try {
    const out = execFileSync(process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, '--manifest', path, ...(net ? [] : ['--skip-reachability'])],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

// A guard passes only if the run FAILED and said why. A non-zero exit with the wrong
// message would mean something else broke, which is not evidence the guard works.
function rejects(name, mutate, expect, net = false) {
  const m = base(); mutate(m)
  const { code, out } = run(m, net)
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '')
  if (code !== 0 && clean.includes(expect)) { pass++; console.log(`  ok   rejects ${name}`) }
  else {
    fail++
    console.log(`  FAIL rejects ${name}`)
    console.log(`       exit ${code}, expected message: ${JSON.stringify(expect)}`)
    console.log(clean.split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

function accepts(name, mutate, net = false) {
  const m = base(); if (mutate) mutate(m)
  const { code, out } = run(m, net)
  if (code === 0) { pass++; console.log(`  ok   accepts ${name}`) }
  else {
    fail++
    console.log(`  FAIL accepts ${name} — exited ${code}`)
    console.log(out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-6).map(l => '       | ' + l).join('\n'))
  }
}

console.log('\n— the manifest as committed must pass —')
accepts('the real manifest (with live reachability)', null, true)

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
