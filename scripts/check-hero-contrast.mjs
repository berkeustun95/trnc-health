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
import { KINDS } from '../constants/islandCalendar.js'

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

// constants/dayParts.js tables, READ as text (one `key: value` per line; null → null).
function readTable(name) {
  const m = new RegExp(`export const ${name} = \\{([^}]*)\\}`).exec(read('constants/dayParts.js'))
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const e = /^\s*(\w+):\s*(null|'[^']*')/.exec(line)
    if (e) out[e[1]] = e[2] === 'null' ? null : e[2].slice(1, -1)
  }
  return out
}
const parseRgba = s => { const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(s); return m ? { c: [+m[1], +m[2], +m[3]], a: parseFloat(m[4]) } : null }

const problems = []
let logoContrast = null   // the wordmark's bar is min(today, 3:1) (non-text), reported apart from the 4.5:1 text rows
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

// ── Daylight experiment (Variant A): the hero wash + weather veil ──
// RedesignHero draws, bottom to top: photo → HERO_WASH → WEATHER_VEIL → TOP ramp → (generic scrim)
// → BOTTOM ramp → logo / chip pills. Read from constants/dayParts.js, never retyped; every
// wash × veil combination (day parts × weather groups, incl. none) is iterated.
//   • the white wordmark (top-left) over the REAL photos, cover-cropped, with the real TOP ramp:
//     p95 background luminance in the logo box must keep white at >= min(today's ratio, 3:1)
//     on every photo x device x combo (the bare logo is ~1.2:1 on a bright sky today: it can only improve there);
//   • the chip pills over a PURE WHITE pixel carrying the combo: ≥ 4.5:1 (a flat colour over
//     white can never be brighter than white, so this is the bound; it goes red only if the
//     pill alpha does — printed so the claim is visible, not assumed).
{
  const hero = readFileSync(resolve(ROOT, 'components/home/redesign/RedesignHero.js'), 'utf8')
  const washes = readTable('HERO_WASH'), veils = readTable('WEATHER_VEIL')
  const calWashes = readTable('CALENDAR_WASH')   // Variant C: replaces the day-part wash on a dated day, veil stays
  const topMax = parseFloat((/const TOP = rampLayers\(([\d.]+)\)/.exec(hero) || [])[1])
  const steps = num('components/home/HomeHero.js', 'RAMP_STEPS')
  const logoWH = /logo:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/.exec(hero)
  const pillA = parseFloat((/export const HERO_PILL_ALPHA\s*=\s*([\d.]+)/.exec(hero) || [])[1])
  const total = parseFloat((/export const HERO_TOTAL\s*=\s*(\d+)/.exec(hero) || [])[1])
  const minBody = parseFloat((/export const HERO_MIN_BODY\s*=\s*(\d+)/.exec(hero) || [])[1])
  if (calWashes) {   // every Island Calendar kind needs a wash and vice versa
    for (const k of KINDS) if (!(k in calWashes)) problems.push(`calendar: kind "${k}" has no CALENDAR_WASH entry`)
    for (const k of Object.keys(calWashes)) if (!KINDS.includes(k)) problems.push(`calendar: CALENDAR_WASH.${k} is not a kind in islandCalendar KINDS`)
  }
  if (!washes || !veils || !calWashes || !(topMax > 0) || !(steps > 0) || !logoWH || !(pillA > 0) || !(total > 0) || !(minBody > 0)
      || !/<HeroAtmosphere part=\{part\} wxGroup/.test(hero) || !/s\.logo/.test(hero)) {
    problems.push('daylight hero: cannot read the wash/veil tables or the hero geometry — measuring nothing')
  } else {
    const combos = []
    for (const [dp, w] of Object.entries(calWashes)) for (const [wx, v] of [['none', null], ...Object.entries(veils)]) {
      const W_ = w == null ? null : parseRgba(w), V_ = v == null ? null : parseRgba(v)
      if (!W_ || (v != null && !V_)) { problems.push(`calendar: CALENDAR_WASH.${dp} / WEATHER_VEIL.${wx} is not rgba(r,g,b,a)`); continue }
      if (W_.a > 0.16) problems.push(`calendar: CALENDAR_WASH.${dp} alpha ${W_.a} is over the 0.16 cap`)
      const [cr, cg, cb2] = W_.c   // product rule: no national-flag colours (red / white)
      if ((cr > 180 && cg < 140 && cb2 < 140) || (cr > 240 && cg > 240 && cb2 > 240)) problems.push(`calendar: CALENDAR_WASH.${dp} is red or white (flag colours)`)
      combos.push({ name: `cal:${dp}+${wx}`, layers: [W_, V_].filter(Boolean) })
    }
    for (const [dp, w] of Object.entries(washes)) for (const [wx, v] of [['none', null], ...Object.entries(veils)]) {
      const W_ = w == null ? null : parseRgba(w), V_ = v == null ? null : parseRgba(v)
      if ((w != null && !W_) || (v != null && !V_)) problems.push(`daylight: HERO_WASH.${dp} / WEATHER_VEIL.${wx} is not rgba(r,g,b,a)`)
      if (W_ && W_.a > 0.22) problems.push(`daylight: HERO_WASH.${dp} alpha ${W_.a} is over the 0.22 cap`)
      if (V_ && V_.a > 0.18) problems.push(`daylight: WEATHER_VEIL.${wx} alpha ${V_.a} is over the 0.18 cap`)
      combos.push({ name: `${dp}+${wx}`, layers: [W_, V_].filter(Boolean) })
    }
    const over = (px, L) => L.reduce((p, { c, a }) => p.map((v, k) => v * (1 - a) + c[k] * a), px)
    // the real top ramp: per-layer alphas whose product is max·(1-u)^RAMP_EXP, band i is (i+1)/steps of 45% of the hero
    const exp = G.RAMP_EXP
    const d = new Array(steps)
    for (let i = steps - 1; i >= 0; i--) {
      let below = 1
      for (let k = i + 1; k < steps; k++) below *= (1 - d[k])
      d[i] = 1 - (1 - topMax * Math.pow(1 - i / steps, exp)) / below
    }
    const [lw, lh] = [+logoWH[1], +logoWH[2]]
    let base = Infinity, worst = Infinity, wname = '', wat = '', b0 = 0, worstDrop = 0, dropAt = ''
    const per = {}
    for (const [name, file] of BACKGROUNDS) {
      for (const [Wd, inset] of [[360, 24], [393, 47], [412, 59]]) {
        const Ht = Math.max(total, inset + minBody)
        const { data } = await sharp(resolve(ROOT, file)).resize(Wd, Ht, { fit: 'cover', position: 'centre' })
          .removeAlpha().raw().toBuffer({ resolveWithObject: true })
        for (const cb of [{ name: 'none', layers: [] }, ...combos]) {
          const lum = []
          for (let y = inset + 8; y < inset + 8 + lh; y++) {
            let keep = 1
            for (let i = 0; i < steps; i++) if (y < (Ht * 0.45 / steps) * (i + 1)) keep *= (1 - d[i])
            const ga = name === 'generic' ? 0.28 : 0   // generic scrim sits above the top ramp
            for (let x = 16; x < 16 + lw; x++) {
              const j = (y * Wd + x) * 3
              let px = over([data[j], data[j + 1], data[j + 2]], cb.layers)
              px = px.map(v => v * keep * (1 - ga))
              lum.push(Y(...px))
            }
          }
          lum.sort((p, q) => p - q)
          const c = 1.05 / (lum[Math.floor(lum.length * 0.95)] + 0.05)
          if (cb.name === 'none') { base = Math.min(base, c); b0 = c }
          else {
            if (c < Math.min(b0, 3) - 1e-9 && c - Math.min(b0, 3) < worstDrop) { worstDrop = c - Math.min(b0, 3); dropAt = `${cb.name} on ${name} ${Wd}dp inset ${inset}: ${c.toFixed(2)} vs ${b0.toFixed(2)} without` }
            const dpk = cb.name.split('+')[0]   // day part, or cal:<kind>
            per[dpk] = Math.min(per[dpk] ?? Infinity, c)
            if (c < worst) { worst = c; wname = cb.name; wat = `${name} ${Wd}dp inset ${inset}` }
          }
        }
      }
    }
    logoContrast = { base, worst, at: `${wname} ${wat}` }
    console.log('  daylight logo, worst per day-part (all weather veils): ' + Object.entries(per).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ') + ` — none ${base.toFixed(2)}`)
    // The wordmark already sits on bright sky (the baseline is NOT 3:1 — it is the status quo), so the
    // bar per photo x device x combo is min(without-atmosphere, 3:1): a wash may lower a ratio that
    // stays at 3:1 (non-text) or better, but never push the logo below today's figure or below 3:1.
    if (dropAt) problems.push(`daylight hero: a wash/veil is too bright for the white wordmark — it takes the logo under min(today, 3:1): ${dropAt}`)
    let wc = Infinity, wcn = ''
    for (const cb of combos) {
      const px = over([255, 255, 255], cb.layers).map(v => v * (1 - pillA))
      const c = 1.05 / (Y(...px) + 0.05)
      if (c < wc) { wc = c; wcn = cb.name }
    }
    rows.push({ name: 'chip pill + wash/veil', worst: wc, at: wcn })
    if (wc < FLOOR) problems.push(`daylight hero: chip text over white carrying ${wcn} is ${wc.toFixed(2)}:1, under ${FLOOR}:1`)
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

    // ── Daylight experiment: the glow tinted per day part ──
    // tintColor REPLACES the glow's colour and keeps its alpha (iOS template render, Android SRC_IN
    // filter). oli-glow.png is pure white at varying alpha, so a tint can only darken the ground.
    // Each OLI_GLOW_TINT (READ from constants/dayParts.js) is rendered exactly like that at the
    // three widths; title and pill must clear 4.5:1 AND be no worse than the untinted figures.
    const tints = readTable('OLI_GLOW_TINT')
    if (!tints || Object.keys(tints).length !== 4) problems.push('daylight: cannot read OLI_GLOW_TINT from constants/dayParts.js — measuring nothing')
    else {
      const glowRaw = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-glow.png')).resize(GS, GS).ensureAlpha().raw().toBuffer()
      const glowLum = (() => { let m = 0; for (let i = 0; i < glowRaw.length; i += 4) if (glowRaw[i + 3] > 0) m = Math.max(m, Y(glowRaw[i], glowRaw[i + 1], glowRaw[i + 2])); return m })()
      // Render the card at one width with a given glow PNG; also the mask of TEXT_ZONE pixels the glow
      // actually covers (alpha > 0). Only those pixels can change with the tint, so only those are measured.
      const pngOf = async (r, g, b) => {
        const buf = Buffer.from(glowRaw)
        if (r != null) for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b }
        return sharp(buf, { raw: { width: GS, height: GS, channels: 4 } }).png().toBuffer()
      }
      const renderAt = async (png, Wd) => {
        const cw = Wd - 32, pad = GS
        const sized = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-bg.png')).resize(cw, H, { fit: 'fill' }).toBuffer()
        const bg = await sharp(sized).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' }).toBuffer()
        const lit = await sharp(bg).composite([{ input: png, left: Math.round(cw * GX - GS / 2) + pad, top: Math.round(H * GY - GS / 2) + pad }]).png().toBuffer()
        return sharp(lit).extract({ left: pad, top: pad, width: cw, height: H }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      }
      const maskAt = Wd => {
        const cw = Wd - 32, gl = Math.round(cw * GX - GS / 2), gt = Math.round(H * GY - GS / 2), m = []
        for (let y = 0; y < H; y++) for (let x = TL; x < Math.ceil(cw * ZONE); x++) {
          const gx = x - gl, gy = y - gt
          if (gx >= 0 && gx < GS && gy >= 0 && gy < GS && glowRaw[(gy * GS + gx) * 4 + 3] > 0) m.push([x, y])
        }
        return m
      }
      const WIDTHS = [320, 360, 393]
      const masks = Object.fromEntries(WIDTHS.map(Wd => [Wd, maskAt(Wd)]))
      const covered = WIDTHS.reduce((n, Wd) => n + masks[Wd].length, 0)
      const plainPng = await pngOf(null)
      const plain = Object.fromEntries(await Promise.all(WIDTHS.map(async Wd => [Wd, await renderAt(plainPng, Wd)])))
      if (covered === 0) console.log('  glow never reaches TEXT_ZONE at 320/360/393dp — tint cannot affect text (brightness bound still enforced)')
      else console.log(`  glow reaches TEXT_ZONE: ${WIDTHS.map(Wd => `${Wd}dp ${masks[Wd].length}px`).join(' · ')} — contrast measured over those pixels only`)
      for (const [part, hex] of Object.entries(tints)) {
        const [tr, tg, tb] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
        if (Y(tr, tg, tb) > glowLum + 1e-9) problems.push(`daylight: OLI_GLOW_TINT.${part} ${hex} is brighter than the untinted glow — it could only lower contrast`)
        const glowPng = await pngOf(tr, tg, tb)
        let wt = Infinity, wp = Infinity, ut = Infinity, up = Infinity
        for (const Wd of WIDTHS) {
          if (!masks[Wd].length) continue
          const { data, info } = await renderAt(glowPng, Wd)
          for (const [x, y] of masks[Wd]) {
            const i = (y * info.width + x) * info.channels
            const px = [data[i], data[i + 1], data[i + 2]]
            wt = Math.min(wt, 1.05 / (Y(...px) + 0.05))
            wp = Math.min(wp, 1.05 / (Y(...px.map(v => 255 * 0.16 + v * 0.84)) + 0.05))
            const q = plain[Wd].data, qp = [q[i], q[i + 1], q[i + 2]]
            ut = Math.min(ut, 1.05 / (Y(...qp) + 0.05))
            up = Math.min(up, 1.05 / (Y(...qp.map(v => 255 * 0.16 + v * 0.84)) + 0.05))
          }
        }
        if (!covered) continue
        rows.push({ name: `oli glow ${part} title`, worst: wt, at: hex }, { name: `oli glow ${part} pill`, worst: wp, at: hex })
        if (wt < FLOOR) problems.push(`daylight: OLI_GLOW_TINT.${part} ${hex}: Oli title is ${wt.toFixed(2)}:1 at worst, under ${FLOOR}:1`)
        if (wp < FLOOR) problems.push(`daylight: OLI_GLOW_TINT.${part} ${hex}: Oli pill text is ${wp.toFixed(2)}:1 at worst, under ${FLOOR}:1`)
        if (wt < ut - 1e-6 || wp < up - 1e-6) problems.push(`daylight: OLI_GLOW_TINT.${part} ${hex} is worse than the untinted glow on the same pixels (title ${wt.toFixed(2)} vs ${ut.toFixed(2)}, pill ${wp.toFixed(2)} vs ${up.toFixed(2)})`)
      }
    }
  }
}

// S2b OliBand (welcome tagline, sign-in titles): the same ground at full width. Rendered at
// 320/360/393dp for both band heights in use (150 welcome, 140 sign-in), brightest pixel in
// the band's text zone, white text must clear 4.5:1. labels:check keeps the text in the zone.
{
  const src = readFileSync(resolve(ROOT, 'components/ui/OliBand.js'), 'utf8')
  const k = name => parseFloat((new RegExp(`export const ${name} = ([\\d.]+)`).exec(src) || [])[1])
  const [ZONE, TL, GS, GX, GY] = ['BAND_TEXT_ZONE', 'BAND_TEXT_LEFT', 'BAND_GLOW_SIZE', 'BAND_GLOW_CX', 'BAND_GLOW_CY'].map(k)
  if ([ZONE, TL, GS, GX, GY].some(v => !(v >= 0))) {
    problems.push('OliBand: cannot read its geometry from components/ui/OliBand.js — measuring nothing')
  } else {
    let worst = Infinity, at = ''
    for (const H of [150, 140]) for (const Wd of [320, 360, 393]) {
      const pad = GS
      const sized = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-bg.png')).resize(Wd, H, { fit: 'fill' }).toBuffer()
      const bg = await sharp(sized).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' }).toBuffer()
      const glow = await sharp(resolve(ROOT, 'assets/oli-scenes/oli-glow.png')).resize(GS, GS).toBuffer()
      const lit = await sharp(bg).composite([{ input: glow, left: Math.round(Wd * GX - GS / 2) + pad, top: Math.round(H * GY - GS / 2) + pad }]).png().toBuffer()
      const { data, info } = await sharp(lit).extract({ left: pad, top: pad, width: Wd, height: H }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let y = 0; y < H; y++) for (let x = TL; x < Math.ceil(Wd * ZONE); x++) {
        const i = (y * info.width + x) * info.channels
        const c = 1.05 / (Y(data[i], data[i + 1], data[i + 2]) + 0.05)
        if (c < worst) { worst = c; at = `${Wd}dp×${H} x=${x} y=${y}` }
      }
    }
    rows.push({ name: 'oli band', worst, at })
    if (worst < FLOOR) problems.push(`OliBand: white text is ${worst.toFixed(2)}:1 at worst (${at}), under ${FLOOR}:1`)
  }
}

// Photo-led Welcome A + onboarding: (1) all text sits on the SOLID teal (PhotoFade lays the
// fade ABOVE the content block), so the number is PHOTO_TEAL vs white; (2) the language
// button and "Atla" sit top-right on dark glass (black 0.38) over the top scrim (black 0.5 → 0
// over 180pt) over each slide's PHOTO — measured on the real photos, cover-cropped at
// 320×640 / 360×780 / 393×852, brightest pixel in the button box.
{
  const pf = readFileSync(resolve(ROOT, 'components/ui/PhotoFade.js'), 'utf8')
  const teal = (/export const PHOTO_TEAL = '#([0-9A-Fa-f]{6})'/.exec(pf) || [])[1]
  if (!teal || !/s_?\.solid/.test(pf)) problems.push('PhotoFade: cannot read PHOTO_TEAL / the solid layer — measuring nothing')
  else {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(teal.slice(i, i + 2), 16))
    const c = 1.05 / (Y(r, g, b) + 0.05)
    rows.push({ name: 'photo-led text', worst: c, at: `#${teal}` })
    if (c < FLOOR) problems.push(`PhotoFade: white on #${teal} is ${c.toFixed(2)}:1`)
  }
  // The language / Atla buttons: white on dark glass over the PHOTO, which is no longer
  // scrimmed (round 2). Bound over a PURE WHITE pixel, so it holds for any photo and any crop.
  const g = parseFloat((/export const PHOTO_GLASS = ([\d.]+)/.exec(pf) || [])[1])
  let worst = Infinity, at = ''
  for (const f of ['screens/WelcomeScreen.js', 'screens/OnboardingScreen.js']) {
    if (!readFileSync(resolve(ROOT, f), 'utf8').includes('rgba(0,0,0,${PHOTO_GLASS})')) problems.push(`${f}: the glass buttons do not use PHOTO_GLASS — measuring nothing`)
  }
  if (!(g > 0)) problems.push('PhotoFade: cannot read PHOTO_GLASS')
  else { const v = 255 * (1 - g); worst = 1.05 / (Y(v, v, v) + 0.05); at = `glass ${g} over #FFFFFF` }
  rows.push({ name: 'photo glass buttons', worst, at })
  if (worst < FLOOR) problems.push(`Photo-led glass buttons: white is ${worst.toFixed(2)}:1 at worst (${at}), under ${FLOOR}:1`)
}

