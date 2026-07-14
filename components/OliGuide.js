import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, TouchableOpacity, Modal, TextInput, ScrollView, StyleSheet, Animated, PanResponder, Dimensions, useWindowDimensions, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { resolveOliQuery, getIntent } from '../constants/oliIntents'

const SCREEN_H = Dimensions.get('window').height

const FAB_SIZE = 62
const EDGE_MARGIN = 16
// Bottom tab bar = borderTop 1 + paddingTop 10 + icon 24 + gap 3 + label ~14, plus insets.bottom.
const TAB_BAR_H = 52
const TAB_BAR_GAP = 20
// Clears the screen header (~68) + the global search entry (~44) so the button never sits on them.
const TOP_CLEARANCE = 112
// Movement under this (px) on release counts as a tap, not a drag.
const TAP_SLOP = 10
const OLI_POS_KEY = '@trnc_oli_pos'

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

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
  const { width, height } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null = home (chips); [] = no match; [intents] = matches
  const translateY = useRef(new Animated.Value(SCREEN_H)).current
  const backdrop = useRef(new Animated.Value(0)).current

  // --- Draggable floating button -------------------------------------------
  const minX = EDGE_MARGIN
  const maxX = width - FAB_SIZE - EDGE_MARGIN
  const minY = insets.top + TOP_CLEARANCE
  const maxY = Math.max(minY, height - (TAB_BAR_H + insets.bottom) - TAB_BAR_GAP - FAB_SIZE)

  // Handlers live in a ref'd PanResponder, so they read bounds through a ref rather than a stale closure.
  const boundsRef = useRef(null)
  boundsRef.current = { minX, maxX, minY, maxY, width }

  // Resting spot is stored as an edge + a vertical offset (never a free-floating x).
  const restRef = useRef(null)
  if (!restRef.current) restRef.current = { edge: 'right', y: maxY }

  const pos = useRef(new Animated.ValueXY({ x: maxX, y: maxY })).current
  const scale = useRef(new Animated.Value(1)).current
  const dragFrom = useRef({ x: 0, y: 0 })

  // Hidden until the saved position is read, so a left-edge rest doesn't flash in at bottom-right first.
  const [hydrated, setHydrated] = useState(false)
  const opacity = useRef(new Animated.Value(0)).current

  // Re-clamp if the window or insets change (rotation, inset shifts). Keeps the same edge.
  useEffect(() => {
    const rest = restRef.current
    const y = clamp(rest.y, minY, maxY)
    const x = rest.edge === 'left' ? minX : maxX
    restRef.current = { edge: rest.edge, y }
    pos.setValue({ x, y })
  }, [minX, maxX, minY, maxY])

  // Restore the saved resting spot on launch. Anything missing or malformed falls back to bottom-right.
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(OLI_POS_KEY)
      .then(raw => {
        if (!alive || !raw) return
        const saved = JSON.parse(raw)
        if (saved?.edge !== 'left' && saved?.edge !== 'right') return
        if (!Number.isFinite(saved?.y)) return
        const b = boundsRef.current
        const y = clamp(saved.y, b.minY, b.maxY)
        restRef.current = { edge: saved.edge, y }
        pos.setValue({ x: saved.edge === 'left' ? b.minX : b.maxX, y })
      })
      .catch(() => {})
      .finally(() => {
        if (!alive) return
        setHydrated(true)
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start()
      })
    return () => { alive = false }
  }, [])

  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const b = boundsRef.current
        const rest = restRef.current
        dragFrom.current = { x: rest.edge === 'left' ? b.minX : b.maxX, y: rest.y }
        Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, friction: 6, tension: 140 }).start()
      },
      onPanResponderMove: (_, g) => {
        const b = boundsRef.current
        // setValue (not Animated.event) so the value stays native-driven for the snap spring.
        pos.x.setValue(clamp(dragFrom.current.x + g.dx, 0, b.width - FAB_SIZE))
        pos.y.setValue(clamp(dragFrom.current.y + g.dy, b.minY, b.maxY))
      },
      onPanResponderRelease: (_, g) => {
        const b = boundsRef.current
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 140 }).start()

        if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
          settle(restRef.current)
          openSheet()
          return
        }

        const x = clamp(dragFrom.current.x + g.dx, 0, b.width - FAB_SIZE)
        const y = clamp(dragFrom.current.y + g.dy, b.minY, b.maxY)
        const edge = x + FAB_SIZE / 2 < b.width / 2 ? 'left' : 'right'
        restRef.current = { edge, y }
        settle({ edge, y })
        AsyncStorage.setItem(OLI_POS_KEY, JSON.stringify({ edge, y })).catch(() => {})
      },
      onPanResponderTerminate: () => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 140 }).start()
        settle(restRef.current)
      },
    })
  ).current

  // Springs the button onto its resting edge. Native driver: transform only.
  const settle = ({ edge, y }) => {
    const b = boundsRef.current
    Animated.spring(pos, {
      toValue: { x: edge === 'left' ? b.minX : b.maxX, y },
      useNativeDriver: true,
      friction: 7,
      tension: 70,
    }).start()
  }

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
      <Animated.View
        {...drag.panHandlers}
        pointerEvents={hydrated ? 'auto' : 'none'}
        style={[s.fab, { opacity, transform: [...pos.getTranslateTransform(), { scale }] }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Ask Oli"
        onAccessibilityTap={openSheet}
      >
        <Image source={require('../assets/oli-button.png')} style={s.fabImg} resizeMode="cover" fadeDuration={0} />
      </Animated.View>

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
    position: 'absolute', left: 0, top: 0, width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
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
