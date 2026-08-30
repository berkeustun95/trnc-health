// Text normalization shared by the client profanity preview and — mirrored in SQL —
// by the database's normalize_for_moderation(). It lives in its own file with NO
// imports so scripts/check-moderation-normalization.mjs can load it under plain node;
// utils/profanity.js pulls in lib/supabase.js, which needs the React Native runtime.
//
// If you change anything here, change 20260925_moderation_normalization.sql in the same
// commit and re-run `npm run moderation:check`. A client that normalizes differently
// from the server tells the user "looks fine" inline and then rejects them on submit.

// Characters deleted before matching. Kept as explicit escapes, in the same order as
// the SQL character class, so the two can be diffed by eye. Three groups, all invisible
// or non-semantic:
//   • Cf format characters — ZWNJ/ZWJ/ZWSP, bidi marks, soft hyphen, BOM. Typing one
//     inside a word split it into two tokens, which defeated the filter completely
//     (f<ZWNJ>uck was NOT caught) and also produced false positives (Persian هیچ‌کس,
//     "nobody", is spelled with a ZWNJ and matched the fragment کس).
//   • Mn combining marks that survive NFC — Arabic tashkeel, Hebrew points, the
//     combining dot above. Arabic تمصّه carries a shadda that broke the word apart.
//   • U+0640 ARABIC TATWEEL — category Lm, so it is a *word* character; كـس therefore
//     never matched كس. Visible, on every Arabic keyboard, and free to type.
const NON_SEMANTIC = new RegExp(
  '[' +
  '\\u00AD' +                 // SOFT HYPHEN
  '\\u0300-\\u036F' +         // combining diacritical marks
  '\\u0483-\\u0489' +         // Cyrillic combining
  '\\u0591-\\u05C7' +         // Hebrew points
  '\\u0610-\\u061A' +         // Arabic honorifics
  '\\u061C' +                 // ARABIC LETTER MARK
  '\\u0640' +                 // ARABIC TATWEEL
  '\\u064B-\\u065F' +         // Arabic tashkeel
  '\\u0670' +                 // ARABIC SUPERSCRIPT ALEF
  '\\u06D6-\\u06ED' +         // Quranic annotation
  '\\u200B-\\u200F' +         // ZWSP ZWNJ ZWJ LRM RLM
  '\\u202A-\\u202E' +         // bidi embedding / override
  '\\u2060-\\u2064' +         // word joiner, invisible operators
  '\\u206A-\\u206F' +         // deprecated format characters
  '\\uFE00-\\uFE0F' +         // variation selectors
  '\\uFEFF' +                 // ZWNBSP / BOM
  ']', 'g')

// Postgres \m…\M treat alphanumerics AND underscore as word characters.
const NON_WORD = /[^\p{L}\p{N}_]+/gu

export function normalizeForModeration(text) {
  if (typeof text !== 'string') return ''
  return text
    // NFC first, so a decomposed é recomposes and is NOT stripped by NON_SEMANTIC
    // below. Do not use NFD/NFKD: that would strip real accents, and folding ö→o
    // makes the Turkish term `göt` match the English word "got".
    .normalize('NFC')
    // İ (U+0130) must be mapped BEFORE lowercasing. toLowerCase('İ') yields
    // 'i' + U+0307, a combining mark that broke the word boundary — which is why
    // SİKİK and PİÇ passed the filter untouched. Anyone shouting in Turkish evaded it.
    .replace(/İ/g, 'i')
    .replace(NON_SEMANTIC, '')
    .toLowerCase()
}

// Deliberately NOT normalized: ı (U+0131) is left alone. Folding it to `i` would make
// the ordinary Turkish word `sık` ("tight", and `sık sık` = "often") match the vulgar
// `sik`. Turkish's two i's are different letters, not a case variant.

// A term whose normalized form starts or ends with a non-word character can never match
// server-side, because \m must be followed by — and \M preceded by — a word character.
// Skipping it here keeps the client from blocking text the database would accept.
export function isMatchableTerm(normalizedTerm) {
  return /^[\p{L}\p{N}_]/u.test(normalizedTerm) && /[\p{L}\p{N}_]$/u.test(normalizedTerm)
}

// Normalizing the term list is pure work that does not change between keystrokes, and
// Phase C takes this list from 54 rows to ~510. Memoised on the array itself so callers
// keep passing the plain list around and nobody has to remember a prepare step.
const prepared = new WeakMap()

function prepareTerms(terms) {
  let out = prepared.get(terms)
  if (!out) {
    out = terms
      .map(normalizeForModeration)
      .filter(isMatchableTerm)
      .map(t => ` ${t.replace(NON_WORD, ' ').trim()} `)
    prepared.set(terms, out)
  }
  return out
}

// Word-boundary match, mirroring `normalized_text ~ ('\m' || term || '\M')`.
// Tokenising and padding with spaces gives the same answer without a regex per term.
export function matchesAnyTerm(text, terms) {
  const haystack = ` ${normalizeForModeration(text).replace(NON_WORD, ' ').trim()} `
  if (haystack === '  ') return false
  return prepareTerms(terms).some(term => haystack.includes(term))
}
