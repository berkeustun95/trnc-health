#!/usr/bin/env node
// Regenerates the placeholder photos the Döveç mock fixture points at (assets/dovec-mock/*.jpg).
// Drawn, not downloaded: no third-party photo licence, works offline, and the "MOCK" corner tag
// makes a screenshot of the preview impossible to mistake for real Döveç content.
//
//   node supabase/functions/sync-dovec/fixtures/make-mock-images.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../assets/dovec-mock')
mkdirSync(OUT, { recursive: true })
const W = 1200, H = 800

const tag = `<g><rect x="${W - 150}" y="24" width="126" height="44" rx="10" fill="#000" fill-opacity="0.45"/>
  <text x="${W - 87}" y="54" font-family="Helvetica, Arial" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">MOCK</text></g>`

const exterior = (sky1, sky2, ground, blocks) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#s)"/>
  <rect y="${H * 0.72}" width="${W}" height="${H * 0.28}" fill="${ground}"/>
  ${blocks.map(([x, w, h, c]) => {
    const y = H * 0.72 - h
    let win = ''
    for (let wy = y + 24; wy < H * 0.72 - 30; wy += 46) for (let wx = x + 18; wx < x + w - 30; wx += 44)
      win += `<rect x="${wx}" y="${wy}" width="24" height="28" rx="3" fill="#dfeef2" fill-opacity="0.85"/>`
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c}"/>${win}`
  }).join('')}
  ${tag}</svg>`

const interior = (wall, floor, accent) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${wall}"/>
  <polygon points="0,${H} ${W},${H} ${W * 0.78},${H * 0.62} ${W * 0.22},${H * 0.62}" fill="${floor}"/>
  <rect x="${W * 0.34}" y="${H * 0.16}" width="${W * 0.32}" height="${H * 0.36}" rx="8" fill="#bfe3ef"/>
  <rect x="${W * 0.34}" y="${H * 0.16}" width="${W * 0.32}" height="${H * 0.36}" rx="8" fill="none" stroke="#fff" stroke-width="10"/>
  <rect x="${W * 0.28}" y="${H * 0.6}" width="${W * 0.44}" height="${H * 0.12}" rx="18" fill="${accent}"/>
  <rect x="${W * 0.3}" y="${H * 0.53}" width="${W * 0.4}" height="${H * 0.1}" rx="18" fill="${accent}" fill-opacity="0.8"/>
  ${tag}</svg>`

const images = {
  'cover-1': exterior('#7cc7e8', '#e9f6fb', '#d9c7a3', [[180, 260, 420, '#f4f1ea'], [470, 300, 500, '#ece6da'], [800, 220, 360, '#f4f1ea']]),
  'cover-2': exterior('#9ccfe0', '#f3f8f2', '#8fb07a', [[140, 300, 170, '#f7f3ec'], [500, 300, 190, '#efe8dc'], [860, 260, 160, '#f7f3ec']]),
  'cover-3': exterior('#a7d3ea', '#f4f9fb', '#9fbf8a', [[220, 340, 260, '#f2e9dc'], [620, 360, 300, '#f6efe4']]),
  'interior-1': interior('#efe9df', '#c9a77f', '#5f8f8b'),
  'interior-2': interior('#f2efe9', '#b8a184', '#c98b6b'),
  'interior-3': interior('#ece8e1', '#a88e6d', '#6d7f9a'),
}

for (const [name, svg] of Object.entries(images)) {
  const file = resolve(OUT, `${name}.jpg`)
  await sharp(Buffer.from(svg)).jpeg({ quality: 72, mozjpeg: true }).toFile(file)
  console.log(file)
}
