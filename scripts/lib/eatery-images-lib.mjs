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
//   banner  width      >= 1000: the banner is a full-width header, ~390 pt wide on a phone, i.e. ~1010 px at 2.6x (a mid-range
//           Android density); 1000 px is the width below which it is upscaled on such a screen. It must also be wider than
//           tall, since the slot is a landscape strip (designs 160-320 pt tall at 390 pt wide).
export const DISH_WAIVER_FLOOR = 600   // a size waiver can never go below this, whatever the manifest says
export const BANNER_WAIVER_FLOOR = 600 // same for the banner width waiver
export const MIN = { logoShortSide: 256, galleryWidth: 800, menuWidth: 1000, dishShortSide: 800, bannerWidth: 1000 }
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

// ─── content-addressed object names ─────────────────────────────────────────
// An object's name embeds the first 8 hex chars of the sha256 of its bytes, joined with a HYPHEN (PATH_RE allows one
// dot only, before the extension): <slug>/logo-<h8>.<ext>, banner-<h8>, gallery-<n>-<h8>, menu-<n>-<h8>, dish-<itemId>-<h8>.
// WHY: the app caches images on disk keyed by URL (expo-image, cachePolicy memory-disk). A replaced file written to
// the SAME path kept showing the old picture until the user cleared the cache. A changed file now gets a NEW name, so
// a new URL, so a cache miss. The same bytes always give the same name, so a re-run stays a no-op.
export const HASH_LEN = 8
export const hashTag = hex => hex.slice(0, HASH_LEN)
export function objectPath(slug, kind, n, hex, ext) {
  const stem = kind === 'logo' || kind === 'banner' ? kind : `${kind}-${n}`
  return `${slug}/${stem}-${hashTag(hex)}.${ext}`
}

// Grace period of a prune. WHAT IS MEASURED: the age of the NEWEST object that a row references under <slug>/, taken as the
// date of the last repoint (a replace apply always uploads the new content-addressed objects before it moves a row, so
// that object is born at the repoint). While it is younger than this, a prune keeps EVERYTHING: a phone that loaded the
// old row just before the repoint may still ask for the old object (a session holds its row for hours), and an apply that
// uploaded but failed before its row write leaves fresh unreferenced objects too. An old object's OWN age proves nothing
// (Crunchy's fixed-name objects are weeks old on the day they are repointed), so it is used only as a second guard.
// Why 7: it outlasts a session and a retry by a wide margin; the storage held is a few hundred KB per replaced image.
// KNOWN LIMIT: a repoint onto an object that ALREADY existed (identical bytes, nothing uploaded) leaves no new object to
// date it by; the check can then be satisfied by older referenced objects. Wait the grace yourself after such a repoint.
export const PRUNE_GRACE_DAYS = 7

