// ─── Eatery images: pure logic (no network, no credentials) ──────────────────
//
// Imported by scripts/eatery-images.mjs (the writer) and scripts/test-eatery-images.mjs.
// Everything here is a function of its arguments, so every refusal can be proven red offline.

import { createHash } from 'node:crypto'
import { lstatSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

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
//   dish    short side >= 800: a dish shows as a ~200 pt thumbnail in the menu list but opens in a full-screen viewer
//           on a 1170 px-wide phone; the short side is what survives fit-to-screen without a visible upscale
//           beyond ~1.5x, whatever the crop (square, 4:3, portrait). Below 800 the viewer is visibly soft.
export const MIN = { logoShortSide: 256, galleryWidth: 800, menuWidth: 1000, dishShortSide: 800 }
// Separator of the "Section › Name" dish key (U+203A), used when one name occurs in several sections.
export const DISH_SEP = ' \u203a '

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
// manifest = { logo?: 'logo.png', gallery?: [...], menu?: [...], dishes?: { '<item name>': 'file.jpg' } }.
// readFile(name) -> Buffer | null (null = missing). Returns { problems: string[], items: [...], dishes: [...] }.
// A dish has no object path yet: it needs the menu item id, so matchDishes() resolves it later.
export function validateLocal(slug, manifest, readFile) {
  const problems = []
  const items = []
  const dishes = []
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) problems.push(`slug '${slug}' does not match ${SLUG_RE}`)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push('manifest.json is not a JSON object')
    return { problems, items, dishes }
  }
  for (const k of Object.keys(manifest)) if (!['logo', 'gallery', 'menu', 'dishes'].includes(k)) problems.push(`manifest: unknown key '${k}'`)
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
  if (manifest.dishes !== undefined) {
    const d = manifest.dishes
    if (!d || typeof d !== 'object' || Array.isArray(d)) problems.push('manifest.dishes must be an object of "item name": "file" pairs')
    else Object.entries(d).forEach(([key, name], i) => {
      if (typeof name !== 'string') problems.push(`manifest.dishes #${i + 1}: the file must be a file name string`)
      else if (key.trim() === '') problems.push(`manifest.dishes #${i + 1} '${name}': empty item name key`)
      else want.push({ kind: 'dish', n: i + 1, name, key: key.trim() })
    })
  }
  if (!want.length && !problems.length) problems.push('manifest lists no images')
  const seen = new Map()
  for (const w of want) {
    const tag = `${w.kind}${w.kind === 'logo' ? '' : '#' + w.n} '${w.name}'`   // never the dish key: it is an item name and logs are public
    if (!FILE_RE.test(w.name)) { problems.push(`${tag}: file name must be a plain name ending .jpg/.jpeg/.png/.webp (no folders)`); continue }
    if (seen.has(w.name)) { problems.push(`${tag}: listed twice (also ${seen.get(w.name)})`); continue }
    seen.set(w.name, tag)
    const buf = readFile(w.name)
    if (buf && buf.unsafe) { problems.push(`${tag}: refused, ${buf.unsafe}`); continue }
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
    if (w.kind === 'dish') {
      if (Math.min(width, height) < MIN.dishShortSide) problems.push(`${tag}: ${width}x${height}, short side must be >= ${MIN.dishShortSide}`)
      dishes.push({ key: w.key, src: w.name, format: s.format, mime: MIME[s.format], bytes: buf.length, width, height, sha256: sha256(buf), buf })
      continue
    }
    const path = `${slug}/${w.kind === 'logo' ? 'logo' : `${w.kind}-${w.n}`}.${s.format}`
    if (!PATH_RE.test(path)) problems.push(`${tag}: object path '${path}' does not match the database path CHECK`)
    items.push({ kind: w.kind, n: w.n, src: w.name, path, mime: MIME[s.format], bytes: buf.length, width, height, sha256: sha256(buf), buf })
  }
  return { problems, items, dishes }
}

