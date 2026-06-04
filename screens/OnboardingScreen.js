import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

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

const POINTS = ['onboardingP1', 'onboardingP2', 'onboardingP3']

export default function OnboardingScreen({ onComplete }) {
  const [lang, setLang] = useState('English')

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

        <View style={s.top}>
          <Image source={require('../assets/Logo.png')} style={s.logoImg} resizeMode="contain" />
          <Text style={s.tagline}>{t('onboardingTagline', lang)}</Text>
        </View>

        <View style={s.langSection}>
          <Text style={s.sectionLabel}>{t('chooseLanguage', lang)}</Text>
          <View style={s.langGrid}>
            {LANGUAGES.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[s.langChip, lang === key && s.langChipActive]}
                onPress={() => setLang(key)}
                activeOpacity={0.7}
              >
                <Text style={[s.langChipText, lang === key && s.langChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.pointsSection}>
          {POINTS.map((key, i) => (
            <View key={i} style={s.pointRow}>
              <View style={s.checkCircle}>
                <Feather name="check" size={13} color={colors.success} />
              </View>
              <Text style={s.pointText}>{t(key, lang)}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={s.cta} onPress={() => onComplete(lang)} activeOpacity={0.85}>
          <Text style={s.ctaText}>{t('getStarted', lang)}</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },
  container:         { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40, flexGrow: 1 },

  top:               { alignItems: 'center', marginBottom: 40 },
  logoImg:           { width: 260, height: 100, marginBottom: 12 },
  tagline:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },

  langSection:       { marginBottom: 36 },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 },
  langGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip:          { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  langChipActive:    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  langChipText:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  langChipTextActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },

  pointsSection:     { marginBottom: 40 },
  pointRow:          { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  checkCircle:       { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.successLight, justifyContent: 'center', alignItems: 'center', marginTop: 1, flexShrink: 0 },
  pointText:         { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },

  cta:               { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  ctaText:           { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
})
