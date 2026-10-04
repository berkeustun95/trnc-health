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
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTS = {
  400: 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  500: 'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
  600: 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
  700: 'node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
}
// ─── THE WEIGHT IS DERIVED FROM WHAT THE TILE ACTUALLY RENDERS ──────────────
//
// This defaulted to 500 until 2026-09-12, when the labels went to Inter 700 for weight. A
// guard measuring 500 while the app draws 700 is measuring a face that is not on screen —
// and it would have passed, because 500 is narrower. Two labels that overflow at 700 would
// have shipped broken with a green check beside them.
//
// So it reads ModuleTile's LABEL_FAMILY and the flag that chooses between its two arms.
// An unreadable value is a hard failure; this guard may not guess which font it is
// measuring.
const TILE_SRC = readFileSync(new URL('../components/home/ModuleTile.js', import.meta.url), 'utf8')
const FLAG_SRC = readFileSync(new URL('../constants/flags.js', import.meta.url), 'utf8')
const famMatch = TILE_SRC.match(/const LABEL_FAMILY = (\w+) \? '([^']+)' : '([^']+)'/)
if (!famMatch) {
  console.error('\n  tile labels: could not read LABEL_FAMILY from ModuleTile.js — this guard '
    + 'cannot know which face the labels use, so it fails rather than guessing.\n')
  process.exit(1)
}
const flagOn = new RegExp(`export const ${famMatch[1]} = true`).test(FLAG_SRC)
const ACTIVE_FAMILY = flagOn ? famMatch[2] : famMatch[3]
const WEIGHT = Number((ACTIVE_FAMILY.match(/_(\d{3})/) || [])[1] || 0)
const MANROPE = new URL('../assets/fonts/Manrope-Medium.ttf', import.meta.url)
const FONT_FILE = ACTIVE_FAMILY.startsWith('Manrope') ? MANROPE : FONTS[WEIGHT]
if (!FONT_FILE) {
  console.error(`\n  tile labels: no font file for the active family '${ACTIVE_FAMILY}'.\n`)
  process.exit(1)
}
function loadFont(file) {
const buf = readFileSync(file)

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
function adv(cp) {
  if (advCache.has(cp)) return advCache.get(cp)
  const g = glyphId(cp)
  const idx = Math.min(g, numberOfHMetrics - 1)
  const a = u16(tables.hmtx.off + idx * 4) / unitsPerEm
  advCache.set(cp, a)
  return a
}
  return adv
}

// Zero-width joiners/marks contribute nothing.
const ZERO = new Set([0x200C, 0x200D, 0x200E, 0x200F, 0x00AD, 0xFEFF])
// The active measurer. V2 uses ACTIVE_FAMILY; the redesign section swaps weights.
let advance = loadFont(FONT_FILE)

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
  // Break opportunities are ordinary whitespace only. JS \s also matches U+00A0, but React
  // Native never breaks at a no-break space, and the Emlak tile binds its '·' separators
  // to the word before them with one (menuAccomTile) so no line can START with '·'.
  const words = str.split(/[ \t\n\r]+/).filter(Boolean)
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


// ─── headroom: how much NARROWER the box could get before the string FAILS ──
//
// ⚠ NOT `box - widestLine`. That figure is ~0 BY CONSTRUCTION for anything that wraps,
//   because greedy wrap fills line 1 as full as it will go whatever the box is — so it
//   measures LINE FULLNESS, not risk, and it reports the safest strings in the grid as the
//   most fragile. It cost a real decision once: on 2026-09-08 the French handyman label
//   was shortened to "Bricoleur" on a reported 0.3pt, and reverted the same day (cef3746)
//   once the true figure turned out to be 31.2pt. "Bricoleur" also means a DIY hobbyist
//   rather than the paid odd-job man the category means, so a bad metric came within one
//   commit of degrading the copy it was supposed to protect.
//
//   The two coincide ONLY for a single-word label, which cannot wrap — there, spare IS
//   headroom, and the next stop really is a mid-word break.
//
// Returns -1 for a string that already fails at full width. A binary search rather than a
// formula because the failure condition is greedy wrap's own output, which is what RN
// actually does; deriving it in closed form would be a second model to keep in step.
export function headroom(str, px, box, maxLines) {
  const ok = W => {
    const { lines, midWord } = wrap(str, px, W)
    return !midWord && lines.length <= maxLines
  }
  if (!ok(box)) return -1
  let lo = 0, hi = box
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid }
  return box - hi
}

