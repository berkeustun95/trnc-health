#!/usr/bin/env node
// ─── i18n coverage — a locale value that is silently English ─────────────────
//
//   node scripts/validate-i18n-coverage.mjs
//
// ─── WHY A RAW-KEY CHECK WOULD BE A DECORATION ──────────────────────────────
//
// The obvious check is "does every key resolve in every locale". It is worthless here,
// and worse than worthless because it is permanently green: t() falls back to
// translations.en[key] BEFORE it falls back to the key itself (constants/i18n.js).
// A key missing from Arabic does not render `checkinCta`; it renders "Check in".
// So the user-visible failure is ENGLISH ON AN RTL SCREEN, and no existence check can
// see it. The only check with teeth compares each locale's VALUE against English.
//
// ─── WHICH MEANS THE ALLOWLIST IS THE WHOLE DESIGN ──────────────────────────
//
// Comparing against English fires on correct data: `hospital` really is "Hospital" in
// Spanish, `Café` really is "Café" in French. A check that fires on correct data teaches
// you to ignore it, so every legitimate collision is DECLARED below with a reason.
// "Deliberately identical" then becomes a visible decision someone made, and anything
// new that matches English fails until a human either translates it or consciously
// adds a line here.
//
// ─── SCOPE: A SUBSET OF THE TABLE, DELIBERATELY ─────────────────────────────
//
// Both figures are MEASURED AND PRINTED on every run rather than written here. They
// were '115 of 1135' until 2026-09-02, when 20261004's client deletions removed 85
// keys per locale and made the second number wrong in a comment nobody would reread.
//
// This guards only the keys reachable from the surfaces listed in SURFACES. That is
// not laziness, it is the only scope at which the design works: app-wide there are 329
// colliding keys across 2081 key×locale pairs, and a 2081-entry allowlist could only be
// GENERATED, never reviewed. A generated allowlist is a rubber stamp — it looks like
// coverage while being read by nobody, which is worse than no guard at all.
//
// Widen this deliberately, one surface at a time, when another surface earns the same
// treatment. Do not widen it by regenerating the allowlist.
//
// ─── THE SCOPE IS DERIVED, NOT LISTED ───────────────────────────────────────
//
// Keys come from reading the surface files AND from the key maps those files index into
// at runtime. Hardcoding a list would go stale the first time someone adds a key, and
// reading only literal t('x') would miss every key looked up through a variable —
// t(src.labelKey, lang), t(CATEGORY_LABEL_KEY[cat], lang) — which is exactly the blind
// spot that let the previous i18n checker pass while covering almost nothing.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { t, LANG_CODES } from '../constants/i18n.js'
import { HEALTH_TYPES } from '../constants/facilityTypes.js'
import { GROUP_META, CATEGORY_LABEL_KEY } from '../constants/exploreCategories.js'
import { REGION_LABEL_KEY } from '../constants/regions.js'
import { RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY, STEP_TITLE_KEY, HELP_ROW_LABEL_KEY } from '../constants/profileGate.js'
import { STRIP_TIPS } from '../constants/homeStrip.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The surfaces this guard covers. Adding a file here widens the scope deliberately.
const SURFACES = [
  'screens/ExploreMapScreen.js',
  'screens/ExploreProfileScreen.js',
  'components/ComingSoonScreen.js',
  // Widened 2026-08-26 for the duty-roster error state. Measured before widening: these
  // two add 34 keys and ZERO new allowlist entries — both were already fully translated.
  // Free coverage on the highest-stakes copy in the app.
  'screens/DutyListScreen.js',
  'screens/HomeScreen.js',
  // Widened 2026-08-26 in the explore go-live commit. These three become reachable to
  // real users the moment MODULE_FLAGS.explore is true, so they must be guarded BEFORE
  // the flip, not after. A hand measurement is true the day it is taken and stale the
  // moment somebody adds a key.
  'screens/ExploreScreen.js',
  'screens/ExploreSubmitScreen.js',
  'screens/ExploreMySubmissionsScreen.js',
  // Widened 2026-08-30 for the profile completion gate. This is the ONLY screen in the
  // app EVERY user is forced through, in whatever language they picked, with no way past
  // it — so an untranslated key here renders English on an RTL screen to someone who
  // cannot skip. It is guarded BEFORE PROFILE_GATE_LIVE flips, not after.
  'screens/ProfileSetupScreen.js',
  // Widened 2026-09-02 with Slice 3a, which gave this screen the wizard's ten fields.
  // It should have been here already: the gate's own strings nearly shipped unchecked
  // because the screen that edits the SAME columns was outside the scan, and "the wizard
  // is covered" is not the same claim as "these fields are covered" once two screens
  // render them. It also carries the account-deletion and legal copy, which is the last
  // place an English fallback should appear.
  //
  // HONEST LIMIT, and this file cannot close it: the scan finds keys passed to t(). It
  // cannot see a hardcoded English string, and ProfileScreen still has a few in paths
  // this slice did not touch (an avatar-upload failure, a phone placeholder). Adding a
  // file here does not translate it; it only guarantees the keys it DOES use are real in
  // all nine locales.
  'screens/ProfileScreen.js',
  // ⚠ A COMPONENT, NOT A SCREEN, AND IT HAD TO BE ADDED IN THE SAME COMMIT THAT CREATED
  //   IT. Slice 3a moved the display-name feedback out of ProfileSetupScreen into this
  //   file so both screens could share one implementation — and the ten keys it renders
  //   (pgChecking, pgTooShort, pgTooLong, pgAvailable, pgTaken, pgTakenSuggest,
  //   pgReserved, pgReservedEmail, pgNameRace, contentBlockedTerm) left the guard's scope
  //   with it. Measured: after the move and before this line, not one of them was
  //   reachable from any file in this list.
  //
  //   NOTHING WENT RED. The translations all exist, so the scan simply stopped looking,
  //   and the key total ROSE from 206 to 222 in the same commit because ProfileScreen was
  //   added — a coverage LOSS hidden inside a coverage gain. That is this repo's named
  //   failure shape and it is worth the paragraph: when code moves out of a guarded file,
  //   the guard does not follow it, and the total is not the alarm you think it is.
  'components/DisplayNameCheck.js',
  // ─── Widened 2026-09-03, HOME_V2 Slice 1 — IN THE COMMIT THAT CREATED THEM ──
  //
  // The same lesson the DisplayNameCheck paragraph above records, applied in advance
  // rather than after the fact: Home's copy moved out of screens/HomeScreen.js (which
  // IS in this list) into seven new component files, and every key that moved would
  // have left the guard's scope with it. Nothing would have gone red — the translations
  // exist — the scan would simply have stopped looking, while the printed key total went
  // UP because these files add keys of their own. A coverage loss hidden inside a
  // coverage gain.
  //
  // Guarded BEFORE HOME_V2_LIVE flips, not after, for the same reason ProfileSetupScreen
  // was: this is the first screen every user sees, in whatever language they picked.
  //
  // constants/homeModules.js is here because the grid's labels are looked up through a
  // VARIABLE — t(mod.labelKey, lang) — and a scan that only matched literal t('key')
  // would silently cover none of them. That is this repo's named blind spot; the scan
  // reads key maps for exactly this reason, and the map has to be in scope to be read.
  'components/home/HomeTopBar.js',
  'components/home/HomeHero.js',
  'components/home/WeatherSheet.js',
  'components/home/OliRow.js',
  'components/home/DutyRow.js',
  'components/home/ModuleGrid.js',
  // Added with the hero attribution UI. PhotoCredit.js is shared with
  // ExploreProfileScreen (already in this list) — adding it here guards the credit
  // strings from BOTH surfaces at once, which is the point of there being one renderer.
  'components/home/HeroCreditSheet.js',
  'components/PhotoCredit.js',
  'constants/homeModules.js',
  // ─── Widened with HOME_V2 Slice 2, in the commit that creates them ────────
  // The live strip's own copy. constants/homeStrip.js is here for the same reason
  // homeModules.js is: STRIP_TIPS's keys are reached through a VARIABLE —
  // t(tip.titleKey, lang) — and a scan matching only the literal call form covers none
  // of them. The keys are derived from the imported array below, not from this file's
  // text, so a tip added to that array is guarded the moment it is added.
  'components/home/LiveStrip.js',
  'constants/homeStrip.js',
  // ─── Widened with HOME_V2 Slice 3, in the commit that creates them ────────
  // The favourites row and its edit sheet. ModuleTile.js is here even though it adds no
  // literal keys of its own — it is where the grid's tile RENDERING moved in this slice,
  // and a file that draws user-visible text belongs in scope before somebody adds a
  // string to it, not after. Its labels come through a variable and are already covered
  // by TILE_LABEL_SOURCES below.
  'components/home/FavouritesRow.js',
  'components/home/FavouritesEditSheet.js',
  'components/home/ModuleTile.js',
]

