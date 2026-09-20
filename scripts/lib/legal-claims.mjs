// ─── The retracted claims, and the version, with ONE owner each ─────────────
//
// Two guards ask about the same three sentences from different sides:
//
//   check-privacy-parity.mjs   do the FILES in this repo still carry them?
//   check-legal-live.mjs       do the PUBLISHED URLS still carry them?
//
// They were going to hold a copy of the list each. That is the failure this repo has
// removed three times in a week — a hardcoded set that cannot fail correctly, and two
// copies of it that drift until the pair reports something neither of them means. A
// sentence deleted from one list and not the other produces a live check that passes on
// a page the file check would reject, which is worse than having only one of them.
//
// So the list lives here and neither guard retypes it. Adding a fourth retraction is one
// edit in one place and both sides pick it up.
//
// ⚠ THE REGEXES MATCH PROSE. Keep them to the shortest phrase that cannot appear in a
//   sentence which is still TRUE — these are searched for in copy that has deliberately
//   been rewritten around them, so a loose pattern re-flags the replacement.
export const GOLIVE_STALE = [
  { key: 'never visible to other customers',
    en: /never visible to other customers/i,
    tr: /diğer müşterilere hiçbir zaman görünmez/i,
    why: 'the student list shows one customer to another' },
  { key: 'no student list yet',
    en: /there is no student list in the app yet/i,
    tr: /henüz bir öğrenci listesi yoktur/i,
    why: 'there is one now, and opting in shows you to people' },
  { key: 'nothing reads the study fields',
    en: /nothing in the app reads them/i,
    tr: /uygulamada bu veriler hiçbir yerde kullanılmıyor/i,
    why: 'get_student_list reads four of them (20261026)' },
]

// DERIVED from the constant the app actually writes to profiles.terms_version, never
// retyped. A guard that carries its own copy of the version is a guard that goes green on
// the day the two disagree, which is the one day it matters.
export function readLegalVersion(src) {
  const m = src.match(/export const LEGAL_VERSION\s*=\s*'([^']+)'/)
  if (!m) throw new Error('could not read LEGAL_VERSION from constants/legal/index.js')
  return m[1]
}
