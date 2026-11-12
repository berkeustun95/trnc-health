// Customer / guest / admin sign-out. Signing out must also stop THIS phone receiving the account's
// pushes, and once the session ends RLS no longer lets the client touch its own profiles row, so the
// push_token is cleared BEFORE the session ends. Provider-role screens keep their original bare
// signOut() and are not routed through here (Berke, 2026-11-12). __tests__/signOutScope.test.js pins
// the scope literals below: this file holds the only local and the only global auth.signOut.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase, isGuest } from '../lib/supabase'

const TOKEN_KEY = 'ada_registered_push_token'
const CLEAR_TIMEOUT_MS = 3000

let rememberedToken = null
let signingOut = false

// The token THIS device registered, kept in AsyncStorage too so a launch where registration could
// not run (offline, permission prompt pending) can still clear it. Local sign-out only clears a row
// that still holds this exact token, so another phone's newer token on the same account survives.
export async function rememberPushToken(token) {
  rememberedToken = token
  try { await AsyncStorage.setItem(TOKEN_KEY, token) } catch {}
}

// The registration effect re-runs on session churn and must not re-write the token between the
// clear and the sign-out; a new sign-in re-arms it.
export const isSigningOut = () => signingOut
export const resetSigningOut = () => { signingOut = false }

async function forgetPushToken() {
  rememberedToken = null
  try { await AsyncStorage.removeItem(TOKEN_KEY) } catch {}
}

// Best effort and time-boxed: a failure or a hang never blocks the sign-out. Offline, the token stays
// on the row until the next sign-in on any device overwrites it (auth-js returns early when /logout
// has a network error and keeps the session, so the user is still signed in and can retry).
function boxed(work) {
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, CLEAR_TIMEOUT_MS) })
  return Promise.race([Promise.resolve().then(work).catch(() => {}), timeout]).finally(() => clearTimeout(timer))
}

async function clearPushToken({ onlyThisDevice }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || isGuest(session)) return
  let query = supabase.from('profiles').update({ push_token: null }).eq('id', session.user.id)
  if (onlyThisDevice) {
    const token = rememberedToken ?? await AsyncStorage.getItem(TOKEN_KEY)
    if (!token) return
    query = query.eq('push_token', token)
  }
  await query
}

async function finish(signOutCall) {
  let result
  try { result = await signOutCall } catch (e) { signingOut = false; throw e }
  if (result?.error) signingOut = false
  else await forgetPushToken()
  return result
}

// "Çıkış yap": this device only.
export async function signOutThisDevice() {
  signingOut = true
  await boxed(() => clearPushToken({ onlyThisDevice: true }))
  return finish(supabase.auth.signOut({ scope: 'local' }))
}

// Safety sign-outs: every device. clearToken true where the profiles row survives (under-13 email
// account, flagged not deleted: every device is leaving, so the token goes unconditionally); false
// after delete_own_account, where the row is already gone.
export async function signOutEverywhere({ clearToken }) {
  signingOut = true
  if (clearToken) await boxed(() => clearPushToken({ onlyThisDevice: false }))
  return finish(supabase.auth.signOut({ scope: 'global' }))
}
