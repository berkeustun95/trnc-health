#!/usr/bin/env node
// ─── Base C page-ground PNGs (components/ui/PageCanvas.js, FloatingTabBar) ───
//
//   node scripts/generate-page-canvas.mjs           # write the PNGs
//   node scripts/generate-page-canvas.mjs --check   # verify they match the tokens, write nothing
//
// Gradients ship as stretched PNGs, not expo-linear-gradient (a native module), so they reach
// users by OTA. Colours and geometry come from constants/theme.js; there is no copy here.
//
// Each row is error-diffused to 8 bits (one dimension, top to bottom): pageTop → pageMid moves
// 25 levels of red over 260pt, and plain rounding draws visible steps on an OLED panel.
//
//   assets/page-canvas/base.png        opaque, pageTop → pageMid → pageBase over gradient.endAt
//   assets/page-canvas/group-fade.png  white, alpha from → mid → 0 over groupFade.endAt; tinted
//                                      to category[group].ink by PageCanvas (Image tintColor)
//   assets/oli-scenes/canvas-fade.png  pageBase, alpha 0 → 1 (the tab bar's fade)
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { colors, pageCanvas } from '../constants/theme.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PX_PER_PT = 3
const W = 4

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const lerp = (a, b, t) => a + (b - a) * t

// rows: [channel values 0..255 as floats] per row → dithered RGBA buffer, W pixels wide
function bake(rows, channels) {
  const buf = Buffer.alloc(rows.length * W * channels)
  const err = new Array(channels).fill(0)
  rows.forEach((row, y) => {
    const px = row.map((v, c) => {
      const q = Math.max(0, Math.min(255, Math.round(v + err[c])))
      err[c] += v - q
      return q
    })
    for (let x = 0; x < W; x++) px.forEach((v, c) => { buf[(y * W + x) * channels + c] = v })
  })
  return { buf, height: rows.length, channels }
}

function baseRows() {
  const { midAt, endAt } = pageCanvas.gradient
  const [top, mid, base] = [colors.pageTop, colors.pageMid, colors.pageBase].map(rgb)
  return Array.from({ length: endAt * PX_PER_PT }, (_, y) => {
    const pt = (y + 0.5) / PX_PER_PT
    return pt < midAt
      ? top.map((v, c) => lerp(v, mid[c], pt / midAt))
      : mid.map((v, c) => lerp(v, base[c], (pt - midAt) / (endAt - midAt)))
  })
}

function groupFadeRows() {
  const { from, mid, midAt, endAt } = pageCanvas.groupFade
  return Array.from({ length: endAt * PX_PER_PT }, (_, y) => {
    const pt = (y + 0.5) / PX_PER_PT
    const a = pt < midAt ? lerp(from, mid, pt / midAt) : lerp(mid, 0, (pt - midAt) / (endAt - midAt))
    return [255, 255, 255, a * 255]
  })
}

function tabFadeRows() {
  const base = rgb(colors.pageBase)
  return Array.from({ length: 256 }, (_, y) => [...base, (y / 255) * 255])
}

const OUT = [
  { path: 'assets/page-canvas/base.png',       img: bake(baseRows(), 3) },
  { path: 'assets/page-canvas/group-fade.png', img: bake(groupFadeRows(), 4) },
  { path: 'assets/oli-scenes/canvas-fade.png', img: bake(tabFadeRows(), 4) },
]

const check = process.argv.includes('--check')
let bad = 0
for (const { path, img } of OUT) {
  const file = resolve(ROOT, path)
  const raw = { raw: { width: W, height: img.height, channels: img.channels } }
  if (check) {
    let have
    try { have = await sharp(file).raw().toBuffer({ resolveWithObject: true }) } catch (e) {
      console.log(`✗ ${path}: ${e.message}`); bad++; continue
    }
    const same = have.info.width === W && have.info.height === img.height
      && have.info.channels === img.channels && have.data.equals(img.buf)
    console.log(`${same ? '✓' : '✗'} ${path} (${have.info.width}×${have.info.height}×${have.info.channels}, want ${W}×${img.height}×${img.channels})`)
    if (!same) bad++
  } else {
    writeFileSync(file, await sharp(img.buf, raw).png({ compressionLevel: 9 }).toBuffer())
    console.log(`wrote ${path} (${W}×${img.height})`)
  }
}
if (bad) { console.error(`${bad} file(s) stale: run node scripts/generate-page-canvas.mjs`); process.exit(1) }
