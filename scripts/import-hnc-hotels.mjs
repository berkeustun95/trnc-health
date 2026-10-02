#!/usr/bin/env node
// ─── KITOB guide content → our hotels (gallery + description + guide page) ───
//
//   node scripts/import-hnc-hotels.mjs --dry-run [--sheet]   # download + resize locally, report; no DB
//   node scripts/import-hnc-hotels.mjs --apply               # upload, write the columns (needs 20261064)
//
// Input: data/hnc/match.json (scripts/match-hnc-hotels.mjs). Permission, credit and politeness:
// see crawl-hnc-hotels.mjs (KITOB-approved per Berke 2026-09-29; robots.txt honoured; 2 s apart).
//
// PHOTOS are COPIED into our storage (no hotlinking), re-encoded to JPEG, longest side ≤ 1200 px
// (macOS `sips`), at hotel-images/<external_id>/<k>.jpg (k = a stable hash of the source URL).
// Up to 6 per hotel: the page's own gallery in page order, else KITOB's featured image.
//   • STOCK IMAGES ARE SKIPPED (unsplash/pexels/… in the file name): they are not the hotel.
//     Found on Merit Lefkoşa, whose gallery AND featured image are stock + a museum.
//   • COVER: data/kitob/cover-overrides.json, keyed by the hotel's KITOB name —
//     {"cover": "<part of a source file name>"} moves that photo first; {"cover": null} = no
//     photo at all (placeholder). Otherwise KITOB's first photo is the cover.
//     {"commons": {file, author, license, page}} replaces KITOB's photos with ONE free-licence
//     photo from Wikimedia Commons (20261065): photo_source 'commons', photo_credit
//     "<author> · <licence> · Wikimedia Commons". The licence and author are re-read from Commons
//     on every run, and the import refuses if either no longer matches, or if the licence is not
//     one that allows commercial use (CC0, public domain, CC BY, CC BY-SA — never NC/ND).
// DESCRIPTIONS: KITOB's English is the source. data/kitob/description-translations/<Language>.json
// (committed) holds {external_id: {sha, text}}; a translation is used only while its sha equals
// the current English's, so a KITOB text change drops the stale translations instead of showing
// them. A re-import therefore never wipes a translation whose source is unchanged.
// data/kitob/description-overrides.json (committed, keyed by KITOB name) replaces KITOB's English
// with ADA's correction BEFORE the sha is taken. Each carries the sha of the KITOB text it
// corrected; if KITOB's text has changed since, the import refuses until it is re-reviewed.
//
// --apply writes ONLY photo_url, gallery_urls, photo_source, description_i18n, kitob_page_url, on
// the matched external_id (+ photo_credit from 20261065), and refuses to replace photos whose
// photo_source is not 'hnc' or 'commons' (the two this script places).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run'), APPLY = args.includes('--apply')
if (DRY === APPLY) { console.error('Pass exactly one of --dry-run or --apply.'); process.exit(1) }
const UA = 'ADA-app hotel import (KITOB-approved; contact berkeustun95 via getadaapp.com)'
const DIR = resolve(ROOT, 'data/hnc/gallery')
const MAX = 6
const STOCK = /unsplash|pexels|pixabay|shutterstock|istock|stock-photo|freepik/i
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sha = s => createHash('sha256').update(s).digest('hex')

const match = JSON.parse(readFileSync(resolve(ROOT, 'data/hnc/match.json'), 'utf8'))
const covers = JSON.parse(readFileSync(resolve(ROOT, 'data/kitob/cover-overrides.json'), 'utf8')).overrides || {}
const TR_DIR = resolve(ROOT, 'data/kitob/description-translations')
const translations = existsSync(TR_DIR) ? Object.fromEntries(readdirSync(TR_DIR).filter(f => f.endsWith('.json'))
  .map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(resolve(TR_DIR, f), 'utf8'))])) : {}
const descOverrides = JSON.parse(readFileSync(resolve(ROOT, 'data/kitob/description-overrides.json'), 'utf8')).overrides || {}
for (const [n, o] of Object.entries(descOverrides)) {
  const m = match.find(x => x.name === n)
  if (!m) { console.error(`description-overrides.json names a hotel that is not in the list: ${n}`); process.exit(1) }
  const now = m.description_en ? sha(m.description_en).slice(0, 16) : null
  if (now !== o.source_sha) { console.error(`description-overrides.json: KITOB's English for ${n} changed (${o.source_sha} → ${now}); re-review the correction`); process.exit(1) }
  m.description_en = o.en
}
writeFileSync(resolve(ROOT, 'data/hnc/descriptions-en.json'), JSON.stringify(Object.fromEntries(match.filter(m => m.description_en)
  .map(m => [m.external_id, { name: m.name, en: m.description_en, sha: sha(m.description_en).slice(0, 16) }])), null, 1))