// ─── manifest + files → items ───────────────────────────────────────────────
// manifest = { logo?: 'logo.png', banner?: 'banner.jpg', bannerSizeWaiver?: {...}, gallery?: [...], menu?: [...], dishes?: { '<item name>': 'file.jpg' } }.
// readFile(name) -> Buffer | null (null = missing). Returns { problems: string[], items: [...], dishes: [...] }.
// A dish has no object path yet: it needs the menu item id, so matchDishes() resolves it later.
export function validateLocal(slug, manifest, readFile) {
  const problems = []
  const items = []
  const dishes = []
  const waivers = []
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) problems.push(`slug '${slug}' does not match ${SLUG_RE}`)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push('manifest.json is not a JSON object')
    return { problems, items, dishes, waivers }
  }
  for (const k of Object.keys(manifest)) if (!['logo', 'banner', 'bannerSizeWaiver', 'gallery', 'menu', 'dishes', 'dishSizeWaivers'].includes(k)) problems.push(`manifest: unknown key '${k}'`)
  const want = []
  if (manifest.logo !== undefined) {
    if (typeof manifest.logo !== 'string') problems.push("manifest.logo must be a file name string")
    else want.push({ kind: 'logo', n: 1, name: manifest.logo })
  }
  if (manifest.banner !== undefined) {
    if (typeof manifest.banner !== 'string') problems.push("manifest.banner must be a file name string")
    else want.push({ kind: 'banner', n: 1, name: manifest.banner })
  }
  // bannerSizeWaiver: { minWidth, reason, approvedBy, date }, only valid together with a banner.
  let bannerWaiver = null
  if (manifest.bannerSizeWaiver !== undefined) {
    const w = manifest.bannerSizeWaiver
    const tag = 'manifest.bannerSizeWaiver'
    if (manifest.banner === undefined) problems.push(`${tag}: there is no banner in the manifest`)
    if (!w || typeof w !== 'object' || Array.isArray(w)) problems.push(`${tag}: must be an object { minWidth, reason, approvedBy, date }`)
    else {
      for (const f of Object.keys(w)) if (!['minWidth', 'reason', 'approvedBy', 'date'].includes(f)) problems.push(`${tag}: unknown field '${f}'`)
      const okMin = Number.isInteger(w.minWidth) && w.minWidth >= BANNER_WAIVER_FLOOR && w.minWidth < MIN.bannerWidth
      if (!okMin) problems.push(`${tag}: minWidth must be an integer from ${BANNER_WAIVER_FLOOR} to ${MIN.bannerWidth - 1}`)
      if (typeof w.reason !== 'string' || w.reason.trim().length < 20) problems.push(`${tag}: reason must be at least 20 characters`)
      if (typeof w.approvedBy !== 'string' || w.approvedBy.trim() === '') problems.push(`${tag}: approvedBy is required`)
      const dateOk = typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && new Date(w.date + 'T00:00:00Z').toISOString().slice(0, 10) === w.date
      if (!dateOk) problems.push(`${tag}: date must be a valid YYYY-MM-DD`)
      if (okMin && typeof w.approvedBy === 'string' && w.approvedBy.trim() !== '' && dateOk && typeof w.reason === 'string' && w.reason.trim().length >= 20) bannerWaiver = w
    }
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
  // dishSizeWaivers: { '<dish key>': { minShortSide, reason, approvedBy, date } }. Problems name the waiver by number, never the key (item name, public logs).
  const waiverFor = new Map()
  if (manifest.dishSizeWaivers !== undefined) {
    const wv = manifest.dishSizeWaivers
    if (!wv || typeof wv !== 'object' || Array.isArray(wv)) problems.push('manifest.dishSizeWaivers must be an object of "dish name": { minShortSide, reason, approvedBy, date }')
    else {
      const dishKeys = new Set(manifest.dishes && typeof manifest.dishes === 'object' && !Array.isArray(manifest.dishes) ? Object.keys(manifest.dishes).map(k => k.trim()) : [])
      Object.entries(wv).forEach(([key, w], i) => {
        const tag = `manifest.dishSizeWaivers #${i + 1}`
        const k = key.trim()
        if (!dishKeys.has(k)) problems.push(`${tag}: no such dish in manifest.dishes`)
        if (waiverFor.has(k)) problems.push(`${tag}: duplicate waiver for the same dish`)
        if (!w || typeof w !== 'object' || Array.isArray(w)) { problems.push(`${tag}: must be an object`); return }
        for (const f of Object.keys(w)) if (!['minShortSide', 'reason', 'approvedBy', 'date'].includes(f)) problems.push(`${tag}: unknown field '${f}'`)
        const okMin = Number.isInteger(w.minShortSide) && w.minShortSide >= DISH_WAIVER_FLOOR && w.minShortSide < MIN.dishShortSide
        if (!okMin) problems.push(`${tag}: minShortSide must be an integer from ${DISH_WAIVER_FLOOR} to ${MIN.dishShortSide - 1}`)
        if (typeof w.reason !== 'string' || w.reason.trim().length < 20) problems.push(`${tag}: reason must be at least 20 characters`)
        if (typeof w.approvedBy !== 'string' || w.approvedBy.trim() === '') problems.push(`${tag}: approvedBy is required`)
        const dateOk = typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && new Date(w.date + 'T00:00:00Z').toISOString().slice(0, 10) === w.date
        if (!dateOk) problems.push(`${tag}: date must be a valid YYYY-MM-DD`)
        if (okMin && typeof w.approvedBy === 'string' && typeof w.date === 'string') waiverFor.set(k, { ...w, tag })
      })
    }
  }
  if (!want.length && !problems.length) problems.push('manifest lists no images')
  const seen = new Map()
  for (const w of want) {
    const tag = `${w.kind}${w.kind === 'logo' || w.kind === 'banner' ? '' : '#' + w.n} '${w.name}'`   // never the dish key: it is an item name and logs are public
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
    if (w.kind === 'banner') {
      if (width <= height) problems.push(`${tag}: ${width}x${height}, a banner must be wider than tall`)
      if (bannerWaiver && width >= MIN.bannerWidth) problems.push(`${tag}: manifest.bannerSizeWaiver is an unnecessary waiver, the banner is ${width}x${height} and meets ${MIN.bannerWidth}; remove it`)
      const minW = bannerWaiver ? bannerWaiver.minWidth : MIN.bannerWidth
      if (width < minW) problems.push(`${tag}: ${width}x${height}, width must be >= ${minW}${bannerWaiver ? ' (waived)' : ''}`)
      else if (bannerWaiver) waivers.push({ src: w.name, kind: 'banner', minWidth: bannerWaiver.minWidth, width, height, approvedBy: bannerWaiver.approvedBy.trim(), date: bannerWaiver.date })
    }
    if (w.kind === 'gallery' && width < MIN.galleryWidth) problems.push(`${tag}: ${width}x${height}, width must be >= ${MIN.galleryWidth}`)
    if (w.kind === 'menu' && width < MIN.menuWidth) problems.push(`${tag}: ${width}x${height}, width must be >= ${MIN.menuWidth}`)
    if (w.kind === 'dish') {
      const wv = waiverFor.get(w.key)
      const short = Math.min(width, height)
      if (wv && short >= MIN.dishShortSide) problems.push(`${tag}: ${wv.tag} is an unnecessary waiver, the photo is ${width}x${height} and meets ${MIN.dishShortSide}; remove it`)
      const minShort = wv ? wv.minShortSide : MIN.dishShortSide
      if (short < minShort) problems.push(`${tag}: ${width}x${height}, short side must be >= ${minShort}${wv ? ' (waived)' : ''}`)
      else if (wv) waivers.push({ src: w.name, minShortSide: wv.minShortSide, width, height, approvedBy: wv.approvedBy.trim(), date: wv.date })
      dishes.push({ key: w.key, src: w.name, format: s.format, mime: MIME[s.format], bytes: buf.length, width, height, sha256: sha256(buf), buf })
      continue
    }
    const path = objectPath(slug, w.kind, w.n, sha256(buf), s.format)
    if (!PATH_RE.test(path)) problems.push(`${tag}: object path '${path}' does not match the database path CHECK`)
    items.push({ kind: w.kind, n: w.n, src: w.name, path, mime: MIME[s.format], bytes: buf.length, width, height, sha256: sha256(buf), buf })
  }
  return { problems, items, dishes, waivers }
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
    const path = objectPath(slug, 'dish', item.id, d.sha256, d.format)
    if (!PATH_RE.test(path)) { problems.push(`${tag}: object path '${path}' does not match the database path CHECK`); continue }
    resolved.push({ ...d, itemId: item.id, path, kind: 'dish' })
  }
  return { problems, resolved }
}

