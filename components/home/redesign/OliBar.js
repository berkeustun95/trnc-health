import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { haptic } from '../../ui/haptics'
import { radii, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import useReduceMotion from '../../ui/useReduceMotion'
import useForeground from '../../ui/useForeground'
import { useHomeLab } from '../../../constants/homeLab'
import { OLI_GLOW_TINT } from '../../../constants/dayParts'
import useDayPart from './useDayPart'

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
// Scene dots: a VERTICAL column in the strip between the text zone (ends at TEXT_ZONE) and the
// art (starts at ≥ 1 − ART_ZONE: right-anchored, never wider than the zone), so they can never
// overlap the mascots on any scene. check-hero-contrast asserts the strip and the dots' contrast.
export const DOTS_X = 0.58   // column centre, as a fraction of the card width
export const DOT = 4
export const DOT_ON = 9
export const DOTS_BOTTOM = 12
export const DOT_ALPHA = 0.65   // inactive dot: white at this opacity
export const TEXT_LEFT = 16
export const PILL_PAD = 10
export const OLI_FONT_CAP = 1.1
export const OLI_FONT_CAP_NARROW = 1.0
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
// Oli companion (Home lab B, only when useHomeLab().oli): a calmer carousel and one small gesture per hold.
const HOLD_IDLE = 6000
const GESTURE_AT = 2500
const HOP_PX = 4
const WIGGLE_DEG = 1.5
const CHEER_PX = 5
const EVENTS_SCENE = 3          // SCENES index of events.png
const QUIET_SCENES = [1, 2]     // health, emergency: no idle gesture (off-tone for safety modules)
const FADE = 600
const ZOOM = 1.05

// Right-anchored in the art zone, feet on the bottom edge, never wider than the zone.
function frame(src, cardW) {
  const { width, height } = Image.resolveAssetSource(src)
  const aspect = width / height
  const maxW = cardW * ART_ZONE - 10
  const h = Math.min(OLI_BAR_H - 6, maxW / aspect)
  return { position: 'absolute', right: 10, bottom: 0, height: h, width: h * aspect }   // h = art height (the wiggle pivots at the feet)
}

// Literal t('…') calls on purpose: scripts/validate-i18n-coverage.mjs only sees literal keys, and a
// t(pillKey, lang) would drop hrOliAskSub and the five hrOliCtx* keys out of coverage. Keep in step
// with OLI_PILL_KEYS (constants/oliContext.js).
const PILL_TEXT = {
  hrOliAskSub: l => t('hrOliAskSub', l),
  hrOliCtxEventTonight: l => t('hrOliCtxEventTonight', l),
  hrOliCtxRain: l => t('hrOliCtxRain', l),
  hrOliCtxMorning: l => t('hrOliCtxMorning', l),
  hrOliCtxEvening: l => t('hrOliCtxEvening', l),
  hrOliCtxNight: l => t('hrOliCtxNight', l),
}

export default function OliBar({ lang, onPress, active = true, barRef, pillKey, cheer }) {
  const { width: winW } = useWindowDimensions()
  const cardW = winW - PAGE * 2
  const cap = winW < 350 ? OLI_FONT_CAP_NARROW : OLI_FONT_CAP
  const reduce = useReduceMotion()
  const fg = useForeground()
  const lab = useHomeLab()
  const part = useDayPart(lab.daylight)
  const running = active && fg && !reduce
  const HOLD_MS = lab.oli ? HOLD_IDLE : HOLD
  // An event tonight on the pill: start on the events scene (only when the companion is on).
  const startIdx = useRef(lab.oli && pillKey === 'hrOliCtxEventTonight' ? EVENTS_SCENE : 0).current
  const [idx, setIdx] = useState(startIdx)
  const opacity = useRef(SCENES.map((_, i) => new Animated.Value(i === startIdx ? 1 : 0))).current
  const scale = useRef(SCENES.map(() => new Animated.Value(1))).current
  const hop = useRef(new Animated.Value(0)).current    // translateY, shared by the (stacked) art
  const wig = useRef(new Animated.Value(0)).current    // rotate, in degrees
  const gestureNo = useRef(0)

  useEffect(() => {
    if (!running) return
    const zoom = Animated.timing(scale[idx], { toValue: ZOOM, duration: HOLD_MS + FADE, useNativeDriver: true })
    zoom.start()
    const timer = setTimeout(() => {
      const next = (idx + 1) % SCENES.length
      scale[next].setValue(1)
      Animated.parallel([
        Animated.timing(opacity[idx], { toValue: 0, duration: FADE, useNativeDriver: true }),
        Animated.timing(opacity[next], { toValue: 1, duration: FADE, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setIdx(next) })
    }, HOLD_MS)
    return () => { clearTimeout(timer); zoom.stop() }
  }, [running, idx, HOLD_MS])

  // Idle life: once per hold, ~2.5 s in, ONE gesture — alternating a hop and a wiggle. `running`
  // already excludes off-screen, background and Reduce Motion; cleanup stops it mid-flight.
  useEffect(() => {
    if (!lab.oli || !running || QUIET_SCENES.includes(idx)) return
    let anim = null
    const timer = setTimeout(() => {
      const hopNow = gestureNo.current++ % 2 === 0
      anim = hopNow
        ? Animated.sequence([
            Animated.timing(hop, { toValue: -HOP_PX, duration: 190, useNativeDriver: true }),
            Animated.timing(hop, { toValue: 0, duration: 190, useNativeDriver: true }),
          ])
        : Animated.sequence([
            Animated.timing(wig, { toValue: -WIGGLE_DEG, duration: 125, useNativeDriver: true }),
            Animated.timing(wig, { toValue: WIGGLE_DEG, duration: 250, useNativeDriver: true }),
            Animated.timing(wig, { toValue: 0, duration: 125, useNativeDriver: true }),
          ])
      anim.start()
    }, GESTURE_AT)
    return () => { clearTimeout(timer); anim?.stop(); hop.setValue(0); wig.setValue(0) }
  }, [lab.oli, running, idx])

  // Pull-to-refresh moment: HomeScreen bumps `cheer` (undefined while off). One spring hop + a light
  // haptic; the haptic is fine under Reduce Motion, the hop is not. Never on mount.
  const lastCheer = useRef(cheer)
  useEffect(() => {
    const prev = lastCheer.current
    lastCheer.current = cheer
    // only a real increase from a numeric value (the dev toggle flipping undefined -> 0 is not a refresh)
    if (!lab.oli || typeof cheer !== 'number' || typeof prev !== 'number' || cheer <= prev) return
    haptic()
    if (reduce) return
    const anim = Animated.sequence([
      Animated.timing(hop, { toValue: -CHEER_PX, duration: 140, useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 7, tension: 180, overshootClamping: true, useNativeDriver: true }),
    ])
    anim.start()
    return () => { anim.stop(); hop.setValue(0) }
  }, [cheer])

  const title = t('hrOliBarTitle', lang)
  const pill = (PILL_TEXT[pillKey] || PILL_TEXT.hrOliAskSub)(lang)
  return (
    <TouchableOpacity ref={barRef} collapsable={false}
      onPress={lab.oli ? () => { haptic(); onPress?.() } : onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={`${title}. ${pill}`} style={s.card}>
      <Image source={BG} resizeMode="stretch" pointerEvents="none" style={s.fill} />
      <Image source={GLOW} pointerEvents="none" style={[s.glow, {
        left: cardW * GLOW_CX - GLOW_SIZE / 2, top: OLI_BAR_H * GLOW_CY - GLOW_SIZE / 2 }]}
        {...(lab.daylight ? { tintColor: OLI_GLOW_TINT[part] } : null)} />
      {SCENES.map((src, i) => {
        const fr = frame(src, cardW)
        return (
          <Animated.Image key={i} source={src} resizeMode="contain" accessibilityIgnoresInvertColors pointerEvents="none"
            style={[fr, { opacity: opacity[i], transform: lab.oli
            ? [{ translateY: hop }, { translateY: fr.height / 2 }, { rotate: wig.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) }, { translateY: -fr.height / 2 }, { scale: scale[i] }]
            : [{ scale: scale[i] }] }]} />
        )
      })}

      <View style={[s.text, { width: `${TEXT_ZONE * 100}%` }]} pointerEvents="none">
        <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={cap}>{title}</Text>
        <View style={s.pill}>
          <Text style={s.pillText} numberOfLines={1} maxFontSizeMultiplier={cap}>{pill}</Text>
          <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
        </View>
      </View>

      {!reduce && (
        <View style={[s.dots, { left: cardW * DOTS_X - DOT / 2 }]} pointerEvents="none">
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
  dots:      { position: 'absolute', bottom: DOTS_BOTTOM, width: DOT, flexDirection: 'column', gap: 3 },
  dot:       { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: `rgba(255,255,255,${DOT_ALPHA})` },
  dotOn:     { height: DOT_ON, backgroundColor: '#FFFFFF' },
})
