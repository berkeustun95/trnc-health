#!/usr/bin/env node
// ─── Tile-label overflow, measured from the SHIPPED FONT ────────────────────
//
//   node scripts/check-tile-labels.mjs
//
// WHY THIS EXISTS. "Property & Accommodation" rendered as "Property & Acc / ommodation" on
// a real phone, and four rounds of locale sweeps had missed it — because they were done in
// characters, or with an average advance of ~0.52em. An average cannot answer this
// question at all:
//
//     "Accommodation"   13 chars   86.1pt      <- the SHORTER string is WIDER
//     "Property & Acc"  14 chars   79.1pt
//
// At 11pt Inter an `m` is 9.77pt and an `i` is 2.77pt, so any per-character model is wrong
// by more than the margin being measured. The label box is 86.25pt at 393dp and
// "Accommodation" is 86.1pt: it was 0.15pt inside the line, which no estimate could have
// resolved. So this reads real advance widths out of the TTF the app actually bundles.
//
// It parses the sfnt table directory, `head` (unitsPerEm), `cmap` format 4 (BMP — every
// script here is in it), `hhea` (numberOfHMetrics) and `hmtx` (advances), then simulates
// React Native's greedy wrap: a word too wide for an empty line is broken INSIDE, which is
// the mid-word break this guard exists to forbid.
//
// ─── HONEST LIMITS, because they change how to read a failure ───────────────
//   • No kerning and no ligatures. Inter's pairs are small at 11pt and the error runs
//     WIDE, which is the conservative direction for an overflow check.
//   • No complex shaping. Arabic and Persian are cursive: this sums ISOLATED forms, which
//     are wider than the joined ones that actually render. ar/fa figures are UPPER BOUNDS,
//     so a failure there should be confirmed on a device before copy is changed for it.
//   • It measures the GRID/SHORTCUT tile label and the Nöbetçi row title. It is not a
//     general layout checker and does not know about any other surface.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the counts and the tightest string, so the margin can be
//   read rather than trusted. A guard that prints only "OK" cannot be told apart from one
//   whose scraper matched nothing.
import { readFileSync } from 'node:fs'

const FONTS = {
  400: 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  500: 'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
  600: 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
  700: 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
}
const WEIGHT = Number(process.env.INTER_WEIGHT || 500)   // 400 | 500 | 600 | 700
const buf = readFileSync(FONTS[WEIGHT])

const u16 = o => buf.readUInt16BE(o)
const i16 = o => buf.readInt16BE(o)
const u32 = o => buf.readUInt32BE(o)

// ─── sfnt table directory ───────────────────────────────────────────────────
const numTables = u16(4)
const tables = {}
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16
  tables[buf.toString('ascii', o, o + 4)] = { off: u32(o + 8), len: u32(o + 12) }
}
for (const t of ['head', 'hhea', 'hmtx', 'cmap']) {
  if (!tables[t]) throw new Error(`font has no ${t} table — cannot measure`)
}

const unitsPerEm      = u16(tables.head.off + 18)
const numberOfHMetrics = u16(tables.hhea.off + 34)

// ─── cmap: prefer format 4 (BMP) — every script here is in the BMP ──────────
function pickSubtable() {
  const base = tables.cmap.off
  const n = u16(base + 2)
  let best = null
  for (let i = 0; i < n; i++) {
    const rec = base + 4 + i * 8
    const platform = u16(rec), encoding = u16(rec + 2), off = base + u32(rec + 4)
    const format = u16(off)
    if (format === 4 && (platform === 3 && (encoding === 1 || encoding === 0))) best = best || off
    if (format === 4 && platform === 0) best = best || off
  }
  if (best == null) throw new Error('no usable cmap format 4 subtable')
  return best
}
const cm = pickSubtable()
const segCountX2 = u16(cm + 6)
const segCount   = segCountX2 / 2
const endO   = cm + 14
const startO = endO + segCountX2 + 2
const deltaO = startO + segCountX2
const rangeO = deltaO + segCountX2

function glyphId(cp) {
  if (cp > 0xFFFF) return 0
  for (let i = 0; i < segCount; i++) {
    if (u16(endO + i * 2) < cp) continue
    const start = u16(startO + i * 2)
    if (start > cp) return 0
    const delta = i16(deltaO + i * 2)
    const ro    = u16(rangeO + i * 2)
    if (ro === 0) return (cp + delta) & 0xFFFF
    const gi = u16(rangeO + i * 2 + ro + (cp - start) * 2)
    return gi === 0 ? 0 : (gi + delta) & 0xFFFF
  }
  return 0
}

const advCache = new Map()
function advance(cp) {
  if (advCache.has(cp)) return advCache.get(cp)
  const g = glyphId(cp)
  const idx = Math.min(g, numberOfHMetrics - 1)
  const a = u16(tables.hmtx.off + idx * 4) / unitsPerEm
  advCache.set(cp, a)
  return a
}

// Zero-width joiners/marks contribute nothing.
const ZERO = new Set([0x200C, 0x200D, 0x200E, 0x200F, 0x00AD, 0xFEFF])
export function width(str, px) {
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    if (ZERO.has(cp)) continue
    w += advance(cp) * px
  }
  return w
}