const FREE = /^(CC0|Public domain|CC BY(-SA)? \d(\.\d)?)$/i
const commons = {}
for (const [n, o] of Object.entries(covers).filter(([, o]) => o.commons)) {
  const c = o.commons
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&titles=${encodeURIComponent('File:' + c.file)}`
  const page = Object.values((await (await fetch(api, { headers: { 'User-Agent': UA } })).json()).query.pages)[0]
  const ii = page.imageinfo?.[0]
  if (!ii) { console.error(`cover-overrides.json: ${n}: File:${c.file} is not on Commons`); process.exit(1) }
  const meta = k => (ii.extmetadata[k]?.value || '').replace(/<[^>]+>/g, '').trim()
  const lic = meta('LicenseShortName'), artist = meta('Artist')
  if (!FREE.test(lic) || lic !== c.license) { console.error(`cover-overrides.json: ${n}: Commons licence is "${lic}", override says "${c.license}"; allowed: CC0, public domain, CC BY, CC BY-SA`); process.exit(1) }
  if (artist !== c.author) { console.error(`cover-overrides.json: ${n}: Commons author is "${artist}", override says "${c.author}"`); process.exit(1) }
  commons[n] = { src: ii.url.split('?')[0], credit: `${c.author} · ${c.license} · Wikimedia Commons` }
}
const unknownCover = Object.keys(covers).filter(n => !match.some(m => m.name === n))
if (unknownCover.length) { console.error(`cover-overrides.json names hotels that are not in the list: ${unknownCover.join(', ')}`); process.exit(1) }

async function download(url, out) {
  let buf = null, why = ''
  for (let i = 0; i < 4 && !buf; i++) {
    if (i) await sleep(10000 * i)
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (r.ok) buf = Buffer.from(await r.arrayBuffer()); else why = `HTTP ${r.status}`
    } catch (e) { why = e.cause?.code || e.message }
  }
  if (!buf) return why
  writeFileSync(`${out}.src`, buf)
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1200', `${out}.src`, '--out', out], { stdio: 'ignore' })
  execFileSync('rm', [`${out}.src`])
  return null
}

const todo = match.filter(m => m.site_url)
let fetched = 0, stockSkipped = 0
const changedCovers = []
for (const m of todo) {
  const o = covers[m.name]
  let srcs = (m.gallery || []).filter(u => { if (STOCK.test(u)) { stockSkipped++; return false } return true })
  if (o?.commons) srcs = [commons[m.name].src]
  else if (o && o.cover === null) srcs = []
  else if (o?.cover) {
    const i = srcs.findIndex(u => u.split('/').pop().includes(o.cover))
    if (i < 0) { console.error(`cover override for ${m.name}: no photo matches "${o.cover}"`); process.exit(1) }
    srcs = [srcs[i], ...srcs.filter((_, j) => j !== i)]
  }
  if (o) changedCovers.push(`${m.name}: ${o.commons ? `commons: ${o.commons.file} — credit "${commons[m.name].credit}"` : o.cover === null ? 'no photo' : `cover = ${o.cover}`} — ${o.reason}`)
  m.photoSource = o?.commons ? 'commons' : 'hnc'
  m.credit = o?.commons ? commons[m.name].credit : null
  m.photos = []
  mkdirSync(resolve(DIR, m.external_id), { recursive: true })
  for (const url of srcs.slice(0, MAX)) {
    const k = sha(url).slice(0, 12)
    const out = resolve(DIR, m.external_id, `${k}.jpg`)
    if (!existsSync(out)) {
      if (fetched++) await sleep(2000)
      const err = await download(url, out)
      if (err) { console.log(`  ✗ photo failed (${err}): ${m.name} ${url}`); continue }
    }
    m.photos.push({ k, local: out, src: url })
  }
}
const all = todo.flatMap(m => m.photos)
const bytes = all.reduce((a, p) => a + statSync(p.local).size, 0)
const tooBig = all.filter(p => statSync(p.local).size > 2097152)
const hist = todo.reduce((h, m) => (h[m.photos.length] = (h[m.photos.length] || 0) + 1, h), {})
console.log(`matched ${todo.length} · photos ${all.length} (downloaded now ${fetched}, stock skipped ${stockSkipped}) · ${(bytes / 1048576).toFixed(1)} MB · over 2 MB ${tooBig.length}`)
console.log(`photos per hotel: ${Object.entries(hist).map(([n, c]) => `${n}×${c}`).join(' · ')}`)
for (const c of changedCovers) console.log(`  cover: ${c}`)
if (tooBig.length) { console.error('photos over the bucket limit — refusing'); process.exit(1) }

function describe(m) {
  if (!m.description_en) return { value: null, langs: [] }
  const s = sha(m.description_en).slice(0, 16)
  const v = { English: m.description_en }
  for (const [lang, t] of Object.entries(translations)) if (t[m.external_id]?.sha === s && t[m.external_id].text) v[lang] = t[m.external_id].text
  return { value: v, langs: Object.keys(v) }
}
const langCount = todo.map(describe).filter(d => d.value).map(d => d.langs.length)
console.log(`descriptions ${langCount.length} · languages per description: min ${Math.min(...langCount)} max ${Math.max(...langCount)} (translations loaded: ${Object.keys(translations).join(', ') || 'none'})`)

// A contact sheet per 20 hotels, cover first: for reviewing covers by eye (data/hnc/sheets/).
if (args.includes('--sheet')) {
  const py = `
import json,sys,os
from PIL import Image, ImageDraw
rows=json.load(open(sys.argv[1])); out=sys.argv[2]; os.makedirs(out,exist_ok=True)
T=150
for s in range(0,len(rows),20):
  chunk=rows[s:s+20]; W=T*6+220; H=T*len(chunk)
  im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
  for r,(name,files) in enumerate(chunk):
    d.text((4,r*T+4),f"{s+r}. {name}"[:34],fill='black')
    for c,f in enumerate(files[:6]):
      t=Image.open(f); t.thumbnail((T-4,T-4)); im.paste(t,(220+c*T,r*T+2))
  im.save(f"{out}/sheet-{s//20:02d}.jpg",quality=70)
print('sheets',(len(rows)+19)//20)`
  const listFile = resolve(ROOT, 'data/hnc/sheet-list.json')
  writeFileSync(listFile, JSON.stringify(todo.filter(m => m.photos.length).map(m => [m.name, m.photos.map(p => p.local)])))
  console.log(execFileSync('python3', ['-c', py, listFile, resolve(ROOT, 'data/hnc/sheets')], { encoding: 'utf8' }).trim())
}
if (DRY) { console.log('DRY RUN — nothing uploaded or written.'); process.exit(0) }

const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n').map(l => l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'], { encoding: 'utf8' }).trim(), { auth: { persistSession: false } })
const { data: rows, error, count } = await sb.from('hotels').select('id, external_id, photo_source', { count: 'exact' })
if (error) throw error
if (rows.length !== count) throw new Error(`read ${rows.length} of ${count}`)
const byExt = new Map(rows.map(r => [r.external_id, r]))
// gallery_urls arrives with 20261064. Until then only the cover goes in (photo_url), so
// descriptions and cover fixes are not held hostage by the migration.
const probe = await sb.from('hotels').select('gallery_urls').limit(1)
const HAS_GALLERY = !probe.error
if (!HAS_GALLERY) console.log(`gallery_urls not in the DB yet (${probe.error.code}) — writing covers only; re-run after 20261064`)
const HAS_CREDIT = !(await sb.from('hotels').select('photo_credit').limit(1)).error
if (!HAS_CREDIT && Object.keys(commons).length) { console.error('photo_credit is not in the DB yet: apply 20261065 before importing a Commons photo'); process.exit(1) }
const bucket = sb.storage.from('hotel-images')

