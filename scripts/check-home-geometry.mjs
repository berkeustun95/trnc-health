#!/usr/bin/env node
// ─── Home V2 geometry: sizes that are not what anyone thinks they are ────────
//
//   node scripts/check-home-geometry.mjs
//
// Two failures in this slice were the same shape, and neither produced an error:
//
//   • The wordmark's style said 168x60 while `contain` on a square asset drew it at
//     26x32. Three polish rounds went into an aesthetic complaint whose cause was
//     arithmetic. (Guarded by scripts/check-hero-logo.mjs.)
//
//   • A scripted edit deleted OliRow's `mascot` style. `<Image style={undefined}>` falls
//     back to the asset's INTRINSIC size — 1024x1024dp — so the mascot covered the module
//     grid and the tab bar. JS has no error for a missing style key.
//
// Both are "a size nobody declared". This asserts the things a screenshot would otherwise
// have to catch.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR  = 'components/home'
const problems = []
let fontReport = 'fonts: not checked'
const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const num  = (src, name) => {
  const m = src.match(new RegExp(`(?:export )?const ${name}\\s*=\\s*(-?[\\d.]+)`))
  return m ? parseFloat(m[1]) : null
}

// ─── A. Every `s.X` used must be defined ────────────────────────────────────
// The general form of the mascot bug. A missing key is silently `undefined`, and for an
// Image that means intrinsic size; for a View it means no layout at all.
for (const f of readdirSync(resolve(ROOT, DIR)).filter(n => n.endsWith('.js'))) {
  const src = read(join(DIR, f))
  const i = src.indexOf('StyleSheet.create')
  if (i === -1) continue
  const used = [...new Set([...src.matchAll(/style=\{(?:\[)?s\.([A-Za-z0-9_]+)/g)].map(m => m[1]))]
  const defined = new Set([...src.slice(i).matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{/gm)].map(m => m[1]))
  for (const u of used) {
    if (!defined.has(u)) {
      problems.push(`${DIR}/${f}: style \`s.${u}\` is used but never defined — `
        + `it resolves to undefined, which for an Image means its INTRINSIC pixel size`)
    }
  }
}

// ─── B. The mascot cannot exceed the banner plus its declared overhang ──────
const oli    = read(`${DIR}/OliRow.js`)
const layout = read(`${DIR}/homeLayout.js`)

const MASCOT_BOX   = num(oli, 'MASCOT_BOX')
const CARD_H       = num(oli, 'CARD_H')
const HEADROOM     = num(oli, 'HEADROOM')
const ASSET_TOP    = num(oli, 'ASSET_TOP')
const ASSET_BOTTOM = num(oli, 'ASSET_BOTTOM')
const OLI_OVERHANG = num(layout, 'OLI_OVERHANG')
const HERO_OVERLAP = num(layout, 'HERO_OVERLAP')

if ([MASCOT_BOX, CARD_H, HEADROOM, ASSET_TOP, ASSET_BOTTOM, OLI_OVERHANG, HERO_OVERLAP].some(v => v == null)) {
  problems.push('could not read the Oli geometry constants — a rename needs this guard updated')
} else {
  // The style must declare an EXPLICIT box. Without width/height an Image is intrinsic.
  const mStyle = oli.match(/mascot:\s*\{[^}]*\}/s)
  if (!mStyle) problems.push(`${DIR}/OliRow.js: no \`mascot\` style block found`)
  else {
    if (!/width:\s*MASCOT_BOX/.test(mStyle[0]) || !/height:\s*MASCOT_BOX/.test(mStyle[0])) {
      problems.push(`${DIR}/OliRow.js: the mascot style must set width AND height from MASCOT_BOX. `
        + `An Image without an explicit box renders at its intrinsic size (1024dp for this asset)`)
    }
    if (!/position:\s*'absolute'/.test(mStyle[0])) {
      problems.push(`${DIR}/OliRow.js: the mascot must stay position:'absolute' — in flow it grows the card`)
    }
  }

  // Where his INK lands, from the asset's measured alpha bounds.
  const artH      = (1 - ASSET_TOP - ASSET_BOTTOM) * MASCOT_BOX
  const inkAbove  = artH - CARD_H          // how far his artwork rises above the card top
  const inkBelow  = 0                      // bottom offset pins the artwork to the card's edge
  const wrapH     = CARD_H + OLI_OVERHANG + HEADROOM

  if (Math.abs(inkAbove - OLI_OVERHANG) > 1) {
    problems.push(`OLI_OVERHANG is ${OLI_OVERHANG} but MASCOT_BOX ${MASCOT_BOX} puts his ink `
      + `${inkAbove.toFixed(1)}pt above the card. The hero reserves space from OLI_OVERHANG, so a `
      + `mismatch means he overlaps the district chip (too big) or floats (too small). `
      + `Set OLI_OVERHANG to ${Math.round(inkAbove)}.`)
  }
  if (inkAbove > wrapH - CARD_H) {
    problems.push(`his ink rises ${inkAbove.toFixed(1)}pt above the card but the wrap only extends `
      + `${(wrapH - CARD_H).toFixed(1)}pt above it — the top of him would be clipped on Android`)
  }
  if (inkBelow > 0) {
    problems.push(`his ink extends ${inkBelow}pt below the card's bottom edge — it would overlap `
      + `the duty pharmacy row`)
  }
  // The declared box, positioned as the style says, must sit inside the wrap.
  const boxBottomBelowWrap = Math.round(MASCOT_BOX * ASSET_BOTTOM) - 0
  const boxTopAboveWrap    = MASCOT_BOX - boxBottomBelowWrap - wrapH
  if (boxTopAboveWrap > 0) {
    problems.push(`the mascot's BOX overflows the wrap's top by ${boxTopAboveWrap.toFixed(1)}pt; `
      + `Android may clip it. Raise HEADROOM or shrink MASCOT_BOX.`)
  }
}

// ─── C. Every font family used here must be REGISTERED in App.js ────────────
// Third instance of "a value that is not what anyone thinks it is", and the cheapest to
// get wrong. React Native has no error for an unregistered fontFamily — it silently
// substitutes the platform default (Roboto on Android), so the text renders in the wrong
// TYPEFACE, not merely the wrong weight, and nothing anywhere says so.
//
// It has already happened twice in this repo: ModuleGrid's labels named Inter_600SemiBold
// while useFonts registered only 400 and 700, and sixteen further references across
// screens/games/* and HomeScreen had never once drawn in Inter.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the families found, so the list can be read rather than
//   trusted. A guard that says only "OK" cannot be told apart from one that matched
//   nothing — and a regex that silently stops matching is the failure mode here, since
//   both sides of this comparison are scraped from source.
const appSrc = read('App.js')
const useFontsBlock = appSrc.match(/useFonts\(\{[\s\S]*?\}\)/)
if (!useFontsBlock) {
  problems.push('App.js: could not find the useFonts({...}) call — this guard cannot run, '
    + 'and a guard that cannot run must fail rather than pass silently')
} else {
  const registered = new Set([...useFontsBlock[0].matchAll(/\b([A-Za-z]+_\d{3}[A-Za-z]+)\b/g)].map(m => m[1]))
  if (registered.size === 0) {
    problems.push('App.js: the useFonts block matched zero font names — the regex or the '
      + 'call shape changed, so this check was about to pass on everything')
  }
  const usedFamilies = new Map()
  for (const f of readdirSync(resolve(ROOT, DIR)).filter(n => n.endsWith('.js'))) {
    const src = read(join(DIR, f))
    // Only real style values: `fontFamily: 'X'`. A family named in a COMMENT is prose —
    // this file's own notes discuss Inter_400Regular and Inter_600SemiBold by name, and
    // matching those would forbid the comments that explain the bug.
    for (const m of src.matchAll(/fontFamily:\s*'([^']+)'/g)) {
      if (!usedFamilies.has(m[1])) usedFamilies.set(m[1], `${DIR}/${f}`)
    }
  }
  if (usedFamilies.size === 0) {
    problems.push(`no fontFamily declarations found under ${DIR} — the scraper broke, `
      + 'not the code')
  }
  for (const [fam, where] of usedFamilies) {
    if (!registered.has(fam)) {
      problems.push(`${where}: fontFamily '${fam}' is NOT registered in App.js's useFonts. `
        + `React Native will silently fall back to the platform default. `
        + `Registered: ${[...registered].join(', ')}`)
    }
  }
  fontReport = `fonts: ${usedFamilies.size} famil${usedFamilies.size === 1 ? 'y' : 'ies'} used `
    + `(${[...usedFamilies.keys()].sort().join(', ')}), all registered among ${registered.size} in App.js`
}

if (problems.length) {
  console.error('\n  ┌─ HOME GEOMETRY CHECK FAILED ───────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
const artH = (1 - ASSET_TOP - ASSET_BOTTOM) * MASCOT_BOX
console.log(fontReport)
console.log(`home geometry: OK (mascot box ${MASCOT_BOX}, ink ${(MASCOT_BOX*0.456).toFixed(0)}x${artH.toFixed(0)}pt, `
  + `${(artH-CARD_H).toFixed(0)}pt above a ${CARD_H}pt card, 0pt below)`)
