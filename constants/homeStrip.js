// Bugün ADA'da — the live strip's vocabulary, geometry and offline floor.
//
// Extension-explicit imports elsewhere in this repo exist so plain Node can read the real
// module; this one is imported by scripts/validate-i18n-coverage.mjs for exactly that
// reason (see STRIP_TIPS below), so it must stay free of React Native imports.
//
// ─── WHAT THE STRIP IS ──────────────────────────────────────────────────────
//
// ONE card, directly under the Oli row, answering "what is happening in ADA today". It
// resolves through a ladder (utils/homeStripResolver.js) and shows the first thing that
// matches. It is never empty and never a spinner-shaped hole.

// ─── THE KINDS ARE A CLOSED SET, AND TWO ABSENCES ARE THE POINT ─────────────
//
// event | place | promo | tip. A renderer that switches on `kind` must handle all four
// and nothing else, which is what STRIP_KINDS is for.
//
// ⚠ DUTY PHARMACY IS NOT A KIND, AND CANNOT BECOME ONE BY ACCIDENT. Nöbetçi eczaneler has
//   its own permanent row directly below this card, and it is the single thing somebody
//   opens this app for at 2am. Putting it in a rotation means that on any day an event or
//   a promo outranks it, the most important row on the screen is the one that did not
//   render. A permanent row cannot lose a ladder it is not in. There is no 'duty' member
//   here, no duty branch in the resolver, and the strip queries no duty table.
//
// ⚠ `tip` IS DELIBERATELY ABSENT FROM THE DATABASE. home_strip_pin's CHECK allows only
//   event | place | promo, so this union is a strict SUPERSET of what the table can hold.
//   That is the structural half of "never renders empty": the fallback is a local
//   constant that cannot be un-seeded, cannot 404 and cannot be emptied by an admin.
export const STRIP_KINDS = ['event', 'place', 'promo', 'tip']

// ─── CARD HEIGHT — ONE NUMBER, TWO CONSUMERS ────────────────────────────────
//
// The card and its loading skeleton both read this. A fixed-height skeleton is only
// actually fixed if the thing it stands in for is the same height, and two literals drift
// the first time either is tuned — the symptom being a page that jumps under the user's
// thumb exactly when the resolver returns, which is the one moment they are looking at it.
export const STRIP_CARD_H = 150

// How much of the card's bottom the solid text band occupies. A BAND, not a gradient
// scrim: this card shows an arbitrary photograph from an arbitrary event submission, and
// the hero's own notes record what that costs — there is no flat scrim alpha that makes
// white text legible over a blown-out sky without blacking the photo out. A solid band
// carries its own contrast on any image whatsoever, which is the same resolution the hero
// reached for its wordmark chip and action buttons.
export const STRIP_BAND_H = 62

// ─── THE OFFLINE FLOOR ──────────────────────────────────────────────────────
//
// Rank 6, and the reason the strip has no empty state. Every field is either a local
// string key or an icon name, so this branch needs no network, no table, no session and
// no permission. A user in a dead spot, a user whose token expired, a user on the day
// every query fails — all of them get a card.
//
// ⚠ THESE ARE NOT PLACEHOLDERS AND MUST NOT READ AS FAKE CONTENT. Each one points at a
//   real destination that exists today. A tip that advertises something unbuilt is the
//   Coming Soon failure in a nicer wrapper: the user learns ADA cannot help with the
//   thing it just offered.
//
// ⚠ THE KEYS ARE REACHED THROUGH A VARIABLE — t(tip.titleKey, lang) — which is this
//   repo's named i18n blind spot: a scan that matches only the literal call form — the
//   translate function with a quoted key inline — covers none of them.
//   scripts/validate-i18n-coverage.mjs imports THIS ARRAY and derives the keys from it, so
//   a tip added here is guarded the moment it is added. Do not inline a tip's strings at
//   the call site; that is how they leave the guard's scope.
//
//   ⚠ AND DO NOT WRITE THAT CALL SHAPE OUT IN A COMMENT ANYWHERE. The scan is a regex over
//     the file, not a parse, so a call written inside a comment registers as a REAL key and
//     the guard fails with "not present in English at all" — for a key that does not exist
//     and never did. This paragraph is the second time that has happened in this repo; the
//     first is recorded in the validator's own header.
export const STRIP_TIPS = [
  { id: 'tipOli',      icon: 'chatbubbles-outline', titleKey: 'stripTipOliTitle',      subtitleKey: 'stripTipOliSub',      action: 'oli' },
  { id: 'tipDuty',     icon: 'medkit-outline',      titleKey: 'stripTipDutyTitle',     subtitleKey: 'stripTipDutySub',     action: 'duty' },
  { id: 'tipExplore',  icon: 'compass-outline',     titleKey: 'stripTipExploreTitle',  subtitleKey: 'stripTipExploreSub',  action: 'explore' },
  { id: 'tipEmergency',icon: 'call-outline',        titleKey: 'stripTipEmergencyTitle',subtitleKey: 'stripTipEmergencySub',action: 'emergency' },
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
