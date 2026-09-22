import { useEffect, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { googleAvailable, appleAvailableAsync, signInWithGoogle, signInWithApple } from '../utils/socialAuth'

// Sign in with Apple + Google, above the email form on both AuthScreen tabs.
//
// ONE SIZE FOR BOTH, APPLE FIRST ON iOS (App Store 4.8), and on iOS Google is offered ONLY
// beside Apple — 4.8 does not allow it alone. Renders nothing at all when neither is
// available (Android in Expo Go), divider included.

const HEIGHT = 50
const RADIUS = 14

// Apple's own system button: HIG requires it, and iOS draws and localises the label.
// require()d here rather than imported — see utils/socialAuth.js.
function AppleButton({ onPress, disabled }) {
  const Apple = require('expo-apple-authentication')
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled && s.dim}>
      <Apple.AppleAuthenticationButton
        buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={RADIUS}
        style={s.btn}
        onPress={onPress}
      />
    </View>
  )
}

// Google's light-theme spec: #FFFFFF fill, 1px #747775 stroke, #1F1F1F Roboto Medium label,
// the standard multicolour G unaltered (assets/google-g.png is cropped from Google's
// sign-in branding kit and is opaque white — keep the fill white).
function GoogleButton({ label, onPress, disabled, busy }) {
  return (
    <TouchableOpacity
      style={[s.btn, s.google, disabled && s.dim]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy
        ? <ActivityIndicator color="#1F1F1F" />
        : (
          <>
            <Image source={require('../assets/google-g.png')} style={s.gLogo} />
            <Text style={s.googleText} numberOfLines={1}>{label}</Text>
          </>
        )}
    </TouchableOpacity>
  )
}

export default function SocialSignInButtons({ lang, consent }) {
  const [apple, setApple] = useState(false)
  const [busy, setBusy] = useState(null)
  // Shown HERE, under the button that failed — not in the email form's error slot below the
  // password field, where it would read as a problem with the password.
  const [errorKey, setErrorKey] = useState(null)
  const google = googleAvailable()

  useEffect(() => {
    let live = true
    appleAvailableAsync().then(ok => { if (live) setApple(ok) })
    return () => { live = false }
  }, [])

  const showGoogle = google && (Platform.OS !== 'ios' || apple)
  if (!apple && !showGoogle) return null

  async function run(which, signIn) {
    if (busy) return
    setBusy(which)
    setErrorKey(null)
    const key = await signIn({ consent })
    // On success SIGNED_IN has already swapped this screen out from under us.
    setBusy(null)
    setErrorKey(key)
  }

  return (
    <View style={s.wrap}>
      {apple && <AppleButton disabled={!!busy} onPress={() => run('apple', signInWithApple)} />}
      {showGoogle && (
        <GoogleButton
          label={t('continueWithGoogle', lang)}
          disabled={!!busy}
          busy={busy === 'google'}
          onPress={() => run('google', signInWithGoogle)}
        />
      )}
      {!!errorKey && <Text style={s.error}>{t(errorKey, lang)}</Text>}
      <View style={s.orRow}>
        <View style={s.orLine} />
        <Text style={s.orText}>{t('socialOr', lang)}</Text>
        <View style={s.orLine} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap:       { gap: 12, marginBottom: 6 },
  btn:        { height: HEIGHT, width: '100%', borderRadius: RADIUS },
  // borderRadius + borderWidth needs an explicit backgroundColor on Android.
  google:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#747775', paddingHorizontal: 16 },
  gLogo:      { width: 20, height: 20 },
  googleText: { fontFamily: 'Roboto_500Medium', fontSize: 17, color: '#1F1F1F', flexShrink: 1 },
  dim:        { opacity: 0.5 },
  error:      { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, textAlign: 'center' },
  orRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 12 },
  orLine:     { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.textSecondary, opacity: 0.4 },
  orText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})
