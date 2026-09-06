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
import { HIDDEN_TILES } from '../constants/homeModules.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR  = 'components/home'
const problems = []
let fontReport = 'fonts: not checked'
let favReport  = 'favourites: not checked'
let mascotReport = 'mascot: not checked'
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

// ─── B. The mascot must sit INSIDE the banner ───────────────────────────────
//
// ⚠ REWRITTEN 2026-09-07, BECAUSE THE THING IT ASSERTED STOPPED BEING TRUE. It used to
//   check that his ink rose exactly OLI_OVERHANG above the card — correct while he was a
//   cut-out STANDING ON the banner and breaking its top line. He now sits inside it, so
//   that assertion would have failed on a perfectly correct layout, and "fixing" it by
//   loosening the tolerance would have left a guard that asserts nothing.
//
// What it checks now is the property the design actually has: his ink fits between the
// card's edges, with the inset he declares below him and real clearance above.
const oli    = read(`${DIR}/OliRow.js`)
const layout = read(`${DIR}/homeLayout.js`)

const MASCOT_BOX   = num(oli, 'MASCOT_BOX')
const MASCOT_INSET = num(oli, 'MASCOT_INSET')
const CARD_H       = num(oli, 'CARD_H')
const HEADROOM     = num(oli, 'HEADROOM')
const ASSET_TOP    = num(oli, 'ASSET_TOP')
const ASSET_BOTTOM = num(oli, 'ASSET_BOTTOM')
const OLI_OVERHANG = num(layout, 'OLI_OVERHANG')
const HERO_OVERLAP = num(layout, 'HERO_OVERLAP')

const geom = { MASCOT_BOX, MASCOT_INSET, CARD_H, HEADROOM, ASSET_TOP, ASSET_BOTTOM, OLI_OVERHANG, HERO_OVERLAP }
const unread = Object.entries(geom).filter(([, v]) => v == null).map(([k]) => k)
if (unread.length) {
  problems.push(`could not read the Oli geometry constant(s) ${unread.join(', ')} — a rename `
    + `needs this guard updated. It measures nothing until then, so it fails rather than passes.`)
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
      problems.push(`${DIR}/OliRow.js: the mascot must stay position:'absolute' — in flow he grows the card`)
    }
    // He is positioned from his INK, not his box: the style offsets by the asset's own
    // transparent bottom margin. Without that the visible mascot lands ASSET_BOTTOM * BOX
    // away from where the inset says, which at box 88 is 7.6pt — enough to look wrong and
    // small enough to be argued about instead of measured.
    if (!/MASCOT_INSET\s*-\s*Math\.round\(MASCOT_BOX \* ASSET_BOTTOM\)/.test(mStyle[0])) {
      problems.push(`${DIR}/OliRow.js: the mascot's \`bottom\` must be `
        + `MASCOT_INSET - Math.round(MASCOT_BOX * ASSET_BOTTOM), so his FEET land at the inset `
        + `rather than his transparent box edge`)
    }
  }

  // Where his INK lands, from the asset's measured alpha bounds.
  const artH     = (1 - ASSET_TOP - ASSET_BOTTOM) * MASCOT_BOX
  const inkTop   = MASCOT_INSET + artH             // above the card's BOTTOM edge
  const inkAbove = Math.max(0, inkTop - CARD_H)    // how far he breaks the card's top line
  const wrapH    = CARD_H + OLI_OVERHANG + HEADROOM

  // The hero reserves space from OLI_OVERHANG, so the two must agree or the hero either
  // wastes space or puts its own text under him.
  if (Math.abs(inkAbove - OLI_OVERHANG) > 1) {
    problems.push(`OLI_OVERHANG is ${OLI_OVERHANG} but MASCOT_BOX ${MASCOT_BOX} at inset `
      + `${MASCOT_INSET} puts his ink ${inkAbove.toFixed(1)}pt above the card. The hero reserves `
      + `space from OLI_OVERHANG, so a mismatch means he overlaps the district text (too big) `
      + `or the hero wastes ${(OLI_OVERHANG - inkAbove).toFixed(1)}pt (too small). `
      + `Set OLI_OVERHANG to ${Math.round(inkAbove)}.`)
  }

  // ─── The current design: he is INSIDE the card ────────────────────────────
  if (OLI_OVERHANG === 0) {
    if (inkTop > CARD_H) {
      problems.push(`he is meant to sit INSIDE the banner (OLI_OVERHANG is 0) but his ink `
        + `reaches ${inkTop.toFixed(1)}pt in an ${CARD_H}pt card — it breaks the top edge`)
    } else if (CARD_H - inkTop < 3) {
      problems.push(`his ink stops ${(CARD_H - inkTop).toFixed(1)}pt below the card's top edge. `
        + `That is close enough to read as clipped rather than placed; shrink MASCOT_BOX.`)
    }
    if (MASCOT_INSET < 3) {
      problems.push(`MASCOT_INSET is ${MASCOT_INSET} — his feet sit on the card's bottom edge `
        + `from the inside, which reads as clipped. It was 0 when he stood ON the card.`)
    }
  }

  if (inkAbove > wrapH - CARD_H) {
    problems.push(`his ink rises ${inkAbove.toFixed(1)}pt above the card but the wrap only extends `
      + `${(wrapH - CARD_H).toFixed(1)}pt above it — the top of him would be clipped on Android`)
  }
  // The declared BOX, positioned as the style says, must sit inside the wrap.
  const boxTopAboveWrap = MASCOT_BOX - (Math.round(MASCOT_BOX * ASSET_BOTTOM) - MASCOT_INSET) - wrapH
  if (boxTopAboveWrap > 0) {
    problems.push(`the mascot's BOX overflows the wrap's top by ${boxTopAboveWrap.toFixed(1)}pt; `
      + `Android may clip it. Raise HEADROOM or shrink MASCOT_BOX.`)
  }
  mascotReport = `mascot: box ${MASCOT_BOX}, ink ${(MASCOT_BOX * 0.456).toFixed(0)}x${artH.toFixed(0)}pt, `
    + `feet ${MASCOT_INSET}pt above the card's bottom, head ${(CARD_H - inkTop).toFixed(1)}pt below its top `
    + `(${OLI_OVERHANG === 0 ? 'inside the banner' : `${inkAbove.toFixed(0)}pt above it`}), card ${CARD_H}pt`
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

