// ─── Messaging (Student Hub slice 6) — the client half of the send contract ──
//
// 20261029 owns the rules. This file owns nothing but the TRANSLATION of what that
// migration answers into copy, and it exists as its own module for one reason: every key
// below is reached through a map rather than a literal `t('key')`, and
// scripts/validate-i18n-coverage.mjs cannot see a key looked up through a variable. That
// blind spot is what let `menuGarages` sit untranslated in seven locales. The validator
// imports SEND_ERROR_KEY by name and spreads its values, the same way it already does for
// STUDENT_LEVEL_LABEL_KEY — so a new outcome added here fails the check until it is
// translated into all nine.

// Mirrors `CHECK (char_length(body) BETWEEN 1 AND 1000)` on messages.body. The server is
// the boundary — this only stops the keystroke that would be rejected.
export const MESSAGE_MAX_LENGTH = 1000

// Below this the composer says nothing; above it, a live counter appears. A counter
// pinned at "1000 remaining" from the first character is noise, and noise trains people
// to ignore the one moment it matters.
export const MESSAGE_COUNTER_FROM = 900

// ─── THE GENERIC REFUSAL ────────────────────────────────────────────────────
//
// ► FOUR DIFFERENT REASONS, ONE STRING, AND THE CLIENT COULD NOT TELL THEM APART EVEN IF
//   IT WANTED TO. start_conversation returns the bare word 'refused' for: they blocked
//   you, you blocked them, they are not listed, they declined you before, and the age
//   rule refused an adult reaching an under-18. No detail crosses the wire.
//
//   That is deliberate and it is the sharpest privacy rule in the slice: if the age
//   refusal had its own code, an adult could type a stranger's id and learn that the
//   person behind it is a child. Distinguishing the reasons would make this screen an age
//   oracle pointed at named children.
//
//   So there is nothing here to "improve" by asking the server for more. There is no
//   more.
export const SEND_ERROR_KEY = {
  REFUSED:              'msgRefused',
  RATE_LIMITED:         'msgRateLimited',
  BODY_LENGTH:          'msgTooLong',
  AWAITING_ACCEPTANCE:  'msgAwaitingAcceptance',
  // ► ALSO ONE STRING FOR SEVERAL THINGS, AND THIS IS THE ONE TO KEEP AN EYE ON.
  //   CONVERSATION_CLOSED is raised when the other person left, when either side blocked
  //   the other, and when they stopped being listed. A block MUST read exactly as a leave
  //   reads — anything that separates them tells somebody they were blocked, which is the
  //   one thing a block must never announce.
  CONVERSATION_CLOSED:  'msgConversationClosed',
  NO_SUCH_CONVERSATION: 'msgConversationGone',
  NOT_LISTED:           'msgNotListed',
  NO_DISPLAY_NAME:      'msgNeedDisplayName',
}

// Longest token first where one contains another, so a prefix never shadows a longer
// match. (`NO_SUCH_CONVERSATION` and `CONVERSATION_CLOSED` both contain "CONVERSATION".)
const ORDER = [
  'NO_SUCH_CONVERSATION',
  'CONVERSATION_CLOSED',
  'AWAITING_ACCEPTANCE',
  'RATE_LIMITED',
  'BODY_LENGTH',
  'NOT_LISTED',
  'NO_DISPLAY_NAME',
]

// A thrown error from either send RPC → an i18n key, or null for "not one of ours".
//
// ► THIS MODULE IMPORTS NOTHING, AND THAT IS LOAD-BEARING.
//   scripts/validate-i18n-coverage.mjs imports SEND_ERROR_KEY under plain Node to check
//   that every outcome is translated into all nine languages. constants/profileGate.js is
//   import-free for the same reason. Reaching for utils/profanity from here pulls in
//   lib/supabase and React Native behind it, and the guard dies on a module-resolution
//   error instead of checking anything.
//
//   So MODERATION IS ASKED FIRST BY THE CALLER, not here — moderationErrorKey() owns
//   BLOCKED_TERM, UGC_BANNED and BLOCKED_PAYMENT, and BLOCKED_TERM carries a side effect
//   that must not be lost: reportModerationRejection() writes the rejection log in a
//   SECOND transaction, because the RAISE that rejected the message took the first one
//   with it (20260926 — a rejection logged from the aborting transaction is a table that
//   stays empty forever and reads as "no false positives").
export function sendErrorKey(error) {
  const message = error?.message
  if (!message) return null
  for (const token of ORDER) {
    if (message.includes(token)) return SEND_ERROR_KEY[token]
  }
  // AUTH_REQUIRED, INVALID_RECIPIENT and SELF are all states the client already made
  // impossible before calling, so they mean something is wrong rather than something is
  // refused. They get the generic failure, never a specific explanation.
  return null
}
