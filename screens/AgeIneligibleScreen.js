import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// The terminal screen for an account whose owner declared a date of birth under
// MIN_SIGNUP_AGE. Extracted from ProfileSetupScreen on 2026-09-13, and the extraction IS
// the fix.
//
// ─── WHAT WAS WRONG, AND WHY A COMPONENT MOVE REPAIRS IT ────────────────────
//
// This screen used to be a branch inside the wizard, shown on `ageBlocked` — a useState
// boolean set right after the flag was written. SESSION STATE. So the block survived
// exactly as long as the app stayed open: force-quit, relaunch, and the user came back
// with profiles.age_ineligible = true, which made App.js's gateActive read FALSE (it
// required !age_ineligible), and they fell straight through to the customer tab shell.
// The flag existed precisely to prevent that and prevented nothing — on an app that
// declares 13-15 / 16-17 / 18+ to Google Play.
//
// Now App.js renders this screen FROM THE ROW, on every launch, before it evaluates the
// gate at all. There is no session state left to lose, so force-quitting cannot be an
// escape — not because a second check was added, but because the state that could go
// stale no longer exists.
//
// ⚠ THE FLAG IS ONE-WAY FOR EVERYONE BUT AN ADMIN. Branch (f) of
//   check_profile_name_content raises on any non-admin UPDATE that takes age_ineligible
//   from true to false, so the client cannot clear what the client set. That is what
//   makes rendering from the row trustworthy rather than merely tidier.
//
// ⚠ AND THE SIGN-OUT BUTTON IS THE ONLY RECOVERY PATH THERE IS. Nothing in the app can
//   clear the flag, so somebody wrongly caught — a device clock a day slow on their
//   thirteenth birthday is the realistic case — gets out by signing out and creating an
//   account with a truthful date. That makes this one button load-bearing, which is why
//   it reports a failure instead of silently doing nothing. See lib/supabase.js.
// onDone: the Google/Apple under-13 branch. That account is already DELETED when this shows,
// so there is nothing to sign out of — the button just dismisses to the entry screen. Same
// words either way: "we can't create an account" is exactly what happened.
export default function AgeIneligibleScreen({ lang, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function signOut() {
    if (onDone) { onDone(); return }
    if (busy) return
    setBusy(true)
    setError(false)
    const { error: signOutError } = await supabase.auth.signOut()
    // On success the SIGNED_OUT listener in App.js unmounts this screen, so there is
    // nothing to reset. On failure the session is still here and so are we.
    if (signOutError) { setError(true); setBusy(false) }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.wrap}>
        <View style={s.icon}>
          <Ionicons name="information-circle-outline" size={30} color={colors.textSecondary} />
        </View>
        <Text style={s.title}>{t('pgAgeTitle', lang)}</Text>
        <Text style={s.body}>{t('pgAgeMessage', lang)}</Text>
        {error && <Text style={s.error}>{t('signOutFailed', lang)}</Text>}
        <TouchableOpacity style={[s.btn, busy && s.btnOff]} onPress={signOut}
          disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>{t('pgAgeSignOut', lang)}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  icon: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  body:  { fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 26 },
  error: { fontSize: 13.5, color: colors.danger, textAlign: 'center', lineHeight: 19, marginBottom: 16 },
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.md, alignSelf: 'stretch',
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  btnOff:  { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
})