// DEFAULT_FAVOURITES is a preference ORDER and may legitimately be longer than the row,
// carrying entries that are dark today. What must NOT happen is the row falling through to
// grid order because too few of them are eligible — that is invisible at runtime (an
// ineligible default is correctly skipped) and it is precisely how the row ends up
// mirroring the grid's opening tiles again.
const eligibleDefaults = DEFAULT_FAVOURITES.filter(id => moduleEligible(id))
if (eligibleDefaults.length < FAVOURITE_SLOTS) {
  problems.push(`only ${eligibleDefaults.length} of ${DEFAULT_FAVOURITES.length} DEFAULT_FAVOURITES `
    + `are eligible under today's flags (${eligibleDefaults.join(', ') || 'none'}), but the row has `
    + `${FAVOURITE_SLOTS} slots — so ${FAVOURITE_SLOTS - eligibleDefaults.length} slot(s) would be `
    + `filled from GRID ORDER instead of from editorial intent. Add another live entry to the `
    + `list; dark entries may stay, they just cannot be counted on.`)
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
let scenarioCount = 0
const scenario = (name, args, check) => {
  scenarioCount++
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
//
//    ⚠ `insurance`, NOT `grooming`. This scenario used grooming until 2026-09-10, when
//      grooming entered HIDDEN_TILES — at which point it stopped being a test of DARKNESS
//      and became a test of hiddenness, and scenario 3 below (the same pin coming back
//      when the flag flips) could never pass again. The subject has to be a module that is
//      dark and NOT hidden, or the pair asserts something other than what it says.
scenario('pin points at a dark module',
  { pins: ['insurance', null, null, null], flags: { ...liveFlags, insurance: false } },
  out => out.includes('insurance') ? 'a Coming Soon module reached the row' : null)

// 3. The same pin must COME BACK when the module goes live — storage is never rewritten,
//    so the user's arrangement survives a module being dark for a release.
scenario('the same pin once the module is live', { pins: ['insurance', null, null, null], flags: liveFlags },
  out => out[0] === 'insurance' ? null : 'the pin did not return to slot 1 once eligible')

// 3b. HIDDEN beats everything, including a live flag and an explicit override. A shortcut
//     to a tile the grid does not render is an orphan the user cannot find again.
for (const hid of HIDDEN_TILES) {
  scenario(`hidden tile '${hid}' never reaches the row, even live and pinned`,
    { pins: [hid, null, null, null], usage: { [hid]: 999 }, flags: liveFlags, overrides: { [hid]: true } },
    out => out.includes(hid) ? 'a HIDDEN tile reached the row' : null)
}

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

// 6. A fresh device shows the editorial defaults, in their editorial order. The one that
//    would break silently if the tie-break lost the defaults.
//
//    ⚠ COMPARED AGAINST THE FIRST FAVOURITE_SLOTS *ELIGIBLE* DEFAULTS, not against the
//      whole array. DEFAULT_FAVOURITES is a preference ORDER and is deliberately longer
//      than the row, so an earlier draft of this scenario — which compared the row to the
//      entire array — went red the moment a fifth entry was added, against a resolver that
//      was behaving perfectly. The check was wrong, not the system; this is what it should
//      have said all along.
const expectFresh = DEFAULT_FAVOURITES
  .filter(id => moduleEligible(id, { flags: liveFlags }))
  .slice(0, FAVOURITE_SLOTS)
scenario('fresh install shows the defaults in order', { pins: [], usage: {}, flags: liveFlags },
  out => out.join(',') === expectFresh.join(',')
    ? null : `expected the first ${FAVOURITE_SLOTS} eligible defaults [${expectFresh.join(', ')}]`)

favReport = `favourites: ${ids.length} tiles (${gated} flag-gated, ${UNGATED_MODULES.size} ungated, `
  + `${HIDDEN_TILES.size} hidden: ${[...HIDDEN_TILES].join('/')}), `
  + `defaults [${DEFAULT_FAVOURITES.join(', ')}], worst-case row fills ${worstCase.length}/${FAVOURITE_SLOTS}, `
  + `${eligibleDefaults.length}/${DEFAULT_FAVOURITES.length} defaults eligible now, `
  + `${scenarioCount} degradation scenarios pass`

if (problems.length) {
  console.error('\n  ┌─ HOME GEOMETRY CHECK FAILED ───────────────────────────────────┐')
  for (const p of problems) console.error('  │ ' + p)
  console.error('  └────────────────────────────────────────────────────────────────┘\n')
  process.exit(1)
}
console.log(fontReport)
console.log(favReport)
// The mascot line is built in section B, where the numbers are, rather than recomputed
// here from a subset of them. The previous version of this file recomputed it — and after
// the mascot moved inside the card it printed "-12pt above a 88pt card", a negative
// distance above something, which is the shape of a report that has outlived its geometry.
console.log(mascotReport)
console.log('home geometry: OK')
