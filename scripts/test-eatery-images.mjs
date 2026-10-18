#!/usr/bin/env node
// ─── Offline proofs for scripts/lib/eatery-images-lib.mjs ────────────────────
//
//   node scripts/test-eatery-images.mjs            # controls: every refusal red, the good fixture green
//   node scripts/test-eatery-images.mjs --mutants  # breaks the CODE UNDER TEST one line at a time and requires
//                                                    this suite to go red for each break (and the break to land)
//
// Fixtures are synthetic header buffers (no image library, no network, no files). End-to-end with real
// files runs on the first dry dispatch of the eatery-images workflow.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, 'lib/eatery-images-lib.mjs')

if (process.argv.includes('--mutants')) {
  const src = readFileSync(LIB, 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'eatery-mut-'))
  const M = [
    ['too large check removed', 'buf.length > MAX_BYTES', 'false'],
    ['extension vs magic check removed', 'ext !== s.format', 'false'],
    ['logo minimum removed', "Math.min(width, height) < MIN.logoShortSide", 'false'],
    ['gallery minimum removed', 'width < MIN.galleryWidth', 'false'],
    ['menu minimum removed', 'width < MIN.menuWidth', 'false'],
    ['slug check removed', 'typeof slug !== \'string\' || !SLUG_RE.test(slug)', 'false'],
    ['missing file check removed', 'if (!buf) {', 'if (false) {'],
    ['duplicate file check removed', 'if (seen.has(w.name))', 'if (false)'],
    ['readiness: lat check removed', "partner.lat == null || partner.lng == null", 'false'],
    ['readiness: address check removed', "partner.address == null || String(partner.address).trim() === ''", 'false'],
    ['readiness: menu_verified_on check removed', '!partner.menu_verified_on', 'false'],
    ['readiness: menu check removed', "!(menuItems >= 1 || (partner.menu_url != null && String(partner.menu_url).trim() !== ''))", 'false'],
    ['readiness: missing partner passes', "if (!partner) return ['no eatery_partners row for this slug (run the data migration first)']", 'if (!partner) return []'],
    ['different file overwrites silently', 'else if (replace) uploads.push({ path: it.path, action: \'replace\' })', "else if (true) uploads.push({ path: it.path, action: 'replace' })"],
    ['identical file re-uploaded', "ex.sha256 === it.sha256", 'false'],
    ['logo overwrite without replace', "else if (replace) logoPlan", 'else if (true) logoPlan'],
    ['photo row duplicate insert', 'if (!row) inserts.push(want)', 'if (true) inserts.push(want)'],
    ['JPEG parser stops at first marker', 'i += 2 + len', 'return { error: "stop" }'],
    ['PNG width read from wrong offset', 'b.readUInt32BE(16)', 'b.readUInt32BE(12)'],
    ['WebP VP8L height wrong', '((bits >>> 14) & 0x3fff) + 1', '((bits >>> 13) & 0x3fff) + 1'],
    ['WebP VP8X animated accepted', 'if (b[20] & 0x02)', 'if (false)'],
  ]
  let bad = 0
  M.forEach(([name, from, to], i) => {
    if (!src.includes(from)) { console.log(`  ✗ ${name}: anchor not found, the break did not land`); bad++; return }
    const f = join(dir, `lib-${i}.mjs`)
    writeFileSync(f, src.replace(from, to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, EATERY_IMAGES_LIB: f }, encoding: 'utf8' })
    const red = r.status !== 0
    console.log(`  ${red ? '✓' : '✗'} ${name.padEnd(44)} suite ${red ? 'RED (noticed)' : 'GREEN (NOT noticed)'}`)
    if (!red) bad++
  })
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  console.log(`  ${base.status === 0 ? '✓' : '✗'} unbroken code: suite ${base.status === 0 ? 'green' : 'RED'}`)
  if (base.status !== 0) bad++
  console.log(bad ? `\n${bad} mutant problem(s).` : `\nAll ${M.length} breaks noticed; unbroken code green.`)
  process.exit(bad ? 1 : 0)
}

