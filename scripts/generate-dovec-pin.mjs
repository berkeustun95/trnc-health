#!/usr/bin/env node
// Generates the Döveç project map pin: assets/map-pins/dovec@2x.png and @3x.png (32 x 32 pt).
//
//   node scripts/generate-dovec-pin.mjs
//
// WHY A BITMAP, NOT A VIEW MARKER. The pin was first a <Marker> with a child View. On Android,
// react-native-maps draws such a marker from a snapshot and hit-tests it from that snapshot, so the
// first tap could land before the snapshot existed and register late (seen on the test phone,
// 2026-11-01). A Marker with `image` is a native bitmap from the first frame: the first tap opens
// the pin, and there is no tracksViewChanges window to manage. Same shape as before: an ADA-teal
// rounded square (never the round, numbered cluster bubble) with a white border and a white
// building glyph. Colours are the theme's: colors.primary #0E7C7B.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/map-pins')
mkdirSync(OUT, { recursive: true })

// Drawn on a 40 pt canvas (32 pt badge + room for the shadow), then rendered at 2x and 3x.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#1A2B33" flood-opacity="0.28"/></filter></defs>
  <rect x="4" y="3" width="32" height="32" rx="9" fill="#0E7C7B" stroke="#FFFFFF" stroke-width="2.5" filter="url(#sh)"/>
  <g fill="#FFFFFF">
    <rect x="12.5" y="10.5" width="10" height="17" rx="1"/>
    <rect x="23.5" y="16" width="5" height="11.5" rx="1"/>
  </g>
  <g fill="#0E7C7B">
    <rect x="14.5" y="12.5" width="2.2" height="2.2"/><rect x="18.3" y="12.5" width="2.2" height="2.2"/>
    <rect x="14.5" y="16.5" width="2.2" height="2.2"/><rect x="18.3" y="16.5" width="2.2" height="2.2"/>
    <rect x="14.5" y="20.5" width="2.2" height="2.2"/><rect x="18.3" y="20.5" width="2.2" height="2.2"/>
    <rect x="16.3" y="24" width="2.4" height="3.5"/>
    <rect x="25" y="18.5" width="2" height="2"/><rect x="25" y="22" width="2" height="2"/>
  </g>
</svg>`

for (const scale of [2, 3]) {
  const file = resolve(OUT, `dovec@${scale}x.png`)
  await sharp(Buffer.from(svg), { density: 72 * scale }).png({ compressionLevel: 9 }).toFile(file)
  console.log(file)
}