// state = { existing: { [path]: {sha256}|null }, itemRows: { [id]: { photo_path, photo_width, photo_height } } }
// Returns { problems, uploads:[{path,action}], updates:[{id,path,width,height,action:'set'|'keep'}] }.
// photo_path may be set only when it is null or already this path; a different one (a REPOINT, old -> new) needs replace.
// A name is a function of the bytes, so an object that exists at the planned path with DIFFERENT bytes is a hash-prefix
// collision or tampering: refused whatever replace says. Nothing is ever overwritten.
export function planDishes(resolved, state, replace = false) {
  const problems = [], uploads = [], updates = []
  for (const d of resolved) {
    const ex = state.existing?.[d.path]
    if (!ex) uploads.push({ path: d.path, action: 'upload' })
    else if (ex.sha256 === d.sha256) uploads.push({ path: d.path, action: 'skip-identical' })
    else problems.push(`${d.path}: an object with DIFFERENT bytes already sits at this content-addressed name; refusing (nothing is overwritten)`)
    const row = state.itemRows?.[d.itemId]
    if (!row) { problems.push(`${d.path}: menu item ${d.itemId} not found among this partner's rows`); continue }
    const same = row.photo_path === d.path && row.photo_width === d.width && row.photo_height === d.height
    if (row.photo_path == null || row.photo_path === d.path) updates.push({ id: d.itemId, path: d.path, from: row.photo_path ?? null, width: d.width, height: d.height, action: same ? 'keep' : 'set' })
    else if (replace) updates.push({ id: d.itemId, path: d.path, from: row.photo_path, width: d.width, height: d.height, action: 'set' })
    else problems.push(`${d.path}: menu item ${d.itemId} already points at '${row.photo_path}', would move to this path (re-run with replace=true)`)
  }
  return { problems, uploads, updates }
}

