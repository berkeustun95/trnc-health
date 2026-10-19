// Run-level health for the fetcher: why a source failed (a short class, safe for the public log)
// and whether this run's failures are systemic (the job goes red, GitHub emails).

// A connection-level failure surfaces as `fetch failed` with the real reason in e.cause.code;
// that bare message is all last_error carried for the 13 gov.ct.tr sources dead since 2026-10-13.
export function errorClass(e) {
  const code = e?.cause?.code || e?.code
  if (e?.name === 'AbortError' || e?.cause?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'timeout'
  if (typeof code === 'string' && /^[A-Z0-9_]{2,60}$/.test(code)) return code
  const m = /^(HTTP \d{3}|not a feed|parsed 0 items|structure changed|too large|known-url read|no parser|insert)/.exec(e?.message || '')
  return m ? m[1] : 'other'
}

// TLS verification failures. A certificate does not fix itself between two requests, so these are
// never retried; daily-health groups them as a certificate change (check-duyurular-health.mjs).
export const CERT_CLASS = /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(_LOCALLY)?|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_[A-Z_]+|ERR_TLS_CERT_ALTNAME_INVALID)$/
export const isCertError = e => CERT_CLASS.test(errorClass(e))
// The subset an AIA download can fix: the issuer is missing, nothing is wrong with what was sent.
// Expired, self-signed and name-mismatch errors stay immediate failures.
export const MISSING_ISSUER = /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(_LOCALLY)?)$/
export const isMissingIssuer = e => MISSING_ISSUER.test(errorClass(e))

// One retry, after a pause, for a source that TIMED OUT before it registered any item. Run
// 39203331829 (2026-10-19 05:13) had 27 of 61 sources time out inside 85 s while the runs either
// side were clean: a network blip, which the pause outlasts. Certificate and HTTP errors are
// deterministic and fail at once. `kept > 0` means the listing was read and items were claimed
// in the run-wide dedupe maps; a second attempt would count its own items as duplicates.
export const TIMEOUT_RETRY_PAUSE_S = 60
export const shouldRetry = r => r.status === 'failed' && r.error_class === 'timeout' && !r.kept
export async function withTimeoutRetry(attempt, pause) {
  const first = await attempt()
  if (!shouldRetry(first)) return first
  await pause()
  const second = await attempt()
  second.retried = true
  return second
}

// Red when more than max(3, 25%) of the sources that were still alive before this run failed,
// or when nothing at all came back. Sources already failing `failingAfter`+ runs in a row are left
// out of the count: they are daily-health's to report. Counting them is what turned run
// 39004347106 (2026-10-17) red: 13 long-dead sources used up most of the 15-source budget, so
// 5 one-off failures on healthy sites crossed it.
export function systemicFailure(results, prevFailures, failingAfter) {
  const counted = results.filter(r => (prevFailures(r.key) || 0) < failingAfter)
  const failed = counted.filter(r => r.status === 'failed').length
  const limit = Math.max(3, counted.length * 0.25)
  const answered = results.some(r => r.status !== 'failed' && r.status !== 'not_due')
  const anyFailed = results.some(r => r.status === 'failed')
  return { failed, counted: counted.length, limit, red: failed > limit || (anyFailed && !answered) }
}
