import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, TouchableOpacity, StyleSheet, AppState, AccessibilityInfo, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, radii, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'

// ─── The Oli bar, "full scene" (Home v3, option B) ───────────────────────────
// One card; the rotating Oli & Maki scene fills it, the text sits on a deep-teal fade on the
// left, and the whole card opens the Oli sheet (search lives there, unchanged).
//
// SCENES are the 1080px originals, trimmed to the art and exported 300px tall. They are
// cut-outs, so each scene = its own soft ground + the art, framed in the RIGHT 40% of the
// card: right-anchored, feet on the bottom edge, scaled down only if it would be wider than
// that zone. No scene needs cropping, so none is dropped. Exchange (no module) and insurance
// (dark, and no 1080px original) are left out: a scene is a quiet promise of a feature.
//
// ─── THE FADE CARRIES THE CONTRAST, SO THE TEXT MUST STAY ON ITS SOLID PART ─
// FADE_COLOR at FADE_ALPHA is solid to FADE_HOLD of the width, then a smoothstep ramp
// (assets/oli-scenes/fade-ramp.png) reaches 0 at FADE_END. Over a PURE WHITE pixel — the
// bound for every scene — white text is 8.66:1 on the fade and 5.68:1 on the glass pill
// (white 16% on top). check-hero-contrast reads these constants; labels:check proves the
// title and the pill end inside the solid part (TEXT_LEFT … FADE_HOLD·width) in 9 locales.
// primaryDark (#0A5E5D) gave the pill only 4.67:1 — too thin a margin — hence the deeper teal.
//
// Motion: 4s per scene, 600ms crossfade, a 1.00 → 1.05 zoom on the art. PAUSES when scrolled
// away (`active`), in the background, and never starts under Reduce Motion (one still scene).
export const OLI_BAR_H = 110
export const FADE_COLOR = '#084B4A'
export const FADE_ALPHA = 0.95
export const FADE_HOLD = 0.56
export const FADE_END = 0.62
export const ART_ZONE = 0.4
export const TEXT_LEFT = 16
export const PILL_PAD = 10
export const OLI_FONT_CAP = 1.1
export const OLI_FONT_CAP_NARROW = 1.0
const rgba = (hex, a) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`
const PAGE = 16   // HomeScreen rBelow paddingHorizontal: the card is window − 2·16 wide

const SCENES = [
  { src: require('../../../assets/oli-scenes/welcome.png'),       bg: category.city.bg },
  { src: require('../../../assets/oli-scenes/health.png'),        bg: category.health.bg },
  { src: require('../../../assets/oli-scenes/emergency.png'),     bg: category.health.bg },
  { src: require('../../../assets/oli-scenes/events.png'),        bg: category.explore.bg },
  { src: require('../../../assets/oli-scenes/accommodation.png'), bg: category.homeLife.bg },
  { src: require('../../../assets/oli-scenes/services.png'),      bg: category.homeLife.bg },
  { src: require('../../../assets/oli-scenes/pets.png'),          bg: colors.primaryLight },
]
const RAMP = require('../../../assets/oli-scenes/fade-ramp.png')
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

// Right-anchored in the art zone, feet on the bottom edge, never wider than the zone.
function frame(src, cardW) {
  const { width, height } = Image.resolveAssetSource(src)
  const aspect = width / height
  const maxW = cardW * ART_ZONE - 10
  const h = Math.min(OLI_BAR_H - 6, maxW / aspect)
  return { position: 'absolute', right: 10, bottom: 0, height: h, width: h * aspect }
}

export default function OliBar({ lang, onPress, active = true, barRef }) {
  const { width: winW } = useWindowDimensions()
  const cardW = winW - PAGE * 2
  const cap = winW < 350 ? OLI_FONT_CAP_NARROW : OLI_FONT_CAP
  const reduce = useReduceMotion()
  const fg = useForeground()
  const running = active && fg && !reduce
  const [idx, setIdx] = useState(0)
  const opacity = useRef(SCENES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current
  const scale = useRef(SCENES.map(() => new Animated.Value(1))).current

  useEffect(() => {
    if (!running) return
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

  const title = t('hrOliBarTitle', lang)
  const pill = t('hrOliAskSub', lang)
  return (
    <TouchableOpacity ref={barRef} collapsable={false} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={`${title}. ${pill}`} style={s.card}>
      {SCENES.map((sc, i) => (
        <Animated.View key={i} pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: sc.bg, opacity: opacity[i] }]}>
          <Animated.Image source={sc.src} resizeMode="contain" accessibilityIgnoresInvertColors
            style={[frame(sc.src, cardW), { transform: [{ scale: scale[i] }] }]} />
        </Animated.View>
      ))}

      <View pointerEvents="none" style={[s.fadeSolid, { width: `${FADE_HOLD * 100}%` }]} />
      <Image source={RAMP} resizeMode="stretch" pointerEvents="none"
        style={[s.fadeRamp, { left: `${FADE_HOLD * 100}%`, width: `${(FADE_END - FADE_HOLD) * 100}%` }]} />

      <View style={[s.text, { width: `${FADE_HOLD * 100}%` }]} pointerEvents="none">
        <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={cap}>{title}</Text>
        <View style={s.pill}>
          <Text style={s.pillText} numberOfLines={1} maxFontSizeMultiplier={cap}>{pill}</Text>
          <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
        </View>
      </View>

      {!reduce && (
        <View style={s.dots} pointerEvents="none">
          {SCENES.map((_, i) => <View key={i} style={[s.dot, i === idx && s.dotOn]} />)}
        </View>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:      { height: OLI_BAR_H, borderRadius: radii.widget, overflow: 'hidden', backgroundColor: colors.primaryLight },
  fadeSolid: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: rgba(FADE_COLOR, FADE_ALPHA) },
  fadeRamp:  { position: 'absolute', top: 0, bottom: 0, height: '100%' },
  text:      { position: 'absolute', top: 0, bottom: 0, left: 0, paddingLeft: TEXT_LEFT, justifyContent: 'center', gap: 10 },
  title:     { fontSize: 20, lineHeight: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  pill:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
               paddingHorizontal: PILL_PAD, paddingVertical: 6, borderRadius: radii.pill,
               backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  pillText:  { fontSize: 13, lineHeight: 17, fontFamily: 'Inter_500Medium', color: '#FFFFFF', flexShrink: 1 },
  dots:      { position: 'absolute', right: 12, bottom: 8, flexDirection: 'row', gap: 3, paddingHorizontal: 5,
               paddingVertical: 4, borderRadius: radii.pill, backgroundColor: rgba(FADE_COLOR, 0.45) },
  dot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn:     { width: 9, backgroundColor: '#FFFFFF' },
})