const L = await import(process.env.EATERY_IMAGES_LIB ? pathToFileURL(process.env.EATERY_IMAGES_LIB).href : pathToFileURL(LIB).href)
let n = 0, bad = 0
const check = (label, ok, detail = '') => { n++; if (!ok) { bad++; console.log(`  ✗ ${label} ${detail}`) } }
const has = (arr, re) => arr.some(p => re.test(p))

// ─── header fixtures ────────────────────────────────────────────────────────
const pad = (b, size) => Buffer.concat([b, Buffer.alloc(Math.max(0, size - b.length), 0x20)])
const jpeg = (w, h, size = 4000) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 1)])
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])
  return pad(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, sos]), size)
}
const png = (w, h, size = 4000) => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 6
  return pad(b, size)
}
const riff = (fourcc, payload) => {
  const b = Buffer.alloc(20 + payload.length)
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8, 'latin1'); b.write(fourcc, 12, 'latin1'); b.writeUInt32LE(payload.length, 16)
  payload.copy(b, 20); return b
}
const webpLossy = (w, h) => { const p = Buffer.alloc(14); p[3] = 0x9d; p[4] = 0x01; p[5] = 0x2a; p.writeUInt16LE(w, 6); p.writeUInt16LE(h, 8); return riff('VP8 ', p) }
const webpLossless = (w, h) => { const p = Buffer.alloc(10); p[0] = 0x2f; p.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1); return riff('VP8L', p) }
const webpExt = (w, h, anim = false) => { const p = Buffer.alloc(10); if (anim) p[0] = 0x02; p.writeUIntLE(w - 1, 4, 3); p.writeUIntLE(h - 1, 7, 3); return riff('VP8X', p) }

// ─── dimension parsers: green and red ───────────────────────────────────────
const dim = (b) => { const s = L.sniffImage(b); return s.error ? s.error : `${s.format} ${s.width}x${s.height}` }
check('jpeg 1200x900', dim(jpeg(1200, 900)) === 'jpg 1200x900', dim(jpeg(1200, 900)))
check('jpeg 300x2000 (tall)', dim(jpeg(300, 2000)) === 'jpg 300x2000')
check('png 512x512', dim(png(512, 512)) === 'png 512x512')
check('webp lossy 1024x768', dim(webpLossy(1024, 768)) === 'webp 1024x768', dim(webpLossy(1024, 768)))
check('webp lossless 640x480', dim(webpLossless(640, 480)) === 'webp 640x480', dim(webpLossless(640, 480)))
check('webp extended 1500x1000', dim(webpExt(1500, 1000)) === 'webp 1500x1000', dim(webpExt(1500, 1000)))
check('webp animated refused', /animated/.test(dim(webpExt(800, 800, true))))
check('truncated jpeg refused', !!L.sniffImage(jpeg(100, 100).subarray(0, 30)).error)
check('png without IHDR refused', !!L.sniffImage(Buffer.concat([png(10, 10).subarray(0, 12), Buffer.from('XXXX'), Buffer.alloc(20)])).error)
{ const b = webpLossy(10, 10); b[23] = 0; check('webp VP8 bad start code is an error', !!L.sniffImage(b).error) }
check('random bytes refused', !!L.sniffImage(Buffer.from('hello world, this is text')).error)
check('gif refused', !!L.sniffImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])).error)