// ─── apply (all writes; the client is passed in so the order is provable offline) ─
// Order: every object (upload + re-download + sha256 verify), then, only if ALL succeeded, photo rows, logo_path,
// banner_path, dish photo_path. One object failure means no row of any kind is written (no row may point at a missing object).
// Uploads are always upsert:false: a name that exists is never written over (the plan already refused different bytes).
// ctx = { sb, partnerId, uploads, bytesByPath: Map(path -> {buf,mime,sha256}), inserts, updates, logo, banner?, dishUpdates,
//         replace, out(line), fail(what, error) }. Returns the failure count.
export async function applyPlan(ctx) {
  const { sb, partnerId, bytesByPath, out, fail, replace } = ctx
  let failed = 0
  const bad = (what, e) => { failed++; fail(what, e) }
  for (const u of ctx.uploads) {
    if (u.action === 'skip-identical') continue
    const it = bytesByPath.get(u.path)
    const up = await sb.storage.from(BUCKET).upload(u.path, it.buf, { contentType: it.mime, upsert: false, cacheControl: '3600' })
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
    // Identified by the row id read at plan time (a repoint changes storage_path, so the new path would match nothing).
    const up = await sb.from('eatery_photos').update({ kind: r.kind, storage_path: r.storage_path, width: r.width, height: r.height, sort_order: r.sort_order }).eq('partner_id', partnerId).eq('id', r.rowId).select('id')
    if (up.error) bad(`update row ${r.storage_path}`, up.error)
    else if (up.data?.length !== 1) bad(`update row ${r.storage_path}`, `${up.data?.length ?? 0} rows changed (expected 1)`)
    else out(`row updated ${r.from && r.from !== r.storage_path ? `${r.from} -> ` : ''}${r.storage_path}`)
  }
  if (ctx.logo.action === 'set') {
    const up = await sb.from('eatery_partners').update({ logo_path: ctx.logo.path }).eq('id', partnerId)
    if (up.error) bad('logo_path update', up.error); else out(`logo_path set ${ctx.logo.from ? `${ctx.logo.from} -> ` : ''}${ctx.logo.path}`)
  }
  if (ctx.banner?.action === 'set') {
    const up = await sb.from('eatery_partners').update({ banner_path: ctx.banner.path }).eq('id', partnerId)
    if (up.error) bad('banner_path update', up.error); else out(`banner_path set ${ctx.banner.from ? `${ctx.banner.from} -> ` : ''}${ctx.banner.path}`)
  }
  for (const r of ctx.dishUpdates) {
    if (r.action === 'keep') continue
    let q = sb.from('eatery_menu_items').update({ photo_path: r.path, photo_width: r.width, photo_height: r.height }).eq('id', r.id).eq('partner_id', partnerId)
    if (!replace) q = q.or(`photo_path.is.null,photo_path.eq.${r.path}`)
    const up = await q.select('id')
    if (up.error) bad(`dish photo_path update item ${r.id}`, up.error)
    else if (up.data?.length !== 1) bad(`dish photo_path update item ${r.id}`, `${up.data?.length ?? 0} rows changed (expected 1)`)
    else out(`dish photo_path set item ${r.id}${r.from && r.from !== r.path ? ` ${r.from} -> ${r.path}` : ''}`)
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
//   rows:     [{ id, storage_path, kind, width, height, sort_order }]   this partner's eatery_photos rows
//   logoPath: partner.logo_path, bannerPath: partner.banner_path
// }
// A gallery/menu row is the slot (kind, sort_order); its storage_path is what changes when the bytes change. So a row is
// found by its path first (same bytes, same name), else by its slot among rows no other image claimed (new bytes ->
// REPOINT old -> new, needs replace). No row is ever claimed twice.
// A name is a function of the bytes: an object at the planned path with other bytes is a collision, refused always.
// Returns { problems, uploads:[{path,action}], inserts:[...], updates:[{..., rowId, from}], logo:{action,path?,from?}, banner, orphans:[paths] }
export function plan(items, state, replace = false) {
  const problems = []
  const uploads = [], inserts = [], updates = []
  const rows = state.rows || []
  const moved = new Set()
  // Pass 1: rows matched by PATH (same bytes, same name) are claimed first, so pass 2 (slot match) can never take the
  // row of another image. Prepending a gallery photo: n is in the name, so the old photo's content gets a NEW name at slot 2 (an insert); the new photo takes slot 1 by repointing the old slot-1 row, and the old slot-1 object becomes prunable.
  const claimed = new Map()   // row -> item path that owns it
  const claim = (row, it) => {
    if (claimed.has(row)) { problems.push(`${it.path}: its row is already claimed by '${claimed.get(row)}'`); return false }
    claimed.set(row, it.path); return true
  }
  const owner = new Map()
  for (const it of items) {
    if (it.kind === 'logo' || it.kind === 'banner') continue
    const byPath = rows.find(r => r.storage_path === it.path)
    if (byPath && claim(byPath, it)) owner.set(it.path, byPath)
  }
  for (const it of items) {
    const ex = state.existing?.[it.path]
    if (!ex) uploads.push({ path: it.path, action: 'upload' })
    else if (ex.sha256 === it.sha256) uploads.push({ path: it.path, action: 'skip-identical' })
    else problems.push(`${it.path}: an object with DIFFERENT bytes already sits at this content-addressed name; refusing (nothing is overwritten)`)
    if (it.kind === 'logo' || it.kind === 'banner') continue
    const want = { kind: it.kind, storage_path: it.path, width: it.width, height: it.height, sort_order: it.n }
    const byPath = owner.get(it.path)
    const slot = byPath ? [] : rows.filter(r => r.kind === it.kind && r.sort_order === it.n && !claimed.has(r))
    if (slot.length > 1) { problems.push(`${it.path}: ${slot.length} existing ${it.kind} rows share order ${it.n}, cannot tell which to repoint`); continue }
    const row = byPath ?? slot[0]
    if (!row) { inserts.push(want); continue }
    if (!byPath) claim(row, it)
    moved.add(row.storage_path)
    if (row.storage_path !== it.path) {
      if (replace) updates.push({ ...want, rowId: row.id, from: row.storage_path })
      else problems.push(`${it.kind} #${it.n}: row points at '${row.storage_path}', would move to '${it.path}' (re-run with replace=true)`)
    } else if (row.kind !== want.kind || row.width !== want.width || row.height !== want.height || row.sort_order !== want.sort_order) {
      if (replace) updates.push({ ...want, rowId: row.id, from: row.storage_path })
      else problems.push(`${it.path}: eatery_photos row differs (${row.width}x${row.height} order ${row.sort_order}); re-run with replace=true to update it`)
    }
  }
  const one = (item, cur, label) => {
    if (!item) return { action: 'none' }
    if (cur == null) return { action: 'set', path: item.path }
    if (cur === item.path) return { action: 'keep', path: item.path }
    if (replace) return { action: 'set', path: item.path, from: cur }
    problems.push(`${label} is already '${cur}', manifest ${item.kind} would be '${item.path}' (re-run with replace=true)`)
    return { action: 'none' }
  }
  const logoPlan = one(items.find(i => i.kind === 'logo'), state.logoPath, 'logo_path')
  const bannerPlan = one(items.find(i => i.kind === 'banner'), state.bannerPath, 'banner_path')
  const orphans = rows.map(r => r.storage_path).filter(p => !moved.has(p))
  return { problems, uploads, inserts, updates, logo: logoPlan, banner: bannerPlan, orphans }
}

// ─── prune: delete OLD objects no row references ────────────────────────────
// A replaced image leaves its old object behind on purpose (a phone mid-load, or a session holding the old row, must
// not 404). Pruning is its own explicit mode, never run after an upload. Pure: the caller reads the rows and the
// bucket listing. objects = [{ path, created_at, updated_at }] (full bucket paths); referenced = Set of paths that ANY
// row points at (logo_path, banner_path, eatery_photos.storage_path, eatery_menu_items.photo_path).
// Rules, in order (each one refuses or keeps, none deletes more):
//   1. a referenced `<slug>/...` path that is NOT in the listing -> problem, nothing deleted (listing or LIKE filter unreliable);
//   2. no referenced `<slug>/...` path at all -> problem (the folder would be deleted entirely);
//   3. the NEWEST referenced object (max of created_at/updated_at) is younger than graceDays, or has no usable
//      timestamp -> KEEP EVERYTHING (the repoint is recent, see PRUNE_GRACE_DAYS);
//   4. otherwise delete objects directly inside `<slug>/`, referenced by no row, whose newer timestamp is older-or-equal
//      graceDays (an object exactly graceDays old IS deleted), with a usable timestamp (no date = kept).
// Returns { problems, delete:[path], keep:[{path, why}] }.
export function planPrune({ slug, objects, referenced, now, graceDays = PRUNE_GRACE_DAYS }) {
  const problems = []
  const del = [], keep = []
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) problems.push(`slug '${slug}' does not match ${SLUG_RE}`)
  if (!(referenced instanceof Set)) problems.push('referenced set missing')
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) problems.push('now is not a valid Date')
  if (problems.length) return { problems, delete: del, keep }
  const prefix = `${slug}/`
  const cutoff = now.getTime() - graceDays * 86400000
  const ownRefs = [...referenced].filter(p => typeof p === 'string' && p.startsWith(prefix))
  if (ownRefs.length === 0) problems.push('no row references anything under this slug: refusing to prune a folder that would be deleted entirely')
  const byPath = new Map(objects.map(o => [String(o.path ?? ''), o]))
  const missing = ownRefs.filter(p => !byPath.has(p))
  if (missing.length) problems.push(`${missing.length} referenced path(s) are missing from the storage listing: the listing or the row filter is unreliable (paths in the report artifact)`)
  if (problems.length) return { problems, delete: del, keep, missing }
  const refTimes = ownRefs.flatMap(p => [byPath.get(p).created_at, byPath.get(p).updated_at]).map(t => (t ? Date.parse(t) : NaN))
  const newestRef = refTimes.some(Number.isNaN) ? NaN : Math.max(...refTimes)
  const holdWhy = Number.isNaN(newestRef) ? 'a referenced object has no usable timestamp, the last repoint cannot be dated'
    : newestRef > cutoff ? `newest referenced object is younger than ${graceDays} days: a recent repoint, old objects may still be in use` : null
  for (const o of objects) {
    const path = String(o.path ?? '')
    const rest = path.slice(prefix.length)
    if (!path.startsWith(prefix) || rest === '' || rest.includes('/') || rest.includes('..')) { keep.push({ path, why: 'outside this slug folder' }); continue }
    if (referenced.has(path)) { keep.push({ path, why: 'referenced by a row' }); continue }
    if (holdWhy) { keep.push({ path, why: holdWhy }); continue }
    const times = [o.created_at, o.updated_at].map(t => (t ? Date.parse(t) : NaN))
    if (times.some(Number.isNaN)) { keep.push({ path, why: 'no usable timestamp' }); continue }
    if (Math.max(...times) > cutoff) { keep.push({ path, why: `younger than ${graceDays} days` }); continue }
    del.push(path)
  }
  return { problems, delete: del, keep }
}

// Orchestration decisions of --prune, pure so they can be tested and mutated. Each returns null (fine) or a message.
export const LIST_LIMIT = 1000
export const pruneModeRefusal = ({ prune, replace }) => (prune && replace ? '--prune cannot be combined with --replace' : null)
// r = { error, count, received } of one row query: a failed or truncated read (count: 'exact' vs rows received) refuses.
export const queryRefusal = (what, r) => (r.error ? `${what} failed`
  : r.count !== r.received ? `${what} truncated: count ${r.count} vs received ${r.received}` : null)
export const ownPartnerRefusal = found => (found === 1 ? null : `prune needs exactly one partner row for the slug, found ${found}`)
export const listingRefusal = lp => (lp.error ? 'bucket listing failed'
  : lp.received >= LIST_LIMIT ? `folder holds >= ${LIST_LIMIT} objects, listing may be truncated` : null)
export const removeRefusal = (rm, expected) => (rm.error ? 'remove failed'
  : (rm.confirmed ?? 0) !== expected ? `storage confirmed ${rm.confirmed ?? 0} of ${expected} deletions` : null)

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
