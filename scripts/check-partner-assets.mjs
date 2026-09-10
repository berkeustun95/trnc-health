#!/usr/bin/env node
// ─── Partner image wiring ───────────────────────────────────────────────────
//
//   npm run partners:check
//
// WHAT IT IS FOR, and it is one thing: a partner photo that is SITTING ON DISK AND
// WIRED TO NOTHING. That is the silent failure here — the file is committed, the folder
// looks right, and the gallery renders one fewer pair than the partner sent, with no
// error anywhere. `constants/partnerAssets.js` ships its require()s COMMENTED (Metro
// resolves require() at build time, so an entry for a file that is not yet on disk is a
// bundler error rather than a missing image), which means "the files landed" and "the
// app can see them" are two separate events and only the first one is visible.
//
// ─── WHAT IS *NOT* AN ERROR, deliberately ───────────────────────────────────
// A key declared in a partner config whose file has not arrived yet is the NORMAL
// pre-drop state — it is the state this repo is in today, and the whole gallery is
// designed to render nothing for it. Failing on that would make this guard red from the
// moment it was written, and a guard that cries wolf gets ignored or deleted. Reported,
// never fatal.
//
// NOT in pre-push. Waiting on a partner's photos must not block unrelated work.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAPSRC = 'constants/partnerAssets.js'
const DIR    = 'assets/partners'

// Read the map as TEXT, never import it: importing would execute require() on a PNG,
// which plain Node cannot do. Text is also the only way to see the COMMENTED entries,
// and a commented entry is precisely the state this check exists to distinguish.
const src = readFileSync(resolve(ROOT, MAPSRC), 'utf8')
const entries = []
for (const line of src.split('\n')) {
  const m = line.match(/^\s*(\/\/\s*)?'([^']+)'\s*:\s*require\('([^']+)'\)/)
  if (m) entries.push({ commented: !!m[1], key: m[2], path: m[3].replace(/^\.\.\//, '') })
}
if (!entries.length) {
  console.error(`\n  partners: ${MAPSRC} declares no require() lines at all, commented or otherwise.`)
  console.error('  That is not an empty map — it is a map this parser could not read. Fix the parser.\n')
  process.exit(1)
}

const walk = d => !existsSync(resolve(ROOT, d)) ? [] : readdirSync(resolve(ROOT, d)).flatMap(n => {
  const rel = join(d, n)
  return statSync(resolve(ROOT, rel)).isDirectory() ? walk(rel) : [rel]
})
const onDisk = walk(DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f))
const mapped = new Set(entries.map(e => e.path))

// ─── EVERY config that names asset keys, not just the first one ─────────────
//
// ⚠ THIS READ constants/partners.js ALONE UNTIL 2026-09-10, and constants/dorms.js had
//   been naming keys for three slices by then. The consequence was narrow but real: the
//   `notInMap` check below — "a declared key with no map entry", the typo catcher — could
//   not see a dorm key at all, so a typo in one was invisible to this guard. It was
//   covered only because scripts/check-dorms.mjs happens to assert the same thing from the
//   other side. Relying on that was luck, not design.
//
//   The reported count was wrong too, and wrong in the direction that misleads: "declared
//   in partners.js: 18" against 20 map entries reads as two orphaned entries.
//
// A THIRD partner config must be added here the day it is created. There is no way to
// discover them automatically that is not worse than this list.
const CONFIGS = [
  ['constants/partners.js', 'HS_PARTNERS'],
  ['constants/dorms.js',    'DORM_PARTNERS'],
]
const declared = new Set()
let configCount = 0
for (const [file, exportName] of CONFIGS) {
  const mod = await import(resolve(ROOT, file))
  const list = mod[exportName]
  if (!Array.isArray(list)) {
    console.error(`\n  partners: ${file} does not export ${exportName} as an array — this guard `
      + `cannot see the keys it declares, so it would pass by checking less than it thinks.\n`)
    process.exit(1)
  }
  configCount += list.length
  for (const p of list) {
    if (p.logo) declared.add(p.logo)
    if (p.logoOnDark) declared.add(p.logoOnDark)
    // ⚠ PER-ITEM PHOTOS, and this guard was blind to them until 2026-09-10. A dorm's six
    //   room types each carry their own `photo` key; a typo in one resolved to undefined
    //   and the row rendered without a picture — which is ALSO the legitimate no-photo
    //   state (the Single Bungalow genuinely has none). Indistinguishable, and silent.
    //   scripts/check-dorms.mjs caught it from the other side; this one, whose entire job
    //   is asset wiring, did not.
    for (const r of p.rooms || []) if (r.photo) declared.add(r.photo)
    for (const proj of p.gallery || []) {
      // A dorm gallery is a flat list of KEYS; a home-services gallery is a list of
      // PROJECTS holding pairs/extra/steps. Handle both rather than assuming one shape.
      if (typeof proj === 'string') { declared.add(proj); continue }
      for (const pr of proj.pairs || []) { declared.add(pr.before); declared.add(pr.after) }
      for (const k of proj.extra || []) declared.add(k)
      for (const st of proj.steps || []) declared.add(st.image)
    }
  }
}

const keys       = new Set(entries.map(e => e.key))
const unwired    = onDisk.filter(f => !mapped.has(f))                       // FATAL
const brokenReq  = entries.filter(e => !e.commented && !existsSync(resolve(ROOT, e.path)))  // FATAL
const notInMap   = [...declared].filter(k => !keys.has(k))                  // FATAL — a typo
const waiting    = entries.filter(e => e.commented && !existsSync(resolve(ROOT, e.path)))   // normal
const readyToWire= entries.filter(e => e.commented && existsSync(resolve(ROOT, e.path)))    // FATAL
const live       = entries.filter(e => !e.commented && existsSync(resolve(ROOT, e.path)))

console.log('')
console.log(`  partner assets: ${entries.length} map entries · ${onDisk.length} image file(s) under ${DIR}/`)
console.log(`    live (wired + on disk) : ${live.length}`)
console.log(`    waiting for the file   : ${waiting.length}   <- normal before a drop`)
console.log(`    declared in config      : ${declared.size} key(s) across `
  + `${configCount} partner(s) in ${CONFIGS.map(c => c[0].replace('constants/', '')).join(' + ')}`)

const fatal = []
for (const f of unwired) fatal.push(`${f} is on disk but NO map entry references it — it will never render`)
for (const e of readyToWire) fatal.push(`${e.path} has arrived but its entry is still COMMENTED in ${MAPSRC}`)
for (const e of brokenReq) fatal.push(`${MAPSRC} require()s ${e.path}, which does not exist — the bundler will fail`)
for (const k of notInMap) fatal.push(`a partner config declares key '${k}' with no entry in ${MAPSRC} — a typo here renders nothing and errors nowhere`)

if (fatal.length) {
  console.error('')
  for (const f of fatal) console.error(`  ✗ ${f}`)
  console.error('')
  process.exit(1)
}
console.log('  OK — every file on disk is wired, and every wired entry exists.')
console.log('')
