import { useState } from 'react'
import { View, Text, Image, ImageBackground, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'

// Native names, not English ones — someone stuck in a language they can't read
// recognises "Türkçe", not "Turkish".
const LANGUAGES = [
  { key: 'English', label: 'English' },
  { key: 'Turkish', label: 'Türkçe' },
  { key: 'Arabic',  label: 'العربية' },
  { key: 'Russian', label: 'Русский' },
  { key: 'Greek',   label: 'Ελληνικά' },
  { key: 'French',  label: 'Français' },
  { key: 'Spanish', label: 'Español' },
  { key: 'German',  label: 'Deutsch' },
  { key: 'Persian', label: 'فارسی' },
]

export default function WelcomeScreen({ lang, onLogin, onSignUp, onLangChange }) {
  const [guestLoading, setGuestLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showLangPicker, setShowLangPicker] = useState(false)

  async function continueAsGuest() {
    setGuestLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInAnonymously()
    // On success onAuthStateChange swaps the tree out from under us, so only
    // recover from the failure path.
    if (error) {
      setError(t('guestSignInFailed', lang))
      setGuestLoading(false)
    }
  }

  return (
    <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      <View style={s.overlay} />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.container}>
          <TouchableOpacity
            style={s.langPill}
            onPress={() => setShowLangPicker(true)}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="globe-outline" size={14} color="#fff" />
            <Text style={s.langPillText}>{(LANG_CODES[lang] ?? 'en').toUpperCase()}</Text>
            <Ionicons name="chevron-down" size={13} color="#fff" />
          </TouchableOpacity>

          <View style={s.logoWrap}>
            <Image source={require('../assets/logonobg.png')} style={s.logo} resizeMode="contain" />
          </View>
          <View style={s.taglineBand}>
            <Text style={s.tagline}>{t('welcomeTagline', lang)}</Text>
          </View>

          <View style={s.actions}>
            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity style={s.btn} onPress={onLogin} activeOpacity={0.85} disabled={guestLoading}>
              <Text style={s.btnText}>{t('login', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={onSignUp} activeOpacity={0.85} disabled={guestLoading}>
              <Text style={[s.btnText, s.btnSecondaryText]}>{t('signup', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.guestBtn}
              onPress={continueAsGuest}
              activeOpacity={0.7}
              disabled={guestLoading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {guestLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.guestText}>{t('continueAsGuest', lang)}</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <Modal
          visible={showLangPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowLangPicker(false)}
        >
          <Pressable style={s.backdrop} onPress={() => setShowLangPicker(false)}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              <View style={s.grabber} />
              <Text style={s.sheetTitle}>{t('chooseLanguage', lang)}</Text>
              <View style={s.langGrid}>
                {LANGUAGES.map(({ key, label }) => (
                  <TouchableOpacity
                    key={key}
                    style={[s.langChip, lang === key && s.langChipActive]}
                    onPress={() => { onLangChange?.(key); setShowLangPicker(false) }}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.langChipText, lang === key && s.langChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </ImageBackground>
  )
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: 'transparent' },
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  container:{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 0, paddingBottom: 40 },
  logoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  logo:     { width: 320, height: 240 },
  taglineBand: { width: '100%', backgroundColor: 'rgba(0,0,0,0.28)', paddingVertical: 14, paddingHorizontal: 32, marginBottom: 32 },
  tagline:  { fontSize: 22, fontFamily: 'PlayfairDisplay_400Regular', color: '#fff', textAlign: 'center', lineHeight: 32, letterSpacing: 0.5 },
  actions:  { alignSelf: 'stretch', paddingHorizontal: 32 },
  error:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#fff', textAlign: 'center', marginBottom: 14, lineHeight: 20,
              backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btn:      { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12,
              shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  btnText:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.3, textAlign: 'center' },
  btnSecondary:     { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#fff', elevation: 0, shadowOpacity: 0 },
  btnSecondaryText: { color: '#fff' },
  guestBtn:  { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 16, minHeight: 48, justifyContent: 'center' },
  guestText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.9)', textAlign: 'center',
               textDecorationLine: 'underline', letterSpacing: 0.2 },

  // borderWidth + borderRadius needs an explicit backgroundColor on Android.
  langPill:     { position: 'absolute', top: 8, right: 20, zIndex: 2, flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(0,0,0,0.32)' },
  langPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },

  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                paddingHorizontal: 24, paddingTop: 10, paddingBottom: 34, alignItems: 'center' },
  grabber:    { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 18 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 18 },
  langGrid:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  langChip:   { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5,
                borderColor: colors.border, backgroundColor: 'transparent' },
  langChipActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  langChipText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  langChipTextActive: { color: colors.primary },
})
