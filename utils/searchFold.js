// Diacritic-insensitive folding for SEARCH. No imports, so a Node-side guard can drive it.
//
// ⚠ THIS IS THE OPPOSITE OF utils/moderationNormalize.js AND MUST NEVER SHARE CODE WITH IT.
//   That file is NFC-only and deliberately does NOT fold accents, for reasons recorded in
//   CLAUDE.md: folding ö→o makes the Turkish term `göt` match the English "got", and
//   folding ı→i makes `sık sık` ("often") match `sik`. Those are false positives in a
//   content filter, where a wrong match silently blocks an innocent user.
//
//   Here the trade runs the other way. A user typing "turkiye" who is shown nothing has
//   been failed; a user typing "kibris" who also gets "Kıbrıs" has been served. Search
//   wants recall, moderation wants precision, and a shared helper would have to pick one.
//
// ─── WHY NFD ALONE IS NOT ENOUGH ────────────────────────────────────────────
//
// The standard recipe — NFD, drop combining marks — handles ğ ş ç ö ü, because each is a
// base letter plus a mark that NFD separates. It does NOT handle ı: U+0131 DOTLESS I is
// its OWN base letter, not a decomposed i, so it survives NFD untouched and the generic
// normalizer fails silently on exactly the Turkish case this exists for.
//
// So the fold is three passes, not one: protect, map explicitly, then decompose.

// ─── 1. PROTECTED — decomposable, but folding them CHANGES THE WORD ─────────
//
// й (U+0439) is и + combining breve, so NFD + strip turns it into и. In Russian those are
// DIFFERENT LETTERS: мой ("my") and мои ("mine", plural) are different words, and
// Тайланд / Таиланд are different spellings people do not confuse. A Turkish fix that
// quietly merges them would degrade Russian search to buy nothing.
//
// ё → е is deliberately NOT protected. Russian readers routinely type е for ё and search
// conventionally treats them as equivalent, so folding there is help rather than harm.
const PROTECTED = new Set(['й'])

// ─── 2. EXPLICIT — not decomposable, so NFD can never reach them ────────────
const EXPLICIT = {
  // Turkish dotless i. THE reason this file exists.
  'ı': 'i',
  // Dotted capital İ. NFD does handle it (I + U+0307), and toLowerCase turns it into
  // i + U+0307 which also strips — but it is listed so the Turkish pair is visible in
  // one place rather than half-implicit.
  'i̇': 'i',
  // Greek final sigma. Not a diacritic and not decomposable, but "Κύπρος" folds to
  // κυπρος while a user typing in caps produces κυπροσ — the same word, no match.
  'ς': 'σ',
}

// ─── 3. Combining marks NFD produces, plus the ones already separate ────────
// Latin/Greek/Cyrillic diacriticals come from NFD. Arabic harakat and Hebrew points are
// ALREADY separate characters in NFC, so NFD does not create them and they must be named:
// Arabic is normally written without them and a search must ignore them.
const MARKS = /[̀-ͯ҃-҉֑-ׇؐ-ًؚ-ٰٟۖ-ۭ]/g

/**
 * Fold a string for search comparison. Apply to BOTH the query and the candidate —
 * folding only one side matches in one direction and not the other, which is worse than
 * not folding at all because it looks like it works.
 */
export function searchFold(input) {
  if (!input) return ''
  // Plain toLowerCase, NEVER toLocaleLowerCase. Under a Turkish locale 'I' lowercases to
  // 'ı', so a locale-aware call would turn English "Ireland" into "ıreland" and then map
  // it back — same answer by luck, and a different answer the moment a locale disagrees
  // about some other pair. The explicit map above is where Turkish casing is handled.
  let out = ''
  for (const ch of String(input).toLowerCase()) {
    if (PROTECTED.has(ch)) { out += ch; continue }
    const mapped = EXPLICIT[ch]
    if (mapped !== undefined) { out += mapped; continue }
    out += ch.normalize('NFD').replace(MARKS, '')
  }
  // Collapse whitespace so "Kuzey  Kıbrıs" and "Kuzey Kıbrıs" compare equal.
  return out.replace(/\s+/g, ' ').trim()
}

/** True when `needle` appears in `haystack` with both sides folded. */
export const searchMatch = (haystack, needle) =>
  searchFold(haystack).includes(searchFold(needle))
