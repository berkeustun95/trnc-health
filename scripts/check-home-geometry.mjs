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
import { HOME_MODULES } from '../constants/homeModules.js'
import { MODULE_FLAGS } from '../constants/flags.js'
import {
  DEFAULT_FAVOURITES, MODULE_FLAG_KEY, UNGATED_MODULES, FAVOURITE_SLOTS,
  resolveFavourites, moduleEligible,
} from '../constants/homeFavourites.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR  = 'components/home'
const problems = []
let fontReport = 'fonts: not checked'
let favReport  = 'favourites: not checked'
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

// ─── D. The favourites row can only offer modules that actually work ────────
//
// The tile id and the flag key are two namespaces that do not always agree — HOME_MODULES
// says `jobPostings`, MODULE_FLAGS says `jobs` — and neither may be renamed to close the
// gap (the flag key is the module_waitlist `module` value, its CHECK, and the notify RPC;
// the tile id is in moduleHandlers and in every stored favourite on every device).
//
// So the map is the fix, and this is what keeps the map honest. Without it a NEW tile
// whose id drifts from its flag key resolves to `undefined`, and the only thing standing
// between that and a Coming Soon tile pinned to somebody's home screen is a fail-closed
// branch nobody would notice had started firing.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the counts, so the numbers can be read rather than trusted.
//   A guard that prints only "OK" cannot be told apart from one whose scraper matched
//   nothing — and both sides of this comparison come from imported modules that a rename
//   could empty.
const ids = HOME_MODULES.map(m => m.id)
if (ids.length === 0) {
  problems.push('HOME_MODULES is empty — this whole section just passed on nothing')
}

let gated = 0
for (const id of ids) {
  const ungated = UNGATED_MODULES.has(id)
  const key     = MODULE_FLAG_KEY[id] ?? id
  const known   = typeof MODULE_FLAGS[key] === 'boolean'
  if (ungated && known) {
    problems.push(`'${id}' is listed in UNGATED_MODULES but MODULE_FLAGS also has a '${key}' `
      + `entry. One of the two is wrong, and eligibility currently answers "ungated" — so a `
      + `dark module would be offered as a favourite.`)
  }
  if (!ungated && !known) {
    problems.push(`'${id}' is not in UNGATED_MODULES and resolves to flag key '${key}', which `
      + `is not a boolean in MODULE_FLAGS. It will be INELIGIBLE for favourites forever. `
      + `Add it to UNGATED_MODULES if nothing gates it, or to MODULE_FLAG_KEY if its flag `
      + `is named differently. (This is the jobPostings/jobs shape.)`)
  }
  if (!ungated && known) gated++
}

// A mapping entry that points at a flag which does not exist is the same defect wearing a
// disguise — it LOOKS handled.
for (const [id, key] of Object.entries(MODULE_FLAG_KEY)) {
  if (!ids.includes(id)) {
    problems.push(`MODULE_FLAG_KEY maps '${id}', which is not a HOME_MODULES id — a stale entry`)
  }
  if (typeof MODULE_FLAGS[key] !== 'boolean') {
    problems.push(`MODULE_FLAG_KEY maps '${id}' -> '${key}', which is not in MODULE_FLAGS`)
  }
}

// A typo in the editorial defaults costs a slot with NO error at runtime, because an
// unknown id is silently skipped. That silence is correct for a stored favourite from an
// old build and wrong for a constant somebody just typed.
for (const id of DEFAULT_FAVOURITES) {
  if (!ids.includes(id)) {
    problems.push(`DEFAULT_FAVOURITES names '${id}', which is not a HOME_MODULES id. It would `
      + `be skipped silently and the row would quietly fall back to grid order.`)
  }
}

// ─── The row can never come up empty — computed, not asserted in prose ──────
// The heading lives in HomeScreen, so an empty row leaves it standing over nothing. Run
// the real resolver against the WORST case: every flag false, no pins, no usage.
const allFalse = Object.fromEntries(Object.keys(MODULE_FLAGS).map(k => [k, false]))
const worstCase = resolveFavourites({ pins: [], usage: {}, flags: allFalse, overrides: {} })
if (worstCase.length !== FAVOURITE_SLOTS) {
  problems.push(`with every module flag false the favourites row resolves to `
    + `${worstCase.length} tile(s), not ${FAVOURITE_SLOTS}. The section heading in `
    + `HomeScreen would be left standing over a short or empty row. Ungated modules: `
    + `${[...UNGATED_MODULES].join(', ')}`)
}
// Control: the same call must NOT be padded with ineligible ids.
for (const id of worstCase) {
  if (!moduleEligible(id, { flags: allFalse })) {
    problems.push(`CONTROL FAILED: resolveFavourites returned '${id}' under all-false flags, `
      + `but moduleEligible says it is ineligible — the filter and the fill disagree`)
  }
}
if (new Set(worstCase).size !== worstCase.length) {
  problems.push(`resolveFavourites returned a duplicate: ${worstCase.join(', ')}`)
}

