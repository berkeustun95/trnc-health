import { useState, useRef } from 'react'
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  FlatList, Dimensions, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const { width, height } = Dimensions.get('window')

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

const FEATURE_SLIDES = [
  {
    id: 'explore',
    icon: 'compass',
    iconBg: '#E0F5F4',
    iconColor: '#0E7C7B',
    titleKey: 'slide1Title',
    bodyKey: 'onboardingP1',
  },
  {
    id: 'duty',
    icon: 'moon',
    iconBg: '#EAE8F5',
    iconColor: '#5B5BD6',
    titleKey: 'slide2Title',
    bodyKey: 'onboardingP2',
  },
  {
    id: 'health',
    icon: 'medical',
    iconBg: '#FAEAEC',
    iconColor: '#D1495B',
    titleKey: 'slide3Title',
    bodyKey: 'onboardingP3',
  },
  {
    id: 'services',
    icon: 'home',
    iconBg: '#FFF0EB',
    iconColor: '#FF8552',
    titleKey: 'slide4Title',
    bodyKey: 'onboardingP4',
  },
]

function WelcomeSlide({ lang, setLang }) {
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={s.welcomeContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.logoWrap}>
        <Image
          source={require('../assets/adalogo.png')}
          style={s.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={s.tagline}>{t('onboardingTagline', lang)}</Text>

      <View style={s.divider} />

      <Text style={s.langLabel}>{t('chooseLanguage', lang)}</Text>
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
    </ScrollView>
  )
}

function FeatureSlide({ slide, lang }) {
  return (
    <View style={s.featureSlide}>
      <View style={s.iconArea}>
        <View style={[s.iconCircle, { backgroundColor: slide.iconBg }]}>
          <Ionicons name={slide.icon} size={72} color={slide.iconColor} />
        </View>
      </View>
      <View style={s.featureText}>
        <Text style={s.featureTitle}>{t(slide.titleKey, lang)}</Text>
        <Text style={s.featureBody}>{t(slide.bodyKey, lang)}</Text>
      </View>
    </View>
  )
}

export default function OnboardingScreen({ onComplete }) {
  const [lang, setLang] = useState('English')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  const SLIDES = [{ id: 'welcome' }, ...FEATURE_SLIDES]
  const isLast = index === SLIDES.length - 1

  function goTo(i) {
    listRef.current?.scrollToIndex({ index: i, animated: true })
    setIndex(i)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        scrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width)
          setIndex(i)
        }}
        renderItem={({ item }) =>
          item.id === 'welcome'
            ? <WelcomeSlide lang={lang} setLang={setLang} />
            : <FeatureSlide slide={item} lang={lang} />
        }
      />

      <View style={s.nav}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>

        <View style={s.navButtons}>
          {index > 0 && (
            <TouchableOpacity style={s.backBtn} onPress={() => goTo(index - 1)} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.nextBtn, isLast && s.nextBtnLast]}
            onPress={() => isLast ? onComplete(lang) : goTo(index + 1)}
            activeOpacity={0.85}
          >
            <Text style={s.nextText}>
              {isLast ? t('getStarted', lang) : t('next', lang)}
            </Text>
            <Ionicons name="arrow-forward" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  // Welcome slide
  welcomeContent: {
    width,
    paddingHorizontal: 28,
    paddingTop: height * 0.06,
    paddingBottom: 16,
  },
  logoWrap:  { alignItems: 'center', marginBottom: 16 },
  logo:      { width: width * 0.68, height: width * 0.68 },
  tagline:   {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  divider:   { height: 1, backgroundColor: colors.border, marginBottom: 24 },
  langLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 14,
  },
  langGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip:        {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  langChipActive:      { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  langChipText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  langChipTextActive:  { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Feature slides
  featureSlide: {
    width,
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  iconArea:    { marginBottom: 40, alignItems: 'center' },
  iconCircle:  {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow,
  },
  featureText:  { alignItems: 'center' },
  featureTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: '#1A3A4A',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 14,
  },
  featureBody: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 280,
  },

  // Bottom nav
  nav: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  dot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary },

  navButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  nextBtnLast: { backgroundColor: '#1A3A4A' },
  nextText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
})
