// Pets module content metadata — the verification stamp, the Vet Department contacts, and
// the wrapper/regulatory language split.
//
// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// Three screens each carried their own `const LAST_VERIFIED = 'June 2026'`, their own
// `VET_DEPT_PHONE` and their own `VET_DEPT_EMAIL`. Three copies of one fact is three
// places to update and two places to forget, and nothing anywhere could ask how old the
// content was — which is how it reached three months stale with every existing check
// green. Every check in this repo asked whether a column EXISTS; none asked whether the
// CONTENT IS CURRENT. That is the duty_list failure class, and this is its guard.
//
// No react-native import and NO require(): plain data and pure functions, so
// scripts/check-pets-staleness.mjs and scripts/validate-i18n-coverage.mjs can both import
// it under plain Node. constants/months.js is the only dependency and is itself
// import-free, for the same reason.

import { monthNames, intlTrusted } from './months.js'
import { LANG_CODES } from './i18n.js'

// ─── THE VERIFICATION STAMP ─────────────────────────────────────────────────
//
// ⚠ MONTH PRECISION, NOT A DAY, BECAUSE THAT IS ALL ANYONE ACTUALLY KNOWS. The value it
//   replaces was the string 'June 2026' — no day was ever recorded. Writing '2026-06-15'
//   here would be inventing a fact to make the arithmetic tidier, which is exactly the
//   thing this module's content is not allowed to do about anything else.
//
// ⚠ IT RESOLVES TO THE FIRST OF THE MONTH, AND THE DIRECTION IS THE POINT. A month is a
//   30-day window of uncertainty and the staleness maths has to pick a point in it.
//   Taking the FIRST assumes the oldest possible verification, so the content is called
//   stale up to 29 days EARLY. Taking the last would under-report staleness by up to 29
//   days — on import rules for a live health module, where the cost of reviewing early is
//   a phone call and the cost of reviewing late is somebody at Ercan with the wrong
//   paperwork. Err toward the phone call.
export const verifiedOn = '2026-06'

// ─── PENDING EXTERNAL VERIFICATION ──────────────────────────────────────────
//
// These replace two floating `// Verify contact details with TRNC Veterinary Department
// before shipping` comments that sat in BringingPetScreen.js and OwningPetScreen.js
// through every release since the module went live. A TODO in a comment is not tracked by
// anything; an entry here is asserted null by scripts/check-pets-staleness.mjs, so filling
// one in is a reviewed act and leaving it empty is visible on every run.
export const PENDING = {
  reviewedBy: 'Who at the TRNC Veterinary Department confirmed these requirements, and in what role. Nobody has been named, so no name is claimed.',
  sourceUrl:  'The official page or document these requirements come from. The Vet Department publishes no stable URL that has been confirmed, and linking a guessed one would lend it an authority nobody granted.',
  vetDeptContacts: 'The phone number and email below were carried over from the original screens and have NEVER been dialled or mailed to confirm they still reach the department. They are published contact details, not verified ones.',
}

export const reviewedBy = null
export const sourceUrl  = null

// ─── TRNC VETERINARY DEPARTMENT ─────────────────────────────────────────────
//
// ⚠ VALUES UNCHANGED from the three screens they were lifted from. This slice moved them;
//   it did not verify them — see PENDING.vetDeptContacts. They are the fallback the PIB.01
//   button now offers instead of a "coming soon" alert, and the actions on the staleness
//   notice, so they are reached from more places than before, not fewer.
export const VET_DEPT_PHONE = '03922283795'
export const VET_DEPT_EMAIL = 'veteriner@gov.ct.tr'

// ─── THE TWO THRESHOLDS, AND WHY THEY DIFFER ────────────────────────────────
//
// 90 days tells the TEAM (a guard, in the terminal). 180 days tells the USER (a notice, on
// the screen). The gap is deliberate: the team gets a full quarter's warning to make one
// phone call before anything is said to a user, because telling users "this may be out of
// date" is a real cost — it devalues content that is probably still correct — and should
// only happen once we have demonstrably failed to check.
//
// ⚠ THE 90-DAY GUARD IS RED THE DAY IT SHIPS, and that is correct rather than a
//   miscalibration: the content was already ~105 days old when this file was written. A
//   guard tuned to pass on the state that caused it to be written would be a decoration.
export const STALE_AFTER_DAYS       = 90
export const USER_NOTICE_AFTER_DAYS = 180

