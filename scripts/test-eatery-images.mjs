#!/usr/bin/env node
// ─── Offline proofs for scripts/lib/eatery-images-lib.mjs ────────────────────
//
//   node scripts/test-eatery-images.mjs            # controls: every refusal red, the good fixture green
//   node scripts/test-eatery-images.mjs --mutants  # breaks the CODE UNDER TEST one line at a time and requires
//                                                    this suite to go red for each break (and the break to land)
//
// Fixtures are synthetic header buffers (no image library, no network, no files). End-to-end with real
// files runs on the first dry dispatch of the eatery-images workflow.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
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
    ['symlink check removed', 'st.isSymbolicLink()', 'false'],
    ['realpath escape check removed', '!real.startsWith(root + sep)', 'false'],
    ['JPEG parser stops at first marker', 'i += 2 + len', 'return { error: "stop" }'],
    ['PNG width read from wrong offset', 'b.readUInt32BE(16)', 'b.readUInt32BE(12)'],
    ['WebP VP8L height wrong', '((bits >>> 14) & 0x3fff) + 1', '((bits >>> 13) & 0x3fff) + 1'],
    ['WebP VP8X animated accepted', 'if (b[20] & 0x02)', 'if (false)'],
    ['dish minimum removed', 'Math.min(width, height) < MIN.dishShortSide', 'false'],
    ['dish minimum off by one', 'Math.min(width, height) < MIN.dishShortSide', 'Math.min(width, height) < MIN.dishShortSide - 1'],
    ['dish key not trimmed', "want.push({ kind: 'dish', n: i + 1, name, key: key.trim() })", "want.push({ kind: 'dish', n: i + 1, name, key })"],
    ['dish match: unknown key accepted', 'if (hit.length === 0) {', 'if (false) {'],
    ['dish match: ambiguous name accepted', 'if (hit.length > 1) {', 'if (false) {'],
    ['dish match: item mapped twice accepted', 'if (taken.has(item.id))', 'if (false)'],
    ['dish match: Section > Name form dropped', '`${t(r.section)}${DISH_SEP}${t(r.name)}` === key', 'false'],
    ['dish path wrong prefix', '`${slug}/dish-${item.id}.${d.format}`', '`${slug}/dishes-${item.id}.${d.format}`'],
    ['dish readiness: items not required', 'if (dishCount > 0 && !(menuItems >= 1))', 'if (false)'],
    ['dish plan: different object overwrites silently', "else if (replace) uploads.push({ path: d.path, action: 'replace' })", "else if (true) uploads.push({ path: d.path, action: 'replace' })"],
    ['dish plan: foreign photo_path overwritten without replace', 'else if (replace) updates.push({ id: d.itemId', 'else if (true) updates.push({ id: d.itemId'],
    ['dish plan: identical object re-uploaded', "ex.sha256 === d.sha256", 'false'],
    ['apply: rows written despite a failed upload', 'if (failed) return failed', 'if (false) return failed'],
    ['apply: dish update not guarded null-or-equal', 'if (!replace) q = q.or(', 'if (false) q = q.or('],
    ['apply: dish update loses partner_id scope', ".eq('id', r.id).eq('partner_id', partnerId)", ".eq('id', r.id)"],
    ['apply: dish guard string changed', 'photo_path.is.null,photo_path.eq.${r.path}', 'photo_path.is.null'],
    ['dish match: stored name not trimmed', "menuRows.filter(r => t(r.name) === key)", "menuRows.filter(r => String(r.name) === key)"],
    ['dish match: no NFC normalisation', "const key = d.key.normalize('NFC')", 'const key = d.key'],
    ['dish match: stored side no NFC', "String(x ?? '').normalize('NFC').trim()", "String(x ?? '').trim()"],
    ['dish match: ASCII > hint dropped', "key.includes(' > ')", 'false'],
    ['apply: dish update 0 rows not noticed', 'up.data?.length !== 1', 'false'],
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

