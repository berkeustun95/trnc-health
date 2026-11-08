// ─── Strip every piece of metadata from a JPEG / PNG / WebP, byte level ─────
//
// Shared by the vehicle-photo edge function (Deno: every new car photo passes through it before it is stored),
// scripts/strip-vehicle-photo-metadata.mjs (Node: the backfill and the daily check) and scripts/test-image-metadata.mjs.
// Plain JS, Uint8Array only, no dependencies, no decoding: the pixels are copied untouched, so there is no
// re-compression and no quality loss. Berke, 2026-11-08: "strip location data (all EXIF) from car photos on the
// server", a go-live gate for private car listings.
//
// ALLOW-LISTS, NOT DENY-LISTS (review 2026-11-08). A renamed or draft metadata container (PNG exIf / zxIf, C2PA caBX,
// a WebP 'exif' or 'META' chunk, a reserved JPEG marker) must not survive because nobody thought to name it. So every
// format keeps only the structures needed to show the picture, and the scanner reports anything else:
//   JPEG  SOFn, DHT, DAC, DQT, DRI, SOS, DNL, EXP, RSTn; APP0 JFIF/JFXX; APP2 ICC_PROFILE (colour); APP14 Adobe (colour
//         transform). Everything else goes: APP1 (Exif, XMP, Extended XMP), APP13 (IPTC), other APPn, COM, reserved
//         markers, and anything after EOI (an iPhone's MPF gain map / depth image, which has its own metadata).
//   PNG   IHDR PLTE IDAT IEND tRNS cHRM gAMA iCCP sBIT sRGB cICP mDCV cLLI bKGD pHYs acTL fcTL fdAT; nothing after IEND.
//   WebP  VP8, VP8L, VP8X, ALPH, ANIM, ANMF, ICCP (the VP8X Exif / XMP flags cleared, the RIFF size rewritten).
// ORIENTATION is the one Exif fact a photo needs to display upright. When it is not 1 it is written back as a minimal
// Exif block holding that single tag and nothing else (no GPS IFD, no Exif IFD, no thumbnail): an APP1 in JPEG, an
// eXIf chunk in PNG, an EXIF chunk in WebP.
// Anything else is refused (UNSUPPORTED_FORMAT); a file that does not parse, or has no picture in it, is refused
// (CORRUPT). Never "best effort": a photo that cannot be proven clean is not stored.

const latin1 = new TextDecoder('latin1')
const text = (b, at, n) => latin1.decode(b.subarray(at, Math.max(at, Math.min(b.length, at + n))))
const startsWith = (b, at, s) => at + s.length <= b.length && text(b, at, s.length) === s

export function imageFormat(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length > 8 && b[0] === 0x89 && text(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length > 12 && text(b, 0, 4) === 'RIFF' && text(b, 8, 4) === 'WEBP') return 'webp'
  return null
}
export const FORMAT_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' }
export const FORMAT_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

class Out {
  constructor(n) { this.buf = new Uint8Array(n); this.len = 0 }
  push(bytes) {
    if (this.len + bytes.length > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + bytes.length))
      next.set(this.buf.subarray(0, this.len)); this.buf = next
    }
    this.buf.set(bytes, this.len); this.len += bytes.length
  }
  done() { return this.buf.slice(0, this.len) }
}
const fail = code => { throw new Error(code) }

// ─── Exif orientation, shared ───────────────────────────────────────────────
// payload: a TIFF block, optionally prefixed "Exif\0\0" (JPEG always, some PNG / WebP writers too). → 1..8, 1 if none.
function exifOrientation(payload) {
  const t = startsWith(payload, 0, 'Exif\0\0') ? 6 : 0
  if (payload.length < t + 8) return 1
  const le = payload[t] === 0x49
  if (!le && payload[t] !== 0x4d) return 1
  const u16 = p => (p >= 0 && p + 2 <= payload.length ? (le ? payload[p] | (payload[p + 1] << 8) : (payload[p] << 8) | payload[p + 1]) : -1)
  const u32 = p => (p >= 0 && p + 4 <= payload.length ? (le ? (payload[p] | (payload[p + 1] << 8) | (payload[p + 2] << 16)) + payload[p + 3] * 2 ** 24
    : payload[p] * 2 ** 24 + ((payload[p + 1] << 16) | (payload[p + 2] << 8) | payload[p + 3])) : -1)
  const ifd = t + u32(t + 4)
  const n = u16(ifd)
  if (ifd <= t || n < 0) return 1
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1 }
  }
  return 1
}
// A big-endian TIFF holding ONLY IFD0 with ONLY the orientation tag (26 bytes).
const orientationTiff = o => [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]
const isOrientationOnly = payload => {
  const t = startsWith(payload, 0, 'Exif\0\0') ? 6 : 0
  if (payload.length !== t + 26) return false
  const o = payload[t + 19]
  return o >= 1 && o <= 8 && orientationTiff(o).every((x, i) => payload[t + i] === x)
}

