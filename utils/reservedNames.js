// Client mirror of public.reserved_names. Lets the wizard refuse a reserved display
// name inline instead of after a round trip; the DATABASE is the boundary
// (check_profile_name_content raises DISPLAY_NAME_RESERVED) and cannot be bypassed.
//
// No imports beyond moderationNormalize.js, so scripts/check-profile-gate.mjs can load
// it under plain Node — same reason utils/moderationNormalize.js has none.
//
// ─── TWO MATCH MODES, AND THE SPLIT IS THE WHOLE DESIGN ─────────────────────
//
// `exact`    — refused only as the WHOLE normalized display name.
//              ada, oli and maki are REAL GIVEN NAMES. Ada is a common Turkish woman's
//              name (it means "island"). Refusing every occurrence would reject
//              "Ada Yılmaz" inside a gate she cannot skip, which is a false positive
//              aimed at exactly the user we are trying to onboard.
// `contains` — refused ANYWHERE in the name. Role words and partner brands only: none
//              of them is a plausible personal name, and "ADA Destek" is precisely the
//              impersonation this list exists to stop.
//
// ⚠ NO ACCENT FOLDING anywhere in ADA's normalization (see 20260925 for why folding
//   ö→o breaks Turkish), so the Turkish and the ASCII spellings of a brand are SEPARATE
//   ROWS. Same precedent as blocked_terms carrying both `piç` and `pic`.
//
// ⚠ THESE ARE NOT BLOCKED TERMS AND MUST NEVER BE ADDED TO blocked_terms. That table
//   feeds contains_blocked_term(), which all six UGC content triggers call — `destek`
//   or `support` in there would reject ordinary reviews, questions, answers, facility
//   descriptions, change requests and place submissions across the whole app.
//   npm run profile:check asserts the separation.
//
// Keep this list identical to the seed in 20261001_profile_completion_schema.sql. The
// table is admin-editable at runtime, so the probe compares this file against the LIVE
// rows, not against the migration text alone.

import { normalizeForModeration } from './moderationNormalize.js'

export const RESERVED_NAMES = [
  { term: 'ada',             mode: 'exact',    reason: 'app name; also a common Turkish given name — exact only' },
  { term: 'oli',             mode: 'exact',    reason: 'ADA mascot; also a given name — exact only' },
  { term: 'maki',            mode: 'exact',    reason: 'ADA mascot; also a given name — exact only' },
  { term: 'admin',           mode: 'contains', reason: 'role impersonation' },
  { term: 'moderator',       mode: 'contains', reason: 'role impersonation' },
  { term: 'official',        mode: 'contains', reason: 'role impersonation' },
  { term: 'resmi',           mode: 'contains', reason: 'role impersonation (TR)' },
  { term: 'destek',          mode: 'contains', reason: 'support impersonation (TR)' },
  { term: 'support',         mode: 'contains', reason: 'support impersonation' },
  { term: 'novest',          mode: 'contains', reason: 'partner brand' },
  { term: 'coldwell banker', mode: 'contains', reason: 'partner brand' },
  { term: 'coldwell',        mode: 'contains', reason: 'partner brand' },
  { term: '101evler',        mode: 'contains', reason: 'partner brand' },
  { term: 'gişe kıbrıs',     mode: 'contains', reason: 'partner brand (TR spelling)' },
  { term: 'gise kibris',     mode: 'contains', reason: 'partner brand (ASCII spelling — no accent folding)' },
]

// ─── The display-name key ────────────────────────────────────────────────────
//
// Mirror of normalize_display_name() in 20261001: the moderation normalizer (İ,
// zero-width, tatweel, NFC, NO accent folding) plus a whitespace fold, so
// "Berke  Ustun" and "Berke Ustun" are one name.
//
// THE SPACE CLASSES BELOW ARE ENUMERATED, NOT `\s`, AND THAT IS DELIBERATE. JavaScript's
// \s covers Unicode space separators; PostgreSQL's [[:space:]] does not, or does so
// depending on the database ctype. Using \s on one side and [[:space:]] on the other
// would make the client and the server disagree about a name containing a NO-BREAK
// SPACE — and NBSP is indistinguishable from a space on screen, so that disagreement is
// also an impersonation vector. Both halves fold the same enumerated list first, then
// collapse the same ASCII run.
//
// Written as escapes, never as the characters themselves — every one of them looks
// exactly like a space in a diff, and the SQL half is APPLIED BY PASTING IT INTO THE
// SUPABASE SQL EDITOR, where a literal U+2009 may not survive the clipboard. Same
// reasoning, and the same order, as NON_SEMANTIC in utils/moderationNormalize.js.
const UNICODE_SPACE = new RegExp(
  '[' +
  '\\u00A0' +          // NO-BREAK SPACE — visually identical to a space
  '\\u2000-\\u200A' +  // EN QUAD … HAIR SPACE
  '\\u202F' +          // NARROW NO-BREAK SPACE
  '\\u205F' +          // MEDIUM MATHEMATICAL SPACE
  '\\u3000' +          // IDEOGRAPHIC SPACE
  ']', 'g')

// Postgres btrim(x) with no second argument strips SPACES ONLY, so the trim below is
// written the same way rather than as .trim(), which strips Unicode whitespace too.
// After the two folds above nothing else can reach the edges, but the two halves are
// kept literally equivalent rather than equivalent-by-argument.
const ASCII_SPACE_RUN = /[ \t\n\r\v\f]+/g
const EDGE_SPACES = /^ +| +$/g

// Returns null for a name that normalizes away to nothing (all punctuation, or nothing
// but invisible characters). Callers must treat null as invalid, never as "no clash".
export function normalizeDisplayName(name) {
  if (typeof name !== 'string') return null
  const out = normalizeForModeration(name)
    .replace(UNICODE_SPACE, ' ')
    .replace(ASCII_SPACE_RUN, ' ')
    .replace(EDGE_SPACES, '')
  return out === '' ? null : out
}

// Mirror of is_reserved_display_name(). Takes the RAW name and normalizes it, so a
// caller cannot accidentally pass an unnormalized string and get a false negative.
export function isReservedDisplayName(name) {
  const norm = normalizeDisplayName(name)
  if (norm === null) return false
  return RESERVED_NAMES.some(({ term, mode }) => {
    const t = normalizeDisplayName(term)
    if (t === null) return false
    return mode === 'exact' ? norm === t : norm.includes(t)
  })
}
