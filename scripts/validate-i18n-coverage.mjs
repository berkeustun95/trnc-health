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
// Slice 6's send failures are reached as t(SEND_ERROR_KEY[token]) — a key looked up
// through a variable, which the literal `t('key')` scan cannot see. Imported by name for
// the same reason STUDENT_LEVEL_LABEL_KEY is: a new outcome added to that map must fail
// this check until it is translated, not slip through untranslated in eight locales.
import { SEND_ERROR_KEY } from '../constants/messaging.js'
import { STRIP_CARD_KEYS } from '../constants/homeStrip.js'
import { AD_SPONSORED_KEY } from '../constants/ads.js'
import { PET_PARTNERS, PENDING_KEYS as PET_PENDING_KEYS, petPartnerSections } from '../constants/petPartners.js'
import { REGULATORY_KEYS as PETS_REGULATORY_KEYS, REGULATORY_LOCALES } from '../constants/petsContent.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The surfaces this guard covers. Adding a file here widens the scope deliberately.
const SURFACES = [
  // ⚠ ADDED 2026-09-20 WITH THE CAROUSEL REBUILD, IN THE SAME COMMIT — not after.
  //   Same argument as ProfileSetupScreen below: that is the only screen every user is
  //   FORCED through, and this is the other one. It is the FIRST screen of a fresh
  //   install, it renders PRE-AUTH in whatever language the user just picked, and an
  //   untranslated key here is English on an RTL screen before the user has an account
  //   or any way past it.
  //
  //   It could not be added in slice 2, and the reason is worth keeping: this scan
  //   derives its keys by READING the file, and until the rebuild the screen still
  //   referenced the old slide1Title set. Adding it then would have guarded the keys
  //   being deleted and none of the nine replacing them. Measured at the time rather
  //   than assumed — with the Arabic value set to the raw English string, i18n:validate
  //   still reported OK.
  'screens/OnboardingScreen.js',
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
  // Widened 2026-09-13 for Bağlantı & eSIM, BEFORE CONNECTIVITY_LIVE flips rather than
  // after — the same reasoning as the explore go-live above. These three screens are the
  // first thing a newcomer reaches on the day they land, in whatever language they chose,
  // and the module's whole promise is that it works for people who do not read Turkish.
  // The warning card in particular ("a generic Cyprus eSIM will not work in the north") is
  // the single most expensive string in the module to render in the wrong language: a
  // visitor who cannot read it buys the wrong product at the airport.
  'screens/ConnectivityLandingScreen.js',
  'screens/ConnectivityOperatorScreen.js',
  'screens/ConnectivityPackageScreen.js',
  'components/ConnectivityErrorState.js',
  // Slice 7, added IN THE COMMIT THAT CREATES THE SCREEN — the fourth time this file has
  // had to record that lesson, and the first time it was applied without being relearned.
  'screens/ConnectivityStoresScreen.js',
  // ─── Shiny Paw pet hotel partner, added 2026-09-14 IN THE COMMIT THAT CREATES IT ──
  //
  // The fifth application of the lesson above, and the first where the SHAPE of the
  // feature was chosen partly to make it possible. The pets module cannot join this list:
  // its 117 `pets*` keys exist in English and Turkish only, so adding PetsHomeScreen would
  // turn this guard red on 819 pre-existing key×locale pairs belonging to a different
  // slice. So the partner's copy was deliberately NOT written inline on those screens —
  // the card and the cross-link are components precisely so they can be guarded here on
  // their own, while their hosts stay outside.
  //
  // That is the DisplayNameCheck paragraph above applied FORWARD instead of in hindsight:
  // copy that lives in a component is only guarded if somebody puts the component here.
  //
  // Guarded BEFORE PET_HOTEL_LIVE flips, not after. Partner copy is the one kind of string
  // where an English fallback is not merely poor service — it is a partnership ADA sold,
  // rendered in a language the reader did not choose.
  'screens/pets/PetHotelPartnerScreen.js',
  'components/PetHotelPartnerCard.js',
  'components/PetHotelCrossLink.js',
  // ─── The pets module, added 2026-09-14 ───────────────────────────────────
  //
  // This module has been LIVE to every user since 2026-08-23 with all 117 of its strings
  // in English and Turkish only — seven locales silently rendering English, two of them
  // RTL, on the screens that tell somebody what paperwork to bring to a border. It could
  // not be added before now because adding it would simply have gone red; the wrapper /
  // regulatory split is what makes the question answerable.
  //
  // Its 39 REGULATORY keys are exempted from the locale comparison as a SET (see
  // PETS_REGULATORY_EXEMPT below) — never as 273 allowlist lines. The other 83 are
  // guarded normally and will fail if a locale is missing.
  'screens/pets/PetsHomeScreen.js',
  'screens/pets/BringingPetScreen.js',
  'screens/pets/TravelWithPetScreen.js',
  'screens/pets/OwningPetScreen.js',
  'screens/pets/VetDirectoryScreen.js',
  // Added in the commit that created them, for the reason the DisplayNameCheck paragraph
  // above records: copy that moves into a component leaves this guard's scope with it.
  'components/PetsRegulatoryNotice.js',
  'components/PetsStaleNotice.js',
  'components/VetDeptActions.js',
  // Widened with the Student Hub port, while MODULE_FLAGS.studentHub is still false — guarded
  // before the flip, not after. Its region chips are t(REGION_LABEL_KEY[city]), already read
  // from the key map above.
  'screens/StudentHubScreen.js',
  // Slice 5's profile page. Added WITH the screen rather than after it: SURFACES is a
  // hand-kept list, so a new screen does not join this guard by existing — somebody has
  // to remember, and the screen nobody remembers is the one whose copy ships in English
  // to eight locales. Its study-level labels are t(STUDENT_LEVEL_LABEL_KEY[level]),
  // reached through a variable and therefore invisible to the literal scan; the map is
  // read out of constants/profileGate.js below for exactly that reason.
  'screens/StudentProfileScreen.js',
  // Slice 6. New component files leave this guard's scope by default and nothing goes
  // red — the note further down records that happening four separate times. Added in the
  // same commit as the screens themselves, which is the only moment anyone remembers.
  'screens/ConversationsScreen.js',
  'screens/ConversationScreen.js',
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
// ─── KEYS CARRIED IN A *Key PROP OR FIELD, INSIDE A SURFACE FILE ─────────────
//
// Same blind spot as the tile labels above, but local: a key held in a file-level array or
// passed as a prop is invisible to a literal t('x') scan. MEASURED when the connectivity
// screens were added — 9 of their 31 keys were outside the scan while the guard reported a
// clean pass:
//   • the three-step rail holds { titleKey, bodyKey } in a local STEPS array and renders
//     them as t(step.titleKey, lang)          -> 6 keys
//   • screen 2 passes titleKey="connPkgErrorTitle" as a JSX prop   -> 1 key
//   • the error card names its own defaults as titleKey = 'connErrorTitle' -> 2 keys
//
// So this matches ANY identifier ending in "Key" bound to a string literal, in all three
// syntaxes — object field, JSX prop, default parameter. Deliberately general: the next
// component to invent `headingKey` or `emptyKey` is covered without anybody remembering
// to widen a list, which is the failure this file has now recorded three times.
//
// ⚠ NOT EVERY *Key PROP IS AN i18n KEY, and the first run of this widening proved it by
//   going red: ComingSoonScreen takes moduleKey="checkins" — a MODULE identifier that has
//   no business in the translation table — and the guard correctly reported it as "not
//   present in English at all". That failure was in this scan, not in the app.
//
//   Excluded BY PROP NAME, never by value. Denying the string 'checkins' would also hide a
//   genuinely missing key that happened to be called that, which is the same mistake as a
//   hardcoded expected-set: it would go quiet about exactly the thing it is for.
//
//   Measured across all surfaces before choosing the deny-list, rather than guessed:
//   moduleKey is the ONLY *Key prop in scope whose values are not i18n keys (1 value, 0
//   resolving). titleKey (6), labelKey (20), templateKey (1) and bodyKey (4) all resolve
//   100%. If a future prop joins moduleKey here, add it with its own measured reason.
//   Joined 2026-09-14 by two more, found the same way — by going red when the pets screens
//   entered scope — and measured before being added, as the paragraph above requires:
//     airlineKey  2 values [pegasus, ajet], 0 resolving   <- AIRLINE_ROWS lookup key
//     animalKey   2 values [dogs, cats],    0 resolving   <- picks an icon, nothing more
//   Both are RECORD SELECTORS that happen to end in "Key". Excluded by PROP NAME, never by
//   value: denying the string 'dogs' would also hide a genuinely missing key called that.
const NON_I18N_KEY_PROPS = new Set(['moduleKey', 'airlineKey', 'animalKey'])

const PROP_KEY_RE = /\b(\w*Key)\s*[:=]\s*['"]([a-zA-Z][a-zA-Z0-9_]*)['"]/g
const SURFACE_PROP_KEYS = [...new Set(SURFACES.flatMap(f =>
  [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(PROP_KEY_RE)]
    .filter(m => !NON_I18N_KEY_PROPS.has(m[1]))
    .map(m => m[2])))]

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
  // ─── Pets module proper nouns, 2026-09-14 ─────────────────────────────────
  //
  // These surfaced the moment the pets screens entered SURFACES. None of them is an
  // untranslated string — each is a NAME, and a name is the same word in every locale.
  // Declared individually rather than as a set (unlike the 39 regulatory keys) because
  // there are seven of them and each has its own distinct reason.
  'petsAjetTitle': {
                          Turkish: 'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          Arabic:  'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          Russian: 'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          Greek:   'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          French:  'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          Spanish: 'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          German:  'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market',
                          Persian: 'airline brand; AJet is a Turkish carrier and writes its own name in Latin script in every market' },
  'petsPegasusTitle': {
                          Arabic:  'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          Russian: 'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          Greek:   'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          French:  'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          Spanish: 'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          German:  'airline brand; Pegasus Airlines writes its own name in Latin script in every market',
                          Persian: 'airline brand; Pegasus Airlines writes its own name in Latin script in every market' },
  'petsVetDeptAddress': {
                          Arabic:  'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          Russian: 'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          Greek:   'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          French:  'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          Spanish: 'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          German:  'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable',
                          Persian: 'a street address is a proper noun and is not translated — the same rule constants/dorms.js states for Alasia. A reader shows this to a taxi driver in Lefkosa; translating it would make it undeliverable' },
  'petsCountryTurkiye': { Turkish: "the country's own endonym — 'Türkiye' IS the Turkish name",
                          French:  'France officially adopted the endonym Türkiye; the older Turquie is being retired' },
  // Shortened to the abbreviation after the font-metric pass: "Großbritannien" measured
  // 96.4pt in a 66.0pt tab, so the German row rendered one tab two lines tall. "UK" is
  // what German writes in a constrained label, and it is the same two letters as English.
  'petsCountryUK':      { German:  'UK is the ordinary German abbreviation in a constrained label; Großbritannien overflows the tab' },
  'petsCountryEU':      { German:  'EU is the standard German abbreviation for Europäische Union — identical letters, not an untranslated string' },
  'petsStep1Title':     { Spanish: "'Microchip' is the Spanish word, spelled identically" },
  // NOT a pets key and NOT new — `email` has been in the table all along. It entered
  // scope because components/VetDeptActions.js renders it, which is a coverage GAIN: a key
  // that nothing was checking is now checked. Greek uses the Latin loanword on interfaces.
  'email':              { Greek:   'Greek interfaces use the Latin loanword "Email"; the calque «Ηλ. ταχυδρομείο» reads as officialese on a contact button' },

  // "WhatsApp" is a BRAND, not a word. It is written in Latin script on WhatsApp's own
  // localised interfaces in every one of these six locales, and on the partner's own
  // Turkish site. Translating it would invent a name for an app the user already has
  // installed under this one — on a contact button, where the whole job of the label is to
  // tell somebody which app is about to open.
  //
  // ⚠ ARABIC AND PERSIAN ARE DELIBERATELY NOT IN THIS LIST, and the asymmetry is the
  //   decision rather than an oversight. Both scripts routinely transliterate this
  //   particular brand — واتساب / واتساپ are what Arabic and Persian speakers read and
  //   type — so they are TRANSLATED above and this guard checks them as normal. That is
  //   the opposite call from connTagEsim below, which stays Latin even in RTL copy,
  //   because "eSIM" is a technical product term nobody transliterates and this is a
  //   consumer brand everybody does. Two entries, two reasons, not one rule about RTL.
  'petHotelWhatsApp': { Turkish: 'brand name, Latin script on WhatsApp\'s own Turkish UI',
                        Russian: 'brand name, Latin script in Russian copy',
                        Greek:   'brand name, Latin script in Greek copy',
                        French:  'brand name, Latin script in French copy',
                        Spanish: 'brand name, Latin script in Spanish copy',
                        German:  'brand name, Latin script in German copy' },
  // "eSIM" is a product term, not a word — it is written in Latin script and left
  // untranslated by the industry in every locale ADA supports, including the two RTL ones,
  // exactly as "Wi-Fi" and "SIM" are. KKTCELL's own Turkish pages say "eSIM". Translating
  // it would invent a term no shop assistant would recognise, which on a screen whose whole
  // job is getting somebody a working line at the airport is the opposite of helpful.
  //
  // NOTE this is the TAG on a package card, which is ADA's own label for a capability. The
  // package NAMES beside it are never translated at all and never reach this file — they
  // come from connectivity_packages and render exactly as the partner wrote them.
  'connTagEsim': { Turkish: 'product term, Latin script in all locales',
                   Arabic:  'product term, stays Latin even in RTL copy',
                   Russian: 'product term, Latin script in Russian tech copy',
                   Greek:   'product term, Latin script in Greek tech copy',
                   French:  'product term, untranslated',
                   Spanish: 'product term, untranslated',
                   German:  'product term, untranslated',
                   Persian: 'product term, stays Latin even in RTL copy' },

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

  // ─── menuTransportation, 2026-09-06 ──────────────────────────────────────
  // English was 'Transportation' and broke mid-word in a 4-across tile, so it was
  // shortened to 'Transport' — which is ALSO the French and German word, exactly as it
  // already was in both locales before this change. Nothing was copied from English and
  // nothing is untranslated; the three languages simply agree.
  //
  // This collision is the guard doing its job: it appeared the moment the English string
  // moved, which is the one time somebody should be asked whether a match is real.
  'menuTransportation': { French: "'Transport' is the French word, and was already the French value",
                          German: "'Transport' is the German word, and was already the German value" },

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

// ⚠ PENDING_KEYS ARE SUBTRACTED, AND THAT IS NOT A CONVENIENCE. petHotelShinyPawAbout is
//   referenced by the config and deliberately unwritten in all nine locales (the partner
//   has supplied no about copy). This guard fails on a key absent from ENGLISH, so
//   including it would go red on a state scripts/check-pet-partners.mjs asserts is
//   correct — two guards contradicting each other over the same key. One owner each:
//   pethotel:check owns "is it still unwritten", this file owns "is every written key
//   present in all nine".
const PET_PARTNER_KEYS = (() => {
  const pending = new Set(PET_PENDING_KEYS)
  const out = new Set()
  for (const p of PET_PARTNERS) {
    if (p.aboutKey) out.add(p.aboutKey)
    for (const sv of p.services || []) { out.add(sv.titleKey); out.add(sv.bodyKey) }
    // The practical rows are FILTERED OUT of petPartnerSections() while their values are
    // pending, so driving it with a probe is the only way to see their labels. Every field
    // is stubbed truthy; nothing here reaches the app.
    const probe = { ...p }
    for (const f of ['openingHours', 'dropOffPickUpHours', 'capacity', 'acceptedSizes',
                     'breedRestrictions', 'vaccinationRequirements', 'cameraAccess']) probe[f] = 'ZZ'
    for (const r of petPartnerSections(probe).practical || []) out.add(r.labelKey)
  }
  return [...out].filter(k => k && !pending.has(k))
})()

// Keys these surfaces reach THROUGH A VARIABLE. Pulled from the same maps the screens
// index into, so a new category or group is covered the moment it is added.
const viaVariable = [
  ...HOME_TILE_LABEL_KEYS,
  // The two strip cards. Every one of these is chosen by a ternary or arrives as
  // item.titleKey, so the literal scan sees none of them — see the note on the array.
  ...STRIP_CARD_KEYS,
  // The banner ad disclosure label. components/AdSlot.js renders it as
  // t(AD_SPONSORED_KEY, lang) — a VARIABLE — so the literal scan cannot see it.
  //
  // ⚠ IT IS COVERED TODAY ONLY BY ACCIDENT, WHICH IS WHY THIS LINE EXISTS. LiveStrip
  //   happens to call t('stripSponsored', lang) literally for the strip's promo rank, so
  //   the key is in scope through that surface. The day the promo rank is removed — and it
  //   has already been removed and restored once — the ad banner's ONLY user-visible string
  //   would drop out of coverage silently, while the key total went UP. That is this repo's
  //   named failure shape: a coverage loss hidden inside a coverage gain.
  AD_SPONSORED_KEY,
  // The V1 duty banner's three states, picked the same way in renderHub(). They have
  // NEVER been in scope: the scan cannot see `t(ok ? 'a' : b ? 'c' : 'd', lang)`, and when
  // components/home/DutyRow.js was a listed surface it did not help, because being listed
  // only matters if the regex matches. Adding them here is the fix that should have been
  // made when the pattern was introduced, not when the file was deleted.
  'tonightDuty', 'dutyBannerPartialTitle', 'dutyBannerStaleTitle',
  'homeDutySub', 'dutyBannerStaleSub',
  ...HEALTH_TYPES,
  ...Object.values(GROUP_META).map(m => m.labelKey),
  // The wizard's two single-select groups. Reached as t(MAP[value]), invisible to the
  // literal scan — the exact blind spot this file's header describes.
  ...Object.values(RESIDENT_STATUS_LABEL_KEY),
  ...Object.values(STUDENT_LEVEL_LABEL_KEY),
  ...Object.values(SEND_ERROR_KEY),
  ...Object.values(STEP_TITLE_KEY),
  ...Object.values(HELP_ROW_LABEL_KEY),
  ...Object.values(CATEGORY_LABEL_KEY),
  ...Object.values(REGION_LABEL_KEY),
  // ─── The pet hotel partner's own copy — 19 of its 34 keys, and ALL of the selling ──
  //
  // Listing screens/pets/PetHotelPartnerScreen.js in SURFACES covers the 15 keys it calls
  // literally. It covers NONE of the 12 service title/body keys or the 7 practical row
  // labels, because those live in constants/petPartners.js and reach the screen as
  // t(sv.titleKey, lang) and t(r.labelKey, lang) — the exact variable-lookup blind spot
  // this file's header describes and the SURFACE_PROP_KEYS note measured once already.
  //
  // ⚠ THEY ARE THE LONGEST AND MOST TRANSLATION-SENSITIVE STRINGS ON THE SURFACE — the
  //   partner's selling copy, six full sentences. Adding the screen to SURFACES while
  //   leaving these out would have guarded the minority of the feature while the key
  //   total went UP, which is this repo's named failure shape.
  //
  // DERIVED from the config, not listed, so partner #2's services are covered the moment
  // the entry exists. petPartners.js is import-safe (no require, no react-native) partly
  // so this import is possible.
  ...PET_PARTNER_KEYS,
  // ─── The pets module's regulatory keys ────────────────────────────────────
  //
  // Pulled in so they are CHECKED FOR AN ENGLISH VALUE and COUNTED, then exempted below
  // from the per-locale comparison. Four of them (petsEUNote, petsTurkiyeNote1/2,
  // petsOtherNote) are bare strings in a NOTES_BY_COUNTRY array — not t('x'), not a *Key
  // field — so nothing else in this file can see them at all.
  ...PETS_REGULATORY_KEYS,
]

const KEYS = [...new Set([...literal, ...viaVariable, ...SURFACE_PROP_KEYS])].filter(Boolean).sort()
const LANGS = Object.keys(LANG_CODES).filter(l => l !== 'English')

// ─── Check ───────────────────────────────────────────────────────────────────

// ─── THE ONE EXEMPTION THAT IS A SET, NOT A LIST OF PAIRS ───────────────────
//
// The pets module's regulatory copy — import steps, waiting intervals, fees, banned
// breeds, airline policy, TRNC statute names — is deliberately English in the seven
// locales that lack it, and deliberately Turkish in tr, which has carried it since before
// this guard existed. A mistranslated "90 days after the titer blood draw" does not look
// wrong in any language; it looks like an instruction, and somebody follows it to an
// airport. That is the whole reason the split exists.
//
// ⚠ WHY THIS IS NOT 273 ALLOWLIST LINES. 39 keys x 7 locales, and this file's own header
//   forbids exactly that: "a 2081-entry allowlist could only be GENERATED, never reviewed.
//   A generated allowlist is a rubber stamp." One declared reason for one named set is
//   reviewable; 273 lines saying the same sentence are not.
//
// ⚠ THE SET IS IMPORTED, NOT COPIED. constants/petsContent.js is the single source, and it
//   is the same list the screens and PetsRegulatoryNotice read. Moving a key between
//   wrapper and regulatory is therefore ONE edit, and it is the review moment — a key
//   cannot drift into "deliberately untranslated" without somebody putting it there.
//
// ⚠ IT EXEMPTS ONLY THE PER-LOCALE COMPARISON. These keys are still required to exist in
//   ENGLISH by the check below, and npm run pets:health separately asserts that every one
//   of them names a real key. An exemption that also skipped the English check would let a
//   typo'd key disappear entirely.
const PETS_REGULATORY_EXEMPT = new Set(PETS_REGULATORY_KEYS)
const PETS_REGULATORY_REASON =
  'pets regulatory copy: legal requirements, kept in ' + REGULATORY_LOCALES.join('+')
  + ' so a translation cannot introduce an error a reader would only discover at a border'

const problems = []
const usedAllowances = new Set()
let regulatoryExempted = 0

for (const key of KEYS) {
  const en = t(key, 'English')
  if (en === key) { problems.push(`${key}: not present in English at all — every locale falls back to the raw key`); continue }
  for (const lang of LANGS) {
    if (t(key, lang) !== en) continue
    if (PETS_REGULATORY_EXEMPT.has(key)) { regulatoryExempted++; continue }
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

// Printed on every run rather than asserted from memory: a reader can see how much of the
// table is exempt and on what grounds, which is the reviewability the 273-line allowlist
// would have destroyed.
const regulatoryLine = `  ${PETS_REGULATORY_EXEMPT.size} pets regulatory key(s) exempt from the locale comparison `
  + `(${regulatoryExempted} key x locale pair(s) matched)\n    reason: ${PETS_REGULATORY_REASON}`

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
// The scope line is DERIVED from SURFACES, never written out. It used to name four
// surfaces in prose — "Explore map, check-in, duty roster and Home" — and was stale from
// the moment ProfileSetupScreen was added, describing a scan that already covered more than
// it claimed. A guard that misdescribes its own scope teaches the reader to skim it, and the
// next real MISSING gets skimmed with it. Same rule this repo applies to any measured
// figure in a comment: regenerate it, do not remember it.
const scopeNames = SURFACES.map(f => f.split('/').pop().replace(/\.js$/, '')).join(', ')
console.log(`i18n coverage: OK — ${KEYS.length} key(s) × ${LANGS.length} locale(s), `
  + `${allowanceCount} declared same-as-English`)
console.log(`  scope: ${SURFACES.length} surface(s) — ${scopeNames}`)
console.log(`  ${KEYS.length} of the ${enTotal} keys in the table`)
console.log(regulatoryLine)
