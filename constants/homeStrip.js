// Bugün ADA'da — the live strip's vocabulary, geometry and offline floor.
//
// Extension-explicit imports elsewhere in this repo exist so plain Node can read the real
// module; this one is imported by scripts/validate-i18n-coverage.mjs for exactly that
// reason (see STRIP_TIPS below), so it must stay free of React Native imports.
//
// ─── WHAT THE STRIP IS ──────────────────────────────────────────────────────
//
// ONE card, below the Nöbetçi row, answering "what is happening in ADA today". It
// resolves through a ladder (utils/homeStripResolver.js) and shows the first thing that
// matches. It is never empty and never a spinner-shaped hole.

// ─── THE KINDS ARE A CLOSED SET ─────────────────────────────────────────────
//
// event | promo. A renderer that switches on `kind` must handle both and nothing else.
//
// ⚠ `tip` IS GONE, AND THE REASON IS WORTH KEEPING. The strip used to end in an Oli tip
//   whose only job was to stop the card being empty. One of those tips was
//   { id: 'tipDuty', action: 'duty' } — a duty pharmacy entry, sitting in the strip,
//   typed as `tip`.
//
//   Every structural guard passed. This file forbade a 'duty' KIND in capitals, the
//   migration's CHECK forbade it in the database, and both were satisfied, because what
//   was forbidden was the LABEL and what shipped was the DESTINATION. Same family as the
//   repo's `NOT ILIKE '%appointments%'` note: an assertion about a name is not an
//   assertion about behaviour. The tip pool is deleted rather than filtered — with nothing
//   left to point anywhere, there is nothing left to guard.
//
// ⚠ `place` IS ALSO GONE. The left card is "today's event" and its stated fallback is the
//   events module's generic image, so a place row had nowhere left to rank: it would have
//   occupied the slot the fallback rule names. Its created_at caveat — a SUBMISSION
//   timestamp read as a publication one — retires with it. Say so if it is ever restored;
//   the caveat comes back with the rank.
//
// ⚠ AND DUTY IS NOW A CARD, NOT A LADDER ENTRY. It occupies the RIGHT slot unconditionally
//   and is never resolved, ranked or outranked. That is a stronger guarantee than the old
//   permanent row had, and it is the one thing about this section that must not be
//   refactored into the resolver.
export const STRIP_KINDS = ['event', 'promo']

// ─── CARD HEIGHT — ONE NUMBER, TWO CONSUMERS ────────────────────────────────
//
// The card and its loading skeleton both read this. A fixed-height skeleton is only
// actually fixed if the thing it stands in for is the same height, and two literals drift
// the first time either is tuned — the symptom being a page that jumps under the user's
// thumb exactly when the resolver returns, which is the one moment they are looking at it.
// 150 -> 134 on 2026-09-08, and the number is a FOLD constraint rather than a taste one.
// With the standalone Nöbetçi row folded into the right-hand card, the duty content's
// bottom edge IS this card's bottom edge — so "duty stays above the fold" now depends on
// it directly. At 150 the card ended at 555.4 on a 360x640 gesture-nav device against a
// 555 fold: exactly on the line. 134 clears it by 16pt. It also suits the new shape — a
// half-width card at 134 is close to 4:3 where 150 was nearly square.
export const STRIP_CARD_H = 134

// How much of the card's bottom the solid text band occupies. A BAND, not a gradient
// scrim: this card shows an arbitrary photograph from an arbitrary event submission, and
// the hero's own notes record what that costs — there is no flat scrim alpha that makes
// white text legible over a blown-out sky without blacking the photo out. A solid band
// carries its own contrast on any image whatsoever, which is the same resolution the hero
// reached for its wordmark chip and action buttons.
// 62 -> 60. The band now holds a 2-line 14pt title over a 1-line 11pt subtitle — 48.8pt of
// content — because a half-width card's text box is 77pt at 320dp and no single line
// survives that. See STRIP_CARD_TEXT_BOX below.
export const STRIP_BAND_H = 60