// Module backgrounds, option B (ModuleScreen): every number is bounded over a PURE WHITE photo
// pixel, so it holds for every module photo, today's and any added later.
//   header text  white over (1 − MODULE_TINT)·(1 − HEADER_SCRIM)
//   pill text    white over (1 − MODULE_TINT)·(1 − PILL_ALPHA)          (OnPhotoLabel, SectionHeader)
//   card text    textPrimary / textSecondary over CARD_ALPHA white over a pure BLACK pixel
{
  const ms = readFileSync(resolve(ROOT, 'components/ui/ModuleScreen.js'), 'utf8')
  const num = n => parseFloat((new RegExp(`export const ${n} = ([\\d.]+)`).exec(ms) || [])[1])
  const [tint, hs, pa, ca] = ['MODULE_TINT', 'HEADER_SCRIM', 'PILL_ALPHA', 'CARD_ALPHA'].map(num)
  // The photo must be SIZED to its frame: a require()d Image defaults to the asset's own size
  // (704×1520) and absolute insets don't override it — every number below would then be measured
  // against a photo the user never sees whole (2026-10-01, ADA Preview). Same style as main's
  // PageBackground.
  const photoStyle = (/\bphoto:\s*\{([^}]*)\}/.exec(ms) || [])[1] || ''
  if (!/width:\s*'100%'/.test(photoStyle) || !/height:\s*'100%'/.test(photoStyle))
    problems.push(`ModuleScreen: the photo style must set width: '100%' and height: '100%' (found: {${photoStyle.trim()}})`)
  if ([tint, hs, pa, ca].some(v => !(v > 0))) problems.push('ModuleScreen: cannot read MODULE_TINT / HEADER_SCRIM / PILL_ALPHA / CARD_ALPHA — measuring nothing')
  else {
    const over = k => { const v = 255 * k; return 1.05 / (Y(v, v, v) + 0.05) }
    const head = over((1 - tint) * (1 - hs)), pill = over((1 - tint) * (1 - pa))
    const cardBg = 255 * ca, yb = Y(cardBg, cardBg, cardBg)
    const cr = rgb => (yb + 0.05) / (Y(...rgb) + 0.05)
    const prim = cr([0x1A, 0x2B, 0x33]), sec = cr([0x55, 0x65, 0x7A])
    rows.push({ name: 'B header', worst: head }, { name: 'B pill', worst: pill }, { name: 'B card primary', worst: prim }, { name: 'B card secondary', worst: sec })
    for (const [n, v] of [['header text', head], ['pill text', pill], ['card textPrimary', prim], ['card textSecondary', sec]])
      if (v < FLOOR) problems.push(`ModuleScreen ${n}: ${v.toFixed(2)}:1 at worst, under ${FLOOR}:1`)
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
  for (const p of new Set(problems)) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(`hero contrast: OK — white text on all ${rows.length} text backgrounds clears ${FLOOR}:1`)
console.log(`  ramp ${G.BOTTOM_MAX}/${G.RAMP_EXP} · generic +${G.GENERIC_SCRIM} flat · text row `
  + `${CONTENT_BOTTOM}pt above the hero's bottom (read from source, not typed here)`)
console.log('  ' + rows.map(r => `${r.name} ${r.worst.toFixed(2)}`).join(' · '))
if (logoContrast) console.log(`  logo wordmark (non-text, bar = min(today, 3:1)): no atmosphere ${logoContrast.base.toFixed(2)}:1 · worst wash+veil ${logoContrast.worst.toFixed(2)}:1 (${logoContrast.at}) — not counted above`)
if (dotsContrast) console.log(`  oli scene dots (non-text, 3:1): inactive ${dotsContrast.worst.toFixed(2)}:1 worst`)
