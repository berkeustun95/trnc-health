import { Platform, TurboModuleRegistry } from 'react-native'
import { supabase } from '../lib/supabase'
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../constants/auth'
import { savePendingConsent, clearPendingConsent } from './pendingConsent'

// Native Google + Apple sign-in, ending in a Supabase session via signInWithIdToken.
//
// ─── EVERY NATIVE MODULE HERE IS require()d INSIDE A FUNCTION ───────────────
// @react-native-google-signin calls TurboModuleRegistry.getEnforcing('RNGoogleSignin') the
// moment its JS is evaluated, and Expo Go has no such module: a top-level import would kill
// the whole app at launch there, not just this screen. check-native-import-safety.mjs holds
// all three modules to this form.
//
// The sign-in functions return null on success AND on cancel — a cancel is the user changing
// their mind and gets no message — and otherwise an i18n KEY, never raw error text.

function googleSignin() {
  const m = require('@react-native-google-signin/google-signin')
  // Cheap and idempotent. Called per use rather than once at startup so nothing native runs
  // until somebody taps.
  m.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID })
  return m
}

// Non-enforcing lookup: null in Expo Go, where the Google button is simply not offered.
export function googleAvailable() {
  return TurboModuleRegistry.get('RNGoogleSignin') != null
}

export async function appleAvailableAsync() {
  if (Platform.OS !== 'ios') return false
  try {
    return await require('expo-apple-authentication').isAvailableAsync()
  } catch {
    return false
  }
}

// ─── THE SIGNUP TICK, CARRIED ACROSS A SOCIAL SIGN-IN ───────────────────────
// `consent` is non-null only when the signup tab's terms box was ticked at the moment of the
// tap. It is saved BEFORE the session exists, because App.js flushes pending consent as part
// of the profile load that SIGNED_IN starts — saving after signInWithIdToken resolves would
// race it. Keyed on the provider's email, which is the email Supabase gives the account.
// Cleared again on failure: a tick against a sign-in that did not happen is not an acceptance
// of anything (same rule as the email path in AuthScreen).
// With no tick, a NEW social account is asked in the wizard instead.

export async function signInWithGoogle({ consent } = {}) {
  let m
  let saved = false
  try {
    m = googleSignin()
    if (Platform.OS === 'android') {
      await m.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    }
    const res = await m.GoogleSignin.signIn()
    if (!m.isSuccessResponse(res)) return null
    const { idToken, user } = res.data
    if (!idToken) return 'socialSignInFailed'
    if (consent && user?.email) {
      await savePendingConsent({ email: user.email, ...consent })
      saved = true
    }
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
    if (!error) return null
  } catch (e) {
    const codes = m?.statusCodes ?? {}
    if (e?.code && (e.code === codes.SIGN_IN_CANCELLED || e.code === codes.IN_PROGRESS)) return null
    if (saved) await clearPendingConsent()
    return e?.code && e.code === codes.PLAY_SERVICES_NOT_AVAILABLE
      ? 'socialPlayServicesMissing'
      : 'socialSignInFailed'
  }
  if (saved) await clearPendingConsent()
  return 'socialSignInFailed'
}

export async function signInWithApple({ consent } = {}) {
  let saved = false
  try {
    const Apple = require('expo-apple-authentication')
    const Crypto = require('expo-crypto')
    // Apple receives the SHA-256 of the nonce, Supabase the raw value, and Supabase checks
    // that one hashes to the other — which is what stops a captured token being replayed.
    const rawNonce = Crypto.randomUUID()
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce)
    const cred = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    })
    if (!cred.identityToken) return 'socialSignInFailed'
    if (consent) {
      // credential.email arrives on the first authorisation only; the token carries it always,
      // including a private-relay address, which is what Supabase stores.
      const email = cred.email ?? tokenEmail(cred.identityToken)
      if (email) {
        await savePendingConsent({ email, ...consent })
        saved = true
      }
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple', token: cred.identityToken, nonce: rawNonce,
    })
    if (!error) {
      await saveAppleName(data?.user, cred.fullName)
      storeAppleToken(cred.authorizationCode)
      return null
    }
  } catch (e) {
    if (e?.code === 'ERR_REQUEST_CANCELED') return null
  }
  if (saved) await clearPendingConsent()
  return 'socialSignInFailed'
}

