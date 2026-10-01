import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, StyleSheet, TouchableOpacity, Pressable, Animated, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, shadow, radius, radii, type } from '../constants/theme'
import { REDESIGN } from '../constants/redesign'
import { BottomSheet, Button } from './ui'
import { t, tCity } from '../constants/i18n'
import { VISITING } from '../utils/cityWelcomeRules'
import CityPicker from './CityPicker'

// The home-city question. Asked once (see shouldAskHomeCity), and it is the only
// thing that sets @trnc_city_asked — until it is answered, city welcome stays
// silent, because we cannot tell a resident from a tourist.
//
// THE VISITOR IS THE PRIMARY USER. "I'm visiting" is a first-class one-tap
// answer sitting above the city grid, not an escape hatch under it. The city
// list only unfolds if you say you live here.
//
// NOTHING IS EVER PRE-SELECTED, not even the city we just detected. Showing
// "Looks like you're in Kyrenia" is a hint; pre-selecting it is a trap — a
// tourist tapping through a pre-filled confirm would silently set their arrival
// city as home and permanently suppress the one welcome they actually wanted.
//
// A soft dismiss (tap-outside, "Not now", backgrounding) resolves to NOTHING:
// `asked` stays false and we re-ask on a later run. It must never fall through
// to "visitor", and it must never lock the user out of being asked again.
// ─── Redesign (S2b): shared BottomSheet with a dim backdrop (clears the floating tab bar),
// the same question, the same three paths in the same order. The visiting subline is full
// white: at 0.85 opacity it measured 4.08:1 on primary; at 1.0 it is 5.01:1. "Later" is a
// 44pt Button (was ~27pt).
function HomeCityBottomSheet({ detectedRegion, lang, onResolve, onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const hint = detectedRegion ? tCity('cwAskDetected', detectedRegion, lang) : null
  return (
    <BottomSheet visible onClose={onDismiss} title={t('cwAskTitle', lang)} lang={lang}>
      <View style={r.head}>
        <Image source={require('../assets/oli-button.png')} style={r.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
        <Text style={r.body}>{t('cwAskBody', lang)}</Text>
      </View>
      <TouchableOpacity style={r.primary} onPress={() => onResolve(VISITING)} activeOpacity={0.85} accessibilityRole="button">
        <Feather name="map" size={18} color="#FFFFFF" />
        <View style={{ flex: 1 }}>
          <Text style={r.primaryTitle}>{t('cwAskVisiting', lang)}</Text>
          <Text style={r.primarySub}>{t('cwAskVisitingHint', lang)}</Text>
        </View>
      </TouchableOpacity>
      {!expanded ? (
        <TouchableOpacity style={r.secondary} onPress={() => setExpanded(true)} activeOpacity={0.8}
          accessibilityRole="button" accessibilityState={{ expanded: false }}>
          <Feather name="home" size={16} color={colors.textPrimary} />
          <Text style={r.secondaryText}>{t('cwAskLiveHere', lang)}</Text>
          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={{ marginTop: 14 }}>
          <Text style={r.pickLabel}>{t('cwAskPickCity', lang)}</Text>
          {hint ? <Text style={r.hint}>{hint}</Text> : null}
          <CityPicker value={null} onSelect={onResolve} lang={lang} />
        </View>
      )}
      <Button variant="text" title={t('cwAskLater', lang)} onPress={onDismiss} fullWidth style={{ marginTop: 8 }} />
    </BottomSheet>
  )
}

export default function HomeCitySheet(props) {
  if (REDESIGN) return <HomeCityBottomSheet {...props} />
  return <HomeCitySheetLegacy {...props} />
}

function HomeCitySheetLegacy({ detectedRegion, lang, onResolve, onDismiss }) {
  const insets = useSafeAreaInsets()
  const slide = useRef(new Animated.Value(Dimensions.get('window').height)).current
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 12 }).start()
  }, [slide])

  const hint = detectedRegion ? tCity('cwAskDetected', detectedRegion, lang) : null

  return (
    <View style={s.backdrop} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

      <Animated.View style={[s.card, { paddingBottom: 16 + insets.bottom, transform: [{ translateY: slide }] }]}>
        <View style={s.head}>
          <Image source={require('../assets/oli-button.png')} style={s.mascot} resizeMode="cover" />
          <View style={s.headText}>
            <Text style={s.title}>{t('cwAskTitle', lang)}</Text>
            <Text style={s.body}>{t('cwAskBody', lang)}</Text>
          </View>
        </View>

        {/* Primary path: the visiting tourist. One tap, no list. */}
        <TouchableOpacity
          style={s.primary}
          onPress={() => onResolve(VISITING)}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Feather name="map" size={17} color="#FFFFFF" />
          <View style={s.primaryText}>
            <Text style={s.primaryTitle}>{t('cwAskVisiting', lang)}</Text>
            <Text style={s.primarySub}>{t('cwAskVisitingHint', lang)}</Text>
          </View>
        </TouchableOpacity>

        {!expanded ? (
          <TouchableOpacity
            style={s.secondary}
            onPress={() => setExpanded(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Feather name="home" size={15} color={colors.textPrimary} />
            <Text style={s.secondaryText}>{t('cwAskLiveHere', lang)}</Text>
            <Feather name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : (
          <View style={s.pickWrap}>
            <Text style={s.pickLabel}>{t('cwAskPickCity', lang)}</Text>
            {hint ? <Text style={s.hint}>{hint}</Text> : null}
            {/* value={null}: the detected city is a hint, never a default. */}
            <CityPicker value={null} onSelect={onResolve} lang={lang} />
          </View>
        )}

        <TouchableOpacity onPress={onDismiss} style={s.later} accessibilityRole="button">
          <Text style={s.laterText}>{t('cwAskLater', lang)}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  backdrop:     { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  card:         { backgroundColor: colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  paddingTop: 20, paddingHorizontal: 20, ...shadow },

  head:         { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  mascot:       { width: 60, height: 60, borderRadius: 30, marginRight: 14, flexShrink: 0 },
  headText:     { flex: 1 },
  title:        { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  body:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },

  primary:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primary,
                  borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16 },
  primaryText:  { flex: 1 },
  primaryTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  primarySub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#FFFFFF', opacity: 0.85, marginTop: 2 },

  secondary:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
                  backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border,
                  borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16 },
  secondaryText:{ flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  pickWrap:     { marginTop: 14 },
  pickLabel:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  hint:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 10 },

  later:        { alignSelf: 'center', marginTop: 14, paddingVertical: 6, paddingHorizontal: 12 },
  laterText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})

const r = StyleSheet.create({
  head:         { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  mascot:       { width: 64, height: 64 },
  body:         { ...type.body, color: colors.textSecondary, flex: 1 },
  primary:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, backgroundColor: colors.primary,
                  borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 16 },
  primaryTitle: { ...type.rowTitle, color: '#FFFFFF' },
  primarySub:   { ...type.meta, fontFamily: 'Inter_400Regular', color: '#FFFFFF', marginTop: 2 },
  secondary:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, minHeight: 52,
                  backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.fieldBorder,
                  borderRadius: radii.card, paddingHorizontal: 16 },
  secondaryText:{ flex: 1, ...type.rowTitle, color: colors.textPrimary },
  pickLabel:    { ...type.meta, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary, marginBottom: 6 },
  hint:         { ...type.meta, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 10 },
})
