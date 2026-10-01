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
// ─── BOTH ENDS OF THE SIZE RANGE, AND THE SMALL END IS THE BINDING ONE ──────
//
// The hero is clamped to [HERO_MIN, HERO_MAX]. The scrim's height is 0.52 x heroH, so the
// SHORTER the hero, the further up its own ramp the text sits and the LESS alpha it gets.
// The smallest hero is therefore the worst case, and this list must contain it.
//
// ⚠ HERO_MIN IS READ FROM SOURCE, NOT TYPED HERE. It moved 305 -> 280 on 2026-09-09 to buy
//   fold margin, and a hardcoded 305 would have left this guard measuring a hero size that
//   no longer occurs — passing on a screen nobody has while the real one failed. That is
//   the frame-of-reference drift this file was written to avoid.
const HERO_MIN = num('components/home/HomeHero.js', 'HERO_MIN')
const HERO_MAX = num('components/home/HomeHero.js', 'HERO_MAX')
if (HERO_MIN == null || HERO_MAX == null) {
  console.error('\n  hero contrast: cannot read HERO_MIN / HERO_MAX — this guard measures nothing.\n')
  process.exit(1)
}
const DEVICES = [[393, 341], [360, HERO_MIN], [412, HERO_MAX]]

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const Y = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const rampAlpha = u => (u >= 1 ? 0 : G.BOTTOM_MAX * Math.pow(1 - u, G.RAMP_EXP))

const problems = []
let dotsContrast = null   // non-text UI (3:1), reported apart from the 4.5:1 text rows
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

// ═══ REDESIGNED HERO (feat/redesign) ═══════════════════════════════════════
// Its only text — the district chip — sits on a dark pill, so the photo cannot decide the
// ratio. The binding case is the pill over a PURE WHITE pixel; measured on the real photos
// the bare text failed 4 of 6 (Karpaz 2.65), which is why the pill exists. The alpha is
// read from source, so lowering it for looks goes red here rather than on a phone.
{
  const src = readFileSync(resolve(ROOT, 'components/home/redesign/RedesignHero.js'), 'utf8')
  const m = /export const HERO_PILL_ALPHA\s*=\s*([\d.]+)/.exec(src)
  if (!m) {
    problems.push('redesign hero: cannot read HERO_PILL_ALPHA from RedesignHero.js — measuring nothing')
  } else {
    const a = parseFloat(m[1])
    const g = 255 * (1 - a)                                  // the pill over pure white
    const c = 1.05 / (Y(g, g, g) + 0.05)
    rows.push({ name: 'redesign pill', worst: c, at: 'over #FFFFFF' })
    if (c < FLOOR) problems.push(`redesign hero: white on rgba(0,0,0,${a}) over white is ${c.toFixed(2)}:1, under ${FLOOR}:1 — raise HERO_PILL_ALPHA`)
  }
  // Home v3: the weather chip must wear the SAME pill, or the number above says nothing about it.
  if (!/style=\{\[s\.chip, s\.wxChip\]\}/.test(src)) {
    problems.push('redesign hero: the weather chip is not styled with s.chip — the pill ratio above does not cover it')
  }
}

