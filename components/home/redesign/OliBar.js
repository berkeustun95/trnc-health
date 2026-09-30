import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, TouchableOpacity, StyleSheet, AppState, AccessibilityInfo, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { radii, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'

// ─── The Oli bar, "full scene" (Home v3, option B) ───────────────────────────
// One card; the rotating Oli & Maki scene fills it, the text sits on a deep-teal fade on the
// left, and the whole card opens the Oli sheet (search lives there, unchanged).
//
// ONE shared ground for every scene: a long horizontal gradient from BG_DARK (left, under
// the text) to BG_LIGHT (right, under the mascots), eased as t^BG_EASE so the left stays deep
// where the text is, plus a soft radial glow behind the art. No per-scene tints and no seam:
// only the mascot cut-outs crossfade. Both are bundled PNGs (assets/oli-scenes/oli-bg.png,
// oli-glow.png) — no gradient library in this app — generated from these constants.
//
// The art is the 1080px originals, trimmed and exported 300px tall; welcome/services/pets
// were opaque white and are cut out (edge flood fill, feathered). Framed in the RIGHT 40%:
// right-anchored, feet on the bottom edge, scaled down only if wider than that zone. No scene
// is cropped, none is dropped. Exchange and insurance are left out (no live module).
//
// ─── CONTRAST ────────────────────────────────────────────────────────────────
// The title and the glass pill sit in TEXT_ZONE (labels:check proves every locale ends
// inside it). check-hero-contrast renders the real bg + glow PNGs at 320/360/393dp and takes
// the BRIGHTEST pixel in that zone: title and pill (white 16% on top) must clear 4.5:1 there.
// Motion: 4s per scene, 600ms crossfade, a 1.00 → 1.05 zoom on the art. PAUSES when scrolled
// away (`active`), in the background, and never starts under Reduce Motion (one still scene).
export const OLI_BAR_H = 110
export const BG_DARK = '#084B4A'
export const BG_LIGHT = '#58B5AE'
export const BG_EASE = 2.5
export const TEXT_ZONE = 0.56
export const ART_ZONE = 0.4
export const GLOW_SIZE = 130
export const GLOW_CX = 0.8   // glow centre, as a fraction of the card width
export const GLOW_CY = 0.6   // … and of its height
export const TEXT_LEFT = 16
export const PILL_PAD = 10
export const OLI_FONT_CAP = 1.1
export const OLI_FONT_CAP_NARROW = 1.0
const rgba = (hex, a) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`
const PAGE = 16   // HomeScreen rBelow paddingHorizontal: the card is window − 2·16 wide

const SCENES = [
  require('../../../assets/oli-scenes/welcome.png'),
  require('../../../assets/oli-scenes/health.png'),
  require('../../../assets/oli-scenes/emergency.png'),
  require('../../../assets/oli-scenes/events.png'),
  require('../../../assets/oli-scenes/accommodation.png'),
  require('../../../assets/oli-scenes/services.png'),
  require('../../../assets/oli-scenes/pets.png'),
]
const BG = require('../../../assets/oli-scenes/oli-bg.png')
const GLOW = require('../../../assets/oli-scenes/oli-glow.png')
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
      <Image source={BG} resizeMode="stretch" pointerEvents="none" style={s.fill} />
      <Image source={GLOW} pointerEvents="none" style={[s.glow, {
        left: cardW * GLOW_CX - GLOW_SIZE / 2, top: OLI_BAR_H * GLOW_CY - GLOW_SIZE / 2 }]} />
      {SCENES.map((src, i) => (
        <Animated.Image key={i} source={src} resizeMode="contain" accessibilityIgnoresInvertColors pointerEvents="none"
          style={[frame(src, cardW), { opacity: opacity[i], transform: [{ scale: scale[i] }] }]} />
      ))}

      <View style={[s.text, { width: `${TEXT_ZONE * 100}%` }]} pointerEvents="none">
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
  card:      { height: OLI_BAR_H, borderRadius: radii.widget, overflow: 'hidden', backgroundColor: BG_DARK },
  fill:      { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  glow:      { position: 'absolute', width: GLOW_SIZE, height: GLOW_SIZE },
  text:      { position: 'absolute', top: 0, bottom: 0, left: 0, paddingLeft: TEXT_LEFT, justifyContent: 'center', gap: 10 },
  title:     { fontSize: 20, lineHeight: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  pill:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
               paddingHorizontal: PILL_PAD, paddingVertical: 6, borderRadius: radii.pill,
               backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  pillText:  { fontSize: 13, lineHeight: 17, fontFamily: 'Inter_500Medium', color: '#FFFFFF', flexShrink: 1 },
  dots:      { position: 'absolute', right: 12, bottom: 8, flexDirection: 'row', gap: 3, paddingHorizontal: 5,
               paddingVertical: 4, borderRadius: radii.pill, backgroundColor: rgba(BG_DARK, 0.45) },
  dot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn:     { width: 9, backgroundColor: '#FFFFFF' },
})
