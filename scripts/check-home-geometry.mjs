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
import {
  DEFAULT_FAVOURITES, FAVOURITE_SLOTS, AUTO_FILL_EXCLUDE, resolveFavourites,
} from '../constants/homeFavourites.js'
import { HIDDEN_TILES } from '../constants/homeModules.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR  = 'components/home'
const problems = []
let fontReport = 'fonts: not checked'
let favReport  = 'favourites: not checked'
let mascotReport = 'mascot: not checked'
let bannerReport = 'strip banner: not checked'
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

// ─── B2. The strip banner stays 160 tall ────────────────────────────────────
// The "Bugün ADA'da" slider reuses the banner frame for every slide, and the loading Bone mirrors it.
// A slide taller or shorter than the skeleton makes the whole Home jump when the strip resolves.
{
  const widgets = read('components/home/redesign/Widgets.js')
  const banner = widgets.match(/^\s{2}banner:\s*\{([^}]*)\}/m)
  const h = banner && banner[1].match(/\bheight:\s*(\d+)/)
  const bone = widgets.match(/<Bone width="100%" height=\{(\d+)\} borderRadius=\{radii\.widget\}/)
  if (!h) problems.push('Widgets.js: no `banner` style with a numeric height found')
  else if (Number(h[1]) !== 160) problems.push(`Widgets.js banner height is ${h[1]}, expected 160 (the strip slider frame)`)
  if (!bone) problems.push('Widgets.js: the banner loading Bone was not found')
  else if (h && Number(bone[1]) !== Number(h[1])) problems.push(`Widgets.js: the loading Bone is ${bone[1]} tall but the banner is ${h[1]}`)
  bannerReport = `strip banner: height ${h ? h[1] : '?'}, loading Bone ${bone ? bone[1] : '?'}`
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
    // ─── SCAN FOR THE FONT-NAME SHAPE, NOT FOR `fontFamily:` ────────────────
    // This matched `fontFamily: 'X'` inline until 2026-09-11, when ModuleTile started
    // choosing its family through a const:
    //
    //     const LABEL_FAMILY = TILE_FONT_MANROPE ? 'Manrope_500Medium' : 'Inter_500Medium'
    //     label: { fontFamily: LABEL_FAMILY, ... }
    //
    // The guard went on passing and reported 4 families while the file used 5. A typo in
    // the Manrope name would have shipped labels in the system font with nothing to say
    // so — which is the exact defect this section exists to catch, reintroduced by the
    // indirection rather than by the mistake.
    //
    // So it now matches the NAME SHAPE (Family_NNNWeight) in any string literal, which no
    // amount of indirection can hide. Comments are stripped FIRST, because this file's own
    // notes discuss Inter_600SemiBold by name and matching prose would forbid the comments
    // that explain the bug.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const m of code.matchAll(/'([A-Za-z][A-Za-z0-9]*_\d{3}[A-Za-z]+)'/g)) {
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

// ─── D. The favourites row: pure rules over a `visible` id list ─────────────
//
// Eligibility is ONE thing now: is the id in `visible` (visibleServiceIds in
// constants/homeGroups.js — flags, HIDDEN_TILES and Yakında are all decided there). This
// file cannot import homeGroups (it pulls expo-constants), so the resolver is exercised
// here with a SYNTHETIC visible list, and the live gates are covered by
// __tests__/homeServices.test.js.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the counts, so the numbers can be read rather than trusted.
const ids = HOME_MODULES.map(m => m.id)
if (ids.length === 0) {
  problems.push('HOME_MODULES is empty — this whole section just passed on nothing')
}

// Tiles that are not HOME_MODULES entries live in the EXTRA table of homeGroups.js; its ids
// are read off the source text.
const extraBlock = read('constants/homeGroups.js').match(/const EXTRA = \{([\s\S]*?)\n\}/)
const extraIds = extraBlock ? [...extraBlock[1].matchAll(/\bid:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]) : []
// Positive control: the scrape must have found the ids this check depends on.
for (const must of ['duty', 'exploreTab']) {
  if (!extraIds.includes(must)) {
    problems.push(`CONTROL FAILED: EXTRA ids read from homeGroups.js are [${extraIds.join(', ')}], `
      + `missing '${must}' — the scraper matched nothing useful`)
  }
}
const knownIds = new Set([...ids, ...extraIds])

// A typo in the editorial defaults costs a slot with NO error at runtime, because an
// unknown id is silently skipped.
for (const id of DEFAULT_FAVOURITES) {
  if (!knownIds.has(id)) {
    problems.push(`DEFAULT_FAVOURITES names '${id}', which is neither a HOME_MODULES id nor an EXTRA id `
      + `in homeGroups.js. It would be skipped silently.`)
  }
}
// Literal on purpose: comparing the resolver to the very set it reads would pass with the set emptied.
const MUST_EXCLUDE = ['duty', 'emergency']
for (const id of MUST_EXCLUDE) {
  if (!AUTO_FILL_EXCLUDE.has(id)) problems.push(`AUTO_FILL_EXCLUDE no longer contains '${id}'`)
  if (!knownIds.has(id)) problems.push(`'${id}' is not a known tile id`)
}

