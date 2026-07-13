import { supabase } from '../lib/supabase'

// Client-side mirror of the DB's contains_blocked_term(). This exists ONLY to
// give instant inline feedback before a round-trip — the BEFORE INSERT trigger
// on reviews/questions/answers is the actual boundary and cannot be bypassed.
// The word list is fetched from blocked_terms so there is one source of truth
// and terms can be added without shipping a build.

let cache = null
let inflight = null

export async function loadBlockedTerms() {
  if (cache) return cache
  if (!inflight) {
    inflight = supabase.from('blocked_terms').select('term')
      .then(({ data, error }) => {
        inflight = null
        if (error || !data) return []          // fail open: the DB trigger still catches it
        cache = data.map(r => r.term.toLowerCase())
        return cache
      })
  }
  return inflight
}

// Word-boundary match, so "Scunthorpe" and "assessment" are not false positives.
// Postgres uses \m…\M; here we tokenise on anything that is not a letter or
// digit, which keeps Turkish characters (ç, ğ, ş, ı, ö, ü) inside their word.
function tokenised(text) {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
}

export async function containsBlockedTerm(text) {
  if (!text?.trim()) return false
  const terms = await loadBlockedTerms()
  if (!terms.length) return false
  const haystack = tokenised(text)
  return terms.some(term => haystack.includes(` ${term} `))
}

// Maps the DB trigger's exceptions onto user-facing copy. Call this on any
// review/question/answer insert error — the server is the boundary, so these
// can fire even when the client pre-check passed (e.g. a stale term cache).
export function moderationErrorKey(error) {
  if (!error?.message) return null
  if (error.message.includes('BLOCKED_TERM')) return 'contentBlockedTerm'
  if (error.message.includes('UGC_BANNED'))   return 'contentBannedUser'
  return null
}
