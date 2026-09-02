// Month names for the profile wizard's date-of-birth dropdowns.
//
// Hand-translating 12 months × 9 locales was ruled out, and rightly: 108 strings nobody
// can review, to reproduce a table ICU already ships. So this takes Intl for eight
// locales and overrides exactly one — with the measurement that justifies it below.
//
// No imports, so scripts/check-profile-gate.mjs can load it under plain Node.
//
// ─── MEASURED 2026-08-30, ALL NINE LOCALES ──────────────────────────────────
//
// Two things were checked for every locale ADA ships: the resolved CALENDAR, and
// whether the standalone month form differs from the form used inside a date.
//
//   locale   calendar(bare)  calendar(-u-ca-gregory)  standalone≠in-date  Jan standalone
//   English  gregory         gregory                  0/12                January
//   Turkish  gregory         gregory                  0/12                Ocak
//   Arabic   gregory         gregory                  0/12                يناير
//   Russian  gregory         gregory                  12/12               январь
//   Greek    gregory         gregory                  0/12                Ιανουαρίου  ← WRONG
//   French   gregory         gregory                  0/12                janvier
//   Spanish  gregory         gregory                  0/12                enero
//   German   gregory         gregory                  0/12                Januar
//   Persian  PERSIAN         gregory                  0/12                ژανویه  (bare: دی)
//
// ─── FINDING 1: PERSIAN, AND ONLY PERSIAN, DEFAULTS TO A NON-GREGORIAN CALENDAR ──
//
// `Intl.DateTimeFormat('fa', {month:'long'})` resolves to the PERSIAN (Jalali) calendar
// and returns دی (Dey) for what a Gregorian reader calls January. A Persian user would
// have picked Jalali month names beside a Gregorian year dropdown and entered a date
// that is simply not the date they meant — silently, with nothing on screen wrong.
// `-u-ca-gregory` fixes it: ژانویه.
//
// ⚠ A CORRECTION TO AN EARLIER CLAIM IN THIS PROJECT'S NOTES: `ar-SA` was said to do
//   the same thing with the Islamic calendar. It does NOT — measured here, `ar`,
//   `ar-SA` and `ar-EG` all resolve to `gregory`. That was an inference repeated as a
//   fact. The suffix is still applied to every locale, because it costs nothing and
//   pins the behaviour against a future CLDR change, but PERSIAN IS THE ONLY LOCALE
//   THAT NEEDS IT TODAY, and that is what the probe asserts.
//
// ─── FINDING 2: GREEK IS THE ONLY LOCALE ICU GETS GRAMMATICALLY WRONG HERE ──
//
// Greek and Russian both inflect month names. Russian is handled correctly: asked for a
// month alone, ICU returns the standalone nominative «январь», and «января» only inside
// a date — 12 of 12 months differ between the two forms, which is the signature of a
// working standalone table.
//
// Greek returns the GENITIVE Ιανουαρίου ("of January") for both — 0 of 12 differ. In a
// date that is right; in a dropdown it reads "of January, of February, of March…".
// The nominative table below is the correction. It is 12 strings for ONE locale, chosen
// deliberately over the 108 the spec ruled out.
//
// Nobody else in ADA's nine is affected: the other seven do not inflect month names, so
// "standalone == in-date" is the correct answer for them, not a symptom.
//
// ⚠ DO NOT DELETE THIS OVERRIDE AS REDUNDANT. If a future ICU starts returning the
//   Greek standalone form, GREEK_MONTHS still returns the same words and nothing
//   changes; the probe asserts the nominative is what reaches the UI, so a silent
//   revert to the genitive goes RED.

// Nominative (standalone) forms — the counterpart of the genitives ICU returns.
// ICU gives: Ιανουαρίου, Φεβρουαρίου, Μαρτίου, Απριλίου, Μαΐου, Ιουνίου, Ιουλίου,
//            Αυγούστου, Σεπτεμβρίου, Οκτωβρίου, Νοεμβρίου, Δεκεμβρίου
export const GREEK_MONTHS = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
]

// The last-resort table. English, deliberately: if Intl is unavailable or is ignoring
// the calendar request, English months in a date picker are understood everywhere and
// are RECOVERABLE — the user reads "January" and picks the right one. Jalali months
// beside a Gregorian year are not recoverable: they look correct and produce a wrong
// date the user never knows they entered.
export const FALLBACK_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const LANG_TO_CODE = {
  English: 'en', Turkish: 'tr', Arabic: 'ar', Russian: 'ru', Greek: 'el',
  French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa',
}

// A fixed day in a fixed year, formatted in UTC. Never `new Date()`: a device in a
// timezone behind UTC would roll the 15th back into the previous month for part of the
// day, and the dropdown would silently list the months shifted by one.
const SAMPLE = m => new Date(Date.UTC(2026, m, 15))

// ─── THE RUNTIME CONTROL ─────────────────────────────────────────────────────
//
// Node ships full ICU; Hermes on the phone is a different engine and this file cannot
// measure it from a laptop. So the control runs ON THE DEVICE, at module load, and asks
// the one question whose wrong answer is invisible to the user: does Persian January
// come back as the Gregorian ژانویه, or as the Jalali دی?
//
// It is a control and not a formality — ask what it prints if the runtime is PERFECT
// (ژانویه) versus BROKEN (دی, or a throw, or an empty string), and the three differ.
// Anything but the first answer drops every locale to FALLBACK_MONTHS, because an
// engine that ignores the calendar request cannot be trusted for the other eight either.
const PERSIAN_GREGORIAN_JANUARY = 'ژانویه'

function intlIsTrustworthy() {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return false
    const fa = new Intl.DateTimeFormat('fa-u-ca-gregory', { month: 'long', timeZone: 'UTC' })
      .format(SAMPLE(0))
    if (fa !== PERSIAN_GREGORIAN_JANUARY) return false
    // Second half of the control: a locale that must be trivially right. If English
    // January is not "January", Intl is returning something this file cannot reason
    // about at all and the fallback is the honest answer.
    const en = new Intl.DateTimeFormat('en-u-ca-gregory', { month: 'long', timeZone: 'UTC' })
      .format(SAMPLE(0))
    return en === 'January'
  } catch {
    return false
  }
}

// Evaluated once. `intlTrusted` is exported so the wizard can surface a dev-only warning
// rather than silently rendering English to a Turkish user with no explanation anywhere.
export const intlTrusted = intlIsTrustworthy()

const cache = {}

// 12 month names for a language, index 0 = January. Never throws.
export function monthNames(lang) {
  if (cache[lang]) return cache[lang]
  let out
  if (!intlTrusted) {
    out = FALLBACK_MONTHS
  } else if (lang === 'Greek') {
    out = GREEK_MONTHS
  } else {
    const code = LANG_TO_CODE[lang] || 'en'
    try {
      const fmt = new Intl.DateTimeFormat(`${code}-u-ca-gregory`, { month: 'long', timeZone: 'UTC' })
      out = Array.from({ length: 12 }, (_, m) => fmt.format(SAMPLE(m)))
      // A locale that returns a blank or a bare number is worse than English.
      if (out.some(n => !n || /^\d+$/.test(n))) out = FALLBACK_MONTHS
    } catch {
      out = FALLBACK_MONTHS
    }
  }
  cache[lang] = out
  return out
}
