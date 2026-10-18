// ─── Eatery images: pure logic (no network, no credentials) ──────────────────
//
// Imported by scripts/eatery-images.mjs (the writer) and scripts/test-eatery-images.mjs.
// Everything here is a function of its arguments, so every refusal can be proven red offline.

import { createHash } from 'node:crypto'

export const BUCKET = 'eatery-images'
export const MAX_BYTES = 2 * 1024 * 1024            // bucket file_size_limit (20261115)
// The DB regex on logo_path and eatery_photos.storage_path (20261115). Mirrored here so a path is refused
// before upload rather than by a CHECK after the object already sits in a public bucket.
export const PATH_RE = /^[a-z0-9-]+(\/[a-z0-9][a-z0-9_-]*)+\.(jpg|jpeg|png|webp)$/
export const SLUG_RE = /^[a-z0-9-]+$/
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$/i

// Minimums (pixels). Phone widths are ~390 pt at 3x = 1170 px.
//   logo    short side >= 256: the largest logo render is ~96 pt (288 px at 3x); 256 is the floor before it softens.
//   gallery width      >= 800: below this a full-width card (1170 px) is visibly upscaled.
//   menu    width      >= 1000: menu text is small print and gets pinch-zoomed; at 800 it is unreadable.
export const MIN = { logoShortSide: 256, galleryWidth: 800, menuWidth: 1000 }

export const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

// ─── format + dimensions from header bytes ──────────────────────────────────
// Returns { format: 'jpg'|'png'|'webp', width, height } or { error }.
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return { error: 'too short to be an image' }
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf)
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return png(buf)
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return webp(buf)
  return { error: 'not a JPEG, PNG or WebP (magic bytes)' }
}

function jpeg(b) {
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { error: 'JPEG: lost marker sync' }
    let m = b[i + 1]
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }   // fill bytes
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }   // no length
    if (m === 0xd9 || m === 0xda) return { error: 'JPEG: no frame header before image data' }
    const len = b.readUInt16BE(i + 2)
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
    if (sof) {
      if (len < 8 || i + 9 > b.length) return { error: 'JPEG: truncated frame header' }
      const height = b.readUInt16BE(i + 5), width = b.readUInt16BE(i + 7)
      if (!width || !height) return { error: 'JPEG: zero dimension' }
      return { format: 'jpg', width, height }
    }
    if (len < 2) return { error: 'JPEG: bad segment length' }
    i += 2 + len
  }
  return { error: 'JPEG: no frame header found' }
}

function png(b) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return { error: 'PNG: IHDR missing' }
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20)
  if (!width || !height) return { error: 'PNG: zero dimension' }
  return { format: 'png', width, height }
}

