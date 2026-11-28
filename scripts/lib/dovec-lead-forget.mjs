// ─── Döveç forget-one-enquiry: the pure parts (reference check, answer allowlist, verdict text) ──────────────────────────
// Engine: scripts/dovec-lead-forget.mjs, workflow .github/workflows/dovec-lead-forget.yml, SQL function
// public.dovec_lead_forget (20261244). Holds no key and makes no call. The log is public: only the ten agreed booleans can be
// printed, whatever the response carries (no e-mail address is ever in an answer or a line); an unreadable answer is reported as such, never echoed.

export const REF_RE = /^ADA-[0-9]+$/
export const KEYS = Object.freeze(['valid_reference', 'found', 'is_test', 'settled', 'account_linked', 'account_has_email', 'email_matches_account', 'already_wiped', 'wiped', 'applied'])

// The ten booleans, or null when the answer is not exactly an object carrying all ten as booleans. Any other key is dropped.
export function allowlisted(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const out = {}
  for (const k of KEYS) { if (typeof body[k] !== 'boolean') return null; out[k] = body[k] }
  return out
}

// Postgres / PostgREST error code out of an error body, or 'unknown'. Never any other part of the body.
export function errorCode(body) {
  const c = body !== null && typeof body === 'object' ? body.code : undefined
  return typeof c === 'string' && /^[A-Za-z0-9_]{1,12}$/.test(c) ? c : 'unknown'
}

// { ok, lines, exit }: ok = valid + found + settled + not a test row + the e-mail matches the sending account (the workflow's gate for the approval step).
export function verdict(a, apply) {
  const ok = a.valid_reference && a.found && !a.is_test && a.settled && a.account_linked && a.email_matches_account
  const lines = KEYS.map(k => `  ${k}: ${a[k]}`)
  const say = (text, exit) => ({ ok, lines: [...lines, `  result: ${text}`], exit })
  if (!a.valid_reference) return say('REFUSED, the reference is not exactly ADA-<number>', 1)
  if (!a.found) return say('REFUSED, no enquiry has that reference', 1)
  if (a.is_test) return say('REFUSED, that is the test enquiry (never forgotten here)', 1)
  if (!a.settled) return say('REFUSED, the enquiry is still pending or retrying; wait until it is sent / rejected / failed, then run again (nothing changed)', 1)
  if (!a.account_linked) return say('REFUSED, the enquiry has no linked account any more (already wiped or account deleted); nothing to match the e-mail against', 1)
  if (!a.account_has_email) return say('REFUSED, the account that sent this enquiry has no e-mail to match', 1)
  if (!a.email_matches_account) return say('REFUSED, the e-mail does not match the account that sent this enquiry (nothing changed)', 1)
  if (!apply) {
    if (a.wiped || a.applied) return say('ABORT, the dry run reports a write: the function is not the agreed one', 1)
    return a.already_wiped
      ? say('DRY OK, already wiped, nothing to change', 0)
      : say('DRY OK, apply would wipe name, phone, e-mail, message and user id of this enquiry; status and everything else stay', 0)
  }
  if (!a.applied) return say('ABORT, apply was asked for but the function did not apply', 1)
  if (a.already_wiped) return a.wiped ? say('ABORT, an already wiped enquiry reports a write', 1) : say('already wiped, nothing changed', 0)
  return a.wiped ? say('APPLIED, personal fields wiped; status and everything else unchanged', 0) : say('ABORT, apply reported no wipe', 1)
}
