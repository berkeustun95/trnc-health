// ─── Strip every piece of metadata from a JPEG / PNG / WebP, byte level ─────
//
// Shared by the vehicle-photo edge function (Deno: every new car photo passes through it before it is stored),
// scripts/strip-vehicle-photo-metadata.mjs (Node: the backfill and the daily check) and scripts/test-image-metadata.mjs.
// Plain JS, Uint8Array only, no dependencies, no decoding: the pixels are copied untouched, so there is no
// re-compression and no quality loss. Berke, 2026-11-08: "strip location data (all EXIF) from car photos on the
// server", a go-live gate for private car listings.
//
// What survives, and why:
//   JPEG  APP0 JFIF/JFXX, APP2 ICC_PROFILE (colour), APP14 Adobe (colour transform: dropping it can swap colours),
//         and every non-APP segment. APP1 (Exif, XMP), APP13 (IPTC/Photoshop), the other APPn, COM, and anything after
//         EOI (an iPhone's MPF gain map / depth image, which carries its own metadata) are dropped. The orientation tag
//         is the one Exif fact a photo needs to display upright, so when it is not 1 it is put back as a minimal Exif
//         block holding that single tag and nothing else (no GPS IFD, no Exif IFD, no thumbnail).
//   PNG   every chunk except eXIf, tEXt, zTXt, iTXt and tIME; nothing after IEND.
//   WebP  every chunk except EXIF and XMP (the VP8X flags for them are cleared, the RIFF size rewritten).
// Anything else is refused (UNSUPPORTED_FORMAT); a file that does not parse is refused (CORRUPT). Never "best effort":
// a photo that cannot be proven clean is not stored.

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n))
const startsWith = (b, at, s) => at + s.length <= b.length && ascii(b, at, s.length) === s

export function imageFormat(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
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

// ─── JPEG ───────────────────────────────────────────────────────────────────
// Exif orientation (tag 0x0112 in IFD0), or 1. seg = the APP1 payload (after the 2 length bytes).
function exifOrientation(seg) {
  if (!startsWith(seg, 0, 'Exif\0\0') || seg.length < 14) return 1
  const t = 6
  const le = seg[t] === 0x49
  if (!le && seg[t] !== 0x4d) return 1
  const u16 = p => (p + 2 <= seg.length ? (le ? seg[p] | (seg[p + 1] << 8) : (seg[p] << 8) | seg[p + 1]) : -1)
  const u32 = p => (p + 4 <= seg.length ? (le ? (seg[p] | (seg[p + 1] << 8) | (seg[p + 2] << 16)) + seg[p + 3] * 2 ** 24
    : seg[p] * 2 ** 24 + ((seg[p + 1] << 16) | (seg[p + 2] << 8) | seg[p + 3])) : -1)
  const ifd = t + u32(t + 4)
  const n = u16(ifd)
  if (ifd <= t || n < 0) return 1
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1 }
  }
  return 1
}
// APP1 holding ONLY IFD0 with ONLY the orientation tag. Big-endian TIFF.
function orientationApp1(o) {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]
  const len = payload.length + 2
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...payload])
}
const isMinimalOrientationExif = seg =>
  seg.length === 32 && startsWith(seg, 0, 'Exif\0\0') && seg[6] === 0x4d && seg[14] === 0 && seg[15] === 1 && seg[16] === 0x01 && seg[17] === 0x12

function keepJpegSegment(marker, seg) {
  if (marker === 0xe0) return startsWith(seg, 0, 'JFIF\0') || startsWith(seg, 0, 'JFXX\0')
  if (marker === 0xe2) return startsWith(seg, 0, 'ICC_PROFILE\0')
  if (marker === 0xee) return startsWith(seg, 0, 'Adobe')
  if (marker >= 0xe0 && marker <= 0xef) return false   // APP1 Exif/XMP, APP13 IPTC, the rest
  if (marker === 0xfe) return false                      // COM
  return true
}

// Walks the whole file (segments, then entropy-coded scans, more segments for progressive JPEGs, up to EOI).
// visit(marker, segPayload, segBytes) is called for every length-carrying segment; scan data is passed to raw().
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
    if (m === 0xd9) return true                                       // EOI: the end; whatever follows is dropped
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { raw(Uint8Array.from([0xff, m])); continue }
    if (p + 2 > b.length) fail('CORRUPT')
    const len = (b[p] << 8) | b[p + 1]
    if (len < 2 || p + len > b.length) fail('CORRUPT')
    visit(m, b.subarray(p + 2, p + len), b.subarray(p - 2, p + len))
    p += len
    if (m === 0xda) inScan = true
  }
  fail('CORRUPT')   // no EOI
}

function stripJpeg(b) {
  const out = new Out(b.length)
  out.push(Uint8Array.from([0xff, 0xd8]))
  // Pass 1: the orientation, wherever the Exif block sits. Pass 2 writes it before the first segment after JFIF.
  let orientation = 1
  walkJpeg(b, (m, seg) => { if (orientation === 1 && m === 0xe1 && startsWith(seg, 0, 'Exif\0\0')) orientation = exifOrientation(seg) }, () => {})
  let wroteOrientation = false
  const removed = new Set()
  const flushOrientation = () => {
    if (!wroteOrientation && orientation !== 1) out.push(orientationApp1(orientation))
    wroteOrientation = true
  }
  walkJpeg(b, (m, seg, bytes) => {
    if (keepJpegSegment(m, seg)) {
      if (m !== 0xe0) flushOrientation()                   // after JFIF (which must come first), before everything else
      out.push(bytes)
    } else {
      removed.add(m === 0xe1 ? (startsWith(seg, 0, 'Exif') ? 'exif' : 'xmp') : m === 0xfe ? 'comment' : `app${m - 0xe0}`)
    }
  }, raw => out.push(raw))
  flushOrientation()
  out.push(Uint8Array.from([0xff, 0xd9]))
  return { bytes: out.done(), removed: [...removed], orientation }
}

