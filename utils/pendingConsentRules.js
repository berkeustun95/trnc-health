// The signup-tick decision, as pure logic. No React Native, no storage, no clock: this
// file imports NOTHING, so plain Node can exercise every branch without a device and
// without waiting seven days for an entry to expire.
//
// The imperative shell — AsyncStorage and the write — is utils/pendingConsent.js and
// App.js's flushPendingConsent, both of which import this. Same split as
// cityWelcomeRules.js / cityWelcome.js, for the same reason.
//
// ─── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
//
// Email confirmation is ON. supabase.auth.signUp returns { user, session: null } and the
// user is shown "confirm your email", so at the moment the checkbox is ticked there is no
// authenticated session and profiles cannot be written. The tick and the record are
// therefore separated in time, and the only honest options were to record it late and say
// so, or to open an unauthenticated write path into profiles. We record it late.
//
// ⚠ THE ALTERNATIVE THAT WAS REJECTED, so nobody re-proposes it: a SECURITY DEFINER RPC
//   callable by anon, keyed on a caller-supplied email, would stamp at the true moment —
//   and would let anyone write a consent record for any address they can guess. It would
//   also reopen the raw_user_meta_data path that 20260827 deliberately closed and
//   verify_schema.sql asserts is absent. An imprecise timestamp is a much smaller problem
//   than an unauthenticated write into profiles.
//
// ─── THREE INDEPENDENT GUARDS, EACH BOUNDING A DIFFERENT THING ──────────────
//
//   EXPIRY   bounds the GAP     — a tick older than MAX_PENDING_AGE_MS is not consumed
//   EMAIL    bounds the IDENTITY— a tick is written only to the account it was given for
//   VERSION  bounds the DOCUMENT— a stale version is written verbatim, never as current
//
// They are separate on purpose: any one of them alone leaves a hole the other two cover.

// ─── EXPIRY ─────────────────────────────────────────────────────────────────
//
// Seven days, enforced AT READ TIME — there is no timer and nothing runs in the
// background; an entry simply stops being consumable and is cleared the next time it is
// looked at.
//
// The tick belongs to one signup attempt, and it should live exactly as long as that
// attempt can still complete. Supabase's confirmation link expires after a period set in
// the DASHBOARD (24h by default), which this repo cannot read — so the window is chosen
// to comfortably exceed any plausible setting rather than to match a number we cannot
// verify. If the link expiry is in fact the 24h default, everything past day one is dead
// weight, and that is the intended direction to be wrong in.
//
// What happens after expiry is not a lost consent: a user who wants the account signs up
// again with the same address, which puts the checkbox back in front of them and writes a
// fresh entry. The thing being prevented is the opposite — a months-old tick firing
// against a document that has since changed.
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000

// The device clock is trusted HERE and nowhere else. Expiry is a local heuristic and a
// wrong clock only makes an entry die early or linger a little; the acceptance TIMESTAMP
// is a legal fact and is stamped by the server (branch (g) of check_profile_name_content).
// Keeping those two uses of "now" visibly apart is the whole design.
const norm = e => (e || '').trim().toLowerCase()

/**
 * The whole decision, as a pure function of its inputs — no storage, no clock, no
 * network — so every branch can be reasoned about and driven from a test.
 *
 * `recordedVersion` is what the loaded profile row already carries, which is how a
 * re-fired session effect (a token refresh re-runs it) stops re-writing the same row.
 *
 * Returns { write, clear, reason } and, when writing, the version and locale to send.
 */
export function decidePendingConsent({ pending, email, currentVersion, recordedVersion, now }) {
  if (!pending || !pending.version || !pending.email) return { write: false, clear: false, reason: 'none' }

  // ⚠ EXPIRY IS CHECKED BEFORE IDENTITY, AND THE ORDER IS LOAD-BEARING. An expired entry
  //   is unconsumable by ANYONE, so clearing it on whatever session happens to observe it
  //   is pure cleanup and cannot cost its owner anything. Checked the other way round, a
  //   shared device where user A ticked and only user B ever signs in returns
  //   'other-account' forever, the expiry arm is unreachable, and A's entry lives in
  //   AsyncStorage permanently — which is the exact outcome the expiry exists to prevent.
  //   A negative age is a clock set forward; treated as expired rather than trusted.
  const age = now - (pending.tickedAt ?? 0)
  if (!(age >= 0) || age > MAX_PENDING_AGE_MS) return { write: false, clear: true, reason: 'expired' }

  // A tick given for one address must never land on another — user A ticks and never
  // confirms, user B signs in on the same phone, and without this the record would say B
  // accepted something B never saw.
  //
  // NOT CLEARED on a mismatch, because it is not this session's entry to throw away and A
  // may still confirm on this device. Expiry above is what eventually removes it, and it
  // can only do that because it runs first.
  if (norm(pending.email) !== norm(email)) return { write: false, clear: false, reason: 'other-account' }

  // Already on file at this exact version: nothing to do, and the entry has served its
  // purpose. Compared against the STORED version rather than the current one, so a row
  // holding an older accepted version is not mistaken for an unconsented one.
  if (recordedVersion === pending.version) return { write: false, clear: true, reason: 'already-recorded' }

  // ⚠ A STALE VERSION IS WRITTEN VERBATIM, NEVER AS CURRENT. If LEGAL_VERSION moved
  //   between the tick and the flush, the user accepted the OLD document and that is what
  //   goes on file. Writing the current version would be a false record; writing nothing
  //   would make a real acceptance indistinguishable from an account that never gave one.
  //   Verbatim is the only option that is both true and useful — a re-acceptance round is
  //   exactly the query `terms_version IS DISTINCT FROM <current>`, and this row belongs
  //   in its results.
  const stale = pending.version !== currentVersion
  return {
    write: true, clear: false, reason: stale ? 'stale-version' : 'current',
    version: pending.version, locale: pending.locale || 'English',
  }
}