function webp(b) {
  const fourcc = b.toString('latin1', 12, 16)
  if (fourcc === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return { error: 'WebP VP8: bad start code' }
    const width = b.readUInt16LE(26) & 0x3fff, height = b.readUInt16LE(28) & 0x3fff
    if (!width || !height) return { error: 'WebP VP8: zero dimension' }
    return { format: 'webp', width, height }
  }
  if (fourcc === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return { error: 'WebP VP8L: bad signature' }
    const bits = b.readUInt32LE(21)
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (fourcc === 'VP8X') {
    if (b.length < 30) return { error: 'WebP VP8X: truncated' }
    if (b[20] & 0x02) return { error: 'WebP: animated files are not accepted' }
    return { format: 'webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
  }
  return { error: `WebP: unknown chunk '${fourcc}'` }
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex')

// ─── manifest + files → items ───────────────────────────────────────────────
// manifest = { logo?: 'logo.png', gallery?: [...], menu?: [...] } (display order).
// readFile(name) -> Buffer | null (null = missing). Returns { problems: string[], items: [...] }.
export function validateLocal(slug, manifest, readFile) {
  const problems = []
  const items = []
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) problems.push(`slug '${slug}' does not match ${SLUG_RE}`)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push('manifest.json is not a JSON object')
    return { problems, items }
  }
  for (const k of Object.keys(manifest)) if (!['logo', 'gallery', 'menu'].includes(k)) problems.push(`manifest: unknown key '${k}'`)
  const want = []
  if (manifest.logo !== undefined) {
    if (typeof manifest.logo !== 'string') problems.push("manifest.logo must be a file name string")
    else want.push({ kind: 'logo', n: 1, name: manifest.logo })
  }
  for (const kind of ['gallery', 'menu']) {
    const arr = manifest[kind]
    if (arr === undefined) continue
    if (!Array.isArray(arr) || arr.some(x => typeof x !== 'string')) { problems.push(`manifest.${kind} must be an array of file name strings`); continue }
    arr.forEach((name, i) => want.push({ kind, n: i + 1, name }))
  }
  if (!want.length && !problems.length) problems.push('manifest lists no images')
  const seen = new Map()
  for (const w of want) {
    const tag = `${w.kind}${w.kind === 'logo' ? '' : '#' + w.n} '${w.name}'`
    if (!FILE_RE.test(w.name)) { problems.push(`${tag}: file name must be a plain name ending .jpg/.jpeg/.png/.webp (no folders)`); continue }
    if (seen.has(w.name)) { problems.push(`${tag}: listed twice (also ${seen.get(w.name)})`); continue }
    seen.set(w.name, tag)
    const buf = readFile(w.name)
    if (!buf) { problems.push(`${tag}: file not found in data/eatery/${slug}/`); continue }
    if (buf.length > MAX_BYTES) { problems.push(`${tag}: ${buf.length} bytes exceeds the ${MAX_BYTES} byte bucket limit`); continue }
    if (buf.length === 0) { problems.push(`${tag}: empty file`); continue }
    const s = sniffImage(buf)
    if (s.error) { problems.push(`${tag}: ${s.error}`); continue }
    const extRaw = w.name.split('.').pop().toLowerCase()
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw
    if (ext !== s.format) { problems.push(`${tag}: extension .${extRaw} but the bytes are ${s.format.toUpperCase()}`); continue }
    const { width, height } = s
    if (w.kind === 'logo' && Math.min(width, height) < MIN.logoShortSide) problems.push(`${tag}: ${width}x${height}, short side must be >= ${MIN.logoShortSide}`)
    if (w.kind === 'gallery' && width < MIN.galleryWidth) problems.push(`${tag}: ${width}x${height}, width must be >= ${MIN.galleryWidth}`)
    if (w.kind === 'menu' && width < MIN.menuWidth) problems.push(`${tag}: ${width}x${height}, width must be >= ${MIN.menuWidth}`)
    const path = `${slug}/${w.kind === 'logo' ? 'logo' : `${w.kind}-${w.n}`}.${s.format}`
    if (!PATH_RE.test(path)) problems.push(`${tag}: object path '${path}' does not match the database path CHECK`)
    items.push({ kind: w.kind, n: w.n, src: w.name, path, mime: MIME[s.format], bytes: buf.length, width, height, sha256: sha256(buf), buf })
  }
  return { problems, items }
}

// ─── readiness: step 1 of the go-live checklist must be complete ────────────
// partner = eatery_partners row (or null); menuItems = count of its eatery_menu_items.
export function readiness(partner, menuItems) {
  if (!partner) return ['no eatery_partners row for this slug (run the data migration first)']
  const out = []
  if (partner.lat == null || partner.lng == null) out.push('lat/lng not set')
  if (partner.address == null || String(partner.address).trim() === '') out.push('address not set')
  if (!partner.menu_verified_on) out.push('menu_verified_on not set')
  if (!(menuItems >= 1 || (partner.menu_url != null && String(partner.menu_url).trim() !== '')))
    out.push('no menu: 0 eatery_menu_items rows and no menu_url')
  return out
}

// ─── plan: what would happen, given what already exists ─────────────────────
// state = {
//   existing: { [path]: { sha256 } | null }   object already in the bucket (null/absent = not there)
//   rows:     [{ storage_path, kind, width, height, sort_order }]   this partner's eatery_photos rows
//   logoPath: partner.logo_path
// }
// Returns { problems, uploads:[{path,action}], inserts:[...], updates:[...], logo:{action,path?} , orphans:[paths] }
export function plan(items, state, replace = false) {
  const problems = []
  const uploads = [], inserts = [], updates = []
  for (const it of items) {
    const ex = state.existing?.[it.path]
    if (!ex) uploads.push({ path: it.path, action: 'upload' })
    else if (ex.sha256 === it.sha256) uploads.push({ path: it.path, action: 'skip-identical' })
    else if (replace) uploads.push({ path: it.path, action: 'replace' })
    else problems.push(`${it.path}: a DIFFERENT file already exists at this path (re-run with replace=true to overwrite)`)
    if (it.kind === 'logo') continue
    const row = (state.rows || []).find(r => r.storage_path === it.path)
    const want = { kind: it.kind, storage_path: it.path, width: it.width, height: it.height, sort_order: it.n }
    if (!row) inserts.push(want)
    else if (row.kind !== want.kind || row.width !== want.width || row.height !== want.height || row.sort_order !== want.sort_order) {
      if (replace) updates.push(want)
      else problems.push(`${it.path}: eatery_photos row differs (${row.width}x${row.height} order ${row.sort_order}); re-run with replace=true to update it`)
    }
  }
  const logo = items.find(i => i.kind === 'logo')
  let logoPlan = { action: 'none' }
  if (logo) {
    if (state.logoPath == null) logoPlan = { action: 'set', path: logo.path }
    else if (state.logoPath === logo.path) logoPlan = { action: 'keep', path: logo.path }
    else if (replace) logoPlan = { action: 'set', path: logo.path }
    else problems.push(`logo_path is already '${state.logoPath}', manifest logo would be '${logo.path}' (re-run with replace=true)`)
  }
  const mine = new Set(items.map(i => i.path))
  const orphans = (state.rows || []).map(r => r.storage_path).filter(p => !mine.has(p))
  return { problems, uploads, inserts, updates, logo: logoPlan, orphans }
}