// ─── THE TWO CARDS ARE ALWAYS PRESENT ───────────────────────────────────────
//
// Both fall back to an image compiled into the bundle: no network, no table, no session,
// no permission. That is what replaces the old Oli tip as the proof that this section can
// never be empty — and it is a stronger proof, because it is now TWO unconditional cards
// rather than one card with a fallback ladder under it.
//
// ⚠ THE IMAGES THEMSELVES LIVE IN components/home/LiveStrip.js, NOT HERE, AND THAT IS A
//   HARD CONSTRAINT RATHER THAN A PREFERENCE. This file is imported by
//   scripts/validate-i18n-coverage.mjs running under plain Node, where `require()` of a
//   PNG throws "require is not defined in ES module scope". Metro resolves it happily, so
//   the failure appears in the guard and never in the app — which is the worst place for
//   it. The header of this file says it must stay free of React Native imports; an asset
//   require is exactly that.
//
// ─── THE TEXT BOX, WHICH IS THE REAL CONSTRAINT AT HALF WIDTH ───────────────
// card = (screenW - 32 page inset - 10 gap) / 2; text = card - 24 band padding - 28
// chevron - 10 gap. That is 114pt at 393dp, 97 at 360 and 77 at 320 — tighter than the
// module grid's label box, with type at 14pt instead of 11. Every string in this section
// is measured against it by `npm run labels:check`.
export const STRIP_TITLE_LINES = 2
export const STRIP_SUB_LINES   = 1

// ─── EVERY STRING THE TWO CARDS CAN RENDER ──────────────────────────────────
//
// ⚠ THESE ARE ALL REACHED THROUGH A TERNARY OR A VARIABLE, WHICH MAKES THEM INVISIBLE TO
//   A LITERAL SCAN. LiveStrip picks a duty title with
//   `t(ok ? A : partial ? B : C, lang)`, and the generic card's copy arrives as
//   `item.titleKey`. Neither form matches the translate-call shape the i18n scanner
//   recognises, so without this list all seven would sit outside the guard while the key
//   total went UP — a coverage loss hidden inside a coverage gain, which is this repo's
//   named failure shape.
//
//   scripts/validate-i18n-coverage.mjs imports this array. Add a key here in the same
//   commit that renders it.
export const STRIP_CARD_KEYS = [
  'stripEventsTitle', 'stripEventsSub',
  'stripDutyTitle', 'stripDutySub',
  'stripDutyPartialTitle', 'stripDutyStaleTitle', 'stripDutyAlertSub',
]

// ─── LADDER WINDOWS ─────────────────────────────────────────────────────────
// Rank 2 — "starting soon" is six hours, so an evening event is already surfacing by
// mid-afternoon rather than at the moment it is too late to go.
export const STRIP_SOON_HOURS = 6
// Rank 4 — "recently added". See the caveat on RANK 4 in the resolver: this is measured
// from created_at, which is a SUBMISSION timestamp, not a publication one.
export const STRIP_NEW_PLACE_DAYS = 7

// ─── PROMO ELIGIBILITY — AND THE LINE THE BRIEF DID NOT DRAW ────────────────
//
// The rule as specified: guests and null-DOB users get no promos. Both halves are about
// not knowing who we are talking to — a guest has no profile, and a null date_of_birth is
// a profile that has not answered.
//
// ⚠ SO A KNOWN 15-YEAR-OLD PASSED BOTH HALVES, WHICH CANNOT BE THE INTENT. Gating on a
//   MISSING date of birth only makes sense if the PRESENT one is being read for
//   something, and there is exactly one thing it is read for. ADA has been a declared
//   mixed-audience app since 2026-08-29 (13-15 / 16-17 / 18+), and a user whose DOB
//   indicates under 18 must receive non-personalized advertising — a launch requirement,
//   not a follow-up.
//
//   This constant is that missing branch, written as the strictest reading: no promo at
//   all to a minor, rather than a differently-targeted one. It is deliberately a named
//   constant and not an inline 18 so that relaxing it is one edit in one place with this
//   paragraph attached — see the Slice 2 journal entry, where it is called out as an
//   addition to the brief rather than an implementation of it.
//
// Unrelated to MIN_SIGNUP_AGE in constants/profileGate.js, which answers "may this person
// hold an account" (13). This answers "may this person be shown paid placement" (18).
// They are different questions and must not be folded into one number.
export const PROMO_MIN_AGE = 18

// Whole years elapsed, calendar-correct — a days/365.25 approximation is wrong for
// somebody in the days around their birthday, which is precisely the boundary this
// decides. Returns null when there is nothing to measure, and null is NOT eligible.
export function ageFromDob(dob, now = new Date()) {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

// The whole promo gate, in one place so the resolver has no policy in it.
// Guest → no. No DOB → no. Under PROMO_MIN_AGE → no.
export function promosAllowed({ isGuest, dateOfBirth }, now = new Date()) {
  if (isGuest) return false
  const age = ageFromDob(dateOfBirth, now)
  return age != null && age >= PROMO_MIN_AGE
}

// Device-local record of what the strip showed last, so a promo cannot appear twice
// running. Device-local because it is a presentation nicety, not a fact about the user —
// nothing here is worth a row in the database or a column on profiles.
export const STRIP_LAST_KIND_KEY = '@trnc_strip_last_kind'
