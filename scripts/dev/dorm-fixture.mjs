#!/usr/bin/env node
// ─── Dorm showcase MAXIMUM-CONTENT fixture — local only, never committed ────
//
//   node scripts/dev/dorm-fixture.mjs --apply     fill every null field
//   node scripts/dev/dorm-fixture.mjs --revert    put it back
//
// WHY THIS EXISTS. Every optional section of the showcase collapses when its data is
// absent, and Özok has delivered nothing — so the page has only ever been seen in its
// EMPTY state. Null-safe design hides crowding; it does not prevent it. The first time
// anybody sees this screen at full content must not be the day a real partner is on it.
//
// ⚠ THE VALUES ARE DELIBERATELY, VISIBLY FAKE. Not plausible — fake. Prices are 9999,
//   sizes are 999 m², the brand colour is magenta, every string starts ZZ. The screen may
//   be recorded during the pass, and anything that reads as real Özok pricing must not be
//   able to leave the device by accident. A plausible fixture is a leak waiting for a
//   screenshot.
//
// ⚠ THIS MUST NEVER BE COMMITTED, AND THREE THINGS STOP IT:
//     1. --apply wraps its edit in ZZ-DORM-FIXTURE markers
//     2. scripts/check-dorms.mjs FAILS HARD if a marker is present
//     3. .githooks/pre-commit runs that guard, so `git commit` is refused
//   The generated images live under assets/partners/_fixture/, which is gitignored.
//
// The images are written by a minimal PNG encoder below rather than committed, so nothing
// binary and nothing resembling a real photograph ever enters the repo.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CONFIG = resolve(ROOT, 'constants/dorms.js')
const MAP    = resolve(ROOT, 'constants/partnerAssets.js')
const IMGDIR = resolve(ROOT, 'assets/partners/_fixture')
const START  = '/* ZZ-DORM-FIXTURE-START — local only, never commit. scripts/dev/dorm-fixture.mjs */'
const END    = '/* ZZ-DORM-FIXTURE-END */'