// ─── dish → menu item matching ──────────────────────────────────────────────
// dishes = validateLocal().dishes; menuRows = [{ id, section, name }] of this partner (all of them).
// A key matches a name EXACTLY (both trimmed). A name that occurs in more than one section is addressed only as
// "Section › Name". Refused, every one listed: a key matching no item; a name matching several items (the
// message says whether that is several sections or the same section twice); an item mapped twice. Problems name
// the FILE and an ordinal, never the item name (the log is public). Returns { problems, resolved }.
export function matchDishes(slug, dishes, menuRows) {
  const problems = []
  const resolved = []
  const t = x => String(x ?? '').normalize('NFC').trim()
  const taken = new Map()
  for (const d of dishes) {
    const tag = `dish '${d.src}'`
    const key = d.key.normalize('NFC')
    const plain = menuRows.filter(r => t(r.name) === key)
    const qualified = menuRows.filter(r => `${t(r.section)}${DISH_SEP}${t(r.name)}` === key)
    const hit = [...new Map([...plain, ...qualified].map(r => [r.id, r])).values()]
    if (hit.length === 0) { problems.push(`${tag}: its key matches no menu item of this partner${key.includes(' > ') ? `; use the \u203a character (U+203A) between section and name, not '>'` : ''}`); continue }
    if (hit.length > 1) {
      const sections = new Set(hit.map(r => t(r.section)))
      problems.push(sections.size > 1
        ? `${tag}: its key matches ${hit.length} items in ${sections.size} sections, use the "Section${DISH_SEP}Name" form`
        : `${tag}: its key matches ${hit.length} items in the same section, it cannot be told apart`)
      continue
    }
    const item = hit[0]
    if (taken.has(item.id)) { problems.push(`${tag}: maps to the same menu item (id ${item.id}) as '${taken.get(item.id)}'`); continue }
    taken.set(item.id, d.src)
    const path = `${slug}/dish-${item.id}.${d.format}`
    if (!PATH_RE.test(path)) { problems.push(`${tag}: object path '${path}' does not match the database path CHECK`); continue }
    resolved.push({ ...d, itemId: item.id, path, kind: 'dish' })
  }
  return { problems, resolved }
}

// state = { existing: { [path]: {sha256}|null }, itemRows: { [id]: { photo_path, photo_width, photo_height } } }
// Returns { problems, uploads:[{path,action}], updates:[{id,path,width,height,action:'set'|'keep'}] }.
// photo_path may be set only when it is null or already this path; a different one needs replace.
export function planDishes(resolved, state, replace = false) {
  const problems = [], uploads = [], updates = []
  for (const d of resolved) {
    const ex = state.existing?.[d.path]
    if (!ex) uploads.push({ path: d.path, action: 'upload' })
    else if (ex.sha256 === d.sha256) uploads.push({ path: d.path, action: 'skip-identical' })
    else if (replace) uploads.push({ path: d.path, action: 'replace' })
    else problems.push(`${d.path}: a DIFFERENT file already exists at this path (re-run with replace=true to overwrite)`)
    const row = state.itemRows?.[d.itemId]
    if (!row) { problems.push(`${d.path}: menu item ${d.itemId} not found among this partner's rows`); continue }
    const same = row.photo_path === d.path && row.photo_width === d.width && row.photo_height === d.height
    if (row.photo_path == null || row.photo_path === d.path) updates.push({ id: d.itemId, path: d.path, width: d.width, height: d.height, action: same ? 'keep' : 'set' })
    else if (replace) updates.push({ id: d.itemId, path: d.path, width: d.width, height: d.height, action: 'set' })
    else problems.push(`${d.path}: menu item ${d.itemId} already has photo_path '${row.photo_path}' (re-run with replace=true)`)
  }
  return { problems, uploads, updates }
}

