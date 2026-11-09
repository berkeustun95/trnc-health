// ─── Pixel size of a JPEG / PNG / WebP, from its header ─────────────────────
//
// Used by marketplace-photo-review to record an approved photo's width/height (the app lays out by aspect ratio
// before the image arrives). Plain JS, Uint8Array only, no decoding — same shape as image-metadata.mjs, tested by
// scripts/test-image-size.mjs against sharp's own reading.
// displaySize() swaps for Exif orientations 5–8 (a 90° turn), so the numbers are what the viewer sees.
import { imageFormat } from './image-metadata.mjs'

const be16 = (b, p) => (b[p] << 8) | b[p + 1]
const le16 = (b, p) => b[p] | (b[p + 1] << 8)
const le24 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)
const be32 = (b, p) => b[p] * 2 ** 24 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const fail = () => { throw new Error('CORRUPT') }

function jpegSize(b) {
  let p = 2
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) fail()
    const m = b[p + 1]
    if (m === 0xff) { p++; continue }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue }
    const len = be16(b, p + 2)
    if (len < 2) fail()
    if (SOF.has(m)) {
      if (p + 9 > b.length) fail()
      return { width: be16(b, p + 7), height: be16(b, p + 5) }
    }
    if (m === 0xda || m === 0xd9) break
    p += 2 + len
  }
  fail()
}

function pngSize(b) {
  if (b.length < 24 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') fail()
  return { width: be32(b, 16), height: be32(b, 20) }
}

function webpSize(b) {
  const id = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (id === 'VP8X' && b.length >= 30) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
  if (id === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (id === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  }
  fail()
}

// Stored pixel size. Throws UNSUPPORTED_FORMAT or CORRUPT.
export function imageSize(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  const format = imageFormat(b)
  if (!format) throw new Error('UNSUPPORTED_FORMAT')
  const s = format === 'jpeg' ? jpegSize(b) : format === 'png' ? pngSize(b) : webpSize(b)
  if (!(s.width > 0 && s.height > 0)) fail()
  return s
}

export function displaySize(input, orientation = 1) {
  const s = imageSize(input)
  return orientation >= 5 && orientation <= 8 ? { width: s.height, height: s.width } : s
}