// ─── validateLocal ──────────────────────────────────────────────────────────
const files = {
  'logo.png': png(512, 512), 'g1.jpg': jpeg(1200, 800), 'g2.jpeg': jpeg(1000, 1500), 'm1.webp': webpLossy(1200, 1600), 'm2.jpg': jpeg(1100, 1400),
}
const rd = name => files[name] ?? null
const GOOD = { logo: 'logo.png', gallery: ['g1.jpg', 'g2.jpeg'], menu: ['m1.webp', 'm2.jpg'] }
const run = (m, f = rd, slug = 'crunchy-express') => L.validateLocal(slug, m, f)
{
  const r = run(GOOD)
  check('good fixture: no problems', r.problems.length === 0, r.problems.join(' | '))
  check('good fixture: 5 items', r.items.length === 5)
  const paths = r.items.map(i => i.path).join()
  check('object paths are logo / gallery-n / menu-n with real-format extension', paths === 'crunchy-express/logo.png,crunchy-express/gallery-1.jpg,crunchy-express/gallery-2.jpg,crunchy-express/menu-1.webp,crunchy-express/menu-2.jpg', paths)
  check('every path matches the DB regex', r.items.every(i => L.PATH_RE.test(i.path)))
}
check('RED bad slug (uppercase)', has(run(GOOD, rd, 'Crunchy_Express').problems, /slug/))
check('RED bad slug (traversal)', has(run(GOOD, rd, '../x').problems, /slug/))
check('RED manifest not an object', run([]).problems.length > 0)
check('RED unknown manifest key', has(run({ ...GOOD, extra: [] }).problems, /unknown key/))
check('RED empty manifest', has(run({}).problems, /no images/))
check('RED missing file', has(run({ ...GOOD, gallery: ['nope.jpg'] }).problems, /not found/))
check('RED folder in file name', has(run({ gallery: ['../x.jpg'] }).problems, /plain name/))
check('RED duplicate file', has(run({ gallery: ['g1.jpg', 'g1.jpg'] }).problems, /listed twice/))
{
  const big = pad(jpeg(1200, 800), 2 * 1024 * 1024 + 1)
  check('RED too large (2 MB + 1)', has(run({ gallery: ['big.jpg'] }, n => (n === 'big.jpg' ? big : null)).problems, /exceeds/))
  const ok = pad(jpeg(1200, 800), 2 * 1024 * 1024)
  check('green exactly 2 MB', run({ gallery: ['ok.jpg'] }, n => (n === 'ok.jpg' ? ok : null)).problems.length === 0)
}
check('RED png bytes named .jpg', has(run({ gallery: ['x.jpg'] }, () => png(1200, 800)).problems, /extension .jpg but the bytes are PNG/))
check('RED jpeg bytes named .png (logo)', has(run({ logo: 'x.png' }, () => jpeg(512, 512)).problems, /bytes are JPG/))
check('RED text named .jpg', has(run({ gallery: ['x.jpg'] }, () => Buffer.from('not an image at all, plain text')).problems, /magic bytes/))
check('RED logo too small (255 short side)', has(run({ logo: 'l.png' }, () => png(900, 255)).problems, /short side/))
check('green logo 256 short side, wide', run({ logo: 'l.png' }, () => png(900, 256)).problems.length === 0)
check('RED gallery 799 wide', has(run({ gallery: ['g.jpg'] }, () => jpeg(799, 2000)).problems, /width must be >= 800/))
check('green gallery 800 wide', run({ gallery: ['g.jpg'] }, () => jpeg(800, 500)).problems.length === 0)
check('RED menu 999 wide', has(run({ menu: ['m.jpg'] }, () => jpeg(999, 2000)).problems, /width must be >= 1000/))
check('green menu 1000 wide', run({ menu: ['m.jpg'] }, () => jpeg(1000, 1400)).problems.length === 0)
{
  const r = run({ logo: 'l.png', gallery: ['a.jpg', 'missing.jpg'], menu: ['m.jpg'] }, n => ({ 'l.png': png(100, 100), 'a.jpg': jpeg(400, 400), 'm.jpg': jpeg(900, 900) }[n] ?? null))
  check('every problem is listed, not just the first (4)', r.problems.length === 4, String(r.problems.length))
}