// Hand-maintained, in Home's group order: a copy of the 19 ids printed by
// __tests__/homeServices.test.js (this file cannot import homeGroups). The real gates are
// covered by `npm run test:home`, which runs in the ota and ota:preview chains.
const VISIBLE = [
  'duty', 'health', 'emergency',
  'exploreTab', 'events', 'walkingRoutes', 'hotels', 'eatery',
  'accommodation', 'homeServices', 'marketplace', 'pets', 'studentHub',
  'esim', 'municipal', 'towing', 'ehliyet', 'exchangeRates', 'newcomerEssentials',
]
for (const id of VISIBLE) {
  if (!knownIds.has(id)) problems.push(`synthetic VISIBLE names '${id}', which is not a known tile id`)
}
const LOCKED_FRESH = ['events', 'accommodation', 'exchangeRates', 'newcomerEssentials', 'exploreTab', 'eatery', 'hotels', 'pets']

if (FAVOURITE_SLOTS !== 8) problems.push(`FAVOURITE_SLOTS is ${FAVOURITE_SLOTS}, the locked row is 8`)

const resolvable = DEFAULT_FAVOURITES.filter(id => VISIBLE.includes(id))
if (resolvable.length < FAVOURITE_SLOTS) {
  problems.push(`only ${resolvable.length} of ${DEFAULT_FAVOURITES.length} DEFAULT_FAVOURITES are in a `
    + `production-like visible list (${resolvable.join(', ') || 'none'}), but the row has ${FAVOURITE_SLOTS} slots`)
}

let scenarioCount = 0
const scenario = (name, args, { len, check } = {}) => {
  scenarioCount++
  let out
  try { out = resolveFavourites(args) } catch (e) {
    problems.push(`scenario "${name}" THREW: ${e.message}`); return
  }
  if (new Set(out).size !== out.length) problems.push(`scenario "${name}" returned duplicates: ${out.join(', ')}`)
  if (out.some(id => !args.visible.includes(id))) {
    problems.push(`scenario "${name}" returned an id that is not visible: ${out.join(', ')}`)
  }
  const want = len ?? FAVOURITE_SLOTS
  if (out.length !== want) problems.push(`scenario "${name}" returned ${out.length} tiles, not ${want}: ${out.join(', ')}`)
  const msg = check?.(out)
  if (msg) problems.push(`scenario "${name}": ${msg} (got ${out.join(', ')})`)
}

// 1. A fresh install is exactly the locked eight, in order.
scenario('fresh install = the locked eight', { pins: [], usage: {}, visible: VISIBLE },
  { check: out => out.join(',') === LOCKED_FRESH.join(',') ? null : `expected [${LOCKED_FRESH.join(', ')}]` })

// 2. Excluded ids never auto-fill — even with the heaviest usage — but a pin is honoured.
scenario('duty and emergency never auto-fill',
  { pins: [], usage: { duty: 999, emergency: 998 }, visible: VISIBLE },
  { check: out => out.some(id => MUST_EXCLUDE.includes(id)) ? 'duty or emergency was auto-filled' : null })
scenario('a manual pin of duty is honoured in its slot',
  { pins: [null, null, 'duty'], usage: {}, visible: VISIBLE },
  { check: out => out[2] === 'duty' ? null : 'the duty pin did not land in slot 3' })

// 3. A pin holds its slot and outranks usage; usage outranks the defaults.
scenario('a pin outranks a heavily-used module',
  { pins: ['municipal'], usage: { health: 90 }, visible: VISIBLE },
  { check: out => out[0] === 'municipal' && out[1] === 'health' ? null : 'pin or usage order wrong' })
scenario('usage reorders the auto-filled slots',
  { pins: [], usage: { health: 90, municipal: 80 }, visible: VISIBLE },
  { check: out => out[0] === 'health' && out[1] === 'municipal' ? null : 'usage did not drive the order' })

// 4. Degradations: nothing dead, nothing doubled, no hole.
scenario('pin to an unknown id is skipped',
  { pins: ['nopeNotAModule'], usage: {}, visible: VISIBLE },
  { check: out => out.includes('nopeNotAModule') ? 'the dead id reached the row' : null })
scenario('pin not in visible (a hidden tile) is skipped',
  { pins: ['garages', 'transport'], usage: {}, visible: VISIBLE },
  { check: out => out.includes('garages') || out.includes('transport') ? 'a non-visible pin reached the row' : null })
scenario('duplicate pins show once',
  { pins: ['pets', 'pets', 'pets'], usage: {}, visible: VISIBLE },
  { check: out => out[0] === 'pets' && out.filter(id => id === 'pets').length === 1 ? null : 'pets doubled or lost' })
// Length/dup/visibility only: loadUsage() sanitises counts before they reach the resolver, so the
// resolver is not asked to order garbage (no independent red beyond the generic asserts).
scenario('garbage usage does not break the row',
  { pins: [], usage: { events: NaN, pets: 'x', hotels: -5, health: undefined }, visible: VISIBLE },
  { check: out => out.length === FAVOURITE_SLOTS ? null : 'garbage usage changed the length' })

// 5. A short visible list fills what it can with no holes.
const SEVEN = VISIBLE.slice(3, 10)
scenario('a 7-id visible list returns 7, no holes', { pins: [], usage: {}, visible: SEVEN }, { len: 7 })
// All-excluded visible list: nothing to auto-fill.
scenario('only excluded ids visible returns nothing', { pins: [], usage: {}, visible: ['duty', 'emergency'] }, { len: 0 })

favReport = `favourites: ${ids.length} tiles + ${extraIds.length} extra, ${HIDDEN_TILES.size} hidden: `
  + `${[...HIDDEN_TILES].join('/')}, defaults [${DEFAULT_FAVOURITES.join(', ')}], `
  + `${resolvable.length}/${DEFAULT_FAVOURITES.length} resolve in the synthetic list, `
  + `${scenarioCount} scenarios pass`

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
console.log(bannerReport)
console.log('home geometry: OK')
