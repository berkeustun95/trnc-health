// Bounded retry for the profile read. The row always exists (handle_new_user creates it in the signup
// transaction), so an error OR an empty result is a transient failure. Resolves { data, error }, never throws.
export const PROFILE_RETRY_DELAYS = [1000, 2000, 4000]

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function loadWithRetry(fetchFn, { sleep = defaultSleep, isCurrent = () => true } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= PROFILE_RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetchFn()
      if (!res?.error && res?.data != null) return { data: res.data, error: null }
      lastError = res?.error ?? new Error('profile row not returned')
    } catch (e) {
      lastError = e
    }
    if (attempt === PROFILE_RETRY_DELAYS.length) break
    await sleep(PROFILE_RETRY_DELAYS[attempt])
    if (!isCurrent()) break
  }
  return { data: null, error: lastError ?? new Error('profile load failed') }
}