// ─── readiness ──────────────────────────────────────────────────────────────
const P = { lat: 35.18, lng: 33.37, address: 'Somewhere 1', menu_verified_on: '2026-10-18', menu_url: null, logo_path: null, is_active: false }
check('ready: items', L.readiness(P, 3).length === 0)
check('ready: menu_url instead of items', L.readiness({ ...P, menu_url: 'https://x.example/menu' }, 0).length === 0)
check('RED partner absent', has(L.readiness(null, 0), /no eatery_partners row/))
check('RED lat null', has(L.readiness({ ...P, lat: null }, 3), /lat\/lng/))
check('RED lng null', has(L.readiness({ ...P, lng: null }, 3), /lat\/lng/))
check('green lat 0 is a number, not missing', L.readiness({ ...P, lat: 0, lng: 0 }, 3).length === 0)
check('RED address null', has(L.readiness({ ...P, address: null }, 3), /address/))
check('RED address blank', has(L.readiness({ ...P, address: '   ' }, 3), /address/))
check('RED menu_verified_on null', has(L.readiness({ ...P, menu_verified_on: null }, 3), /menu_verified_on/))
check('RED no items and no menu_url', has(L.readiness(P, 0), /no menu/))
check('RED blank menu_url and no items', has(L.readiness({ ...P, menu_url: '  ' }, 0), /no menu/))
check('RED several missing are all listed', L.readiness({ ...P, lat: null, address: null, menu_verified_on: null }, 0).length === 4)
check('active partner is allowed (no readiness problem)', L.readiness({ ...P, is_active: true }, 3).length === 0)

// ─── plan ───────────────────────────────────────────────────────────────────
{
  const items = run(GOOD).items
  const empty = { existing: {}, rows: [], logoPath: null }
  const p0 = L.plan(items, empty)
  check('fresh: 5 uploads, 4 row inserts, logo set', p0.problems.length === 0 && p0.uploads.every(u => u.action === 'upload') && p0.uploads.length === 5 && p0.inserts.length === 4 && p0.logo.action === 'set', JSON.stringify(p0.logo))
  check('sort_order = manifest position', p0.inserts.filter(r => r.kind === 'menu').map(r => r.sort_order).join() === '1,2')
  const existing = Object.fromEntries(items.map(i => [i.path, { sha256: i.sha256 }]))
  const rows = p0.inserts.map(r => ({ ...r }))
  const p1 = L.plan(items, { existing, rows, logoPath: 'crunchy-express/logo.png' })
  check('rerun is a no-op (all skip, no rows, logo keep)', p1.problems.length === 0 && p1.uploads.every(u => u.action === 'skip-identical') && p1.inserts.length === 0 && p1.updates.length === 0 && p1.logo.action === 'keep')
  const other = { ...existing, [items[1].path]: { sha256: 'deadbeef' } }
  const p2 = L.plan(items, { existing: other, rows, logoPath: null })
  check('RED different file at same path, no replace', has(p2.problems, /DIFFERENT file/))
  const p3 = L.plan(items, { existing: other, rows, logoPath: null }, true)
  check('green with replace: that path becomes replace', p3.problems.length === 0 && p3.uploads.find(u => u.path === items[1].path).action === 'replace')
  const p4 = L.plan(items, { existing, rows, logoPath: 'crunchy-express/logo.jpg' })
  check('RED logo_path set to something else, no replace', has(p4.problems, /logo_path is already/))
  check('green logo_path other with replace', L.plan(items, { existing, rows, logoPath: 'crunchy-express/logo.jpg' }, true).logo.action === 'set')
  const p5 = L.plan(items, { existing, rows: rows.map(r => (r.sort_order === 1 && r.kind === 'gallery' ? { ...r, width: 1 } : r)), logoPath: 'crunchy-express/logo.png' })
  check('RED photo row with different size, no replace', has(p5.problems, /row differs/))
  const p6 = L.plan(items, { existing, rows: [...rows, { storage_path: 'crunchy-express/old.jpg', kind: 'gallery', width: 1, height: 1, sort_order: 9 }], logoPath: 'crunchy-express/logo.png' })
  check('rows outside the manifest are reported, never touched', p6.orphans.join() === 'crunchy-express/old.jpg' && p6.inserts.length === 0 && p6.problems.length === 0)
}

console.log(bad ? `\n✗ ${bad} of ${n} checks failed` : `✓ eatery-images lib: ${n} checks passed`)
process.exit(bad ? 1 : 0)
