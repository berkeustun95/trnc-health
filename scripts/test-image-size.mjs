// supabase/functions/_shared/image-size.mjs against sharp's own reading of real encoder output, node only:
//   node scripts/test-image-size.mjs
import sharp from 'sharp'
import { imageSize, displaySize } from '../supabase/functions/_shared/image-size.mjs'

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }
const img = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } })

const CASES = [
  ['jpeg baseline', () => img(1600, 1200).jpeg({ quality: 80 }), 1600, 1200],
  ['jpeg progressive', () => img(1201, 1600).jpeg({ progressive: true }), 1201, 1600],
  ['jpeg with Exif first (SOF after APP1)', () => img(640, 480).withMetadata({ orientation: 6 }).jpeg(), 640, 480],
  ['png', () => img(1600, 900).png(), 1600, 900],
  ['png with alpha', () => sharp({ create: { width: 33, height: 77, channels: 4, background: '#0000' } }).png(), 33, 77],
  ['webp lossy (VP8)', () => img(1600, 1067).webp({ quality: 70 }), 1600, 1067],
  ['webp lossless (VP8L)', () => img(999, 501).webp({ lossless: true }), 999, 501],
  ['webp with Exif (VP8X)', () => img(1600, 1200).withMetadata({ orientation: 8 }).webp(), 1600, 1200],
]
for (const [name, make, w, h] of CASES) {
  const buf = await make().toBuffer()
  const m = await sharp(buf).metadata()
  const s = imageSize(new Uint8Array(buf))
  check(`${name}: ${w}x${h}`, s.width === w && s.height === h && m.width === w && m.height === h, { s, sharp: [m.width, m.height] })
}

const portrait = new Uint8Array(await img(1600, 1200).jpeg().toBuffer())
check('displaySize swaps for orientation 6', JSON.stringify(displaySize(portrait, 6)) === '{"width":1200,"height":1600}', displaySize(portrait, 6))
check('displaySize keeps orientation 1 and 3', displaySize(portrait, 1).width === 1600 && displaySize(portrait, 3).width === 1600)

const throws = (fn, code) => { try { fn(); return false } catch (e) { return e.message === code } }
check('not an image → UNSUPPORTED_FORMAT', throws(() => imageSize(new TextEncoder().encode('hello world, not an image')), 'UNSUPPORTED_FORMAT'))
check('truncated jpeg → CORRUPT', throws(() => imageSize(portrait.subarray(0, 40)), 'CORRUPT'))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