// ─── PNG ────────────────────────────────────────────────────────────────────
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])
function walkPng(b, visit) {
  let p = 8
  while (p + 12 <= b.length) {
    const len = b[p] * 2 ** 24 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])
    const type = ascii(b, p + 4, 4)
    const end = p + 12 + len
    if (end > b.length) fail('CORRUPT')
    visit(type, b.subarray(p, end))
    if (type === 'IEND') return
    p = end
  }
  fail('CORRUPT')
}
function stripPng(b) {
  const out = new Out(b.length)
  out.push(b.subarray(0, 8))
  const removed = new Set()
  walkPng(b, (type, bytes) => { if (PNG_DROP.has(type)) removed.add(type); else out.push(bytes) })
  return { bytes: out.done(), removed: [...removed], orientation: 1 }
}

// ─── WebP ───────────────────────────────────────────────────────────────────
const le32 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24 >>> 0)
function walkWebp(b, visit) {
  const riffEnd = 8 + (le32(b, 4) >>> 0)
  if (riffEnd > b.length || riffEnd < 12) fail('CORRUPT')
  let p = 12
  while (p + 8 <= riffEnd) {
    const id = ascii(b, p, 4)
    const size = le32(b, p + 4) >>> 0
    const end = p + 8 + size + (size & 1)
    if (p + 8 + size > riffEnd) fail('CORRUPT')
    visit(id, b.subarray(p, Math.min(end, riffEnd)))
    p = end
  }
}
function stripWebp(b) {
  const chunks = []
  const removed = new Set()
  walkWebp(b, (id, bytes) => {
    if (id === 'EXIF' || id === 'XMP ') { removed.add(id.trim().toLowerCase()); return }
    if (id === 'VP8X') { const c = bytes.slice(); c[8] &= ~(0x08 | 0x04); chunks.push(c); return }
    chunks.push(bytes)
  })
  const body = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(12 + body)
  out.set(b.subarray(0, 12))
  const size = 4 + body
  out[4] = size & 0xff; out[5] = (size >> 8) & 0xff; out[6] = (size >> 16) & 0xff; out[7] = (size >>> 24) & 0xff
  let p = 12
  for (const c of chunks) { out.set(c, p); p += c.length }
  return { bytes: out, removed: [...removed], orientation: 1 }
}

// The clean copy. Throws UNSUPPORTED_FORMAT or CORRUPT.
export function stripImageMetadata(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const format = imageFormat(b)
  if (!format) fail('UNSUPPORTED_FORMAT')
  const r = format === 'jpeg' ? stripJpeg(b) : format === 'png' ? stripPng(b) : stripWebp(b)
  return { format, ...r }
}

// What metadata a file still carries. [] = clean (the minimal orientation-only Exif counts as clean).
// gps: a GPS IFD pointer in Exif, or GPS fields in XMP. Used to prove the output and to scan the bucket.
export function metadataFound(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const format = imageFormat(b)
  if (!format) return { format: null, found: ['unsupported'], gps: false }
  const found = new Set()
  let gps = false
  const textHasGps = s => /GPS(Latitude|Longitude|Altitude|Position)|exif:GPS/i.test(s)
  const exifHasGps = s => s.includes('\x88\x25') || s.includes('\x25\x88')   // tag 0x8825 GPSInfo, either byte order
  try {
    if (format === 'jpeg') {
      walkJpeg(b, (m, seg) => {
        if (keepJpegSegment(m, seg)) return
        if (m === 0xe1 && isMinimalOrientationExif(seg)) return
        const s = ascii(seg, 0, Math.min(seg.length, 65535))
        if (m === 0xe1) { found.add(startsWith(seg, 0, 'Exif') ? 'exif' : 'xmp'); if (exifHasGps(s) || textHasGps(s)) gps = true }
        else found.add(m === 0xfe ? 'comment' : `app${m - 0xe0}`)
        if (textHasGps(s)) gps = true
      }, () => {})
      // Bytes after the EOI that ends the primary image (a second image with its own Exif) are metadata too.
      if (hasTrailer(b)) found.add('trailer')
    } else if (format === 'png') {
      walkPng(b, (type, bytes) => {
        if (PNG_DROP.has(type)) { found.add(type); const t = ascii(bytes, 8, bytes.length - 12); if (textHasGps(t) || (type === 'eXIf' && exifHasGps(t))) gps = true }
      })
    } else {
      walkWebp(b, (id, bytes) => {
        if (id === 'EXIF' || id === 'XMP ') { found.add(id.trim().toLowerCase()); const s = ascii(bytes, 8, bytes.length - 8); if (exifHasGps(s) || textHasGps(s)) gps = true }
      })
    }
  } catch {
    found.add('corrupt')
  }
  return { format, found: [...found], gps }
}

// True when bytes follow the EOI that ends the primary image (walked, not guessed).
function hasTrailer(b) {
  let endAt = -1
  try {
    let p = 2, inScan = false
    while (p < b.length) {
      if (inScan) {
        while (p < b.length) {
          if (b[p] === 0xff) { const n = b[p + 1]; if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { p += 2; continue } if (n === 0xff) { p++; continue } break }
          p++
        }
        inScan = false
      }
      while (b[p] === 0xff) p++
      const m = b[p++]
      if (m === 0xd9) { endAt = p; break }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) continue
      const len = (b[p] << 8) | b[p + 1]
      p += len
      if (m === 0xda) inScan = true
    }
  } catch { return false }
  if (endAt < 0) return false
  for (let i = endAt; i < b.length; i++) if (b[i] !== 0) return true
  return false
}