// ─── APPLE SENDS THE NAME ONCE ──────────────────────────────────────────────
// Only on the first authorisation for this Apple ID and this app. Deleting the ADA account
// does not reset that — only revoking the app's Apple authorisation does, which is what
// slice 5's token revocation is for. So it is written now or it is lost, and App Store 4.0
// forbids asking an Apple user for it afterwards.
//
// Profile FIRST, then user_metadata: updateUser fires USER_UPDATED, App.js's session effect
// reloads the profile, and that reload then carries the name. `is('first_name', null)` means
// an account that already has a name (an email account the Apple ID linked to) is left alone.
// A BLOCKED_TERM from check_profile_name_content — a moderation false positive on a real
// name — is swallowed: the wizard shows the name fields when they are empty, so the user can
// still finish. Nothing here may stop a sign-in that has already succeeded.
async function saveAppleName(user, fullName) {
  const given = fullName?.givenName?.trim() || null
  const family = fullName?.familyName?.trim() || null
  if (!user?.id || (!given && !family)) return
  const patch = {}
  if (given) patch.first_name = given
  if (family) patch.last_name = family
  try {
    await supabase.from('profiles').update(patch).eq('id', user.id).is('first_name', null)
    await supabase.auth.updateUser({
      data: { given_name: given, family_name: family, full_name: [given, family].filter(Boolean).join(' ') },
    })
  } catch {}
}

// ─── APPLE TOKEN REVOCATION (slice 5, App Store 5.1.1(v)) ───────────────────
// The authorization code is single-use and dies in five minutes, so it goes to the
// apple-token Edge Function straight after sign-in, which swaps it for a refresh token and
// keeps it server-side (20261044). Fire-and-forget: a failure never touches a sign-in that
// has already succeeded — Profile deletion then falls back to asking Apple once more.
function storeAppleToken(code) {
  if (!code) return
  supabase.functions.invoke('apple-token', { body: { action: 'store', code } }).catch(() => {})
}

// ⚠ BEFORE the delete RPC, like revokeGoogle(): apple_refresh_tokens cascades with the auth
//   user, so once the account is gone there is nothing left to revoke with.
// Resolves { revoked, reason }; reason 'no_token' means nothing was stored for this account.
export async function revokeApple() {
  try {
    const { data, error } = await supabase.functions.invoke('apple-token', { body: { action: 'revoke' } })
    return error ? { revoked: false, reason: 'invoke_failed' } : data
  } catch {
    return { revoked: false, reason: 'invoke_failed' }
  }
}

// The fallback for a user-initiated deletion when no token was ever stored: one more Apple
// sheet for a fresh code, revoked on the spot. Never used in the under-13 branch — a child
// should not meet an unexplained Apple prompt. A cancel just means no revocation.
export async function revokeAppleWithPrompt() {
  try {
    const Apple = require('expo-apple-authentication')
    const cred = await Apple.signInAsync({ requestedScopes: [] })
    if (!cred.authorizationCode) return false
    const { data, error } = await supabase.functions.invoke('apple-token', {
      body: { action: 'revoke_code', code: cred.authorizationCode },
    })
    return !error && data?.revoked === true
  } catch {
    return false
  }
}

export const hasAppleIdentity = session =>
  session?.user?.app_metadata?.providers?.includes('apple') === true

function tokenEmail(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))).email ?? null
  } catch {
    return null
  }
}

// On every SIGNED_OUT, so the next Google tap shows the account chooser instead of silently
// reusing the last account — a shared phone would otherwise sign the next person in as the
// previous one.
export async function signOutGoogle() {
  if (!googleAvailable()) return
  try {
    await googleSignin().GoogleSignin.signOut()
  } catch {}
}

// ⚠ CALL THIS BEFORE ANYTHING SIGNS OUT OF SUPABASE. SIGNED_OUT runs signOutGoogle(), which
//   clears the device's Google user, and revokeAccess() then has nothing to revoke and
//   resolves as a silent no-op. Best effort: a failure never blocks a deletion, and the user
//   can still remove ADA under their Google account's third-party access.
export async function revokeGoogle() {
  if (!googleAvailable()) return false
  try {
    const { GoogleSignin } = googleSignin()
    // iOS forgets the current user across launches until it is restored.
    if (!GoogleSignin.getCurrentUser()) {
      if (!GoogleSignin.hasPreviousSignIn()) return false
      await GoogleSignin.signInSilently()
    }
    await GoogleSignin.revokeAccess()
    return true
  } catch {
    return false
  }
}

// The provider the account was CREATED with. app_metadata.provider is the first identity, so
// an email account that later linked Google stays 'email' — which is what keeps the social
// branches (wizard consent, hidden names, under-13 deletion) off every pre-existing account.
export const socialProvider = session => {
  const p = session?.user?.app_metadata?.provider
  return p === 'google' || p === 'apple' ? p : null
}

export const hasGoogleIdentity = session =>
  session?.user?.app_metadata?.providers?.includes('google') === true
