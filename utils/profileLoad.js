// Bounded retry for the profile read. The row always exists (handle_new_user creates it in the signup
// transaction), so an error OR an empty result is a transient failure. Each attempt is aborted after
// PROFILE_ATTEMPT_TIMEOUT_MS (a hung request never settles on RN) and counts as failed. Resolves { data, error }, never throws.
import { withTimeout } from './withTimeout'

export const PROFILE_RETRY_DELAYS = [1000, 2000, 4000]

export const PROFILE_ATTEMPT_TIMEOUT_MS = 8000

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// A timeout, an abort or a failed fetch: the device cannot reach the server (offline, dead Wi-Fi, captive portal).
export function isNetworkError(e) {
  if (!e) return false
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true
  return /network request failed|failed to fetch|network ?error|timed out|aborted/i.test(String(e.message || ''))
}

// onAttemptFailed(error, attempt) runs after every failed attempt, so the caller can show an offline
// screen at once while the remaining retries continue behind it.
export async function loadWithRetry(fetchFn, { sleep = defaultSleep, isCurrent = () => true, onAttemptFailed = () => {} } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= PROFILE_RETRY_DELAYS.length; attempt++) {
    try {
      const res = await withTimeout(signal => fetchFn(signal), PROFILE_ATTEMPT_TIMEOUT_MS)
      if (!res?.error && res?.data != null) return { data: res.data, error: null }
      lastError = res?.error ?? new Error('profile row not returned')
    } catch (e) {
      lastError = e
    }
    try { onAttemptFailed(lastError, attempt) } catch {}
    if (attempt === PROFILE_RETRY_DELAYS.length) break
    await sleep(PROFILE_RETRY_DELAYS[attempt])
    if (!isCurrent()) break
  }
  return { data: null, error: lastError ?? new Error('profile load failed') }
}