// ─── Greedy wrap, matching RN: a word too wide for an empty line breaks mid-word ──
export function wrap(str, px, maxW) {
  const words = str.split(/\s+/).filter(Boolean)
  const lines = []
  let cur = '', midWord = false
  const push = () => { if (cur) { lines.push(cur); cur = '' } }
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word
    if (width(trial, px) <= maxW) { cur = trial; continue }
    push()
    if (width(word, px) <= maxW) { cur = word; continue }
    // The word alone does not fit: RN fills the line and breaks inside it.
    midWord = true
    let piece = ''
    for (const ch of word) {
      if (width(piece + ch, px) > maxW) { lines.push(piece); piece = ch }
      else piece += ch
    }
    cur = piece
  }
  push()
  return { lines, midWord }
}


// ═══ THE CHECK ══════════════════════════════════════════════════════════════
import { HOME_MODULES, GRID_COLUMNS } from '../constants/homeModules.js'
import { t, LANG_CODES } from '../constants/i18n.js'

// Both widths that matter: a typical modern phone, and the narrowest device in the fold
// table. The narrow one is where every locale except Turkish failed before 2026-09-06.
const WIDTHS = [393, 320]
// ModuleTile: width `100/GRID_COLUMNS`% of a column already inset 16pt each side, minus
// the tile's own paddingHorizontal: 2. Derived, so a change to either number is picked up.
const labelBox = W => (W - 32) / GRID_COLUMNS - 4
// DutyRow: padding 14 each side, iconTile 44, chevron 18, two 14pt gaps.
const dutyBox  = W => (W - 32) - 28 - 44 - 18 - 28

const problems = []
let checked = 0
// TWO tightest figures, because one of them would be misleading on its own. Arabic and
// Persian sum isolated forms, so their widths are UPPER BOUNDS and a 0.1pt margin there is
// not a real 0.1pt margin — reporting it as the headline would make the whole run look
// like it was about to fail when it is not. The shaped-script figure is still printed,
// labelled for what it is.
const CURSIVE = new Set(['Arabic', 'Persian'])
let tightest = { spare: Infinity }
let tightestLatin = { spare: Infinity }

function assess(label, str, px, box, where, cursive) {
  checked++
  const { lines, midWord } = wrap(str, px, box)
  const widest = Math.max(...lines.map(l => width(l, px)))
  const spare = box - widest
  if (spare < tightest.spare) tightest = { spare, where, str, box }
  if (!cursive && spare < tightestLatin.spare) tightestLatin = { spare, where, str, box }
  if (midWord) {
    problems.push(`${where}: ${JSON.stringify(str)} BREAKS MID-WORD -> ${lines.map(l => JSON.stringify(l)).join(' / ')}`)
  } else if (lines.length > 2) {
    problems.push(`${where}: ${JSON.stringify(str)} needs ${lines.length} lines, the box holds 2 -> `
      + lines.map(l => JSON.stringify(l)).join(' / '))
  }
}

for (const W of WIDTHS) {
  for (const L of Object.keys(LANG_CODES)) {
    for (const m of HOME_MODULES) {
      assess('tile', t(m.labelKey, L), 11, labelBox(W), `${W}dp ${L} tile:${m.id}`, CURSIVE.has(L))
    }
    // The Nöbetçi row's three states. Its ALERT titles are the copy that says WE HAVE LOST
    // THE DUTY ROSTER, and they were being ellipsed in every locale before 2026-09-05 —
    // found by this tool, not by review.
    for (const k of ['tonightDuty', 'dutyBannerPartialTitle', 'dutyBannerStaleTitle']) {
      assess('duty', t(k, L), 16, dutyBox(W), `${W}dp ${L} duty:${k}`, CURSIVE.has(L))
    }
  }
}

if (checked === 0) {
  problems.push('measured ZERO strings — HOME_MODULES or LANG_CODES came back empty, so this '
    + 'guard was about to pass on nothing')
}

if (problems.length) {
  console.error('\n  ┌─ TILE LABEL CHECK FAILED ──────────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  console.error(`  ${problems.length} of ${checked} strings do not fit. Shorten the copy — the box is a `
    + `fixed two lines so the grid keeps one shape in all nine locales.\n`)
  process.exit(1)
}
console.log(`tile labels: OK — ${checked} strings from Inter_${WEIGHT} at ${WIDTHS.join('dp / ')}dp`)
console.log(`  tightest (shaped scripts excluded): ${JSON.stringify(tightestLatin.str)} `
  + `at ${tightestLatin.where}, ${tightestLatin.spare.toFixed(1)}pt spare of ${tightestLatin.box.toFixed(1)}pt`)
console.log(`  tightest overall:                   ${JSON.stringify(tightest.str)} `
  + `at ${tightest.where}, ${tightest.spare.toFixed(1)}pt spare `
  + `${CURSIVE.has(tightest.where.split(' ')[1]) ? '(UPPER BOUND — cursive,real width is narrower)' : ''}`)
