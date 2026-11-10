#!/usr/bin/env node
// ─── Araçlar: stage a dealer's car photos from this Mac (never through git) ──
//
//   node scripts/upload-dealer-photos.mjs --dealer mustafa-ustuner-otomotiv ~/ADA-partner-files/mustafa-photos
//   node scripts/upload-dealer-photos.mjs --dealer <slug> <folder> --check     # read and report only, no sign-in
//
// <folder> holds one folder per car, named by ilan_no, with 1.jpg (the cover), 2.jpg, … (jpg / jpeg / png / webp /
// heic). Each photo is stripped of ALL metadata here, on the Mac, with the same code the server uses
// (supabase/functions/_shared/image-metadata.mjs) and proved clean; HEIC is converted to JPEG with macOS `sips`
// first; a file still over 5 MB is scaled down to 2560 px. The clean files go to the PRIVATE bucket dealer-intake
// (20261188) as <slug>/<ilan_no>/<n>.<ext>, replacing whatever was staged for that car. Then:
//
//   gh workflow run araclar-dealer-import -f dealer=<slug> -f apply=true
//
// moves them into vehicle-images and empties staging. Sign-in: an ADMIN account, by a one-time code e-mailed to it
// (nothing is stored on this Mac; there is no service key here and none is needed). Only admins can write the
// bucket (storage policy dealer_intake_insert).
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { parseCsv, mapCar } from './lib/dealer-csv.mjs'
import { stripImageMetadata, metadataFound, FORMAT_EXT, FORMAT_MIME } from '../supabase/functions/_shared/image-metadata.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }
const di = args.indexOf('--dealer')
const slug = di >= 0 ? args[di + 1] : null
const checkOnly = args.includes('--check')
const folderArg = args.find((a, i) => !a.startsWith('--') && i !== di + 1)
if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug ?? '') || !folderArg) fail('usage: node scripts/upload-dealer-photos.mjs --dealer <slug> <folder with one folder per ilan_no> [--check]')
const SRC = resolve(folderArg.replace(/^~(?=\/|$)/, homedir()))
if (!existsSync(SRC) || !statSync(SRC).isDirectory()) fail(`not a folder: ${SRC}`)
const csvPath = resolve(ROOT, 'data/dealers', slug, 'cars.csv')
if (!existsSync(csvPath)) fail(`unknown dealer: data/dealers/${slug}/cars.csv is missing`)

const BUCKET = 'dealer-intake'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_PHOTOS = 30
const cars = new Map(parseCsv(readFileSync(csvPath, 'utf8')).map(mapCar).map(c => [c.ref, c]))

// ─── Read, convert, strip, prove clean: everything is checked before the first upload ─
const tmp = mkdtempSync(join(tmpdir(), 'ada-dealer-photos-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))
const sips = (...a) => execFileSync('/usr/bin/sips', a, { stdio: ['ignore', 'ignore', 'pipe'] })
const problems = [], notes = [], plan = []
for (const ref of readdirSync(SRC).filter(n => !n.startsWith('.')).sort()) {
  const dir = join(SRC, ref)
  if (!statSync(dir).isDirectory()) { problems.push(`${ref}: a file next to the car folders (expected only folders named by ilan_no)`); continue }
  const car = cars.get(ref)
  if (!car) { problems.push(`${ref}: no car with this ilan_no in cars.csv`); continue }
  if (!car.row) notes.push(`${ref}: its CSV row is not importable yet (${car.problems.join('; ')}); the photos wait in staging until it is`)
  const names = readdirSync(dir).filter(n => !n.startsWith('.'))
  const bad = names.filter(n => !/^\d{1,2}\.(jpe?g|png|webp|heic|heif)$/i.test(n))
  for (const n of bad) problems.push(`${ref}/${n}: not <number>.jpg / png / webp / heic`)
  const files = names.filter(n => !bad.includes(n)).sort((a, b) => parseInt(a) - parseInt(b))
  const nums = files.map(n => parseInt(n))
  if (new Set(nums).size !== nums.length) problems.push(`${ref}: two files share a number`)
  if (!files.length) { problems.push(`${ref}: no photos in the folder`); continue }
  if (files.length > MAX_PHOTOS) problems.push(`${ref}: ${files.length} photos (at most ${MAX_PHOTOS})`)
  const out = []
  for (const [i, name] of files.entries()) {
    try {
      let path = join(dir, name)
      if (/\.hei[cf]$/i.test(name)) {
        const jpg = join(tmp, `${ref}-${i}.jpg`)
        sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '90', path, '--out', jpg)
        path = jpg
      }
      let clean = stripImageMetadata(new Uint8Array(readFileSync(path)))
      if (clean.bytes.length > MAX_BYTES) {
        const small = join(tmp, `${ref}-${i}-small.jpg`)
        sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '2560', path, '--out', small)
        clean = stripImageMetadata(new Uint8Array(readFileSync(small)))
        notes.push(`${ref}/${name}: over 5 MB, scaled down to 2560 px`)
      }
      const left = metadataFound(clean.bytes)
      if (left.found.length || left.gps) throw new Error('metadata left after stripping')
      if (clean.bytes.length > MAX_BYTES) throw new Error('still over 5 MB after scaling')
      out.push({ path: `${slug}/${ref}/${i + 1}.${FORMAT_EXT[clean.format]}`, bytes: Buffer.from(clean.bytes), mime: FORMAT_MIME[clean.format] })
    } catch (e) { problems.push(`${ref}/${name}: ${e.message === 'UNSUPPORTED_FORMAT' ? 'not a JPEG / PNG / WebP image' : e.message === 'CORRUPT' ? 'the image file is damaged' : e.message}`) }
  }
  plan.push({ ref, car, out })
}

