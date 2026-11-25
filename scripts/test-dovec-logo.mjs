// Döveç logo files, node only:  node scripts/test-dovec-logo.mjs   (LOGO_DIR=<dir> points the app files elsewhere, for red-first runs)
// Always: the bundled files keep the delivered 2781:1022 aspect and are 8-bit RGBA. When the originals sit in ~/Downloads:
// same artwork, only the size differs (alpha and mean colour match the box-downsampled original). Nothing from ~/Downloads is committed.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { decodePng, boxAlpha, meanOpaqueRgb } from './lib/png-rgba.mjs'

let fail = 0
const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`) }

const dir = process.env.LOGO_DIR || fileURLToPath(new URL('../assets/partners/dovec/', import.meta.url))
const ORIG = { w: 2781, h: 1022 }
const FILES = [
  { app: 'dovec-logo-navy.png', orig: 'Dovec-logo-lacivert.png', sha: '58324b977fe242bbce4c508d6f6ad4e9aec8b79ce16d13481e1419521d93e12d' },
  { app: 'dovec-logo-white.png', orig: 'Dovec-logo-beyaz.png', sha: '8d3068f6ee1e7b118113da63ca021651e8e069b4d1c34b673e667d428b734249' },
]

for (const f of FILES) {
  const img = decodePng(readFileSync(dir + f.app))
  check(`${f.app}: 8-bit RGBA, non-interlaced`, img.colorType === 6 && img.depth === 8 && img.data !== null, `colorType ${img.colorType} depth ${img.depth}`)
  if (!img.data) continue
  check(`${f.app}: aspect 2781:1022 within 1 px (${img.width}x${img.height})`, Math.abs(img.width - Math.round(img.height * ORIG.w / ORIG.h)) <= 1 && Math.abs(img.height - Math.round(img.width * ORIG.h / ORIG.w)) <= 1)
  const op = `${homedir()}/Downloads/${f.orig}`
  if (!existsSync(op)) { console.log(`SKIP  ${f.app}: original ${f.orig} not in ~/Downloads`); continue }
  const buf = readFileSync(op)
  check(`${f.orig}: original unchanged (sha256)`, createHash('sha256').update(buf).digest('hex') === f.sha)
  const o = decodePng(buf)
  check(`${f.orig}: original is ${ORIG.w}x${ORIG.h} RGBA`, o.width === ORIG.w && o.height === ORIG.h && o.colorType === 6 && o.data !== null)
  const ref = boxAlpha(o, img.width, img.height)
  let d = 0
  for (let i = 0; i < ref.length; i++) d += Math.abs(ref[i] - img.data[i * 4 + 3])
  d /= ref.length
  check(`${f.app}: mean alpha difference vs downsampled original ${d.toFixed(2)} < 4`, d < 4)
  const a = meanOpaqueRgb(o), b = meanOpaqueRgb(img)
  const dc = Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  check(`${f.app}: mean RGB of opaque pixels matches (max diff ${dc.toFixed(1)} < 6)`, dc < 6, `${a.map(Math.round)} vs ${b.map(Math.round)}`)
}
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('\nall passed')