// ═══ THE CHECK ══════════════════════════════════════════════════════════════
import { HOME_MODULES, GRID_COLUMNS, GRID_LABEL_HEIGHT, ACCOM_TILE_STATES } from '../constants/homeModules.js'
import { HOTEL_ACTIONS } from '../constants/hotels.js'
import { t, LANG_CODES } from '../constants/i18n.js'

// Both widths that matter: a typical modern phone, and the narrowest device in the fold
// table. The narrow one is where every locale except Turkish failed before 2026-09-06.
const WIDTHS = [393, 320]

// ─── THE BOXES ARE SCRAPED FROM THE COMPONENTS, NOT TYPED HERE ──────────────
//
// An earlier version hardcoded `(W - 32) / GRID_COLUMNS - 4` and `(W-32) -28 -44 -18 -28`
// while its comment claimed the numbers were derived. Only GRID_COLUMNS actually was. That
// is the precise shape of this repo's standing hazard — a guard whose FRAME OF REFERENCE
// drifts from the thing it measures — and it is worse here than usual, because the drift
// would be silent in both directions: a narrower tile would stop being flagged, and a wider
// one would flag copy that fits.
//
// So every number below is read out of the file that owns it, and a value that cannot be
// read is a hard failure rather than a default. `num()` returning null is the only way this
// guard is allowed to not know something.
const read = f => readFileSync(resolve(ROOT, f), 'utf8')
function num(file, blockKey, prop) {
  const src = read(file)
  // The style block, from `key:` to its closing brace. Non-greedy so a later block's
  // properties cannot be read as this one's.
  const block = new RegExp(blockKey + ':\\s*\\{[^}]*\\}').exec(src)
  if (!block) return { err: `${file}: no style block named \`${blockKey}\`` }
  const m = new RegExp(prop + ':\\s*(-?[\\d.]+)').exec(block[0])
  if (!m) return { err: `${file}: \`${blockKey}\` has no numeric \`${prop}\`` }
  return { v: parseFloat(m[1]) }
}

const GEOM = {
  pageInset: num('screens/HomeScreen.js',        'v2Below',  'paddingHorizontal'),
  tilePad:   num('components/home/ModuleTile.js', 'tile',    'paddingHorizontal'),
  // ─── THE DUTY FRAME MOVED, AND SO DID THIS ────────────────────────────────
  // It used to scrape components/home/DutyRow.js — a full-width row with 243pt of text.
  // That row was deleted on 2026-09-08 when the duty pharmacy became the right-hand card
  // of the two-up strip, and its text box is now 77pt at 320dp: a third of what this guard
  // was measuring against.
  //
  // ⚠ AND THE SCRAPER WOULD HAVE HARD-FAILED, NOT DRIFTED — readFileSync on a deleted file
  //   throws, so `npm run ota` was blocked the moment the component went. That is the
  //   designed behaviour (a guard that cannot read its subject must not pass), and it is
  //   why this repointing belongs in the same commit as the deletion.
  bandPad:   num('components/home/LiveStrip.js',  'band',    'paddingHorizontal'),
  bandGap:   num('components/home/LiveStrip.js',  'band',    'gap'),
  chevron:   num('components/home/LiveStrip.js',  'chevron', 'width'),
  cardGap:   num('components/home/LiveStrip.js',  'row',     'gap'),
}