// HomeScreen's module tiles look their labels up through a variable — t(mod.labelKey) —
// so a literal scan cannot see them. Reading them out of the file is what turned up
// menuGarages sitting untranslated in seven locales.
//
// ⚠ TWO FILES, BECAUSE THE V2 GRID'S DATA MOVED AND THIS DID NOT FOLLOW IT. Slice 1 lifted
//   the tile list into constants/homeModules.js, and this derivation still read only
//   screens/HomeScreen.js — so hubMedicalTitle, menuEmergency and menuEvents, which exist
//   ONLY in the new file, had quietly left the scan. Nothing went red; the translations
//   are fine, the scan just stopped looking at three of them. That is the exact shape the
//   DisplayNameCheck paragraph above records, hit a second time in the file that records
//   it — which is the argument for deriving the SOURCE LIST rather than naming one file.
const TILE_LABEL_SOURCES = ['screens/HomeScreen.js', 'constants/homeModules.js']
const HOME_TILE_LABEL_KEYS = [...new Set(TILE_LABEL_SOURCES.flatMap(f =>
  [...readFileSync(resolve(ROOT, f), 'utf8')
     .matchAll(/labelKey:\s*'([a-zA-Z][a-zA-Z0-9_]*)'/g)].map(m => m[1])))]

// ─── ALLOWLIST — one line per key×locale, with the reason ────────────────────
//
// A pair listed here is asserting: this locale's value is identical to English ON
// PURPOSE. Anything not listed must differ. Removing a line is how you re-open a
// question; adding one should feel like a decision, because it is.
const SAME_AS_ENGLISH = {
  // Place names. The English strings are already the local exonyms the app uses, so a
  // locale "translating" them would be inventing a name the signage does not use.
  'blDistrictIskele':     { Turkish: 'the English value IS the Turkish name',
                            French: 'no French exonym in use', Spanish: 'no Spanish exonym in use',
                            German: 'no German exonym in use' },
  'blDistrictKarpaz':     { Turkish: 'the English value IS the Turkish name',
                            French: 'no French exonym in use', Spanish: 'no Spanish exonym in use',
                            German: 'no German exonym in use' },
  'blDistrictLefke':      { Turkish: 'the English value IS the Turkish name',
                            French: 'no French exonym in use', Spanish: 'no Spanish exonym in use',
                            German: 'no German exonym in use' },
  'blDistrictKyrenia':    { French: 'Kyrenia is used in French alongside Kérynia',
                            Spanish: 'Kyrenia is the form in Spanish use',
                            German: 'Kyrenia is the form in German use' },
  'blDistrictMorphou':    { French: 'Morphou is the French form',
                            Spanish: 'Morphou is the form in Spanish use',
                            German: 'Morphou is the form in German use' },
  // Note French correctly carries Famagouste and Nicosie — those locales are ABSENT
  // here on purpose, and if either ever collides the guard should fire.
  'blDistrictFamagusta':  { Spanish: 'Famagusta is the Spanish form',
                            German: 'Famagusta is the German form' },
  'blDistrictNicosia':    { Spanish: 'Nicosia is the Spanish form' },

  // ─── German Home-grid labels, 2026-09-03 (Slice 1 polish r3) ──────────────
  // The 4-across grid gives a label ~14 characters per line and German compounds do not
  // wrap: 'Veranstaltungen' (15) and 'Stellenangebote' (15) both ellipsed mid-word. The
  // replacements are the English loanwords, which is not laziness — 'Events' and 'Jobs'
  // are what German listing sites and job boards actually use, and they are the forms a
  // German speaker in Cyprus would scan for. 'Termine' and 'Stellen' are the native
  // alternatives and were considered; both read narrower than the sections they label
  // ('Termine' suggests appointments, 'Stellen' suggests vacancies only).
  //
  // Declared rather than worked around: this guard firing here was CORRECT, and the
  // right response to a correct alarm is to record the decision where the next person
  // will read it.
  'menuEvents':      { German: "'Events' is standard German usage for a what's-on listing; 'Veranstaltungen' (15 chars) truncates in the 4-across grid" },
  'menuJobPostings': { German: "'Jobs' is standard German usage on job boards; 'Stellenangebote' (15 chars) truncates in the 4-across grid" },

  // Loanwords and shared Latin roots. Identical because the word IS the word.
  'exploreCatCafe':       { French: 'Café is French', German: 'Café is used in German' },
  'exploreCatRestaurant': { French: 'Restaurant is French', German: 'Restaurant is German' },
  'blCatMonument':        { French: 'Monument is French' },
  'blCatMuseum':          { German: 'Museum is German' },
  'exploreGroupNature':   { French: 'Nature is French' },
  'exploreGroupServices': { French: 'Services is French' },
  'blAccessPublic':       { French: 'Public is French' },
  'photoCreditPrefix':    { French: 'Photo is French' },
  'hospital':             { Spanish: 'Hospital is Spanish' },

  // Brand / technical terms that are the same word everywhere by design.
  'menuEsim':             { Turkish: 'eSIM is the technical term worldwide', Arabic: 'eSIM worldwide',
                            Russian: 'eSIM worldwide', Greek: 'eSIM worldwide', French: 'eSIM worldwide',
                            Spanish: 'eSIM worldwide', German: 'eSIM worldwide', Persian: 'eSIM worldwide' },
  // 'Garage' IS the French word for an auto repair shop. Declared explicitly in the
  // locale table rather than left absent, so this line records a decision and not the
  // oversight it was in the other six locales until 2026-08-26.
  'menuGarages':          { French: 'Garage is the French word for an auto repair shop' },

  // Submission-form labels. Short nouns that are genuinely the same word.
  'blSubmitType':         { French: 'Type is French' },
  'blSubmitName':         { German: 'Name is German' },
  'blSubmitDistrict':     { French: 'District is French' },
  'blSubmitDesc':         { French: 'Description is French' },
}