// ─── safeRead: symlinks and escapes (real files in a temp dir) ───────────────
{
  const base = mkdtempSync(join(tmpdir(), 'eatery-sym-'))
  const dir = join(base, 'partner'); mkdirSync(dir)
  const outside = join(base, 'secret.txt'); writeFileSync(outside, 'TOPSECRET')
  writeFileSync(join(dir, 'real.png'), png(512, 512))
  symlinkSync(outside, join(dir, 'link.png'))
  symlinkSync(join(dir, 'real.png'), join(dir, 'inner-link.png'))   // even a link that stays inside is refused
  mkdirSync(join(base, 'other')); writeFileSync(join(base, 'other', 'x.png'), png(512, 512))
  const r = name => L.safeRead(dir, name)
  check('positive control: a real file is read', Buffer.isBuffer(r('real.png')) && r('real.png').length === 4000)
  check('RED symlink to a file outside is refused, not read', r('link.png')?.unsafe === 'is a symlink' && !Buffer.isBuffer(r('link.png')))
  check('RED symlink inside the folder is refused too', r('inner-link.png')?.unsafe === 'is a symlink')
  check('missing file is null (not an error object)', r('nope.png') === null)
  check('RED escape via .. is refused', r('../other/x.png')?.unsafe === 'resolves outside the partner folder')
  const v = run({ logo: 'link.png' }, r)
  check('RED validateLocal reports the symlink and reads nothing', has(v.problems, /is a symlink/) && v.items.length === 0)
  check('positive control through validateLocal', run({ logo: 'real.png' }, r).problems.length === 0)
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

// ─── dishes: manifest validation, matching, planning, apply order ─────────────
const SEP = ' › '
const dfiles = { 'burger.jpg': jpeg(900, 1200), 'fries.png': png(1000, 800), 'wrap.jpg': jpeg(1600, 1200), 'wrap2.jpg': jpeg(1600, 1200), 'sauce.jpg': jpeg(1200, 1200) }
const drd = name => dfiles[name] ?? null
const ROWS = [
  { id: 11, section: 'Burgers', name: 'Chicken Burger' },
  { id: 12, section: 'Sides', name: 'Fries' },
  { id: 13, section: 'Wraps', name: 'Special' },
  { id: 14, section: 'Burgers', name: 'Special' },
  { id: 15, section: 'Sauces', name: 'Garlic Sauce' },
  { id: 16, section: 'Sauces', name: 'Twin' },
  { id: 17, section: 'Sauces', name: 'Twin' },
  { id: 18, section: 'Soups ', name: 'Plain  ' },
  { id: 19, section: 'Soups', name: '\u00c7orba' },
]
const dv = dishes => run({ dishes }, drd)
const dm = dishes => { const v = dv(dishes); return { v, m: L.matchDishes('crunchy-express', v.dishes, ROWS) } }
{
  const v = dv({ 'Chicken Burger': 'burger.jpg', ' Fries ': 'fries.png' })
  check('dishes: valid manifest, no problems', v.problems.length === 0, v.problems.join(' | '))
  check('dishes: 2 dishes parsed, keys trimmed, not in items', v.dishes.length === 2 && v.items.length === 0 && v.dishes[1].key === 'Fries')
  check('dishes: dishes alone are a non-empty manifest', !has(v.problems, /no images/))
}
check('RED dishes not an object (array)', has(run({ dishes: ['burger.jpg'] }, drd).problems, /must be an object/))
check('RED dish value not a string', has(dv({ A: 5 }).problems, /file must be a file name string/))
check('RED dish empty key', has(dv({ '  ': 'burger.jpg' }).problems, /empty item name key/))
check('RED dish file missing', has(dv({ 'Chicken Burger': 'nope.jpg' }).problems, /not found/))
check('RED dish short side 799', has(run({ dishes: { A: 'd.jpg' } }, () => jpeg(2000, 799)).problems, /short side must be >= 800/))
check('green dish short side 800 (wide)', run({ dishes: { A: 'd.jpg' } }, () => jpeg(2000, 800)).problems.length === 0)
check('RED dish 799 wide (tall) is judged on the short side too', has(run({ dishes: { A: 'd.jpg' } }, () => jpeg(799, 2000)).problems, /short side/))
check('RED dish png bytes named .jpg', has(run({ dishes: { A: 'd.jpg' } }, () => png(900, 900)).problems, /bytes are PNG/))
check('RED same file used twice for two dishes', has(dv({ 'Chicken Burger': 'burger.jpg', Fries: 'burger.jpg' }).problems, /listed twice/))
check('RED dish file also used as gallery', has(run({ gallery: ['burger.jpg'], dishes: { A: 'burger.jpg' } }, drd).problems, /listed twice/))
check('dish problems never echo the item name', !has(dv({ 'Secret Name': 'nope.jpg' }).problems, /Secret Name/))
{
  const { m } = dm({ 'Chicken Burger': 'burger.jpg', Fries: 'fries.png', ['Wraps' + SEP + 'Special']: 'wrap.jpg' })
  check('match: exact name, and Section > Name for a name in two sections', m.problems.length === 0 && m.resolved.map(r => r.itemId).join() === '11,12,13', m.problems.join(' | '))
  check('match: object path = slug/dish-<id>.<ext>, DB regex', m.resolved.map(r => r.path).join() === 'crunchy-express/dish-11.jpg,crunchy-express/dish-12.png,crunchy-express/dish-13.jpg' && m.resolved.every(r => L.PATH_RE.test(r.path)), m.resolved.map(r => r.path).join())
}
check('match: the qualified form also works for a unique name', dm({ ['Sides' + SEP + 'Fries']: 'fries.png' }).m.resolved[0]?.itemId === 12)
check('match: name is case-exact (no fuzzy)', has(dm({ 'chicken burger': 'burger.jpg' }).m.problems, /matches no menu item/))
check('RED ambiguous name in two sections, plain form', has(dm({ Special: 'wrap.jpg' }).m.problems, /2 items in 2 sections.*Section/))
check('RED same name twice in ONE section (even qualified)', has(dm({ ['Sauces' + SEP + 'Twin']: 'sauce.jpg' }).m.problems, /same section/) && has(dm({ Twin: 'sauce.jpg' }).m.problems, /same section/))
check('RED unknown key', has(dm({ Nonexistent: 'burger.jpg' }).m.problems, /matches no menu item/))
check('RED unknown section in qualified form', has(dm({ ['Nope' + SEP + 'Fries']: 'fries.png' }).m.problems, /matches no menu item/))
check('RED one item mapped twice (plain + qualified)', has(dm({ Fries: 'fries.png', ['Sides' + SEP + 'Fries']: 'burger.jpg' }).m.problems, /same menu item \(id 12\)/))
check('RED matching lists every problem', dm({ A: 'burger.jpg', B: 'fries.png', Special: 'wrap.jpg' }).m.problems.length === 3)
check('RED matching problems never echo the item name', !has(dm({ Nonexistent: 'burger.jpg', Special: 'wrap.jpg' }).m.problems, /Nonexistent|Special/))
check('match: stored name with trailing spaces matches the trimmed key', dm({ Plain: 'burger.jpg' }).m.resolved[0]?.itemId === 18)
check('match: stored section with trailing space matches the qualified key', dm({ ['Soups' + SEP + 'Plain']: 'burger.jpg' }).m.resolved[0]?.itemId === 18)
check('match: NFD-typed key matches the NFC row', dm({ ['C\u0327orba'.normalize('NFD')]: 'burger.jpg' }).m.resolved[0]?.itemId === 19)
check('match: NFD stored name matches an NFC key', L.matchDishes('crunchy-express', dv({ '\u00c7orba': 'burger.jpg' }).dishes, [{ id: 5, section: 'S', name: 'C\u0327orba' }]).resolved[0]?.itemId === 5)
check('RED ASCII > between section and name: refusal says to use U+203A', has(dm({ 'Sides > Fries': 'fries.png' }).m.problems, /U\+203A/))
check('no ASCII > hint when the key has none', !has(dm({ Nonexistent: 'burger.jpg' }).m.problems, /U\+203A/))
check('RED matching against zero menu rows', L.matchDishes('crunchy-express', dv({ Fries: 'fries.png' }).dishes, []).problems.length === 1)

check('readiness: dishes need menu ITEMS, menu_url is not enough', has(L.readiness({ ...P, menu_url: 'https://x.example/m' }, 0, 2), /0 eatery_menu_items rows/))
check('readiness: dishes with items are ready', L.readiness(P, 5, 2).length === 0)
check('readiness: no dishes, menu_url only is still fine', L.readiness({ ...P, menu_url: 'https://x.example/m' }, 0, 0).length === 0)

{
  const r = dm({ 'Chicken Burger': 'burger.jpg', Fries: 'fries.png' }).m.resolved
  const itemRows = { 11: { photo_path: null, photo_width: null, photo_height: null }, 12: { photo_path: null, photo_width: null, photo_height: null } }
  const p0 = L.planDishes(r, { existing: {}, itemRows })
  check('dish plan fresh: uploads + photo_path set', p0.problems.length === 0 && p0.uploads.every(u => u.action === 'upload') && p0.updates.every(u => u.action === 'set') && p0.updates.length === 2)
  const existing = Object.fromEntries(r.map(d => [d.path, { sha256: d.sha256 }]))
  const done = { 11: { photo_path: r[0].path, photo_width: r[0].width, photo_height: r[0].height }, 12: { photo_path: r[1].path, photo_width: r[1].width, photo_height: r[1].height } }
  const p1 = L.planDishes(r, { existing, itemRows: done })
  check('dish plan rerun: all skip-identical, row keep', p1.problems.length === 0 && p1.uploads.every(u => u.action === 'skip-identical') && p1.updates.every(u => u.action === 'keep'))
  check('dish plan: identical object but row still null -> upload skipped, row set', (() => { const p = L.planDishes(r, { existing, itemRows }); return p.uploads.every(u => u.action === 'skip-identical') && p.updates.every(u => u.action === 'set') })())
  check('dish plan: equal path, different dims -> row set', L.planDishes(r, { existing, itemRows: { ...done, 11: { ...done[11], photo_width: 1 } } }).updates[0].action === 'set')
  const diff = { ...existing, [r[0].path]: { sha256: 'deadbeef' } }
  check('RED different object at the path, no replace', has(L.planDishes(r, { existing: diff, itemRows }).problems, /DIFFERENT file/))
  check('green different object with replace -> replace', L.planDishes(r, { existing: diff, itemRows }, true).uploads[0].action === 'replace')
  const other = { ...itemRows, 11: { photo_path: 'crunchy-express/dish-11.png', photo_width: 1, photo_height: 1 } }
  check('RED row has a different photo_path, no replace', has(L.planDishes(r, { existing: {}, itemRows: other }).problems, /already has photo_path/))
  check('green different photo_path with replace -> set', L.planDishes(r, { existing: {}, itemRows: other }, true).updates[0].action === 'set')
  check('RED item row missing from state', has(L.planDishes(r, { existing: {}, itemRows: {} }).problems, /not found among/))

  // apply order against a fake client
  const mkSb = ({ failUpload = null, failVerify = null, rowsChanged = 1 } = {}) => {
    const calls = []; const store = {}
    const sb = {
      calls,
      storage: { from: () => ({
        upload: async (path, buf) => { calls.push(['upload', path]); if (path === failUpload) return { error: { statusCode: '500' } }; store[path] = buf; return { error: null } },
        download: async path => { calls.push(['download', path]); const b = path === failVerify ? Buffer.from('tampered') : store[path]; return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } },
      }) },
      from: table => ({
        insert: async () => { calls.push(['insert', table]); return { error: null } },
        update: vals => { const rec = ['update', table, vals]; calls.push(rec); rec.eqs = []; rec.ors = []; const q = { eq: (c, v) => { rec.eqs.push([c, v]); return q }, or: f => { rec.ors.push(f); return q }, select: async () => ({ data: Array(rowsChanged).fill({ id: 1 }), error: null }), then: res => res({ error: null }) }; return q },
      }),
    }
    return sb
  }
  const base = sb => ({
    sb, partnerId: 'p', uploads: p0.uploads, bytesByPath: new Map(r.map(d => [d.path, d])), inserts: [{ kind: 'gallery', storage_path: 'x' }], updates: [],
    logo: { action: 'set', path: 'crunchy-express/logo.png' }, dishUpdates: p0.updates, replace: false, out: () => {}, fail: () => {},
  })
  const writes = sb => sb.calls.filter(c => c[0] === 'insert' || c[0] === 'update')
  { const sb = mkSb(); const f = await L.applyPlan(base(sb)); const w = writes(sb)
    check('apply: all green -> 0 failures, rows + logo + 2 dish updates written', f === 0 && w.filter(c => c[1] === 'eatery_menu_items').length === 2 && w.some(c => c[1] === 'eatery_photos') && w.some(c => c[1] === 'eatery_partners'), JSON.stringify(w.map(c => c.slice(0, 2))))
    check('apply: dish update sets photo_path/width/height guarded by null-or-equal', (() => { const c = w.find(x => x[1] === 'eatery_menu_items'); return c[2].photo_path === r[0].path && c[2].photo_width === r[0].width && c.ors.length === 1 && c.ors[0] === `photo_path.is.null,photo_path.eq.${r[0].path}` })())
    check('apply: every dish update is scoped by partner_id AND item id', (() => { const u = w.filter(x => x[1] === 'eatery_menu_items'); return u.length === 2 && u.every((c, i) => c.eqs.some(e => e[0] === 'partner_id' && e[1] === 'p') && c.eqs.some(e => e[0] === 'id' && e[1] === p0.updates[i].id)) })())
    check('apply: every upload comes before every row write', sb.calls.findLastIndex(c => c[0] === 'upload') < sb.calls.findIndex(c => c[0] === 'insert' || c[0] === 'update'))
  }
  { const sb = mkSb({ failUpload: r[1].path }); const f = await L.applyPlan(base(sb))
    check('RED atomic: a failed dish upload writes NO row of any kind', f === 1 && writes(sb).length === 0, JSON.stringify(writes(sb)))
  }
  { const sb = mkSb({ failVerify: r[0].path }); const f = await L.applyPlan(base(sb))
    check('RED atomic: bytes differing after upload writes NO row', f === 1 && writes(sb).length === 0)
  }
  { const sb = mkSb(); const f = await L.applyPlan({ ...base(sb), replace: true })
    check('apply with replace: no null-or-equal guard on the dish update', f === 0 && writes(sb).filter(c => c[1] === 'eatery_menu_items').every(c => c.ors.length === 0))
  }
  { const sb = mkSb({ rowsChanged: 0 }); const f = await L.applyPlan(base(sb))
    check('RED a dish update that changed 0 rows is a failure', f === 2)
  }
  { const sb = mkSb(); await L.applyPlan({ ...base(sb), dishUpdates: p1.updates }); 
    check('apply: keep rows are not written', writes(sb).filter(c => c[1] === 'eatery_menu_items').length === 0)
  }
  { const sb = mkSb(); await L.applyPlan({ ...base(sb), uploads: p1.uploads })
    check('apply: skip-identical objects are not uploaded', sb.calls.filter(c => c[0] === 'upload').length === 0)
  }
}

console.log(bad ? `\n✗ ${bad} of ${n} checks failed` : `✓ eatery-images lib: ${n} checks passed`)
process.exit(bad ? 1 : 0)
