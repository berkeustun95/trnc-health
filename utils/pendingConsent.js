// The signup tick, held on the device until there is a session to write it with.
//
// This is the imperative half — AsyncStorage and nothing else. The DECISION (identity,
// expiry, document version) is pure and lives in pendingConsentRules.js, which imports
// nothing and is therefore drivable from plain Node.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = '@ada_pending_consent'

const norm = e => (e || '').trim().toLowerCase()

/**
 * Called on a successful signUp, NOT on the tick itself — a box ticked on a form that
 * then fails validation is not an acceptance of anything.
 */
export async function savePendingConsent({ email, version, locale }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({
      email: norm(email), version, locale,
      // Local only. Drives the expiry rule in pendingConsentRules.js and nothing else;
      // never written to terms_accepted_at, which the server stamps. Kept in the
      // payload because it is the only record of WHEN the tick happened, so if the gap
      // between tick and record ever needs showing, the data is already being captured at
      // the right moment and it is a one-column migration rather than a lost year.
      tickedAt: Date.now(),
    }))
  } catch { /* device-local; a failure here costs the record, not the signup */ }
}

export async function readPendingConsent() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export async function clearPendingConsent() {
  try { await AsyncStorage.removeItem(KEY) } catch {}
}
