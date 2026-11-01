// ─── Partner image pipeline — ONE copy for every partner mirror ──────────────
//
// Moved verbatim out of scripts/mirror-novest-images.mjs (2026-11-01) so mirror-dovec-images.mjs
// re-encodes with exactly the same settings. Two copies would drift; both would keep working.
import sharp from 'sharp'

// Egress, not aesthetics — identical to the Gişe Kıbrıs pipeline so both modules serve
// images at the same cost. The Supabase free tier shares 5 GB/month across everything.
export const MAX_WIDTH = 1200
export const JPEG_QUALITY = 80
export const OPTIMISE_FLOOR = 300 * 1024

export async function optimise(body, sourceExt) {
  if (body.length < OPTIMISE_FLOOR) return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  const img = sharp(body, { failOn: 'none' })
  const [m, stats] = await Promise.all([img.metadata(), img.stats()])
  // hasAlpha alone is not enough — plenty of PNGs carry a fully opaque alpha channel.
  const keepAlpha = m.hasAlpha === true && stats.isOpaque === false
  const pipeline = sharp(body, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
  const buffer = keepAlpha
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  if (buffer.length >= body.length) return { buffer: body, ext: sourceExt, contentType: null, skipped: true }
  return { buffer, ext: keepAlpha ? 'png' : 'jpg', contentType: keepAlpha ? 'image/png' : 'image/jpeg', skipped: false }
}
