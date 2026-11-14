import { useEffect, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, font, radii, press, TAP } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { Button, InlineAlert, PageCanvas } from '../components/ui'
import { LanguageSheet } from '../components/shell/Sheets'
import SplashStatusBar from '../components/SplashStatusBar'
import { logOnboardingEvent } from '../utils/onboardingEvents'
import { START_SHOWN_EVENT } from '../utils/onboardingState'

const LOGO = require('../assets/brand/v2/ada-logo-keyline.png')

// Onboarding v2, the entry screen: one primary path (guest -> Screen 2) and the account paths
// underneath. Replaces Welcome and is where sign-out lands. App owns every storage write;
// onStart resolves to the sign-in's { error }.
export default function StartScreen({ lang, onLangChange, onStart, onLogin, onSignUp }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showLang, setShowLang] = useState(false)

  useEffect(() => { logOnboardingEvent(START_SHOWN_EVENT) }, [])

  async function start() {
    setBusy(true)
    setError(null)
    let failed = true
    try { failed = !!(await onStart())?.error } catch {}
    // On success onAuthStateChange swaps the tree out, so only the failure path recovers.
    if (failed) { setError(t('guestSignInFailed', lang)); setBusy(false) }
  }

  return (
    <PageCanvas>
      <SplashStatusBar style="dark" />
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.topRow}>
          <TouchableOpacity style={s.langPill} onPress={() => setShowLang(true)} activeOpacity={press.small}
            accessibilityRole="button" accessibilityLabel={t('chooseLanguage', lang)}>
            <Ionicons name="globe-outline" size={16} color={colors.primaryDark} />
            <Text style={s.langPillText}>{(LANG_CODES[lang] ?? 'en').toUpperCase()}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.primaryDark} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} bounces={false} showsVerticalScrollIndicator={false}>
          <View style={s.brand}>
            <Image source={LOGO} style={s.logo} resizeMode="contain" accessible={false} importantForAccessibility="no" />
            <Text style={s.tagline} accessibilityRole="header">{t('startTagline', lang)}</Text>
          </View>

          <View style={s.actions}>
            <InlineAlert message={error} />
            <Button size="lg" title={t('startCta', lang)} onPress={start} loading={busy} fullWidth />
            <View style={s.accountRow}>
              <Text style={s.accountText}>{t('startHaveAccount', lang)}</Text>
              <View style={s.links}>
                <TouchableOpacity onPress={onLogin} disabled={busy} activeOpacity={press.small} style={[s.link, busy && s.linkBusy]}
                  accessibilityRole="link" accessibilityState={{ disabled: busy }}>
                  <Text style={s.linkText}>{t('login', lang)}</Text>
                </TouchableOpacity>
                <Text style={s.dot} importantForAccessibility="no">·</Text>
                <TouchableOpacity onPress={onSignUp} disabled={busy} activeOpacity={press.small} style={[s.link, busy && s.linkBusy]}
                  accessibilityRole="link" accessibilityState={{ disabled: busy }}>
                  <Text style={s.linkText}>{t('signup', lang)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>

        <LanguageSheet visible={showLang === true} lang={lang} onClose={() => setShowLang(false)}
          onSelect={key => { onLangChange?.(key); setShowLang(false) }} />
      </SafeAreaView>
    </PageCanvas>
  )
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: 'transparent' },
  topRow:      { flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 },
  // borderRadius + borderWidth: an explicit fill, or Android may draw it opaque.
  langPill:    { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 14,
                 borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.fieldBorder },
  langPillText:{ ...type.meta, fontFamily: font.bold, color: colors.primaryDark, letterSpacing: 0.5 },
  scroll:      { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  brand:       { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  logo:        { width: 156, height: 191 },
  tagline:     { ...type.sectionHeading, color: colors.textPrimary, textAlign: 'center', marginTop: 20 },
  actions:     { gap: 12 },
  accountRow:  { alignItems: 'center', marginTop: 8 },
  accountText: { ...type.body, color: colors.textSecondaryOnPage, textAlign: 'center' },
  links:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  link:        { minHeight: TAP, paddingHorizontal: 10, justifyContent: 'center' },
  linkBusy:    { opacity: 0.45 },
  linkText:    { ...type.rowTitle, color: colors.primaryDark },
  dot:         { ...type.rowTitle, color: colors.textSecondaryOnPage },
})