// ─── JPEG ───────────────────────────────────────────────────────────────────
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const JPEG_KEEP = new Set([...SOF, 0xc4, 0xcc, 0xdb, 0xdd, 0xda, 0xdc, 0xdf])   // + DHT DAC DQT DRI SOS DNL EXP
function keepJpegSegment(marker, seg) {
  if (marker === 0xe0) return startsWith(seg, 0, 'JFIF\0') || startsWith(seg, 0, 'JFXX\0')
  if (marker === 0xe2) return startsWith(seg, 0, 'ICC_PROFILE\0')
  if (marker === 0xee) return startsWith(seg, 0, 'Adobe')
  return JPEG_KEEP.has(marker)
}
const orientationApp1 = o => {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...orientationTiff(o)]
  const len = payload.length + 2
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...payload])
}

// Walks the whole file (segments, entropy-coded scans, more segments between progressive scans, up to EOI).
// visit(marker, payload, segmentBytes) for every length-carrying segment; raw(bytes) for scan data and RSTn.
// Returns the offset just past EOI.
function walkJpeg(b, visit, raw) {
  let p = 2
  let inScan = false
  while (p < b.length) {
    if (inScan) {
      const start = p
      while (p < b.length) {
        if (b[p] === 0xff) {
          const n = b[p + 1]
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { p += 2; continue }
          if (n === 0xff) { p++; continue }
          break
        }
        p++
      }
      raw(b.subarray(start, p))
      if (p >= b.length) fail('CORRUPT')
      inScan = false
    }
    if (b[p] !== 0xff) fail('CORRUPT')
    while (b[p] === 0xff) p++
    const m = b[p++]
    if (m === undefined) fail('CORRUPT')
    if (m === 0xd9) return p
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { if (m >= 0xd0) raw(Uint8Array.from([0xff, m])); continue }
    if (p + 2 > b.length) fail('CORRUPT')
    const len = (b[p] << 8) | b[p + 1]
    if (len < 2 || p + len > b.length) fail('CORRUPT')
    visit(m, b.subarray(p + 2, p + len), b.subarray(p - 2, p + len))
    p += len
    if (m === 0xda) inScan = true
  }
  fail('CORRUPT')
}

function stripJpeg(b) {
  let orientation = 1, sof = false, sos = false
  walkJpeg(b, (m, seg) => {
    if (orientation === 1 && m === 0xe1 && startsWith(seg, 0, 'Exif\0\0')) orientation = exifOrientation(seg)
    if (SOF.has(m)) sof = true
    if (m === 0xda) sos = true
  }, () => {})
  if (!sof || !sos) fail('CORRUPT')   // no picture in it
  const out = new Out(b.length)
  out.push(Uint8Array.from([0xff, 0xd8]))
  const removed = new Set()
  let wroteOrientation = false
  const flushOrientation = () => { if (!wroteOrientation && orientation !== 1) out.push(orientationApp1(orientation)); wroteOrientation = true }
  walkJpeg(b, (m, seg, bytes) => {
    if (keepJpegSegment(m, seg)) { if (m !== 0xe0) flushOrientation(); out.push(bytes) }
    else removed.add(m === 0xe1 ? (startsWith(seg, 0, 'Exif') ? 'exif' : 'xmp') : m === 0xfe ? 'comment' : `marker_${m.toString(16)}`)
  }, raw => out.push(raw))
  flushOrientation()
  out.push(Uint8Array.from([0xff, 0xd9]))
  return { bytes: out.done(), removed: [...removed], orientation }
}

// ─── PNG ────────────────────────────────────────────────────────────────────
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV',
  'cLLI', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT'])
const u32be = (b, p) => b[p] * 2 ** 24 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])
// visit(type, chunkBytes, data). Returns the offset just past IEND.
function walkPng(b, visit) {
  let p = 8
  while (p + 12 <= b.length) {
    const len = u32be(b, p)
    const type = text(b, p + 4, 4)
    const end = p + 12 + len
    if (end > b.length) fail('CORRUPT')
    visit(type, b.subarray(p, end), b.subarray(p + 8, p + 8 + len))
    p = end
    if (type === 'IEND') return p
  }
  fail('CORRUPT')
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const len = data.length
  out.set([len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255], 0)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let c = 0xffffffff
  for (let i = 4; i < 8 + len; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8)
  c = (c ^ 0xffffffff) >>> 0
  out.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255], 8 + len)
  return out
}
function stripPng(b) {
  let orientation = 1, ihdr = false, idat = false
  walkPng(b, (type, _, data) => {
    if (orientation === 1 && type.toLowerCase() === 'exif') orientation = exifOrientation(data)
    if (type === 'IHDR') ihdr = true
    if (type === 'IDAT') idat = true
  })
  if (!ihdr || !idat) fail('CORRUPT')
  const out = new Out(b.length)
  out.push(b.subarray(0, 8))
  const removed = new Set()
  let wrote = orientation === 1
  walkPng(b, (type, bytes) => {
    if (!PNG_KEEP.has(type)) { removed.add(type); return }
    // eXIf must come before the first IDAT.
    if (type === 'IDAT' && !wrote) { out.push(pngChunk('eXIf', Uint8Array.from(orientationTiff(orientation)))); wrote = true }
    out.push(bytes)
  })
  return { bytes: out.done(), removed: [...removed], orientation }
}