// ─── apply (all writes; the client is passed in so the order is provable offline) ─
// Order: every object (upload + re-download + sha256 verify), then, only if ALL succeeded, photo rows, logo_path,
// dish photo_path. One object failure means no row of any kind is written (no row may point at a missing object).
// ctx = { sb, partnerId, uploads, bytesByPath: Map(path -> {buf,mime,sha256}), inserts, updates, logo, dishUpdates,
//         replace, out(line), fail(what, error) }. Returns the failure count.
export async function applyPlan(ctx) {
  const { sb, partnerId, bytesByPath, out, fail, replace } = ctx
  let failed = 0
  const bad = (what, e) => { failed++; fail(what, e) }
  for (const u of ctx.uploads) {
    if (u.action === 'skip-identical') continue
    const it = bytesByPath.get(u.path)
    const up = await sb.storage.from(BUCKET).upload(u.path, it.buf, { contentType: it.mime, upsert: u.action === 'replace', cacheControl: '3600' })
    if (up.error) { bad(`upload ${u.path}`, up.error); continue }
    const dl = await sb.storage.from(BUCKET).download(u.path)
    if (dl.error || sha256(Buffer.from(await dl.data.arrayBuffer())) !== it.sha256) { bad(`verify ${u.path}`, dl.error ?? 'bytes differ after upload'); continue }
    out(`uploaded + verified ${u.path}`)
  }
  if (failed) return failed
  for (const r of ctx.inserts) {
    const ins = await sb.from('eatery_photos').insert({ partner_id: partnerId, ...r })
    if (ins.error) bad(`insert row ${r.storage_path}`, ins.error); else out(`row inserted ${r.storage_path}`)
  }
  for (const r of ctx.updates) {
    const up = await sb.from('eatery_photos').update({ kind: r.kind, width: r.width, height: r.height, sort_order: r.sort_order }).eq('partner_id', partnerId).eq('storage_path', r.storage_path)
    if (up.error) bad(`update row ${r.storage_path}`, up.error); else out(`row updated ${r.storage_path}`)
  }
  if (ctx.logo.action === 'set') {
    const up = await sb.from('eatery_partners').update({ logo_path: ctx.logo.path }).eq('id', partnerId)
    if (up.error) bad('logo_path update', up.error); else out(`logo_path set ${ctx.logo.path}`)
  }
  for (const r of ctx.dishUpdates) {
    if (r.action === 'keep') continue
    let q = sb.from('eatery_menu_items').update({ photo_path: r.path, photo_width: r.width, photo_height: r.height }).eq('id', r.id).eq('partner_id', partnerId)
    if (!replace) q = q.or(`photo_path.is.null,photo_path.eq.${r.path}`)
    const up = await q.select('id')
    if (up.error) bad(`dish photo_path update item ${r.id}`, up.error)
    else if (up.data?.length !== 1) bad(`dish photo_path update item ${r.id}`, `${up.data?.length ?? 0} rows changed (expected 1)`)
    else out(`dish photo_path set item ${r.id}`)
  }
  return failed
}

// ─── readiness: step 1 of the go-live checklist must be complete ────────────
// partner = eatery_partners row (or null); menuItems = count of its eatery_menu_items.
export function readiness(partner, menuItems, dishCount = 0) {
  if (!partner) return ['no eatery_partners row for this slug (run the data migration first)']
  const out = []
  if (partner.lat == null || partner.lng == null) out.push('lat/lng not set')
  if (partner.address == null || String(partner.address).trim() === '') out.push('address not set')
  if (!partner.menu_verified_on) out.push('menu_verified_on not set')
  if (!(menuItems >= 1 || (partner.menu_url != null && String(partner.menu_url).trim() !== '')))
    out.push('no menu: 0 eatery_menu_items rows and no menu_url')
  if (dishCount > 0 && !(menuItems >= 1)) out.push(`${dishCount} dish photo(s) in the manifest but 0 eatery_menu_items rows (run the menu data migration first)`)
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

// ─── file reading that never follows a link out of the partner folder ────────
// A committed symlink (e.g. to /proc/self/environ) must never be read. Refuses a symlink entry, and any
// path whose realpath leaves the realpath of the folder, BEFORE opening it. Returns Buffer | null (absent)
// | { unsafe: reason }. Also used for manifest.json (name 'manifest.json').
export function safeRead(dir, name) {
  const p = join(dir, name)
  let st
  try { st = lstatSync(p) } catch { return null }
  if (st.isSymbolicLink()) return { unsafe: 'is a symlink' }
  if (!st.isFile()) return null
  const real = realpathSync(p), root = realpathSync(dir)
  if (!real.startsWith(root + sep)) return { unsafe: 'resolves outside the partner folder' }
  return readFileSync(p)
}