const geomErrors = Object.entries(GEOM).filter(([, r]) => r.err).map(([k, r]) => `${k}: ${r.err}`)
if (geomErrors.length) {
  console.error('\n  ┌─ TILE LABEL CHECK CANNOT RUN ──────────────────────────────────┐')
  for (const e of geomErrors) console.error('  │ ' + e)
  console.error('  │ A renamed style or prop moved out from under this guard. It measures')
  console.error('  │ nothing until the scraper is updated, so it fails rather than passes.')
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
const G = Object.fromEntries(Object.entries(GEOM).map(([k, r]) => [k, r.v]))

// ModuleTile sits in a column inset by v2Below on both sides, takes 1/GRID_COLUMNS of it,
// and pads itself horizontally on both sides.
const labelBox = W => (W - G.pageInset * 2) / GRID_COLUMNS - G.tilePad * 2
// The strip's card band: two cards share the page width with one gap between them, then
// each band pads both sides and reserves the chevron plus a gap. 114pt at 393dp, 97 at 360
// and 77 at 320 — tighter than the module-grid label box, with type at 14pt rather than 11.
const cardBox  = W => (W - G.pageInset * 2 - G.cardGap) / 2 - G.bandPad * 2 - G.chevron - G.bandGap

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

// maxLines is a PARAMETER, not the literal 2 it used to be. One grid tile renders its
// label on three lines at a smaller size (see `gridLabel` in constants/homeModules.js),
// and a checker that assumed 2 would have failed that tile for needing the third line it
// is designed to take — then been "fixed" by loosening the rule for every other label.
function assess(label, str, px, box, where, cursive, maxLines = 2, leadingDot = false) {
  checked++
  const { lines, midWord } = wrap(str, px, box)
  // PASS/FAIL is unchanged and has never used the slack figure — it is midWord and the
  // line count, below. The slack is REPORTING only, which is exactly why it was able to
  // stay wrong for so long without any check going red.
  const spare = headroom(str, px, box, maxLines)
  if (spare >= 0 && spare < tightest.spare) tightest = { spare, where, str, box }
  if (!cursive && spare >= 0 && spare < tightestLatin.spare) tightestLatin = { spare, where, str, box }
  if (midWord) {
    problems.push(`${where}: ${JSON.stringify(str)} BREAKS MID-WORD -> ${lines.map(l => JSON.stringify(l)).join(' / ')}`)
  } else if (lines.length > maxLines) {
    problems.push(`${where}: ${JSON.stringify(str)} needs ${lines.length} lines, the box holds ${maxLines} -> `
      + lines.map(l => JSON.stringify(l)).join(' / '))
  } else if (leadingDot && lines.some(l => l.startsWith('·'))) {
    problems.push(`${where}: ${JSON.stringify(str)} wraps a line onto a leading '·' (bind it with U+00A0) -> `
      + lines.map(l => JSON.stringify(l)).join(' / '))
  }
}

for (const W of WIDTHS) {
  for (const L of Object.keys(LANG_CODES)) {
    // The accommodation tile has two label states (HOTELS_LIVE off / on). Both are measured
    // whatever the flag is, so a green check never depends on which state the file is in.
    const modules = [...HOME_MODULES, ...Object.entries(ACCOM_TILE_STATES).map(([k, st]) => ({ id: `accommodation[${k}]`, ...st }))]
    for (const m of modules) {
      // BOTH labels, and dropping either would leave a real surface unmeasured.
      //
      // labelKey is what the FAVOURITES row and the edit sheet's picker render — they do
      // not receive the override — so it stays measured at 11pt / 2 lines for every
      // module including the one that overrides.
      assess('tile', t(m.labelKey, L), 11, labelBox(W), `${W}dp ${L} tile:${m.id}`, CURSIVE.has(L), 2, true)
      // gridLabel is what the GRID renders. Size and line count are READ FROM THE CONFIG,
      // never assumed here: if this file hardcoded 8.5 and 3 it would be a second copy of
      // a number that lives in constants/homeModules.js, and the day somebody tuned one
      // the guard would be measuring a tile that no longer exists — the standing
      // frame-of-reference hazard this file documents at length.
      if (m.gridLabel) {
        assess('tile', t(m.gridLabel.key, L), m.gridLabel.size, labelBox(W),
               `${W}dp ${L} gridLabel:${m.id}`, CURSIVE.has(L), m.gridLabel.lines, true)
      }
    }
    // ─── The hotel card's three action buttons (Oteller) ─────────────────────
    // ONE line each, in the box HotelsTab draws (geometry from constants/hotels.js, never
    // retyped here). "Web sitesi" was ellipsed on every card on the 2026-09-29 device test.
    // The measurement below is only true if EVERY card style draws the button this way. The
    // redesign card (redesignHs, live from 1.3.0) once laid the icon BESIDE the label in its own
    // padding, and this guard stayed green while "Web sitesi" truncated at every width — it was
    // measuring the legacy box. So each `action:` style in HotelsTab must stack icon above label
    // and take its padding and font size from HOTEL_ACTIONS.
    if (W === 320 && L === 'English') {
      const src = readFileSync(resolve(ROOT, 'components/accommodation/HotelsTab.js'), 'utf8')
      const actions = [...src.matchAll(/^\s*action:\s*\{([\s\S]*?)\},\s*$/gm)].map(m => m[1])
      const bad = actions.filter(b => /flexDirection:\s*'row'/.test(b) || !/paddingHorizontal:\s*HOTEL_ACTIONS\.buttonPadX/.test(b))
      const texts = [...src.matchAll(/^\s*actionText:\s*\{([\s\S]*?)\},\s*$/gm)].map(m => m[1])
      const badText = texts.filter(b => !/fontSize:\s*HOTEL_ACTIONS\.fontSize/.test(b))
      if (actions.length < 2 || texts.length < 2) { console.error(`check-tile-labels: expected the legacy AND redesign hotel action styles, found ${actions.length} action / ${texts.length} actionText — measuring nothing`); process.exit(1) }
      if (bad.length || badText.length) {
        console.error(`check-tile-labels: a HotelsTab action style does not use HOTEL_ACTIONS geometry (icon above label, buttonPadX, fontSize), so the hotel button measurement does not describe it:\n${[...bad, ...badText].map(b => '  {' + b.replace(/\s+/g, ' ').trim() + '}').join('\n')}`)
        process.exit(1)
      }
    }
    {
      const A = HOTEL_ACTIONS
      const content = W - 2 * A.listPadX - 2 * A.cardPadX
      const box = (content - 2 * A.gap) / 3 - 2 * A.buttonPadX - 2 * A.border
      for (const k of A.labelKeys) assess('card', t(k, L), A.fontSize, box, `${W}dp ${L} hotelButton:${k}`, CURSIVE.has(L), 1)
    }
    // ─── The strip's card copy ──────────────────────────────────────────────
    // Titles at 14pt over two lines; subtitles at 11pt, which the card renders on ONE, so a
    // subtitle needing two shows up here as a mid-word break or an over-long wrap.
    //
    // The duty ALERT titles are the copy that says WE HAVE LOST THE DUTY ROSTER. They were
    // being ellipsed in every locale before 2026-09-05 — found by this tool, not by review
    // — and they now live in a box a third the width, so they are re-measured here rather
    // than assumed to have survived the move.
    for (const k of ['stripDutyTitle', 'stripDutyPartialTitle', 'stripDutyStaleTitle', 'stripEventsTitle',
                     'stripNoticeTitle']) {
      assess('card', t(k, L), 14, cardBox(W), `${W}dp ${L} card:${k}`, CURSIVE.has(L))
    }
    // The subtitle loop is gone with the subtitles (2026-09-10). Measuring keys that no
    // longer render would be the guard reporting on ghosts — it would keep passing while
    // saying nothing, which is worse than not checking.
  }
}

// ═══ REDESIGNED HOME (feat/redesign) ═══════════════════════════════════════
// The tile label's face, derived (the dev 500/700 toggle is gone; Medium is final): unreadable = fail.
const R_LABEL_WEIGHT = Number(((readFileSync(resolve(ROOT, 'components/home/redesign/ServicePanels.js'), 'utf8')
  .match(/\blabel:\s*\{[^}]*fontFamily:\s*'Inter_(\d{3})/) || [])[1]))
if (![400, 500, 600, 700].includes(R_LABEL_WEIGHT)) {
  console.error('check-tile-labels: cannot read the redesign tile label fontFamily from ServicePanels.js — measuring nothing')
  process.exit(1)
}
// Real Inter metrics, the new geometry, the tile label's weight READ from ServicePanels' style,
// at system font scale 1.0 AND 1.3, at 320 / 360 / 393dp, in all 9 locales. Each element's
// maxFontSizeMultiplier is READ FROM SOURCE and applied: effective px = px · min(scale, cap).
// Everything is read from source; a renamed style or constant fails the guard rather than
// passing on a box it no longer measures. (Berke's device showed "Exchange Rates" running
// into "Welcome Guide" at a large system font — the 1.0-only version of this check was blind.)
const constNum = (file, name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*(-?[\\d.]+)`).exec(read(file))
  return m ? { v: parseFloat(m[1]) } : { err: `${file}: no numeric const ${name}` }
}
const RGEOM = {
  page:       num('screens/HomeScreen.js', 'rBelow', 'paddingHorizontal'),
  widgetGap:  num('screens/HomeScreen.js', 'rWidgets', 'gap'),
  panelGut:   constNum('components/home/redesign/ServicePanels.js', 'PANEL_GUTTER'),
  tilePad:    constNum('components/home/redesign/ServicePanels.js', 'TILE_PAD'),
  labelCap:   constNum('components/home/redesign/ServicePanels.js', 'LABEL_CAP'),
  labelCapN:  constNum('components/home/redesign/ServicePanels.js', 'LABEL_CAP_NARROW'),
  narrowW:    constNum('components/home/redesign/ServicePanels.js', 'NARROW_W'),
  tileCap:    constNum('components/home/redesign/Widgets.js', 'TILE_FONT_CAP'),
  tileCapN:   constNum('components/home/redesign/Widgets.js', 'TILE_FONT_CAP_NARROW'),
  chipCap:    constNum('components/home/redesign/RedesignHero.js', 'CHIP_CAP'),
  chipCapN:   constNum('components/home/redesign/RedesignHero.js', 'CHIP_CAP_NARROW'),
  chipPad:    constNum('components/home/redesign/RedesignHero.js', 'CHIP_PAD'),
  chipGap:    constNum('components/home/redesign/RedesignHero.js', 'CHIP_GAP'),
  infoIcon:   constNum('components/home/redesign/RedesignHero.js', 'INFO_ICON'),
  wxPad:      constNum('components/home/redesign/RedesignHero.js', 'WX_PAD'),
  wxIcon:     constNum('components/home/redesign/RedesignHero.js', 'WX_ICON'),
  rowGap:     constNum('components/home/redesign/RedesignHero.js', 'ROW_GAP'),
  bandPad:    num('components/home/redesign/Widgets.js', 'band', 'paddingHorizontal'),
  tileH:      constNum('components/home/redesign/Widgets.js', 'TILE_H'),
  tileHA:     constNum('components/home/redesign/Widgets.js', 'TILE_H_ALERT'),
  arrowW:     constNum('components/home/redesign/Widgets.js', 'ARROW_W'),
  oliH:       constNum('components/home/redesign/OliBar.js', 'OLI_BAR_H'),
  fadeHold:   constNum('components/home/redesign/OliBar.js', 'TEXT_ZONE'),
  textLeft:   constNum('components/home/redesign/OliBar.js', 'TEXT_LEFT'),
  pillPad:    constNum('components/home/redesign/OliBar.js', 'PILL_PAD'),
  oliCap:     constNum('components/home/redesign/OliBar.js', 'OLI_FONT_CAP'),
  oliCapN:    constNum('components/home/redesign/OliBar.js', 'OLI_FONT_CAP_NARROW'),
}
const rErr = Object.entries(RGEOM).filter(([, r]) => r.err).map(([k, r]) => `redesign ${k}: ${r.err}`)
if (rErr.length) { for (const e of rErr) problems.push(e) } else {
  const R = Object.fromEntries(Object.entries(RGEOM).map(([k, r]) => [k, r.v]))
  const WIDTHS_R = [320, 360, 393]
  const SCALES = [1.0, 1.3]
  const rTile   = W => (W - R.page * 2 - R.panelGut * 2) / 4               // one panel column
  const rLabel  = W => rTile(W) - R.tilePad * 2                              // the label box
  const rCard   = W => (W - R.page * 2 - R.widgetGap) / 2                    // duty / weather card
  const rBand   = W => rCard(W) - R.bandPad * 2                              // full band width (alert line)
  const rTitle  = W => rBand(W) - R.arrowW                                   // band title, beside the arrow
  const lCap = W => (W < R.narrowW ? R.labelCapN : R.labelCap)             // width-aware caps, as rendered
  const tCap = W => (W < 350 ? R.tileCapN : R.tileCap)
  const fonts = {}
  const use = w => { advance = fonts[w] ??= loadFont(FONTS[w]) }
  const extraKeys = [...read('constants/homeGroups.js').matchAll(/labelKey:\s*'([a-zA-Z0-9_]+)'/g)].map(m => m[1])
  const groupKeys = [...read('constants/homeGroups.js').matchAll(/titleKey:\s*'([a-zA-Z0-9_]+)'/g)].map(m => m[1])
  if (!extraKeys.length || !groupKeys.length) problems.push('redesign: read ZERO keys from constants/homeGroups.js')
  const BADGE_KEY = (/soonText[^>]*>\{t\('([a-zA-Z0-9_]+)'/.exec(read('components/home/redesign/ServicePanels.js')) || [])[1]
  if (!BADGE_KEY) problems.push('redesign: could not read the Yakında badge key from ServicePanels.js')
  const { tCount } = await import('../constants/i18n.js')
  const { REGION_LABEL_KEY } = await import('../constants/regions.js')
  const { untilTr } = await import('../utils/turkishTime.js')
  const { WEATHER_LABEL_KEY } = await import('../utils/facilityUtils.js')
  const UNTILS = ['00:00', '19:00', '20:00', '22:00']
  // region → landmark, read from homeHero.js TEXT (it requires images, so it cannot be imported)
  const bandSrc = read('components/ui/OliBand.js')
  const BAND = { zone: parseFloat((/BAND_TEXT_ZONE = ([\d.]+)/.exec(bandSrc) || [])[1]),
                 left: parseFloat((/BAND_TEXT_LEFT = ([\d.]+)/.exec(bandSrc) || [])[1]),
                 cap: parseFloat((/BAND_FONT_CAP = ([\d.]+)/.exec(bandSrc) || [])[1]),
                 capN: parseFloat((/BAND_FONT_CAP_NARROW = ([\d.]+)/.exec(bandSrc) || [])[1]) }
  if (!(BAND.zone > 0) || !(BAND.left >= 0)) problems.push('redesign: cannot read OliBand text zone')
  const HERO_LANDMARKS = {}
  for (const m of read('constants/homeHero.js').matchAll(/^  ([a-z_]+): \{[\s\S]*?landmark: '([^']+)'/gm)) HERO_LANDMARKS[m[1]] = m[2]
  if (Object.keys(HERO_LANDMARKS).length < 5) problems.push(`redesign: read only ${Object.keys(HERO_LANDMARKS).length} hero landmarks from homeHero.js`)
  let rTight = { spare: Infinity }
  const rAssess = (w, str, px, cap, scale, box, where, cursive, lines) => {
    use(w); checked++
    const eff = px * Math.min(scale, cap)
    const { lines: got, midWord } = wrap(str, eff, box)
    const spare = headroom(str, eff, box, lines)
    if (!cursive && spare >= 0 && spare < rTight.spare) rTight = { spare, where, str, box }
    if (midWord) problems.push(`${where}: ${JSON.stringify(str)} BREAKS MID-WORD in ${box.toFixed(1)}pt at ${eff.toFixed(1)}px -> ${got.map(l => JSON.stringify(l)).join(' / ')}`)
    else if (got.length > lines) problems.push(`${where}: ${JSON.stringify(str)} needs ${got.length} lines, has ${lines} (${box.toFixed(1)}pt at ${eff.toFixed(1)}px)`)
  }
  for (const W of WIDTHS_R) for (const S of SCALES) for (const L of Object.keys(LANG_CODES)) {
    const cur = CURSIVE.has(L), at = `redesign ${W}dp ×${S} ${L}`
    for (const w of [R_LABEL_WEIGHT]) {
      for (const m of HOME_MODULES) {
        rAssess(w, t(m.labelKey, L), 11, lCap(W), S, rLabel(W), `${at} ${w} tile:${m.id}`, cur, 2)
        if (m.gridLabel) rAssess(w, t(m.gridLabel.key, L), m.gridLabel.size, lCap(W), S, rLabel(W), `${at} ${w} gridLabel:${m.id}`, cur, m.gridLabel.lines)
      }
      for (const k of extraKeys) rAssess(w, t(k, L), 11, lCap(W), S, rLabel(W), `${at} ${w} tile:${k}`, cur, 2)
    }
    rAssess(600, t(BADGE_KEY, L), 9.5, lCap(W), S, rTile(W) - 12, `${at} badge:${BADGE_KEY}`, cur, 1)
    for (const k of groupKeys) rAssess(600, t(k, L), 15, lCap(W), S, rTile(W) * 4 - 24 - 16, `${at} panel:${k}`, cur, 1)
    // Home v3 tiles — px and numberOfLines MIRROR Widgets.js: titles 13/600 × 2 beside the
    // arrow, alert line 12/600 × 2 under it, corner numbers 12/700 × 1. Change one, change both.
    // HEIGHT too: the text block (lines as actually wrapped) + band padding must sit below the
    // badge row (10 + 28 + 2) inside TILE_H, or TILE_H_ALERT when the alert line is present.
    const tileText = (w, str, px, box) => { use(w); return wrap(str, px * Math.min(S, tCap(W)), box).lines.length }
    const fitH = (H, parts, where) => {
      const h = 40 + parts.reduce((acc, [n, lh]) => acc + n * lh * Math.min(S, tCap(W)), 0) + 1 + 8
      if (h > H + 0.01) problems.push(`${where}: text block needs ${h.toFixed(1)}pt, tile is ${H}pt`)
    }
    for (const key of ['stripDutyTitle', 'menuEmergency']) {
      rAssess(600, t(key, L), 13, tCap(W), S, rTitle(W), `${at} tile:${key}`, cur, 2)
      fitH(R.tileH, [[tileText(600, t(key, L), 13, rTitle(W)), 17]], `${at} tile:${key} height`)
    }
    for (const k of ['hrDutyTileAlertPartial', 'hrDutyTileAlertDown']) {
      rAssess(600, t(k, L), 12, tCap(W), S, rBand(W), `${at} duty:${k}`, cur, 2)
      fitH(R.tileHA, [[tileText(600, t('stripDutyTitle', L), 13, rTitle(W)), 17], [tileText(600, t(k, L), 12, rBand(W)), 16]], `${at} duty:${k} height`)
    }
    rAssess(700, '112 · 155 · 199', 12, tCap(W), S, rCard(W) - 10 - 28 - 6 - 12, `${at} emergency:corner`, false, 1)
    // Oli bar (full scene): contrast is proven only inside TEXT_ZONE (check-hero-contrast), so the
    // title (20/700 × 1) and the pill must END inside it: zone = card · TEXT_ZONE − TEXT_LEFT, card =
    // W − 2·page. Pill = text 13/500 + gap 4 + arrow icon 14 (icons do not scale) + 2·PILL_PAD
    // + 2 border. Height: title 26 + gap 10 + pill (17 + 12 + 2) inside the card, 8pt clear.
    const oCap = W < 350 ? R.oliCapN : R.oliCap
    const zone = (W - R.page * 2) * R.fadeHold - R.textLeft
    rAssess(700, t('hrOliBarTitle', L), 20, oCap, S, zone, `${at} oli:title`, cur, 1)
    rAssess(500, t('hrOliAskSub', L), 13, oCap, S, zone - 4 - 14 - R.pillPad * 2 - 2, `${at} oli:pill`, cur, 1)
    {
      const c = Math.min(S, oCap), h = 26 * c + 10 + 17 * c + 14
      if (h > R.oliH - 16 + 0.01) problems.push(`${at} oli: text block needs ${h.toFixed(1)}pt, the card has ${R.oliH - 16}`)
    }
    // Hero row (weather chip = icon + temperature only). At 360dp and up the WHOLE
    // "{district} · {landmark}" must fit, each district with ITS OWN landmark (homeHero.js);
    // below 360 only the landmark may ellipsize, so the district alone must fit.
    //   location = 2·CHIP_PAD + 3·CHIP_GAP + district + "·" + landmark + INFO_ICON
    //   weather  = 2·WX_PAD + WX_ICON + 4 + "-12°"   ·  + ROW_GAP (space-between, one gap)
    {
      use(600)
      const cCap = W < 350 ? R.chipCapN : R.chipCap
      const eff = 12 * Math.min(S, cCap)
      const wd = str => width(str, eff)
      const fixed = 2 * R.chipPad + 3 * R.chipGap + R.infoIcon + 2 * R.wxPad + R.wxIcon + 4 + wd('-12°') + R.rowGap
      const box = W - 32 - fixed
      for (const [region, key] of Object.entries(REGION_LABEL_KEY)) {
        const lm = HERO_LANDMARKS[region]
        // FULL text: at 360dp+ at default size, and at 393dp+ at every size. At 360dp with the
        // largest font the landmark may ellipsize (keeping the chip's 1.2 cap for large-text
        // users was chosen over a ~1.05 cap that would fit it) — the district must still fit.
        if (lm && (W >= 393 || (W >= 360 && S === 1.0))) {
          const need = wd(t(key, L)) + wd('·') + wd(lm)
          if (need > box + 0.01) problems.push(`${at} heroRow:${region}: "${t(key, L)} · ${lm}" needs ${need.toFixed(1)}pt, has ${box.toFixed(1)}pt`)
          checked++
        } else {
          rAssess(600, t(key, L), 12, cCap, S, box - wd('·') - wd('…'), `${at} heroRow:${key}`, cur, 1)
        }
      }
    }
    // S3 ContactBar: equal-width buttons. Label box = button − 2·CONTACT_PAD − icon − 6.
    // In a list card (inner = W − 2·page − 2·14) and in the sticky detail bar (W − 2·16),
    // rows of 1..CONTACT_MAX actions (labelledCount labelled, up to 2 lines; the rest icon-only).
    {
      const cs = read('components/ui/ContactBar.js')
      const cn = name => parseFloat((new RegExp(`export const ${name} = ([\\d.]+)`).exec(cs) || [])[1])
      const [CP, CG, CI, CC, CCN, CIB, CM] = ['CONTACT_PAD', 'CONTACT_GAP', 'CONTACT_ICON', 'CONTACT_FONT_CAP',
        'CONTACT_FONT_CAP_NARROW', 'CONTACT_ICON_BTN', 'CONTACT_MAX'].map(cn)
      const labelled = n => (n <= 2 ? n : 1)   // mirrors labelledCount in ContactBar.js
      if (!/export const labelledCount = n => \(n <= 2 \? n : 1\)/.test(cs)) problems.push('redesign: ContactBar labelledCount changed — update the mirror in labels:check')
      if ([CP, CG, CI, CC, CCN, CIB, CM].some(v => !(v > 0))) problems.push('redesign: cannot read ContactBar geometry')
      else {
        const labels = { call: t('call', L), getDirections: t('getDirections', L), visitWebsite: t('visitWebsite', L), whatsapp: 'WhatsApp' }
        for (const [where, inner] of [['card', W - R.page * 2 - 28], ['sticky', W - 32]]) for (let n = 1; n <= CM; n++) {
          // the labelled buttons share what the icon-only buttons leave
          const lab = labelled(n), icons = n - lab
          const box = (inner - CIB * icons - CG * (n - 1)) / lab - 2 * CP - CI - 6
          for (const [k, v] of Object.entries(labels)) rAssess(600, v, 13, W < 350 ? CCN : CC, S, box, `${at} contact:${where}×${n}:${k}`, cur, 2)
        }
      }
    }
    // Welcome A headline: centred, full width (page 24), ≤ 3 lines, growth bandCap.
    {
      const ws = read('screens/WelcomeScreen.js')
      const hp = parseFloat((/WELCOME_HEAD_PX = ([\d.]+)/.exec(ws) || [])[1])
      if (!(hp > 0)) problems.push('redesign: cannot read the Welcome headline geometry')
      else rAssess(700, t('hrWelcomeHeadline', L), hp, W < 350 ? BAND.capN : BAND.cap, S, W - 48, `${at} welcome:headline`, cur, 3)
    }
    // S2b OliBand text: welcome tagline 18/700 × 4 and the sign-in titles 18/700 × 3 (cap: bandCap)
    // (login, signup, reset, account created), all inside BAND_TEXT_ZONE·W − BAND_TEXT_LEFT.
    {
      const bandZone = W * BAND.zone - BAND.left
      const bCap = W < 350 ? BAND.capN : BAND.cap
      rAssess(700, t('welcomeTagline', L), 18, bCap, S, bandZone, `${at} band:welcomeTagline`, cur, 4)
      for (const k of ['login', 'signup', 'resetPassword', 'accountCreated'])
        rAssess(700, t(k, L), 18, bCap, S, bandZone, `${at} band:${k}`, cur, 3)
    }
  }
  use(WEIGHT || 700)
  console.log(`  redesign: ${WIDTHS_R.join('/')}dp × font scale ${SCALES.join('/')}; label box ${rLabel(320).toFixed(1)}pt, `
    + `band ${rBand(320).toFixed(1)}pt at 320dp; tightest ${JSON.stringify(rTight.str)} at ${rTight.where}, ${rTight.spare.toFixed(1)}pt headroom`)
}

if (checked === 0) {
  problems.push('measured ZERO strings — HOME_MODULES or LANG_CODES came back empty, so this '
    + 'guard was about to pass on nothing')
}

if (problems.length) {
  console.error('\n  ┌─ TILE LABEL CHECK FAILED ──────────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  // The old wording said "the box is a fixed two lines", which stopped being true for
  // every label when gridLabel arrived. It is the HEIGHT that is fixed — 32pt — while the
  // line count is per label and the lineHeight is derived from it. A failure message that
  // misdescribes the constraint sends the reader to change the wrong number.
  console.error(`  ${problems.length} of ${checked} strings do not fit. The label box is a fixed `
    + `${GRID_LABEL_HEIGHT}pt in every locale; a label's line count divides it rather than `
    + `growing it, so the grid keeps one row rhythm. Shorten the copy, or — for a gridLabel `
    + `— lower its \`size\` in constants/homeModules.js.\n`)
  process.exit(1)
}
console.log(`tile labels: OK — ${checked} strings from ${ACTIVE_FAMILY} (the face ModuleTile actually renders) at ${WIDTHS.join('dp / ')}dp`)
console.log(`  geometry read from source: page inset ${G.pageInset}, tile pad ${G.tilePad}, `
  + `card gap ${G.cardGap}/band pad ${G.bandPad}/gap ${G.bandGap}/chevron ${G.chevron} `
  + `-> label box ${labelBox(320).toFixed(1)}pt, card band ${cardBox(320).toFixed(1)}pt at 320dp`)
console.log(`  tightest (shaped scripts excluded): ${JSON.stringify(tightestLatin.str)} `
  + `at ${tightestLatin.where}, ${tightestLatin.spare.toFixed(1)}pt HEADROOM of a ${tightestLatin.box.toFixed(1)}pt box`)
console.log(`  tightest overall:                   ${JSON.stringify(tightest.str)} `
  + `at ${tightest.where}, ${tightest.spare.toFixed(1)}pt HEADROOM `
  + `${CURSIVE.has(tightest.where.split(' ')[1]) ? '(UPPER BOUND — cursive, real width is narrower)' : ''}`)