const mb = n => `${(n / 1048576).toFixed(1)} MB`
console.log(`\n${plan.length} car folder(s), ${plan.reduce((n, p) => n + p.out.length, 0)} photo(s), ${mb(plan.reduce((n, p) => n + p.out.reduce((m, o) => m + o.bytes.length, 0), 0))} after stripping (all metadata removed and checked)`)
for (const p of plan) console.log(`  ${p.ref}  ${p.car.row ? `${p.car.row.make} ${p.car.row.model} ${p.car.row.year}` : '(row not importable yet)'}  ${p.out.length} photo(s)`)
const without = [...cars.values()].filter(c => c.row && !plan.some(p => p.ref === c.ref))
if (without.length) console.log(`\nno folder for ${without.length} car(s): ${without.map(c => c.ref).join(', ')}`)
if (notes.length) { console.log('\nnotes:'); for (const n of notes) console.log(`  ${n}`) }
if (problems.length) { console.error('\nproblems (nothing uploaded):'); for (const p of problems) console.error(`  ${p}`); process.exit(1) }
if (!plan.length) fail('\nnothing to upload')
if (checkOnly) { console.log('\nCHECK ONLY: nothing uploaded.'); process.exit(0) }

// ─── Sign in as an admin with a one-time e-mail code ────────────────────────
const env = Object.fromEntries((existsSync(resolve(ROOT, '.env')) ? readFileSync(resolve(ROOT, '.env'), 'utf8') : '').split('\n')
  .map(l => l.match(/^\s*(EXPO_PUBLIC_SUPABASE_(?:URL|ANON_KEY))\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) fail('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY not found (.env in the repo root, or the environment)')
const db = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: true } })
const rl = createInterface({ input: process.stdin, output: process.stdout })
const email = (await rl.question('\nAdmin e-mail: ')).trim()
{
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) fail(`could not send the code: ${error.message}`)
}
const typed = (await rl.question('Code from the e-mail (or paste the whole sign-in link): ')).trim()
{
  const link = typed.match(/token_hash=([A-Za-z0-9_-]+)/)
  const { error } = link
    ? await db.auth.verifyOtp({ token_hash: link[1], type: (typed.match(/[?&]type=([a-z_]+)/) ?? [])[1] ?? 'magiclink' })
    : await db.auth.verifyOtp({ email, token: typed.replace(/\s/g, ''), type: 'email' })
  if (error) fail(`sign-in failed: ${error.message}`)
}
{
  const { data, error } = await db.rpc('is_admin')
  if (error || data !== true) { await db.auth.signOut(); fail('this account is not an admin: only admins can stage dealer photos') }
}
const go = (await rl.question(`Upload ${plan.reduce((n, p) => n + p.out.length, 0)} photo(s) for ${plan.length} car(s) to private staging? (y/N) `)).trim().toLowerCase()
rl.close()
if (go !== 'y') { await db.auth.signOut(); fail('stopped: nothing uploaded') }

// ─── Upload: each car's staged set is replaced as a whole ───────────────────
const bucket = db.storage.from(BUCKET)
let done = 0
for (const p of plan) {
  const { data: old, error: lErr } = await bucket.list(`${slug}/${p.ref}`, { limit: 200 })
  if (lErr) fail(`${p.ref}: list staging: ${lErr.message}`)
  if (old.length) {
    const { error } = await bucket.remove(old.map(o => `${slug}/${p.ref}/${o.name}`))
    if (error) fail(`${p.ref}: clear staging: ${error.message}`)
  }
  for (const o of p.out) {
    const { error } = await bucket.upload(o.path, o.bytes, { contentType: o.mime, upsert: false })
    if (error) fail(`${o.path}: ${error.message}`, `(${done} car(s) fully staged before this; re-run to finish: a car's set is replaced as a whole)`)
  }
  const { data: now, error: cErr } = await bucket.list(`${slug}/${p.ref}`, { limit: 200 })
  if (cErr || now.length !== p.out.length) fail(`${p.ref}: staged ${now?.length ?? '?'} of ${p.out.length} photo(s)`)
  done++
  console.log(`  staged ${p.ref}  ${p.out.length} photo(s)`)
}
await db.auth.signOut()
console.log(`\nDone: ${done} car(s) staged. Tell Claude, or run:\n  gh workflow run araclar-dealer-import -R berkeustun95/trnc-health -f dealer=${slug} -f apply=true`)
