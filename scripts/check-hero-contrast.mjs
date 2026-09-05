#!/usr/bin/env node
// ─── Hero text contrast, re-measured from the real photographs every run ─────
//
//   node scripts/check-hero-contrast.mjs
//
// WHY THIS IS A GUARD AND NOT A NOTE. On 2026-09-07 the district row lost its dark pill,
// so the bottom scrim became the ONLY thing carrying that text. Three separate numbers now
// decide whether it is legible — BOTTOM_MAX, RAMP_EXP and HERO_OVERLAP (which sets how far
// down the text sits) — and none of them looks like a contrast control. Someone raising
// HERO_OVERLAP for a layout reason would move the text into a different part of the ramp
// and have no way to know they had done it.
//
// The repo's rule is that a comment citing a measured figure must be regenerated rather
// than remembered. This regenerates them: it composites each background exactly as the app
// draws it and prints the six ratios on every run.
//
// ─── WHAT IT MODELS, STATED SO A FAILURE CAN BE READ ────────────────────────
//   • resizeMode 'cover' into the hero box, centre position — same as the <Image>.
//   • The bottom scrim, as the CUMULATIVE alpha of the stacked bands, not a single band.
//   • The generic's extra flat scrim, applied only to that asset.
//   • sRGB compositing (black at alpha a over c gives c*(1-a)), because that is what RN
//     does — NOT linear-light blending, which would give a different and wrong answer.
//   • The 95th-percentile luminance of the text row, not the single brightest pixel: one
//     specular highlight is not what a glyph sits on.
//
// ⚠ IT DOES NOT MODEL THE textShadow, DELIBERATELY. WCAG has no method for a shadow, so
//   counting it would be inventing a number. The shadow is a perceptual aid at glyph
//   edges; the scrim is what these figures certify.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(resolve(ROOT, f), 'utf8')

// ─── Constants are READ, never retyped ──────────────────────────────────────
// The whole point is that these track the components. A hardcoded copy here would be the
// frame-of-reference drift this repo has already been bitten by.
function num(file, name) {
  const m = read(file).match(new RegExp(`const ${name}\\s*=\\s*(-?[\\d.]+)`))
  return m ? parseFloat(m[1]) : null
}
const G = {
  BOTTOM_MAX:    num('components/home/HomeHero.js', 'BOTTOM_MAX'),
  RAMP_EXP:      num('components/home/HomeHero.js', 'RAMP_EXP'),
  GENERIC_SCRIM: num('components/home/HomeHero.js', 'GENERIC_SCRIM'),
  HERO_OVERLAP:  num('components/home/homeLayout.js', 'HERO_OVERLAP'),
  OLI_OVERHANG:  num('components/home/homeLayout.js', 'OLI_OVERHANG'),
  CLEARANCE:     num('components/home/homeLayout.js', 'CLEARANCE'),
}
const missing = Object.entries(G).filter(([, v]) => v == null).map(([k]) => k)
if (missing.length) {
  console.error(`\n  hero contrast: cannot read ${missing.join(', ')} — a rename moved a constant `
    + `out from under this guard. It measures nothing until the scraper is updated.\n`)
  process.exit(1)
}
const CONTENT_BOTTOM = G.HERO_OVERLAP + G.OLI_OVERHANG + G.CLEARANCE
const LINE = 17                       // the 14pt district row's line box
const FLOOR = 4.5                     // normal text; 14pt is not "large" under WCAG

const BACKGROUNDS = [
  ['kyrenia',   'assets/hero/hero-kyrenia.jpg'],
  ['famagusta', 'assets/hero/hero-famagusta.jpg'],
  ['iskele',    'assets/hero/hero-iskele.jpg'],
  ['karpaz',    'assets/hero/hero-karpaz.jpg'],
  ['nicosia',   'assets/hero/hero-nicosia.jpg'],
  ['generic',   'assets/auth-bg.png'],
]
// Both ends of the size range: the hero is clamped to [305, 400].
const DEVICES = [[393, 341], [360, 305]]

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const Y = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const rampAlpha = u => (u >= 1 ? 0 : G.BOTTOM_MAX * Math.pow(1 - u, G.RAMP_EXP))

const problems = []
const rows = []
for (const [name, file] of BACKGROUNDS) {
  let worst = Infinity, at = ''
  for (const [W, H] of DEVICES) {
    const { data } = await sharp(resolve(ROOT, file)).resize(W, H, { fit: 'cover', position: 'centre' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rampH = Math.round(H * 0.52)
    const y0 = H - CONTENT_BOTTOM - LINE
    const lum = []
    for (let y = y0; y < y0 + LINE; y++) {
      let a = rampAlpha((H - y) / rampH)
      if (name === 'generic') a = 1 - (1 - a) * (1 - G.GENERIC_SCRIM)
      for (let x = 16; x < W - 16; x++) {
        const i = (y * W + x) * 3
        lum.push(Y(data[i] * (1 - a), data[i + 1] * (1 - a), data[i + 2] * (1 - a)))
      }
    }
    lum.sort((p, q) => p - q)
    const p95 = lum[Math.floor(lum.length * 0.95)]
    const c = 1.05 / (p95 + 0.05)
    if (c < worst) { worst = c; at = `${W}x${H}` }
  }
  rows.push({ name, worst, at })
  if (worst < FLOOR) {
    problems.push(`${name}: white district text measures ${worst.toFixed(2)}:1 at ${at}, under the `
      + `${FLOOR}:1 floor. The scrim is the only thing carrying this text since the pill was `
      + `removed — raise BOTTOM_MAX or RAMP_EXP, or reduce HERO_OVERLAP so the row sits higher.`)
  }
}

if (problems.length) {
  console.error('\n  ┌─ HERO CONTRAST CHECK FAILED ───────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(`hero contrast: OK — white text on all ${rows.length} backgrounds clears ${FLOOR}:1`)
console.log(`  ramp ${G.BOTTOM_MAX}/${G.RAMP_EXP} · generic +${G.GENERIC_SCRIM} flat · text row `
  + `${CONTENT_BOTTOM}pt above the hero's bottom (read from source, not typed here)`)
console.log('  ' + rows.map(r => `${r.name} ${r.worst.toFixed(2)}`).join(' · '))
