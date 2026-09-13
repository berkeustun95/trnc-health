import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, readableOn } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import ConnectivityErrorState from '../components/ConnectivityErrorState'
import OperatorWordmark from '../components/OperatorWordmark'
import { fetchOperator } from '../lib/connectivity'

// Bağlantı & eSIM — module landing (screen 1 of 3).
//
// A SINGLE PARTNER HERO AND NOTHING ELSE. No list, no second operator, no "coming soon"
// rows: KKTCELL is the sole operator in v1 and the whole screen is given to them. The only
// other element is the warning card, which exists to stop a newcomer buying a generic
// "Cyprus" eSIM that will not work in the north.
//
// ⚠ EVERY BRAND VALUE COMES OFF THE OPERATOR ROW. Colours, logo, name — nothing here is
//   hardcoded, so a brand correction is one UPDATE and no OTA. brand_confirmed is
//   deliberately NOT read: it is a go-live gate for the project owner, not user-facing
//   state, and branching on it would make an unconfirmed brand render differently from a
//   confirmed one for no reason a user could understand.
export default function ConnectivityLandingScreen({ lang, onBack, onOpenOperator, onOperatorLoaded }) {
  const [operator, setOperator] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  // Kept apart from the zero-rows case even though both render the same thing. See the
  // note in ConnectivityErrorState: they are one state for the user and two for us.
  const [failed, setFailed]     = useState(false)

  // Reported upward so screen 2 can use the row this screen already loaded rather than
  // querying for it again. Only ever called with a real row — handing up null on a failure
  // would clear a good operator that screen 2 may already be rendering.
  const load = useCallback(async () => {
    const { data, error } = await fetchOperator()
    setFailed(!!error)
    setOperator(data)
    if (data) onOperatorLoaded?.(data)
  }, [onOperatorLoaded])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await fetchOperator()
      if (!active) return
      setFailed(!!error)
      setOperator(data)
      if (data) onOperatorLoaded?.(data)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const onRetry = useCallback(async () => {
    setRetrying(true)
    await load()
    setRetrying(false)
  }, [load])

  function renderBody() {
    if (loading) {
      return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
    }

    // A failed request AND zero rows both land here. Neither table can legitimately be
    // empty, so an absent operator is a fault, never a calm empty state.
    if (failed || !operator) {
      return <ConnectivityErrorState lang={lang} onRetry={onRetry} retrying={retrying} />
    }

    const primary   = operator.brand_primary   || colors.primary
    const secondary = operator.brand_secondary || colors.textPrimary
    const onPrimary   = readableOn(primary)
    const onSecondary = readableOn(secondary)

    return (
      <>
        <View style={[s.hero, { backgroundColor: secondary }]}>
          {/* Brand band — brand_primary, carrying the logo and the partner badge. */}
          <View style={[s.heroTop, { backgroundColor: primary }]}>
            <OperatorWordmark operator={operator} onBrand={onPrimary} />
            <View style={[s.badge, { backgroundColor: secondary }]}>
              <Text style={[s.badgeText, { color: primary }]}>{t('connPartnerBadge', lang)}</Text>
            </View>
          </View>

          <View style={s.heroBody}>
            <Text style={[s.heroTitle, { color: onSecondary }]}>{t('connHeroHeadline', lang)}</Text>
            {/* The spec picks a hand-mixed tint of THIS navy for body copy. Derived from the
                brand instead, so a future operator with a light brand_secondary still gets
                readable copy rather than pale blue on pale blue. */}
            <Text style={[s.heroBodyText, { color: onSecondary, opacity: 0.78 }]}>
              {t('connHeroBody', lang)}
            </Text>

            <TouchableOpacity
              style={[s.heroCta, { backgroundColor: primary }]}
              onPress={onOpenOperator}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[s.heroCtaText, { color: onPrimary }]}>{t('connHeroCta', lang)}</Text>
              <Ionicons name="arrow-forward" size={17} color={onPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ⚠ THIS CARD'S COLOURS ARE FIXED AND MUST NOT BE DERIVED FROM THE OPERATOR ROW.
            Everything else on this screen is the partner's brand; this one card is ADA
            speaking in ADA's OWN VOICE, warning users about a category of product —
            including, implicitly, about other operators' eSIMs. A warning that adopted the
            partner's colours would read as the partner warning you off their competitors,
            which is a different and much worse message than the one intended.
            Amber rather than red on purpose: it is guidance that saves money, not a fault.
            Do not "fix" this to match the brand band. */}
        <View style={s.warn}>
          <Text style={s.warnText}>
            <Text style={s.warnStrong}>{t('connWarnTitle', lang)} </Text>
            {t('connWarnBody', lang)}
          </Text>
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.headerTitle}>{t('connTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  center:        { paddingVertical: 40, alignItems: 'center' },

  // overflow:hidden so the brand band's square top corners are clipped by the card radius.
  hero:          { borderRadius: 18, overflow: 'hidden', ...shadow },
  heroTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  // flexShrink so a longer locale wraps the badge instead of pushing it past the band.
  // Measured at 320dp the Turkish line is 73.4pt in a 92pt box — comfortable, but the
  // margin is small enough that an untranslated-yet locale could exceed it, and the
  // fixed-width logo slot beside it cannot give ground.
  badge:         { flexShrink: 1, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10 },
  badgeText:     { fontSize: 9.5, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 12 },

  heroBody:      { padding: 16 },
  heroTitle:     { fontSize: 19, fontFamily: 'Inter_700Bold', lineHeight: 24 },
  heroBodyText:  { fontSize: 12.5, fontFamily: 'Inter_400Regular', lineHeight: 19, marginTop: 7 },
  heroCta:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, paddingVertical: 13, marginTop: 14 },
  heroCtaText:   { fontSize: 13.5, fontFamily: 'Inter_700Bold' },

  warn:          { marginTop: 12, backgroundColor: '#FFF6E0', borderWidth: 1, borderColor: '#F3DDA4', borderRadius: 12, padding: 12 },
  warnText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6B4E00', lineHeight: 18 },
  warnStrong:    { fontFamily: 'Inter_700Bold' },
})