// Home v3 Oli bar: white text on the shared ground (oli-bg.png gradient + oli-glow.png), and
// on the glass pill (white 16%) over it. labels:check proves the text ends inside TEXT_ZONE,
// so this renders the REAL PNGs at 320/360/393dp exactly as OliBar lays them out (bg
// stretched to the card; glow GLOW_SIZE square centred at GLOW_CX/GLOW_CY) and takes the
// BRIGHTEST pixel anywhere in the zone — a bound for every locale's title and pill. The art
// never enters the zone (right 40%, and TEXT_ZONE + ART_ZONE ≤ 1 is asserted). Pill text is
// 13/500, so 4.5:1 applies to both.
{
  const src = readFileSync(resolve(ROOT, 'components/home/redesign/OliBar.js'), 'utf8')
  const k = name => parseFloat((new RegExp(`export const ${name} = ([\\d.]+)`).exec(src) || [])[1])
  const [H, ZONE, ART, GS, GX, GY, TL, DX, DOT, DON, DB, DA] = ['OLI_BAR_H', 'TEXT_ZONE', 'ART_ZONE', 'GLOW_SIZE', 'GLOW_CX', 'GLOW_CY', 'TEXT_LEFT',
    'DOTS_X', 'DOT', 'DOT_ON', 'DOTS_BOTTOM', 'DOT_ALPHA'].map(k)
  if ([H, ZONE, ART, GS, GX, GY, TL, DX, DOT, DON, DB, DA].some(v => !(v >= 0)) || !/'rgba\(255,255,255,0\.16\)'/.test(src)
      || !/source=\{BG\} resizeMode="stretch"/.test(src)) {
    problems.push('redesign Oli bar: cannot read the ground geometry / 16% pill from OliBar.js — measuring nothing')
  } else {
    if (ZONE + ART > 1.0001) problems.push(`redesign Oli bar: TEXT_ZONE ${ZONE} + ART_ZONE ${ART} overlap — the art could sit under the text`)
    let worstT = Infinity, worstP = Infinity, at = '', worstD = Infinity, atD = ''
    for (const Wd of [320, 360, 393]) {
      const cw = Wd - 32
      const glow = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-glow.png')).resize(GS, GS).toBuffer()
      const gl = Math.round(cw * GX - GS / 2), gt = Math.round(H * GY - GS / 2)
      // extend the canvas so a glow hanging off the card still composites, then crop to the card
      const pad = GS
      // sharp orders its operations itself, so resize and extend are separate passes
      const sized = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-bg.png')).resize(cw, H, { fit: 'fill' }).toBuffer()
      const bg = await sharp(sized).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' }).toBuffer()
      const lit = await sharp(bg).composite([{ input: glow, left: gl + pad, top: gt + pad }]).png().toBuffer()
      const { data, info } = await sharp(lit).extract({ left: pad, top: pad, width: cw, height: H })
        .removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const x1 = Math.ceil(cw * ZONE)
      for (let y = 0; y < H; y++) for (let x = TL; x < x1; x++) {
        const i = (y * info.width + x) * info.channels
        const px = [data[i], data[i + 1], data[i + 2]]
        const ct = 1.05 / (Y(...px) + 0.05)
        const cp = 1.05 / (Y(...px.map(v => 255 * 0.16 + v * 0.84)) + 0.05)
        if (ct < worstT) worstT = ct
        if (cp < worstP) { worstP = cp; at = `${Wd}dp x=${x} y=${y} rgb(${px.join(',')})` }
      }
      // Scene dots: a vertical column that must sit BETWEEN the text zone and the art (whose
      // left edge is ≥ cw·(1 − ART_ZONE) on every scene), never on either. The dimmest dot
      // (white at DOT_ALPHA) must clear 3:1 against every ground pixel behind the column (WCAG 1.4.11).
      const dl = cw * DX - DOT / 2, dr = dl + DOT
      if (dl < cw * ZONE + 1) problems.push(`redesign Oli bar: ${Wd}dp dots start at ${dl.toFixed(1)}pt, inside the text zone (ends ${(cw * ZONE).toFixed(1)})`)
      if (dr > cw * (1 - ART) - 1) problems.push(`redesign Oli bar: ${Wd}dp dots end at ${dr.toFixed(1)}pt, inside the art zone (starts ${(cw * (1 - ART)).toFixed(1)})`)
      const colH = 6 * DOT + DON + 6 * 3
      for (let y = Math.floor(H - DB - colH); y < H - DB; y++) for (let x = Math.floor(dl); x < Math.ceil(dr); x++) {
        const i = (y * info.width + x) * info.channels
        const px = [data[i], data[i + 1], data[i + 2]]
        const dot = px.map(v => 255 * DA + v * (1 - DA))
        const c = (Y(...dot) + 0.05) / (Y(...px) + 0.05)
        if (c < worstD) { worstD = c; atD = `${Wd}dp x=${x} y=${y} rgb(${px.join(',')})` }
      }
    }
    rows.push({ name: 'oli title', worst: worstT, at }, { name: 'oli pill', worst: worstP, at })
    dotsContrast = { worst: worstD, at: atD }
    if (worstD < 3) problems.push(`redesign Oli bar: inactive dot is ${worstD.toFixed(2)}:1 against the ground (${atD}), under 3:1`)
    if (worstT < FLOOR) problems.push(`redesign Oli bar: title on the ground is ${worstT.toFixed(2)}:1 at worst, under ${FLOOR}:1`)
    if (worstP < FLOOR) problems.push(`redesign Oli bar: pill text is ${worstP.toFixed(2)}:1 at worst (${at}), under ${FLOOR}:1`)
  }
}

// Home v3 emergency tile: white text straight on solid health red (no band, no photo).
{
  const w = readFileSync(resolve(ROOT, 'components/home/redesign/Widgets.js'), 'utf8')
  const th = readFileSync(resolve(ROOT, 'constants/theme.js'), 'utf8')
  const hex = (/health:\s*\{[^}]*ink:\s*'#([0-9A-Fa-f]{6})'/.exec(th) || [])[1]
  if (!/export const EMERGENCY_BG = category\.health\.ink/.test(w) || !hex) {
    problems.push('redesign emergency tile: EMERGENCY_BG is not category.health.ink, or the ink is unreadable — measuring nothing')
  } else {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
    const c = 1.05 / (Y(r, g, b) + 0.05)
    rows.push({ name: 'emergency tile', worst: c, at: `#${hex}` })
    if (c < FLOOR) problems.push(`redesign emergency tile: white on #${hex} is ${c.toFixed(2)}:1, under ${FLOOR}:1`)
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
if (dotsContrast) console.log(`  oli scene dots (non-text, 3:1): inactive ${dotsContrast.worst.toFixed(2)}:1 worst`)