// Resolve the stamp to a Date. UTC and the first of the month — see the note on verifiedOn.
// Returns null rather than an Invalid Date so every caller has one obvious thing to test.
export function verifiedDate() {
  const m = /^(\d{4})-(\d{2})$/.exec(String(verifiedOn || ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  return Number.isNaN(d.getTime()) ? null : d
}

// `now` is INJECTED everywhere below so the guard can drive both sides of each threshold
// with a fake clock. A function that reads the wall clock internally cannot be tested at
// the boundary it exists to defend — the same reason dormDeal() takes its clock.
export function daysSinceVerified(now = new Date()) {
  const d = verifiedDate()
  if (!d) return null
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

// ⚠ AN UNPARSEABLE STAMP COUNTS AS STALE, NOT AS FRESH. If verifiedOn is ever corrupted,
//   the honest answer is "we do not know how old this is", and the safe rendering of "we
//   do not know" on regulatory content is the same as "too old". The inverse would let a
//   typo silently switch the guard off.
export function isStale(now = new Date()) {
  const days = daysSinceVerified(now)
  return days === null || days > STALE_AFTER_DAYS
}

export function showUserStaleNotice(now = new Date()) {
  const days = daysSinceVerified(now)
  return days === null || days > USER_NOTICE_AFTER_DAYS
}

// "June 2026" in the reader's own language, for the {date} slot in petsDisclaimerText.
// Built from constants/months.js rather than toLocaleDateString, which is not a detail:
// that file MEASURED that Intl.DateTimeFormat('fa', …) resolves to the PERSIAN (Jalali)
// calendar, so a Persian reader would have been shown a month name that is not the month
// meant, with nothing on screen looking wrong. monthNames() carries the -u-ca-gregory fix,
// the Greek nominative override and a runtime trust control.
export function verifiedLabel(lang) {
  const d = verifiedDate()
  if (!d) return ''
  return `${monthNames(lang)[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// ─── A FULL DATE, IN THE READER'S LANGUAGE AND THE RIGHT CALENDAR ───────────
//
// TimelineCalculatorScreen hardcoded `toLocaleDateString('en-GB', …)`, so every computed
// date rendered in English in all nine locales — a calculator that works out the right day
// and then prints it in a format the reader cannot use is broken in the part that counts.
//
// ⚠ THE OBVIOUS FIX IS A TRAP, AND constants/months.js ALREADY MEASURED IT. Swapping
//   'en-GB' for the user's locale sends Persian to the JALALI calendar:
//   Intl.DateTimeFormat('fa', …) resolves to `persian`, so a Gregorian deadline would have
//   been printed as a Jalali date — a real date, correctly formatted, and not the day the
//   calculation produced. Nothing on screen would look wrong. `-u-ca-gregory` is the fix,
//   and it is applied to EVERY locale rather than just fa, so a future CLDR change cannot
//   reintroduce the bug somewhere else.
//
// ⚠ AND IT IS GATED ON intlTrusted, the runtime control months.js runs ON THE DEVICE at
//   load: Node ships full ICU, Hermes is a different engine, and this file cannot measure
//   Hermes from a laptop. If the engine ignores the calendar request, every locale drops to
//   a composed "D Month YYYY" built from the month table — English month names, which are
//   understood widely and, crucially, RECOVERABLE. A wrong calendar is not.
export function formatPetDate(date, lang) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  if (intlTrusted) {
    try {
      const code = LANG_CODES[lang] || 'en'
      return new Intl.DateTimeFormat(`${code}-u-ca-gregory`,
        { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    } catch { /* fall through to the composed form */ }
  }
  return `${date.getDate()} ${monthNames(lang)[date.getMonth()]} ${date.getFullYear()}`
}

// ─── THE LANGUAGE SPLIT — ONE SOURCE OF TRUTH ───────────────────────────────
//
// WRAPPER copy (titles, headings, buttons, tabs, empty states, disclaimers, notices) is
// translated into all nine locales. REGULATORY copy — anything stating a rule, an
// interval, a threshold, a fee, a law, a breed list or an airline's own policy — is NOT,
// and the seven locales without it see English under an explanatory notice.
//
// ─── WHY REGULATORY COPY IS NOT TRANSLATED ──────────────────────────────────
//
// These strings are the requirements themselves. A mistranslated "90 days after the titer
// blood draw" does not look wrong in any locale — it looks like an instruction, and
// somebody follows it to an airport. The nine-locale sweep that is right for a button
// label is a liability on a number a border officer will check.
//
// ⚠ en AND tr, NOT en ALONE. Turkish already carried all 39 of these, fully translated,
//   before this slice existed. Dropping to English-only would have DELETED working
//   Turkish rule text — in an official language of the TRNC — to solve a problem Turkish
//   does not have. The rule for this slice is that it ADDS and never REMOVES. So the
//   notice renders for the SEVEN locales that genuinely fall back (ar, ru, el, fr, es, de,
//   fa) and never for en or tr.
//
// ⚠ THIS LIST IS IMPORTED BY scripts/validate-i18n-coverage.mjs, which exempts exactly
//   these keys from its identical-to-English rule with ONE declared reason. That is what
//   makes this the single source of truth: moving a key between buckets is a one-line edit
//   HERE, and it is the review moment. The alternative was 39 × 7 = 273 allowlist entries,
//   which that file forbids in its own header — a generated allowlist is a rubber stamp.
//
// ⚠ ADDING A KEY HERE MAKES IT ENGLISH FOR SEVEN LOCALES. That is a content decision, not
//   a tidying one. Removing a key means it must exist in all nine.
export const REGULATORY_KEYS = [
  // Entry points — states where a pet may legally enter the country.
  'petsGreenLineText',
  // The six import steps, and the four interval pills beside them. The pills are styled as
  // labels but are the hardest numbers on the screen: "30-day wait", "90 days", "4–6
  // weeks", "within 10 days".
  'petsStep1Body', 'petsStep2Body', 'petsStep3Body', 'petsStep4Body', 'petsStep5Body', 'petsStep6Body',
  'petsStep3Sub', 'petsStep4Sub', 'petsStep5Sub', 'petsStep6Sub',
  // Per-country variants and their notes.
  'petsStep3BodyEU', 'petsStep6BodyEU', 'petsEUNote',
  'petsTrStep3Body', 'petsTrStep5Body', 'petsTurkiyeNote1', 'petsTurkiyeNote2',
  'petsOtherNote', 'petsOtherStep6Body',
  // Breed prohibitions, fees, and the arrival procedure.
  'petsBannedBreedsBody', 'petsFeesBody', 'petsAtErcanBody',
  // The calculator's per-step intervals — the same numbers as the pills above, restated.
  'petsTimelineMicrochipNote', 'petsTimelineVaccineNote', 'petsTimelineTiterNote', 'petsTimelineEntryNote',
  // Airline policy, which is the airline's rule and not ours to paraphrase in nine ways.
  'petsPegasusCabinBody', 'petsPegasusHoldBody', 'petsAjetBody',
  // Travel health warnings carrying temperatures, months and breed embargoes.
  'petsSummerHeatBody', 'petsSnubNosedBody', 'petsReentryBody',
  // TRNC law: registration duty, the statute names, vaccination schedules, cruelty
  // reporting duty, and tenancy rules.
  'petsRegistrationBody', 'petsTrncLawNote',
  'petsVaccineDogsBody', 'petsVaccineCatsBody',
  'petsCrueltyBody', 'petsApartmentBody',
]

// The locales that see English regulatory copy, and therefore the notice. Derived as
// "every locale except the two that have the strings", so adding a full translation later
// is one edit and this follows.
export const REGULATORY_LOCALES = ['en', 'tr']
export const fallsBackToEnglish = langCode => !REGULATORY_LOCALES.includes(langCode)
