// Minimal PNG reader for the logo checks: 8-bit RGBA (colour type 6), non-interlaced, all five filter types. Node built-ins only.
import { inflateSync } from 'node:zlib'

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let p = 8, w = 0, h = 0, depth = 0, colorType = -1, interlace = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; colorType = d[9]; interlace = d[12] }
    else if (type === 'IDAT') idat.push(d)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const info = { width: w, height: h, depth, colorType, interlace }
  if (colorType !== 6 || depth !== 8 || interlace !== 0) return { ...info, data: null }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0
      const b = y > 0 ? out[dst - stride + x] : 0
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[dst + x] = v & 255
    }
  }
  return { ...info, data: out }
}

// Box-average the alpha plane and the alpha-weighted mean RGB down to w x h (area average over each source block).
export function boxAlpha(img, w, h) {
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * img.height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.height / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * img.width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.width / w))
      let s = 0, n = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += img.data[(yy * img.width + xx) * 4 + 3]; n++ }
      out[y * w + x] = s / n
    }
  }
  return out
}

// Mean RGB of pixels with alpha >= 200 (the solid artwork).
export function meanOpaqueRgb(img) {
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] >= 200) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++ }
  return n ? [r / n, g / n, b / n] : [0, 0, 0]
}