// ─── WebP ───────────────────────────────────────────────────────────────────
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP'])
const le32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
function walkWebp(b, visit) {
  const riffEnd = 8 + le32(b, 4)
  if (riffEnd > b.length || riffEnd < 20) fail('CORRUPT')
  let p = 12
  while (p + 8 <= riffEnd) {
    const id = text(b, p, 4)
    const size = le32(b, p + 4)
    if (p + 8 + size > riffEnd) fail('CORRUPT')
    const end = Math.min(p + 8 + size + (size & 1), riffEnd)
    visit(id, b.subarray(p, end), b.subarray(p + 8, p + 8 + size))
    p = end
  }
  if (p !== riffEnd) fail('CORRUPT')
}
function webpChunk(id, data) {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i)
  const n = data.length
  out.set([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24], 4)
  out.set(data, 8)
  return out
}
function stripWebp(b) {
  let orientation = 1, image = false, hasVp8x = false
  walkWebp(b, (id, _, data) => {
    if (orientation === 1 && id.toLowerCase() === 'exif') orientation = exifOrientation(data)
    if (id === 'VP8 ' || id === 'VP8L' || id === 'ANMF') image = true
    if (id === 'VP8X') hasVp8x = true
  })
  if (!image) fail('CORRUPT')
  if (!hasVp8x) orientation = 1   // only an extended (VP8X) file can carry Exif at all
  const chunks = []
  const removed = new Set()
  walkWebp(b, (id, bytes) => {
    if (!WEBP_KEEP.has(id)) { removed.add(id.trim()); return }
    if (id === 'VP8X') {
      const c = bytes.slice()
      c[8] = (c[8] & ~(0x08 | 0x04)) | (orientation !== 1 ? 0x08 : 0)   // XMP flag off; Exif flag only for the orientation block
      chunks.push(c); return
    }
    chunks.push(bytes)
  })
  if (orientation !== 1) chunks.push(webpChunk('EXIF', Uint8Array.from(orientationTiff(orientation))))
  const body = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(12 + body)
  out.set(b.subarray(0, 12))
  const size = 4 + body
  out.set([size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24], 4)
  let p = 12
  for (const c of chunks) { out.set(c, p); p += c.length }
  return { bytes: out, removed: [...removed], orientation }
}

// The clean copy. Throws UNSUPPORTED_FORMAT or CORRUPT.
export function stripImageMetadata(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const format = imageFormat(b)
  if (!format) fail('UNSUPPORTED_FORMAT')
  const r = format === 'jpeg' ? stripJpeg(b) : format === 'png' ? stripPng(b) : stripWebp(b)
  return { format, ...r }
}

// What a file still carries beyond the allow-list. [] = clean (an orientation-only Exif block counts as clean).
// gps: GPS found in what was flagged (a GPSInfo tag in Exif, GPS fields in XMP / text). Used to prove the function's
// output, by the daily bucket check, and by the backfill. It applies the same allow-lists as the stripper on purpose:
// "nothing outside the list" is the property; the tests prove the lists with an independent decoder (sharp).
export function metadataFound(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const format = imageFormat(b)
  if (!format) return { format: null, found: ['unsupported'], gps: false }
  const found = new Set()
  let gps = false
  // GPSInfo is tag 0x8825, so its bytes are searched as bytes: TextDecoder('latin1') is really windows-1252 and maps 0x88.
  const hasPair = (d, x, y) => { for (let i = 0; i + 1 < d.length; i++) if (d[i] === x && d[i + 1] === y) return true; return false }
  const look = data => {
    if (/GPS(Latitude|Longitude|Altitude|Position|Info)|exif:GPS/i.test(text(data, 0, data.length))
        || hasPair(data, 0x88, 0x25) || hasPair(data, 0x25, 0x88)) gps = true
  }
  try {
    if (format === 'jpeg') {
      const end = walkJpeg(b, (m, seg) => {
        if (keepJpegSegment(m, seg)) return
        if (m === 0xe1 && isOrientationOnly(seg)) return
        found.add(m === 0xe1 ? (startsWith(seg, 0, 'Exif') ? 'exif' : 'xmp') : m === 0xfe ? 'comment' : `marker_${m.toString(16)}`)
        look(seg)
      }, () => {})
      if (b.subarray(end).some(x => x !== 0)) { found.add('trailer'); look(b.subarray(end)) }
    } else if (format === 'png') {
      const end = walkPng(b, (type, _, data) => {
        if (PNG_KEEP.has(type)) return
        if (type === 'eXIf' && isOrientationOnly(data)) return
        found.add(type); look(data)
      })
      if (end < b.length) { found.add('trailer'); look(b.subarray(end)) }
    } else {
      walkWebp(b, (id, _, data) => {
        if (WEBP_KEEP.has(id)) return
        if (id === 'EXIF' && isOrientationOnly(data)) return
        found.add(id.trim()); look(data)
      })
      if (8 + le32(b, 4) < b.length) found.add('trailer')
    }
  } catch {
    found.add('corrupt')
  }
  return { format, found: [...found], gps }
}
