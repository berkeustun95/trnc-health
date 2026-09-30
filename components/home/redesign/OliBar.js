import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, TouchableOpacity, StyleSheet, AppState, AccessibilityInfo, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'

// ─── The Oli bar (Home v3) ───────────────────────────────────────────────────
// The whole bar opens the Oli sheet (search lives there, unchanged). Left: "Oli'ye sor" and
// its subline on primary (white on #0E7C7B = 5.01:1). Right: a white panel that crossfades
// through the Oli & Maki scenes.
//
// Scenes are the 1080px ORIGINALS, trimmed to the art and exported 300px tall
// (assets/oli-scenes/). The 360px module badges would draw ~252px tall at 3x — upscaled and
// soft; these never are, zoom included. Only LIVE modules' scenes: exchange has no module
// and insurance is dark, and a scene is a quiet promise of a feature.
//
// Motion: 4s per scene, 600ms crossfade, a 1.00 → 1.05 zoom across each scene's life. It
// PAUSES when the bar is scrolled away (`active`), when the app is in the background, and
// never starts under Reduce Motion (one static scene, no dots advancing).
export const OLI_BAR_H = 104
// 164, not ~150: "Demandez à Oli" / "Pregunta a Oli" and most sublines at font scale 1.3 did
// not fit 150 (labels:check). Title 17/22 × 1 line, subline 12/16 × 2 lines; height is checked too.
export const OLI_TEXT_W = 164
export const OLI_FONT_CAP = 1.1   // "Demandez à Oli" is 148.6pt at 1.15 in a 148pt column; 142.1 at 1.1
export const OLI_FONT_CAP_NARROW = 1.0
const SCENES = [
  require('../../../assets/oli-scenes/welcome.png'),
  require('../../../assets/oli-scenes/health.png'),
  require('../../../assets/oli-scenes/emergency.png'),
  require('../../../assets/oli-scenes/events.png'),
  require('../../../assets/oli-scenes/accommodation.png'),
  require('../../../assets/oli-scenes/services.png'),
  require('../../../assets/oli-scenes/pets.png'),
]
const HOLD = 4000
const FADE = 600
const ZOOM = 1.05

function useReduceMotion() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return on
}

function useForeground() {
  const [fg, setFg] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setFg(st === 'active'))
    return () => sub.remove()
  }, [])
  return fg
}

function SceneCarousel({ active }) {
  const reduce = useReduceMotion()
  const fg = useForeground()
  const running = active && fg && !reduce
  const [idx, setIdx] = useState(0)
  const opacity = useRef(SCENES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current
  const scale = useRef(SCENES.map(() => new Animated.Value(1))).current

  useEffect(() => {
    if (!running) return
    // The zoom runs across the scene's whole life (hold + fade out), so it never stops mid-view.
    const zoom = Animated.timing(scale[idx], { toValue: ZOOM, duration: HOLD + FADE, useNativeDriver: true })
    zoom.start()
    const timer = setTimeout(() => {
      const next = (idx + 1) % SCENES.length
      scale[next].setValue(1)
      Animated.parallel([
        Animated.timing(opacity[idx], { toValue: 0, duration: FADE, useNativeDriver: true }),
        Animated.timing(opacity[next], { toValue: 1, duration: FADE, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setIdx(next) })
    }, HOLD)
    return () => { clearTimeout(timer); zoom.stop() }
  }, [running, idx])

  return (
    <View style={s.panel} pointerEvents="none">
      {SCENES.map((src, i) => (
        <Animated.Image key={i} source={src} resizeMode="contain" accessibilityIgnoresInvertColors
          style={[s.scene, { opacity: opacity[i], transform: [{ scale: scale[i] }] }]} />
      ))}
      {!reduce && (
        <View style={s.dots}>
          {SCENES.map((_, i) => <View key={i} style={[s.dot, i === idx && s.dotOn]} />)}
        </View>
      )}
    </View>
  )
}

export default function OliBar({ lang, onPress, active = true, barRef }) {
  const cap = useWindowDimensions().width < 350 ? OLI_FONT_CAP_NARROW : OLI_FONT_CAP
  const title = t('homeOliTitle', lang)
  const sub = t('hrOliAskSub', lang)
  return (
    <TouchableOpacity ref={barRef} collapsable={false} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} style={s.bar}>
      <View style={s.text}>
        <Ionicons name="chatbubble-ellipses" size={22} color={colors.onPrimary} />
        <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={cap}>{title}</Text>
        <Text style={s.sub} numberOfLines={2} maxFontSizeMultiplier={cap}>{sub}</Text>
      </View>
      <SceneCarousel active={active} />
    </TouchableOpacity>
  )
}

const INSET = 6
const s = StyleSheet.create({
  bar:   { height: OLI_BAR_H, borderRadius: radii.widget, backgroundColor: colors.primary,
           flexDirection: 'row', padding: INSET, overflow: 'hidden' },
  text:  { width: OLI_TEXT_W - INSET, paddingLeft: 10, justifyContent: 'center', gap: 2 },
  title: { ...type.sectionHeading, fontSize: 17, lineHeight: 22, color: colors.onPrimary, marginTop: 2 },
  sub:   { ...type.meta, fontFamily: 'Inter_500Medium', color: colors.onPrimary },
  panel: { flex: 1, borderRadius: radii.card, backgroundColor: colors.card, overflow: 'hidden' },
  scene: { position: 'absolute', top: 6, bottom: 12, left: 6, right: 6, width: undefined, height: undefined },
  dots:  { position: 'absolute', bottom: 5, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot:   { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(26,43,51,0.18)' },
  dotOn: { backgroundColor: colors.primary, width: 10 },
})
