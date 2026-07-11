import { useRef, useState } from 'react'
import { View, Text, Image, TouchableOpacity, Modal, TextInput, ScrollView, StyleSheet, Animated, PanResponder, Dimensions, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { resolveOliQuery, getIntent } from '../constants/oliIntents'

const SCREEN_H = Dimensions.get('window').height

// Starter chips → intent targets. Matching/navigation lands in Slice 2.
const CHIPS = [
  { id: 'pharmacy',     labelKey: 'oliChipPharmacy' },
  { id: 'events',       labelKey: 'oliChipEvents' },
  { id: 'homeServices', labelKey: 'oliChipHomeServices' },
  { id: 'jobs',         labelKey: 'oliChipJobs' },
  { id: 'emergency',    labelKey: 'oliChipEmergency' },
  { id: 'newcomer',     labelKey: 'oliChipNewcomer' },
]

export default function OliGuide({ lang, onNavigate }) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null = home (chips); [] = no match; [intents] = matches
  const translateY = useRef(new Animated.Value(SCREEN_H)).current
  const backdrop = useRef(new Animated.Value(0)).current

  const openSheet = () => {
    setOpen(true)
    setResults(null)
    setQuery('')
    translateY.setValue(SCREEN_H)
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start()
  }

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setOpen(false)
      setQuery('')
      setResults(null)
    })
  }

  const handleChip = (id) => {
    const intent = getIntent(id)
    setResults(intent ? [intent] : [])
  }

  const handleSubmit = () => {
    const q = query.trim()
    if (!q) return
    setResults(resolveOliQuery(q))
  }

  const handleGo = (intent) => {
    onNavigate?.(intent.id)
    closeSheet()
  }

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy) },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) closeSheet()
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
      },
    })
  ).current

  return (
    <>
      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + 72 }]}
        activeOpacity={0.85}
        onPress={openSheet}
        accessibilityLabel="Ask Oli"
      >
        <Image source={require('../assets/oli-button.png')} style={s.fabImg} resizeMode="cover" fadeDuration={0} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
        <Animated.View style={[s.backdrop, { opacity: backdrop }]}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
        </Animated.View>

        <Animated.View style={[s.sheet, { paddingTop: insets.top + 8, transform: [{ translateY }] }]}>
          <View {...pan.panHandlers}>
            <View style={s.grabber} />
            <TouchableOpacity style={s.closeBtn} onPress={closeSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={s.header}>
              <Image source={require('../assets/oli-header.png')} style={s.headerImg} resizeMode="contain" />
              <Text style={s.greeting}>{t('oliGreeting', lang)}</Text>
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {results && results.length > 0 ? (
              <View style={s.results}>
                {results.map(intent => (
                  <View key={intent.id} style={s.card}>
                    <View style={s.cardAvatar}>
                      <Image source={require('../assets/oli-button.png')} style={s.cardAvatarImg} resizeMode="cover" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardMsg}>{t(intent.msgKey, lang)}</Text>
                      <TouchableOpacity style={s.goBtn} activeOpacity={0.85} onPress={() => handleGo(intent)}>
                        <Text style={s.goBtnText}>{t('oliTakeMeThere', lang)}</Text>
                        <Ionicons name="arrow-forward" size={15} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <>
                {results && results.length === 0 && (
                  <Text style={s.fallback}>{t('oliNoMatch', lang)}</Text>
                )}
                <View style={s.chipWrap}>
                  {CHIPS.map(chip => (
                    <TouchableOpacity key={chip.id} style={s.chip} activeOpacity={0.75} onPress={() => handleChip(chip.id)}>
                      <Text style={s.chipText}>{t(chip.labelKey, lang)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          <View style={[s.inputBar, { paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={s.input}
              value={query}
              onChangeText={setQuery}
              placeholder={t('oliInputPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity style={s.sendBtn} activeOpacity={0.85} onPress={handleSubmit}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute', right: 16, width: 62, height: 62, borderRadius: 31,
    backgroundColor: colors.cardBg, borderWidth: 2, borderColor: colors.primary,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center', zIndex: 50,
    ...shadow, shadowOpacity: 0.18, elevation: 8,
  },
  // Gentle zoom so Oli's head/face fills the circle naturally. Tune scale to taste.
  fabImg: { width: '100%', height: '100%', transform: [{ scale: 1.35 }] },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 4 },
  closeBtn: { position: 'absolute', right: 16, top: 6 },
  header: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
  headerImg: { width: 128, height: 128, marginBottom: 4 },
  greeting: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', lineHeight: 25 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingTop: 4 },
  chip: {
    backgroundColor: colors.cardBg, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11,
    borderWidth: 1, borderColor: colors.border, ...shadow, shadowOpacity: 0.05, elevation: 1,
  },
  chipText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  fallback: { fontSize: 14.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 21, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 14 },
  results: { gap: 12, paddingTop: 4 },
  card: {
    flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: radius.card,
    padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  cardAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight, overflow: 'hidden', flexShrink: 0 },
  cardAvatarImg: { width: '100%', height: '100%', transform: [{ scale: 1.35 }] },
  cardMsg: { fontSize: 14.5, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },
  goBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10,
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14,
  },
  goBtnText: { fontSize: 13.5, fontFamily: 'Inter_700Bold', color: '#fff' },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.cardBg,
  },
  input: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 24, paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
})