let hotelsWithPhotos = 0, uploaded = 0, texts = 0, skipped = 0
for (const m of todo) {
  const row = byExt.get(m.external_id)
  if (!row) { console.log(`  ✗ not in the DB: ${m.external_id}`); continue }
  if (row.photo_source && !['hnc', 'commons'].includes(row.photo_source)) { skipped++; continue }
  const urls = []
  for (const p of (HAS_GALLERY ? m.photos : m.photos.slice(0, 1))) {
    const path = `${m.external_id}/${p.k}.jpg`
    const { error: ue } = await bucket.upload(path, readFileSync(p.local), { contentType: 'image/jpeg', upsert: true })
    if (ue) throw new Error(`upload ${m.name}: ${ue.message}`)
    urls.push(bucket.getPublicUrl(path).data.publicUrl)
    uploaded++
  }
  const d = describe(m)
  const patch = { kitob_page_url: m.site_url, description_i18n: d.value,
    photo_url: urls[0] || null, photo_source: urls.length ? m.photoSource : null }
  if (HAS_CREDIT) patch.photo_credit = urls.length ? m.credit : null
  if (HAS_GALLERY) patch.gallery_urls = urls.length ? urls : null
  const { data, error: we } = await sb.from('hotels').update(patch).eq('id', row.id).select('id')
  if (we) throw new Error(`write ${m.name}: ${we.message}`)
  if (data.length !== 1) throw new Error(`write ${m.name}: ${data.length} rows`)
  if (urls.length) hotelsWithPhotos++
  if (d.value) texts++
}
console.log(`APPLIED: ${hotelsWithPhotos} hotels with photos, ${uploaded} photos uploaded, ${texts} descriptions; skipped (photo from another source) ${skipped}`)

// The single-photo layout of the first import (hotel-images/<id>.jpg) is superseded: remove
// those root objects so storage holds exactly what the rows point at.
const { data: rootObjs, error: le } = await bucket.list('', { limit: 1000 })
if (le) throw le
const legacy = rootObjs.filter(o => /\.jpg$/.test(o.name)).map(o => o.name)
if (legacy.length) {
  const { error: de } = await bucket.remove(legacy)
  if (de) throw de
}
console.log(`removed ${legacy.length} superseded single-photo objects`)
const sample = todo.find(m => m.photos.length > 1)
if (sample) {
  const url = bucket.getPublicUrl(`${sample.external_id}/${sample.photos[1].k}.jpg`).data.publicUrl
  const r = await fetch(url)
  console.log(`public URL check (no auth): ${r.status} ${r.headers.get('content-type')} — ${sample.name} photo 2`)
  if (!r.ok) process.exit(1)
}
