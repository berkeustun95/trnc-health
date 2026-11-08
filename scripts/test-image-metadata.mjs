// supabase/functions/_shared/image-metadata.mjs against real encoder output, node only:
//   node scripts/test-image-metadata.mjs
// sharp (libvips) is the independent party: it WRITES photos with GPS Exif / XMP the way a phone would, and READS the
// stripped result back, so the stripper is not graded by its own parser. Each check is red-first: the unstripped input
// must show the metadata before the stripped output may show none. The pixels must decode identically afterwards
// (no re-encode), and an iPhone-style rotated photo must stay rotated.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { stripImageMetadata, metadataFound, imageFormat } from '../supabase/functions/_shared/image-metadata.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(got)}`}`) }

// A real car photo from the repo (CC0, data/araclar-preview), re-written with the metadata a phone adds.
const car = readFileSync(resolve(ROOT, 'data/araclar-preview/3c1e2f6a-6b7d-4f0e-9a51-0e7c2b8d4a01.jpg'))
const GPS = { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 20/1 1234/100', GPSLongitudeRef: 'E', GPSLongitude: '33/1 19/1 4321/100' } }
const EXIF = { IFD0: { Make: 'Apple', Model: 'iPhone 15', Software: 'ADA-test' }, ...GPS }
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="35,20.2N" exif:GPSLongitude="33,19.7E"/></rdf:RDF></x:xmpmeta>'
const pixels = async buf => (await sharp(buf).raw().toBuffer()).toString('base64')

async function roundTrip(label, input, { orientation } = {}) {
  const before = metadataFound(input)
  const mBefore = await sharp(input).metadata()
  check(`${label}: the input really carries metadata (red first)`, before.found.length > 0 && before.gps === true && !!(mBefore.exif || mBefore.xmp), { before, exif: !!mBefore.exif })
  const out = stripImageMetadata(input)
  const after = metadataFound(out.bytes)
  const m = await sharp(out.bytes).metadata()
  check(`${label}: nothing left by our scan`, after.found.length === 0 && after.gps === false, after)
  check(`${label}: libvips sees no XMP, and no Exif beyond the orientation`, !m.xmp && (!m.exif || (orientation && m.exif.length < 40)), { exif: m.exif?.length, xmp: !!m.xmp })
  // Distinctive strings only: short ones ('GPS', the 88 25 tag bytes) occur by chance inside a megabyte of compressed pixels.
  const text = Buffer.from(out.bytes).toString('latin1')
  check(`${label}: no metadata text left (Apple, iPhone, xmpmeta, the coordinates)`, !/Apple|iPhone|ADA-test|xmpmeta|GPSLatitude|35,20/.test(text)
    && (text.split('Exif').length - 1) === (orientation ? 1 : 0), null)
  check(`${label}: same format`, imageFormat(out.bytes) === out.format && out.format === imageFormat(input))
  check(`${label}: pixels identical (no re-encode)`, await pixels(out.bytes) === await pixels(input))
  if (orientation) check(`${label}: orientation ${orientation} kept`, m.orientation === orientation, m.orientation)
  else check(`${label}: no orientation invented`, !m.orientation || m.orientation === 1, m.orientation)
  check(`${label}: stripping twice changes nothing`, Buffer.compare(Buffer.from(stripImageMetadata(out.bytes).bytes), Buffer.from(out.bytes)) === 0)
  return out
}

// JPEG, like a phone: Exif (make, model, GPS) + XMP with GPS, rotated 90° (orientation 6).
const jpeg = await sharp(car).withExif(EXIF).withXmp(XMP).withMetadata({ orientation: 6 }).jpeg({ quality: 85 }).toBuffer()
await roundTrip('JPEG + Exif GPS + XMP, rotated', jpeg, { orientation: 6 })
// JPEG upright: orientation 1 must not produce an Exif block at all.
const upright = await sharp(car).withExif(EXIF).jpeg({ quality: 85 }).toBuffer()
const up = await roundTrip('JPEG + Exif GPS, upright', upright)
check('upright JPEG: no APP1 written', !Buffer.from(up.bytes).includes(Buffer.from([0xff, 0xe1])))
// A comment and a trailing second image (iPhone MPF gain map style) are dropped too.
const withTrailer = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xfe, 0, 9]), Buffer.from('GPS 35N'), jpeg.subarray(2), jpeg])
const tr = stripImageMetadata(withTrailer)
check('JPEG trailer + COM: reported before', ['comment', 'trailer'].every(k => metadataFound(withTrailer).found.includes(k)), metadataFound(withTrailer))
check('JPEG trailer + COM: gone after', metadataFound(tr.bytes).found.length === 0 && tr.bytes.length < jpeg.length, metadataFound(tr.bytes))
// PNG and WebP with Exif GPS.
await roundTrip('PNG + Exif GPS', await sharp(car).withExif(EXIF).withXmp(XMP).png().toBuffer())
await roundTrip('WebP + Exif GPS + XMP', await sharp(car).withExif(EXIF).withXmp(XMP).webp({ lossless: true }).toBuffer())

// Refusals: never "best effort".
const refuses = (label, bytes, code) => { try { stripImageMetadata(bytes); check(label, false, 'no throw') } catch (e) { check(label, e.message === code, e.message) } }
refuses('HEIC / anything else is refused', Buffer.from('....ftypheic........'), 'UNSUPPORTED_FORMAT')
refuses('a truncated JPEG is refused', jpeg.subarray(0, 600), 'CORRUPT')
refuses('a JPEG with no EOI is refused', jpeg.subarray(0, jpeg.length - 2), 'CORRUPT')
refuses('empty input is refused', new Uint8Array(0), 'UNSUPPORTED_FORMAT')

// The seed photos already in the bucket are clean (sharp stripped them when they were made).
check('seed photo is already clean', metadataFound(car).found.length === 0, metadataFound(car))

console.log(bad ? `image metadata: ${bad} FAILED` : 'image metadata: OK')
process.exit(bad ? 1 : 0)
