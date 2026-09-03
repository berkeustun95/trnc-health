#!/usr/bin/env node
// ─── The keylined wordmark: two halves of one number ─────────────────────────
//
//   node scripts/check-hero-logo.mjs
//
// The hero wordmark's white keyline is BAKED INTO THE ASSET, at a dilation radius chosen
// for one specific on-screen height. Nothing at runtime knows that. So:
//
//   • components/home/homeLayout.js  HERO_LOGO_H   — how tall it renders
//   • assets/hero/ada-wordmark-keyline.json        — how tall it was baked FOR
//
// If those drift, the keyline silently stops being 1pt: thicker if the render shrank,
// thinner if it grew. Nothing errors, nothing looks obviously broken, and the result is
// a mark that reads as improvised — which is exactly what happened in rounds 3 to 5,
// when `contain` on a square asset meant the logo drew at 26x32pt while the style said
// 168x60 and a 2pt ring became 8% of the mark's width. Three rounds went into diagnosing
// an aesthetic complaint whose cause was arithmetic.
//
// This is the cheap check that would have caught it.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAYOUT   = 'components/home/homeLayout.js'
const TOPBAR   = 'components/home/HomeTopBar.js'
const MANIFEST = 'assets/hero/ada-wordmark-keyline.json'
const ASSET    = 'assets/hero/ada-wordmark-keyline.png'

const problems = []
const read = p => readFileSync(resolve(ROOT, p), 'utf8')

// ─── 1. The declared render height ──────────────────────────────────────────
const layout = read(LAYOUT)
const mH = layout.match(/export const HERO_LOGO_H\s*=\s*(\d+(?:\.\d+)?)/)
if (!mH) problems.push(`HERO_LOGO_H not found in ${LAYOUT}`)
const renderH = mH ? parseFloat(mH[1]) : null

// ─── 2. What the asset was baked for ────────────────────────────────────────
let man = null
try { man = JSON.parse(read(MANIFEST)) }
catch { problems.push(`${MANIFEST} missing or unparseable — re-bake the asset (script is in the round-5 vault entry)`) }

if (man && renderH != null && man.renderHeightPt !== renderH) {
  problems.push(
    `HERO_LOGO_H is ${renderH} but the keyline was baked for ${man.renderHeightPt}. `
    + `On screen the keyline would be ${(man.keylinePt * man.renderHeightPt / renderH).toFixed(2)}pt, not ${man.keylinePt}pt. `
    + `Re-bake the asset at ${renderH}, or put HERO_LOGO_H back to ${man.renderHeightPt}.`)
}

// ─── 3. The PNG on disk must be the one the manifest describes ──────────────
// Dimensions come from the IHDR chunk: 8-byte signature, 4-byte length, "IHDR",
// then width and height as big-endian uint32. No decoder needed.
if (man) {
  const buf = readFileSync(resolve(ROOT, ASSET))
  const sig = buf.subarray(0, 8).toString('hex')
  if (sig !== '89504e470d0a1a0a') problems.push(`${ASSET} is not a PNG`)
  else {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
    const [mw, mh] = man.bakedPx ?? []
    if (w !== mw || h !== mh) {
      problems.push(`${ASSET} is ${w}x${h}px but the manifest says ${mw}x${mh}px — `
        + `the asset and its manifest were not produced by the same bake`)
    }
  }
}

// ─── 4. The style must USE the constant, not a literal ──────────────────────
// A literal would satisfy every check above while being free to drift.
const topbar = read(TOPBAR)
if (!/height:\s*HERO_LOGO_H/.test(topbar)) {
  problems.push(`${TOPBAR}'s logo style must set \`height: HERO_LOGO_H\` — a literal height `
    + `passes every other check here and then drifts silently, which is the whole failure this guard exists for`)
}

// ─── 5. The box must match the asset's aspect, or `contain` letterboxes it ───
// THE round-3 bug, as an assertion.
if (man && renderH != null) {
  const [bw, bh] = man.bakedPx
  const expectW = Math.round(renderH * bw / bh)
  const mW = topbar.match(/width:\s*(\d+(?:\.\d+)?)\s*,\s*height:\s*HERO_LOGO_H/)
  if (!mW) problems.push(`could not read the logo width from ${TOPBAR}`)
  else if (Math.abs(parseFloat(mW[1]) - expectW) > 1) {
    problems.push(`logo width is ${mW[1]} but the asset's aspect (${(bw/bh).toFixed(3)}) at `
      + `height ${renderH} needs ${expectW}. With resizeMode 'contain' the mismatch does not `
      + `stretch the mark, it SHRINKS it inside the box — silently, which is how it ended up `
      + `drawing at 26x32pt while the style said 168x60.`)
  }
}

if (problems.length) {
  console.error('\n  ┌─ HERO LOGO CHECK FAILED ───────────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(`hero logo: OK (${renderH}pt tall, keyline ${man.keylinePt}pt baked at radius `
  + `${man.dilationRadiusPx}px, asset ${man.bakedPx[0]}x${man.bakedPx[1]})`)
