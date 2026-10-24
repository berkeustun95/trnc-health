#!/usr/bin/env node
// ─── The keylined wordmark: two halves of one number ─────────────────────────
//
//   node scripts/check-hero-logo.mjs
//
// The hero wordmark's white keyline is BAKED INTO THE ASSET, at a dilation radius chosen
// for one specific on-screen height. Nothing at runtime knows that. So:
//
//   • components/home/homeLayout.js  HERO_LOGO_H   — how tall it renders
//   • assets/brand/v2/ada-logo-keyline.json        — how tall it was baked FOR
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
const LAYOUT = 'components/home/homeLayout.js'
// One entry per baked mark. HomeTopBar draws the 72pt bake; RedesignHero (the live Home's top
// row) draws its own 44pt bake, because the 72pt keyline shrank to ~0.6pt there.
const MARKS = [
  { constant: 'HERO_LOGO_H',         file: 'components/home/HomeTopBar.js',
    manifest: 'assets/brand/v2/ada-logo-keyline.json',    asset: 'assets/brand/v2/ada-logo-keyline.png' },
  { constant: 'HERO_LOGO_H_COMPACT', file: 'components/home/redesign/RedesignHero.js',
    manifest: 'assets/brand/v2/ada-logo-keyline-44.json', asset: 'assets/brand/v2/ada-logo-keyline-44.png' },
]

const problems = []
const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const layout = read(LAYOUT)
const ok = []

for (const { constant, file, manifest: MANIFEST, asset: ASSET } of MARKS) {
  // ─── 1. The declared render height ────────────────────────────────────────
  const mH = layout.match(new RegExp(`export const ${constant}\\s*=\\s*(\\d+(?:\\.\\d+)?)`))
  if (!mH) problems.push(`${constant} not found in ${LAYOUT}`)
  const renderH = mH ? parseFloat(mH[1]) : null

  // ─── 2. What the asset was baked for ──────────────────────────────────────
  let man = null
  try { man = JSON.parse(read(MANIFEST)) }
  catch { problems.push(`${MANIFEST} missing or unparseable — re-bake the asset (script is in the vault, attachments/logo-v2/gen)`) }

  if (man && renderH != null && man.renderHeightPt !== renderH) {
    problems.push(
      `${constant} is ${renderH} but the keyline was baked for ${man.renderHeightPt}. `
      + `On screen the keyline would be ${(man.keylinePt * man.renderHeightPt / renderH).toFixed(2)}pt, not ${man.keylinePt}pt. `
      + `Re-bake the asset at ${renderH}, or put ${constant} back to ${man.renderHeightPt}.`)
  }

  // ─── 3. The PNG on disk must be the one the manifest describes ────────────
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

  // ─── 4. The component must require THIS asset and USE the constant ───────
  // A literal height would satisfy every check above while being free to drift.
  const src = read(file)
  const assetName = ASSET.split('/').pop()
  if (!src.includes(`/${assetName}')`)) problems.push(`${file} does not require ${ASSET} — the guard is checking a mark nobody draws`)
  if (!new RegExp(`height:\\s*${constant}\\b`).test(src)) {
    problems.push(`${file}'s logo style must set \`height: ${constant}\` — a literal height `
      + `passes every other check here and then drifts silently, which is the whole failure this guard exists for`)
  }

  // ─── 5. The box must match the asset's aspect, or `contain` letterboxes it ─
  // THE round-3 bug, as an assertion.
  if (man && renderH != null) {
    const [bw, bh] = man.bakedPx
    const expectW = Math.round(renderH * bw / bh)
    const mW = src.match(new RegExp(`width:\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*height:\\s*${constant}\\b`))
    if (!mW) problems.push(`could not read the logo width from ${file}`)
    else if (Math.abs(parseFloat(mW[1]) - expectW) > 1) {
      problems.push(`${file}: logo width is ${mW[1]} but the asset's aspect (${(bw/bh).toFixed(3)}) at `
        + `height ${renderH} needs ${expectW}. With resizeMode 'contain' the mismatch does not `
        + `stretch the mark, it SHRINKS it inside the box — silently, which is how it ended up `
        + `drawing at 26x32pt while the style said 168x60.`)
    }
    ok.push(`${constant} ${renderH}pt, keyline ${man.keylinePt}pt at radius ${man.dilationRadiusPx}px, asset ${bw}x${bh}`)
  }
}

if (problems.length) {
  console.error('\n  ┌─ HERO LOGO CHECK FAILED ───────────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(`hero logo: OK (${ok.join('; ')})`)
