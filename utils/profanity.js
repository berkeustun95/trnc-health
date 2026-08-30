import { supabase } from '../lib/supabase'
import { matchesAnyTerm } from './moderationNormalize'

// Client-side mirror of the DB's contains_blocked_term(). This exists ONLY to
// give instant inline feedback before a round-trip — the BEFORE INSERT trigger
// on reviews/questions/answers is the actual boundary and cannot be bypassed.
// The word list is fetched from blocked_terms so there is one source of truth
// and terms can be added without shipping a build.
//
// The matching itself lives in utils/moderationNormalize.js, which is the mirror of
// normalize_for_moderation() in 20260925_moderation_normalization.sql. Keep the two in
// step: a client that normalizes differently from the server says "looks fine" inline
// and is then rejected on submit, which reads as arbitrary to the user.
// `npm run moderation:check` runs every case through both and fails on disagreement.

let cache = null
let cachedAt = 0
let inflight = null

// The list is admin-editable at runtime, so the cache MUST expire. Without this a term
// removed because it was a false positive keeps being flagged inline until the user
// force-quits the app — the server accepts the text, the preview still says it will not,
// and the fix looks like it did not work. Five minutes: short enough that an admin
// removing a term sees it converge while the complaining user is still on the phone,
// long enough that it is not a fetch per keystroke.
const CACHE_TTL_MS = 5 * 60 * 1000

export function invalidateBlockedTerms() {
  cache = null
  cachedAt = 0
}

export async function loadBlockedTerms() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  if (cache) cache = null   // expired
  if (!inflight) {
    // count: 'exact' is not decoration. PostgREST caps a response at max-rows (1000)
    // and says so ONLY in the Content-Range header — the body is a short, valid,
    // perfectly innocent-looking array. Comparing what arrived against the true total
    // is the one check that works at any cap; testing `length >= 1000` would be a
    // truncation guard defeated by truncation.
    inflight = supabase.from('blocked_terms').select('term', { count: 'exact' })
      .then(({ data, error, count }) => {
        inflight = null
        if (error || !data) return []          // fail open: the DB trigger still catches it
        if (count != null && data.length < count) {
          console.warn(
            `[moderation] blocked_terms TRUNCATED: got ${data.length} of ${count}. ` +
            'The inline preview is filtering against a partial list and will miss terms. ' +
            'Page the fetch or raise PostgREST max-rows.'
          )
        }
        cache = data.map(r => r.term)
        cachedAt = Date.now()
        return cache
      })
  }
  return inflight
}

export async function containsBlockedTerm(text) {
  if (!text?.trim()) return false
  const terms = await loadBlockedTerms()
  if (!terms.length) return false
  return matchesAnyTerm(text, terms)
}

// Records a rejection so an admin can tell a real block from a false positive.
//
// This is a SEPARATE round trip on purpose, and it is the only way the record can exist:
// the trigger that rejects the content does so with RAISE EXCEPTION, which aborts the
// transaction — anything it wrote is rolled back with it. A log written server-side at
// the point of rejection would be empty forever. See 20260926_moderation_rejection_log.sql.
//
// Fire and forget. It must never block, never surface an error, and never turn a
// moderation message into a crash: the user has already been told what happened, and a
// failure to log is our problem, not theirs.
//
// We send only the TEXT. The matched term is computed server-side and overwritten, and
// there is no read policy for the author — the client is not told which word tripped.
export function reportModerationRejection(contentType, text) {
  if (!text?.trim()) return
  supabase.auth.getUser().then(({ data }) => {
    if (!data?.user) return          // signed out: nothing to attribute it to
    return supabase.from('moderation_rejections').insert({
      user_id: data.user.id,
      content_type: contentType,
      content_text: text.slice(0, 2000),
    })
  }).catch(() => {})
}

// Maps the DB trigger's exceptions onto user-facing copy. Call this on any
// review/question/answer insert error — the server is the boundary, so these
// can fire even when the client pre-check passed (e.g. a stale term cache).
//
// Pass `report` — {contentType, text} — to also record a blocked-term rejection. It is
// optional so existing call sites keep working untouched; the surfaces that pass it are
// the free-text ones, where a false positive silently costs us a user.
export function moderationErrorKey(error, report = null) {
  if (!error?.message) return null
  if (error.message.includes('BLOCKED_PAYMENT')) return 'contentPaymentBlocked'
  if (error.message.includes('BLOCKED_TERM')) {
    if (report?.contentType && report?.text) {
      reportModerationRejection(report.contentType, report.text)
    }
    return 'contentBlockedTerm'
  }
  if (error.message.includes('UGC_BANNED'))      return 'contentBannedUser'
  return null
}
