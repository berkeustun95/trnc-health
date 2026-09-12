// The legal documents, and the one place that decides which one a reader gets.
//
// ─── WHY THESE ARE NOT IN constants/i18n.js ─────────────────────────────────
//
// They are ~13KB each and there are four. i18n.js is already ~10,500 lines carrying
// ~1,630 keys per locale, every screen imports it, and both its guards
// (check-i18n-duplicates, validate-i18n-coverage) treat an entry as a UI STRING — a
// 13KB template literal is pathological for both. More basically these are not UI copy:
// they are versioned documents with their own publication process, compared across three
// hosts by scripts/check-privacy-parity.mjs, and they change on a legal cadence rather
// than a product one.
//
// ─── WHY NOT IN screens/LegalScreen.js, WHERE THEY USED TO LIVE ─────────────
//
// 52KB of prose inside a screen component means every layout edit is a diff against a
// legal document and vice versa. Both guards used to extract them from that file with a
// regex over the template literal; both are repointed here, in the same commit that
// moved them, because their extract THROWS rather than silently passing when the literal
// is not found — which is the right failure and still a hard blocker.
import PRIVACY_EN from './privacy.en.js'
import PRIVACY_TR from './privacy.tr.js'
import TERMS_EN   from './terms.en.js'
import TERMS_TR   from './terms.tr.js'

// ─── THE VERSION IS A PAIR, NOT TWO NUMBERS ─────────────────────────────────
//
// One tick accepts BOTH documents, so they carry one version between them and move
// together. If they ever need to version separately, that is a product change (two
// acceptance events, two records) and not a constant to split quietly.
//
// Bumped 2026-08 -> 2026-09 when the Turkish translations, the advertising clause, the
// legal-basis table and the entity block landed. It is the value written to
// profiles.terms_version, so a bump means every future acceptance records the new one —
// it does NOT re-ask anyone who already accepted. Re-asking is a separate decision.
export const LEGAL_VERSION = '2026-09'

// Locales with a translated body. NOT a hand-kept list — derived from what is actually
// imported, so adding a body is one import and one map entry and this follows.
const DOCS = {
  privacy: { English: PRIVACY_EN, Turkish: PRIVACY_TR },
  terms:   { English: TERMS_EN,   Turkish: TERMS_TR },
}

// ⚠ EVERY CONSUMER MUST GO THROUGH THIS, and it must never be replaced by a list of the
//   seven locales that lack a translation. The day a Greek body is added, the fallback
//   notice has to stop rendering for Greek BY ITSELF — a hardcoded list would keep
//   telling Greek readers their document is only in English while they are reading it in
//   Greek. Same reason the render condition below is derived rather than enumerated.
export function legalDoc(kind, lang) {
  const byLang = DOCS[kind]
  if (!byLang) return null
  return byLang[lang] ?? byLang.English
}

// True when the reader is getting English because their own language has no body yet.
// This is the ONLY thing that should gate the "available in English and Turkish" line,
// on the signup checkbox and inside LegalScreen alike.
export const isLegalFallback = (kind, lang) => !DOCS[kind]?.[lang]

// The language of the body a reader was actually shown. Written to
// profiles.terms_locale at acceptance — see the column comment: it records the document
// that was in front of them, which for seven locales is NOT their UI language.
export const legalLocaleFor = (kind, lang) => (DOCS[kind]?.[lang] ? lang : 'English')

// i18n keys for the two documents. Both already existed for the signup notice links, so
// the tab label, the link text and the header title cannot drift apart.
export const LEGAL_TITLE_KEY = { privacy: 'privacyPolicy', terms: 'termsOfService' }