// ─── The four degradation rules, exercised rather than described ───────────
// A stored favourite is read off a device we have never seen, written by a build we may
// no longer have. Each of these is a scenario the row must survive SILENTLY — no dead
// tile, no crash, no gap.
const liveFlags = Object.fromEntries(Object.keys(MODULE_FLAGS).map(k => [k, true]))
const scenario = (name, args, check) => {
  let out
  try { out = resolveFavourites(args) } catch (e) {
    problems.push(`degradation "${name}" THREW: ${e.message}`); return
  }
  if (new Set(out).size !== out.length) problems.push(`degradation "${name}" returned duplicates: ${out.join(', ')}`)
  if (out.length !== FAVOURITE_SLOTS)   problems.push(`degradation "${name}" returned ${out.length} tiles, not ${FAVOURITE_SLOTS}: ${out.join(', ')}`)
  const msg = check(out)
  if (msg) problems.push(`degradation "${name}": ${msg} (got ${out.join(', ')})`)
}

// 1. REMOVED — a pin naming a module that no longer exists.
scenario('pin points at a deleted module', { pins: ['nopeNotAModule', null, null, null], flags: liveFlags },
  out => out.includes('nopeNotAModule') ? 'the dead id reached the row' : null)

// 2. DARK — a pin naming a real module whose flag is false.
scenario('pin points at a dark module',
  { pins: ['grooming', null, null, null], flags: { ...liveFlags, grooming: false } },
  out => out.includes('grooming') ? 'a Coming Soon module reached the row' : null)

// 3. The same pin must COME BACK when the module goes live — storage is never rewritten,
//    so the user's arrangement survives a module being dark for a release.
scenario('the same pin once the module is live', { pins: ['grooming', null, null, null], flags: liveFlags },
  out => out[0] === 'grooming' ? null : 'the pin did not return to slot 1 once eligible')

// 4. A pin holds its SLOT, and unpinned slots still auto-fill around it.
scenario('a pin in slot 3 holds position 3', { pins: [null, null, 'esim', null], flags: liveFlags },
  out => out[2] === 'esim' ? null : 'the pin did not land in slot 3')

// 5. Usage outranks the editorial defaults once it exists, and a pin outranks usage.
scenario('usage reorders the auto-filled slots',
  { pins: [], usage: { esim: 90, games: 80, municipal: 70, exchangeRates: 60 }, flags: liveFlags },
  out => out[0] === 'esim' && out[1] === 'games' ? null : 'usage did not drive the order')
scenario('a pin outranks a heavily-used module',
  { pins: ['municipal', null, null, null], usage: { esim: 90 }, flags: liveFlags },
  out => out[0] === 'municipal' ? null : 'usage beat an explicit pin')

// 6. A fresh device shows exactly the editorial defaults, in their editorial order. This
//    is the one that would break silently if the tie-break lost the defaults.
scenario('fresh install shows the defaults in order', { pins: [], usage: {}, flags: liveFlags },
  out => out.join(',') === DEFAULT_FAVOURITES.join(',')
    ? null : `expected the DEFAULT_FAVOURITES order [${DEFAULT_FAVOURITES.join(', ')}]`)

favReport = `favourites: ${ids.length} tiles (${gated} flag-gated, ${UNGATED_MODULES.size} ungated), `
  + `defaults [${DEFAULT_FAVOURITES.join(', ')}], worst-case row fills ${worstCase.length}/${FAVOURITE_SLOTS}, `
  + `7 degradation scenarios pass`

if (problems.length) {
  console.error('\n  ┌─ HOME GEOMETRY CHECK FAILED ───────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
const artH = (1 - ASSET_TOP - ASSET_BOTTOM) * MASCOT_BOX
console.log(fontReport)
console.log(favReport)
console.log(`home geometry: OK (mascot box ${MASCOT_BOX}, ink ${(MASCOT_BOX*0.456).toFixed(0)}x${artH.toFixed(0)}pt, `
  + `${(artH-CARD_H).toFixed(0)}pt above a ${CARD_H}pt card, 0pt below)`)
