import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// ─── supabase.auth.signOut() CAN FAIL AND LEAVE YOU SIGNED IN ───────────────
//
// Read out of @supabase/auth-js GoTrueClient._signOut, not inferred: it POSTs to
// /logout, and on an error that is NOT one of 404 / 401 / 403 / session-missing it
// RETURNS EARLY — before _removeSession(). A network failure is none of those, so
// offline the local session survives, no SIGNED_OUT event fires, and the UI does
// nothing at all.
//
// ⚠ `scope: 'local'` DOES NOT AVOID THIS. It changes the query string, not whether the
//   request is made, so it fails identically offline. There is no public API that drops
//   the local session without the round trip, and reaching into the storage key by hand
//   would desync the client's in-memory session from disk — a worse failure than the one
//   being fixed. So the answer is to REPORT the failure, not to route around it.
//
// That makes error handling mandatory at any call site where sign-out is the user's only
// way forward: AgeIneligibleScreen (the sole recovery path for an account wrongly flagged
// under-13) and the wizard's exit. A button that silently does nothing on the screen
// somebody is trapped on is the bug, not a detail of it.
//
// ProfileScreen's sign-out is deliberately left as fire-and-forget: a user there has the
// whole app and is not stuck, so a failed tap costs a retry rather than an exit.

// Single source of truth for guest state. Mirrors the is_anonymous JWT claim that
// RLS reads server-side — never track guest status with a separate local flag.
export const isGuest = session => session?.user?.is_anonymous === true