// ─── A minimal PNG encoder ──────────────────────────────────────────────────
// Solid colour, no dependencies. Enough to occupy the gallery at a known size so the
// container's aspect can be measured against a real decoded image.
function png(w, h, [r, g, b]) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = buf => {
    let c = 0xFFFFFFFF
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(w).fill(Buffer.from([r, g, b])))])
  const raw = Buffer.concat(Array(h).fill(row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── The fixture ────────────────────────────────────────────────────────────
// Every field that is null or [] in the committed config, filled. Deliberately at or past
// the plausible maximum — six amenities, six services, seven ring times, four events —
// because the question is what CROWDS, and a fixture at the comfortable size answers
// nothing.
const FIXTURE = `${START}
    coords: { latitude: 35.1856, longitude: 33.3823 },   // Lefkoşa centre — NOT Alasia's real pin
    accent: '#FF00FF',                                    // magenta: obviously fake, and it is the
                                                          // contrast question the teal fallback hides
    priceFrom: { amount: 9999, currency: 'EUR', periodKey: 'dormRoomPrice' },
    deal: { textKey: 'zzFixtureDeal', expiry: '2099-12-31' },
    gallery: ['_fixture/g1', '_fixture/g2', '_fixture/g3'],
    amenities: [
      { icon: 'wifi-outline', labelKey: 'zzFixtureA1' }, { icon: 'barbell-outline', labelKey: 'zzFixtureA2' },
      { icon: 'restaurant-outline', labelKey: 'zzFixtureA3' }, { icon: 'car-outline', labelKey: 'zzFixtureA4' },
      { icon: 'shirt-outline', labelKey: 'zzFixtureA5' }, { icon: 'shield-outline', labelKey: 'zzFixtureA6' },
    ],
    servicesIncluded: [
      { labelKey: 'zzFixtureS1' }, { labelKey: 'zzFixtureS2' }, { labelKey: 'zzFixtureS3' },
    ],
    servicesExtra: [
      { labelKey: 'zzFixtureS4' }, { labelKey: 'zzFixtureS5' }, { labelKey: 'zzFixtureS6' },
    ],
    ringTimes: [
      { labelKey: 'zzFixtureR1', times: '99:99 · 99:99 · 99:99' },
      { labelKey: 'zzFixtureR2', times: '99:99 · 99:99' },
      { labelKey: 'zzFixtureR3', times: '99:99 · 99:99 · 99:99 · 99:99' },
    ],
    events: [
      { titleKey: 'zzFixtureE1', date: '99/99' }, { titleKey: 'zzFixtureE2', date: '99/99' },
      { titleKey: 'zzFixtureE3', date: '99/99' },
    ],
${END}`

const ROOM_FIELDS = `price: 9999, sqm: 999, available: true`

function apply() {
  let s = readFileSync(CONFIG, 'utf8')
  if (s.includes(START)) { console.error('  already applied — run --revert first'); process.exit(1) }

  // Anchor on the id line so the block lands inside the partner object.
  const anchor = "    slug: 'alasia-dorm',"
  if (!s.includes(anchor)) { console.error(`  anchor not found: ${anchor}`); process.exit(1) }
  s = s.replace(anchor, `${anchor}\n${FIXTURE}`)

  // Fill every room. The committed rooms all carry the same null triple.
  const before = (s.match(/price: null, sqm: null, available: null/g) || []).length
  if (before !== 6) { console.error(`  expected 6 null room triples, found ${before}`); process.exit(1) }
  s = s.replaceAll('price: null, sqm: null, available: null', ROOM_FIELDS)

  writeFileSync(CONFIG, s)

  // Gallery images. 1600x900 = 16:9, matching what DormPartnerScreen hardcodes, so any
  // crop seen on device is the CONTAINER's doing and not a source mismatch.
  mkdirSync(IMGDIR, { recursive: true })
  const cols = [[255, 0, 255], [0, 255, 255], [255, 255, 0]]
  cols.forEach((c, i) => writeFileSync(resolve(IMGDIR, `g${i + 1}.png`), png(1600, 900, c)))
  writeFileSync(resolve(IMGDIR, 'logo.png'), png(1600, 455, [255, 0, 255]))
  writeFileSync(resolve(IMGDIR, 'logo-onDark.png'), png(1600, 455, [0, 255, 255]))

  // Wire them into the asset map, inside markers so the guard sees them too.
  let m = readFileSync(MAP, 'utf8')
  const mapAnchor = "export const PARTNER_ASSETS = {"
  m = m.replace(mapAnchor, `${mapAnchor}\n${START}\n`
    + `  '_fixture/g1': require('../assets/partners/_fixture/g1.png'),\n`
    + `  '_fixture/g2': require('../assets/partners/_fixture/g2.png'),\n`
    + `  '_fixture/g3': require('../assets/partners/_fixture/g3.png'),\n`
    + `  'alasia/logo': require('../assets/partners/_fixture/logo.png'),\n`
    + `  'alasia/logo-onDark': require('../assets/partners/_fixture/logo-onDark.png'),\n`
    + `${END}`)
  writeFileSync(MAP, m)

  console.log('  fixture APPLIED. constants/dorms.js and constants/partnerAssets.js are now dirty.')
  console.log('  Flip DORMS_LIVE locally, look at the screen, then:')
  console.log('    node scripts/dev/dorm-fixture.mjs --revert')
  console.log('  npm run dorms:check will FAIL until you do — that is the guard, not a bug.')
}

function revert() {
  for (const f of [CONFIG, MAP]) {
    let s = readFileSync(f, 'utf8')
    const i = s.indexOf(START)
    if (i === -1) continue
    const j = s.indexOf(END, i)
    if (j === -1) { console.error(`  ${f}: START without END — refusing to guess. Fix by hand.`); process.exit(1) }
    // Take the newline before the marker too, so no blank line is left behind.
    const from = s.lastIndexOf('\n', i)
    s = s.slice(0, from) + s.slice(j + END.length)
    writeFileSync(f, s)
  }
  let s = readFileSync(CONFIG, 'utf8')
  s = s.replaceAll(ROOM_FIELDS, 'price: null, sqm: null, available: null')
  writeFileSync(CONFIG, s)
  if (existsSync(IMGDIR)) rmSync(IMGDIR, { recursive: true, force: true })
  console.log('  fixture REVERTED. Confirm with: git diff --stat && npm run dorms:check')
}

const mode = process.argv[2]
if (mode === '--apply') apply()
else if (mode === '--revert') revert()
else { console.error('  usage: dorm-fixture.mjs --apply | --revert'); process.exit(1) }
