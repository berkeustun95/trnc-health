import { useEffect, useRef } from 'react'
import { View, Text, Image, StyleSheet, TouchableOpacity, Pressable, Animated, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, shadow, radius, radii, type, category } from '../constants/theme'
import { REDESIGN } from '../constants/redesign'
import { BottomSheet, Button } from './ui'
import { t, tCity } from '../constants/i18n'

// The city-welcome card. Mounted at the root of App.js next to OliGuide — the
// canonical app-wide overlay pattern (see architecture.md). It slides up over
// whatever screen is showing rather than living inside one, because the trigger
// is a foreground event, not a navigation.
//
// Two variants, decided by decideWelcome():
//   'rich'  — first time in this city: full greeting
//   'nudge' — been here before, 30-day cooldown elapsed: lighter "what's on"
//
// Deep-links out to that city's beaches, events and duty pharmacies.

const ACTIONS = [
  { target: 'beaches', labelKey: 'cwBeaches', icon: 'sun' },
  { target: 'events',  labelKey: 'cwEvents',  icon: 'calendar' },
  { target: 'duty',    labelKey: 'cwDuty',    icon: 'plus-square' },
]

// ─── Redesign (S2b): the shared BottomSheet — a Modal with a dim backdrop, so it sits above
// the floating tab bar rather than beside it, and Android back / backdrop / swipe all
// dismiss. Same three destinations, same copy, same handlers. "Turn off" is a 44pt Button
// (was ~27pt of underlined text).
function CityWelcomeSheet({ region, variant, lang, onNavigate, onDismiss, onTurnOff }) {
  const isRich = variant === 'rich'
  const title = tCity(isRich ? 'cwWelcomeTitle' : 'cwNudgeTitle', region, lang)
  const body  = tCity(isRich ? 'cwWelcomeBody'  : 'cwNudgeBody',  region, lang)
  return (
    <BottomSheet visible onClose={onDismiss} title={title} lang={lang}>
      <View style={r.head}>
        <Image source={require('../assets/oli-button.png')} style={r.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
        <Text style={r.body}>{body}</Text>
      </View>
      <View style={r.actions}>
        {ACTIONS.map(a => (
          <TouchableOpacity key={a.target} style={r.action} onPress={() => onNavigate(a.target)} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel={t(a.labelKey, lang)}>
            <View style={r.actionIcon}><Feather name={a.icon} size={18} color={category.city.ink} /></View>
            <Text style={r.actionText} numberOfLines={2}>{t(a.labelKey, lang)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Button variant="text" title={t('cwTurnOff', lang)} onPress={onTurnOff} fullWidth style={{ marginTop: 8 }} />
    </BottomSheet>
  )
}

export default function CityWelcomeCard(props) {
  if (REDESIGN) return <CityWelcomeSheet {...props} />
  return <CityWelcomeCardLegacy {...props} />
}

function CityWelcomeCardLegacy({ region, variant, lang, onNavigate, onDismiss, onTurnOff }) {
  const insets = useSafeAreaInsets()
  const slide = useRef(new Animated.Value(Dimensions.get('window').height)).current

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 12,
    }).start()
  }, [slide])

  // tCity, not t(...).replace('{city}') — Turkish inflects the place name and
  // needs a pre-inflected form per region. See tCity() in constants/i18n.js.
  const isRich = variant === 'rich'
  const title = tCity(isRich ? 'cwWelcomeTitle' : 'cwNudgeTitle', region, lang)
  const body  = tCity(isRich ? 'cwWelcomeBody'  : 'cwNudgeBody',  region, lang)

  return (
    <View style={s.backdrop} pointerEvents="box-none">
      {/* Tap-outside dismisses. Without this the card sits over the bottom tab
          bar until the user finds the ×, which is a trap on a small screen. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      <Animated.View
        style={[
          s.card,
          { paddingBottom: 16 + insets.bottom, transform: [{ translateY: slide }] },
        ]}
      >
        <TouchableOpacity
          style={s.close}
          onPress={onDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('cwDismiss', lang)}
        >
          <Feather name="x" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={s.head}>
          <Image
            source={require('../assets/oli-button.png')}
            style={[s.mascot, isRich && s.mascotRich]}
            resizeMode="cover"
          />
          <View style={s.headText}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.body}>{body}</Text>
          </View>
        </View>

        <View style={s.actions}>
          {ACTIONS.map(a => (
            <TouchableOpacity
              key={a.target}
              style={s.action}
              onPress={() => onNavigate(a.target)}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <View style={s.actionIcon}>
                <Feather name={a.icon} size={17} color={colors.primary} />
              </View>
              <Text style={s.actionText} numberOfLines={2}>{t(a.labelKey, lang)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity onPress={onTurnOff} style={s.turnOff} accessibilityRole="button">
          <Text style={s.turnOffText}>{t('cwTurnOff', lang)}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  backdrop:   { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },

  card:       { backgroundColor: colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                paddingTop: 20, paddingHorizontal: 20, ...shadow },
  close:      { position: 'absolute', top: 14, right: 14, zIndex: 1, padding: 4 },

  head:       { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingRight: 24 },
  mascot:     { width: 60, height: 60, borderRadius: 30, marginRight: 14, flexShrink: 0 },
  mascotRich: { width: 76, height: 76, borderRadius: 38 },
  headText:   { flex: 1 },
  title:      { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  body:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },

  actions:    { flexDirection: 'row', gap: 10 },
  action:     { flex: 1, backgroundColor: colors.bg, borderRadius: radius.card, paddingVertical: 14,
                paddingHorizontal: 8, alignItems: 'center', gap: 8 },
  actionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight,
                alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },

  turnOff:     { alignSelf: 'center', marginTop: 14, paddingVertical: 6, paddingHorizontal: 12 },
  turnOffText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                 textDecorationLine: 'underline' },
})

const r = StyleSheet.create({
  head:       { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  mascot:     { width: 64, height: 64 },
  body:       { ...type.body, color: colors.textSecondary, flex: 1 },
  actions:    { flexDirection: 'row', gap: 10 },
  action:     { flex: 1, minHeight: 92, backgroundColor: category.city.bg, borderRadius: radii.tile,
                paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.meta, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
})