// ─── Scope derivation ────────────────────────────────────────────────────────

// ⚠ THIS SCAN READS COMMENTS TOO. It is a regex over the file, not a parse, so a call
// written out inside a /* */ or // comment registers as a real key — a comment in
// ProfileSetupScreen explaining the scan itself once registered a phantom key literally
// called "key", and the check failed with "not present in English at all". Same family
// as the pg_get_functiondef note in CLAUDE.md: the matcher sees prose as readily as code.
// If a comment needs to show the call shape, describe it instead of writing it.
const literal = new Set()
for (const f of SURFACES) {
  const src = readFileSync(resolve(ROOT, f), 'utf8')
  // The negative lookbehind matters: without it this also matches inside identifiers
  // that merely END in t, and `.select('user_id')` is read as t('user_id').
  for (const m of src.matchAll(/(?<![A-Za-z0-9_])t\('([a-zA-Z][a-zA-Z0-9_]*)'/g)) literal.add(m[1])
}

// Keys these surfaces reach THROUGH A VARIABLE. Pulled from the same maps the screens
// index into, so a new category or group is covered the moment it is added.
const viaVariable = [
  ...HOME_TILE_LABEL_KEYS,
  // The live strip's offline floor. Reached as t(tip.titleKey, lang).
  ...STRIP_TIPS.flatMap(tip => [tip.titleKey, tip.subtitleKey]),
  ...HEALTH_TYPES,
  ...Object.values(GROUP_META).map(m => m.labelKey),
  // The wizard's two single-select groups. Reached as t(MAP[value]), invisible to the
  // literal scan — the exact blind spot this file's header describes.
  ...Object.values(RESIDENT_STATUS_LABEL_KEY),
  ...Object.values(STUDENT_LEVEL_LABEL_KEY),
  ...Object.values(STEP_TITLE_KEY),
  ...Object.values(HELP_ROW_LABEL_KEY),
  ...Object.values(CATEGORY_LABEL_KEY),
  ...Object.values(REGION_LABEL_KEY),
]

const KEYS = [...new Set([...literal, ...viaVariable])].filter(Boolean).sort()
const LANGS = Object.keys(LANG_CODES).filter(l => l !== 'English')

// ─── Check ───────────────────────────────────────────────────────────────────

const problems = []
const usedAllowances = new Set()

for (const key of KEYS) {
  const en = t(key, 'English')
  if (en === key) { problems.push(`${key}: not present in English at all — every locale falls back to the raw key`); continue }
  for (const lang of LANGS) {
    if (t(key, lang) !== en) continue
    const reason = SAME_AS_ENGLISH[key]?.[lang]
    if (reason) { usedAllowances.add(`${key}/${lang}`); continue }
    problems.push(`${key} / ${lang} is identical to English (${JSON.stringify(en)}) — `
      + `translate it, or declare it in SAME_AS_ENGLISH with a reason`)
  }
}

// A stale allowance is a silent hole: the key gets translated, the line stays, and the
// next collision on that pair passes unnoticed. Report it rather than fail — it is a
// tidiness problem, not a correctness one, and failing a push over it would be noise.
const stale = []
for (const [key, langs] of Object.entries(SAME_AS_ENGLISH)) {
  for (const lang of Object.keys(langs)) {
    if (!usedAllowances.has(`${key}/${lang}`)) stale.push(`${key}/${lang}`)
  }
}

const allowanceCount = Object.values(SAME_AS_ENGLISH).reduce((n, o) => n + Object.keys(o).length, 0)

if (problems.length) {
  console.error('\n  ┌─ i18n COVERAGE FAILED ─────────────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘')
  console.error(`\n  ${problems.length} problem(s) across ${KEYS.length} key(s) × ${LANGS.length} locale(s).`)
  console.error('  A locale that matches English renders ENGLISH to that user — on ar/fa,')
  console.error('  English text on an RTL screen. It never renders a raw key, which is why')
  console.error('  an existence check cannot see this.\n')
  process.exit(1)
}

if (stale.length) {
  console.log(`i18n coverage: ${stale.length} STALE allowance(s) — now translated, safe to delete:`)
  for (const s of stale) console.log(`  · ${s}`)
}

// Measured, never remembered: the total is read out of the table itself on every run,
// so this line cannot go stale the way the header's old "1135" did.
const i18nSrc = readFileSync(resolve(ROOT, 'constants/i18n.js'), 'utf8')
const enBlock = i18nSrc.slice(i18nSrc.indexOf('\n  en: {'), i18nSrc.indexOf('\n  tr: {'))
const enTotal = (enBlock.match(/\b[A-Za-z0-9_]+:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g) ?? []).length
console.log(`i18n coverage: OK — ${KEYS.length} key(s) × ${LANGS.length} locale(s), `
  + `${allowanceCount} declared same-as-English (scope: Explore map, check-in, `
  + `duty roster and Home — ${KEYS.length} of the ${enTotal} keys in the table)`)
