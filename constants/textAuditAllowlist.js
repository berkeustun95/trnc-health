// ─── The suppression list for the dev-only UI audits ────────────────────────
//
// utils/devTextAudit.js reports two things at runtime, in __DEV__ only:
//   (1) a string that ELLIPSIZED — it did not fit its numberOfLines
//   (2) a low-contrast string sitting directly on PageBackground's photo
//
// Both will sometimes be right about the pixels and wrong about the intent. A long
// address that is MEANT to clip at one line is not a bug; a caption deliberately set on
// the photo is not a bug. Without somewhere to record that, the console fills with noise
// and the audit gets muted — and a muted check is worse than no check, because it still
// looks like coverage.
//
// ► WHY THIS IS A FILE AND NOT A PROP.
//   The obvious alternative is `<Text allowTruncation>` at the call site. That hides the
//   decision inside a component where nobody will ever see it again, and it cannot be
//   reviewed as a set — you would have to grep 72 files to learn what the audit is no
//   longer watching. A list in one file shows up whole in a diff, can be read top to
//   bottom by somebody who was not there when it was written, and every line can be
//   questioned. Suppressions should be embarrassing to add, not invisible.
//
// ► KEYED BY i18n KEY, NOT BY THE STRING.
//   The audit sees rendered text, which is different in all nine languages. Keying on the
//   string would need nine entries per suppression and would silently stop matching the
//   day a translation is edited. So devTextAudit reverse-looks-up the rendered string in
//   constants/i18n.js (devKeysForString) and matches THAT key here. One entry covers all
//   nine languages, and the key is readable: `jobPostedToday` says what it is.
//
// ► WHAT THIS MEANS YOU CANNOT SUPPRESS, BY DESIGN.
//   A string that is not an i18n value — a display name, an address, a price — has no key
//   to put here. Those are not reported at all (see the `SCOPE` note in devTextAudit):
//   truncating user data is almost always deliberate, and reporting it would drown the
//   signal. The audit only watches UI CHROME, which is where all four of the 2026-09-17
//   bugs lived.
//
// ► ONE CLASS OF REPORT MUST NEVER BE SUPPRESSED HERE, AND IT IS THE COMMON ONE.
//   If the report says `needs` equals `box` — the string fits its own box EXACTLY and was
//   ellipsized regardless — that is not a label too long for its space. It is React
//   Native's ellipsize comparison cutting on equality, and the fix is to spread
//   `...ellipsizeSlack` (constants/theme.js) into that style. Eight labels across four
//   components had it on 2026-09-20; the audit will keep finding more, because the bug is
//   in the comparison rather than in any one screen.
//   An allowlist entry here would hide a real, fixable defect behind a sentence saying the
//   clipping was intended. It was not. The audit prints this instruction itself on that
//   branch, so nobody should arrive at this file for one of them.
//
// Every entry needs a `reason`. An entry without one is a mute, not a decision.

export const ALLOW_TRUNCATION = [
  // { key: 'someI18nKey', reason: 'why clipping is correct here', added: '2026-09-17' },
]

// The list starts EMPTY on purpose. Nothing has been suppressed yet because the audit has
// not been run yet — the first run is what populates these, one considered line at a time.
// Starting with pre-emptive entries would be guessing at which complaints are wrong before
// hearing any of them.

const keysOf = list => new Set(list.map(e => e.key))

export const TRUNCATION_ALLOWED = keysOf(ALLOW_TRUNCATION)
