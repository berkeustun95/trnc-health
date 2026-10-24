import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, Easing, StyleSheet, Platform, AccessibilityInfo, useWindowDimensions } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── Boot splash: "the compass gate" (Berke, 2026-10-24) ─────────────────────
//
// The emblem grows, its compass opens into a round gate, Oli & Maki rush up the tunnel
// and burst out over the rim. One native-driven clock (0 → END ms) feeds every layer
// through keyframed interpolations, so the whole scene runs on the UI thread and the
// timeline below reads as one table. Built-in Animated + PNGs only: no shipped binary
// has Reanimated or react-native-svg.
//
// Colours outside theme tokens are from Berke's brief: canvas #F4FBFA, disc #E1F2F0,
// tunnel #9FD8D3. They live here, once.

const BG = '#F4FBFA'
const DISC = '#E1F2F0'
const TEAL = '#0E7C7B'
const TEAL_DARK = '#0A5E5D'
const TEAL_MID = '#3AA3A1'
const TUNNEL_LIGHT = '#9FD8D3'

const EMBLEM_BASE = require('../assets/splash/emblem-base.png')
const EMBLEM_ROSE = require('../assets/splash/emblem-rose.png')
const GATE_ROSE = require('../assets/splash/gate-rose.png')
const WORDMARK = require('../assets/splash/wordmark.png')
const OLI = require('../assets/splash/oli-burst.png')
const MAKI = require('../assets/splash/maki-burst.png')

// The emblem is drawn at the native splash size (dp, unscaled) so frame 1 matches it.
// Its compass centre sits at these fractions of the emblem box (from ada-emblem.svg:
// circle cx 511.5 cy 377 in viewBox 311.5 194.2 439.8 386).
const EMBLEM_W = 128
const EMBLEM_H = 128 * 386 / 439.8
const ROSE_FX = 0.4548
const ROSE_FY = 0.4736
const ROSE_W = 30.9

// Scene end, and when the splash may leave: never before the last beat lands, never
// later than the cap even if the app is still not ready.
const END = 2700
const EXIT_MIN = 2750
const EXIT_MAX = 3000
const EXIT_FADE = 250
// The spill-over copies are clipped this far below the gate centre (see Mascot).
const CLIP_LINE = 75

// ─── Which first frame ──────────────────────────────────────────────────────
// A binary with expo-splash-screen has the new native splash (emblem in the Ø184 disc),
// so frame 1 is exactly that. Every binary shipped before it shows the OLD native splash,
// so frame 1 copies that and cross-fades out of it ("morph", Berke 2026-10-23).
const devPath = __DEV__ ? process.env.EXPO_PUBLIC_SPLASH_PATH : undefined
export const NEW_NATIVE = devPath ? devPath === 'native' : !!requireOptionalNativeModule('ExpoSplashScreen')
const IS_PREVIEW = Constants.expoConfig?.extra?.appVariant === 'preview'

// Old Android 12+ native frame: the adaptive-icon foreground, centred on white. Measured
// on SM-G985F / Android 13 (2026-10-24): the 1024 px foreground draws 264 dp wide, centre
// 11 dp below the window centre. A bridge-period number from one device; it goes away
// with the native stage.
const MORPH_ANDROID_W = 264
const MORPH_ANDROID_DY = 11
const MORPH_IMAGE = Platform.OS === 'ios'
  ? require('../assets/splash/morph-ios.png')
  : IS_PREVIEW ? require('../assets/splash/morph-android-preview.png') : require('../assets/splash/morph-android.png')

// The old native splash, redrawn so the first JS frame matches it; fades out by `opacity`.
export function MorphFrame({ opacity, W, cx, cy }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity }]}>
      {Platform.OS === 'ios'
        ? <Image source={MORPH_IMAGE} fadeDuration={0} resizeMode="contain" style={{ position: 'absolute', left: 0, top: cy - W / 2, width: W, height: W }} />
        : <Image source={MORPH_IMAGE} fadeDuration={0} style={{ position: 'absolute', left: cx - MORPH_ANDROID_W / 2, top: cy + MORPH_ANDROID_DY - MORPH_ANDROID_W / 2, width: MORPH_ANDROID_W, height: MORPH_ANDROID_W }} />}
    </Animated.View>
  )
}

export function useReduceMotion() {
  const [on, setOn] = useState(null)
  useEffect(() => {
    let alive = true
    // Undecided after 100 ms = animate; never start animating and then snap.
    const timer = setTimeout(() => { if (alive) setOn(v => v ?? false) }, 100)
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setOn(prev => prev ?? v) }).catch(() => {})
    return () => { alive = false; clearTimeout(timer) }
  }, [])
  return on
}

// Each mascot is drawn twice with the same transform: once clipped to the gate hole,
// once clipped to a rectangle that ends CLIP_LINE pt below the gate centre. Above that line
// they spill over the rim; below it only the hole shows them, so the cut-off bottom of
// the art never appears outside the gate.
function Mascot({ m, ox, oy, opacity }) {
  return (
    <Animated.Image
      source={m.src}
      fadeDuration={0}
      style={[
        { position: 'absolute', left: ox + m.left, top: oy + m.top, width: m.w, height: m.h, transformOrigin: '50% 100%' },
        m.style,
        opacity ? { opacity: Animated.multiply(m.style.opacity, opacity) } : null,
      ]}
    />
  )
}

const kf = (clock, frames, ease) => clock.interpolate({
  inputRange: frames.map(f => f[0]),
  outputRange: frames.map(f => f[1]),
  extrapolate: 'clamp',
  ...(ease ? { easing: ease } : null),
})
const deg = (clock, frames) => kf(clock, frames.map(([ms, d]) => [ms, `${d}deg`]))

export default function BootSplash({ ready, lang, fontsLoaded, onDone }) {
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduce = useReduceMotion()
  const clock = useRef(new Animated.Value(0)).current
  const scene = useRef(new Animated.Value(1)).current
  const exit = useRef(new Animated.Value(1)).current
  const startedAt = useRef(null)
  const readyAt = useRef(null)
  const [laidOut, setLaidOut] = useState(false)
  const [emblemLoaded, setEmblemLoaded] = useState(false)

  useEffect(() => {
    if (!laidOut || !emblemLoaded || reduce === null || startedAt.current != null) return
    startedAt.current = Date.now()
    if (reduce) {
      clock.setValue(END)
      scene.setValue(0)
      Animated.timing(scene, { toValue: 1, duration: 300, useNativeDriver: true }).start()
    } else {
      Animated.timing(clock, { toValue: END, duration: END, easing: Easing.linear, useNativeDriver: true }).start()
    }
  }, [laidOut, emblemLoaded, reduce])

  useEffect(() => {
    if (ready && readyAt.current == null) readyAt.current = Date.now()
  }, [ready])

  useEffect(() => {
    if (startedAt.current == null) return
    const elapsed = Date.now() - startedAt.current
    const sinceStart = readyAt.current == null ? Infinity : readyAt.current - startedAt.current
    const at = Math.min(EXIT_MAX, Math.max(EXIT_MIN, sinceStart))
    const timer = setTimeout(() => {
      Animated.timing(exit, { toValue: 0, duration: EXIT_FADE, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(() => onDone?.())
    }, Math.max(0, at - elapsed))
    return () => clearTimeout(timer)
  }, [ready, laidOut, emblemLoaded, reduce])

  const s = Math.max(0.85, Math.min(1.1, Math.min(W / 390, H / 844)))
  const cx = W / 2
  const cy = H / 2
  const GATE = 280 * s
  const DIAL = 296 * s

  // ─── Timeline (ms) ─────────────────────────────────────────────────────────
  //   0      emblem in the disc (= native frame); morph: old frame fades out 80–380
  //   400    emblem grows; 650 zoom into the compass, which opens into a SMALL gate
  //   950    Oli's ears poke out; 1150 his head squeezes in and sticks, the hole rubbers
  //          around it while he wiggles
  //   1550   Maki squeezes in beside him; both stuck, little shakes
  //   1900   POP: the hole snaps wide, both burst out (squash → stretch → overshoot →
  //          settle), shockwave
  //   2150   lean + bob, wordmark + tagline; 2300 "Merhaba!" — landed by 2500, held to the exit
  const emblemScale = kf(clock, [[0, 1], [400, 1], [525, 1.6], [650, 1.85], [775, 2.6], [900, 4.4]])
  const emblemOpacity = kf(clock, [[0, 1], [650, 1], [750, 0.6], [900, 0]])
  const discOpacity = kf(clock, [[0, 1], [400, 1], [650, 0]])
  const discScale = kf(clock, [[0, 1], [400, 1], [650, 1.4]])
  const gateOpacity = kf(clock, [[0, 0], [650, 0], [750, 1]])
  // The hole: small, then rubber. X and Y move apart while the heads push on it.
  const gateX = kf(clock, [[0, 0.1], [650, 0.1], [820, 0.36], [900, 0.32], [1150, 0.32], [1220, 0.4], [1300, 0.36], [1375, 0.41], [1450, 0.35], [1525, 0.4], [1600, 0.36], [1700, 0.56], [1750, 0.53], [1800, 0.57], [1850, 0.54], [1900, 0.55], [1980, 1.12], [2080, 0.97], [2180, 1.01], [2260, 1]])
  const gateY = kf(clock, [[0, 0.1], [650, 0.1], [820, 0.36], [900, 0.32], [1150, 0.32], [1220, 0.28], [1300, 0.31], [1375, 0.29], [1450, 0.32], [1525, 0.29], [1600, 0.31], [1700, 0.33], [1750, 0.35], [1800, 0.32], [1850, 0.34], [1900, 0.33], [1980, 1.08], [2080, 0.98], [2180, 1], [2260, 1]])
  const unGateX = Animated.divide(1, gateX)
  const unGateY = Animated.divide(1, gateY)
  const dialRotate = deg(clock, [[0, 0], [650, 0], [900, 180], [END, 290]])
  const tunnelScale = kf(clock, [[0, 1], [1950, 1], [2150, 1.06], [2350, 1]])
  const roseOpacity = kf(clock, [[0, 0], [650, 0], [720, 1], [900, 1], [1100, 0]])
  const roseRotate = deg(clock, [[0, 0], [650, 0], [900, 300], [1100, 540]])
  const shockOpacity = kf(clock, [[0, 0], [1890, 0], [1910, 0.9], [2300, 0]])
  const shockScale = kf(clock, [[0, 1], [1900, 1], [2300, 1.5]])
  // The spill-over clip line sits at the hole's centre while they are stuck (only ears and
  // the top of a head get past the rim), and drops to CLIP_LINE at the POP.
  const lineShift = kf(clock, [[0, -CLIP_LINE * s], [1900, -CLIP_LINE * s], [1960, 0]])
  const unLineShift = Animated.multiply(lineShift, -1)
  const wordOpacity = kf(clock, [[0, 0], [2150, 0], [2450, 1]])
  const wordY = kf(clock, [[0, -14], [2150, -14], [2450, 0]])
  const bubbleOpacity = kf(clock, [[0, 0], [2300, 0], [2400, 1]])
  const bubbleScale = kf(clock, [[0, 0.4], [2300, 0.4], [2400, 1.08], [2500, 1]])
  const morphOpacity = kf(clock, [[0, 1], [80, 1], [380, 0]])

  // Mascot geometry at s = 1, relative to the gate centre. Each scales from its bottom
  // centre; `headAt(target, k)` is the translation that puts the head on `target` at scale k.
  const mascot = (src, aspect, box, head) => {
    const w = box.w * s
    const h = w / aspect
    const bx = box.x * s + w / 2
    const by = box.y * s + h
    const hx = box.x * s + head.fx * w
    const hy = box.y * s + head.fy * h
    const headAt = (tx, ty, k) => ({ x: tx * s - (bx + k * (hx - bx)), y: ty * s - (by + k * (hy - by)) })
    return { src, w, h, left: box.x * s, top: box.y * s, headAt }
  }
  // Positions are solved, not eyeballed: at the final pose no pixel of Oli's ring-cut edge
  // lands outside the hole above the clip line, and no pixel of either body lands outside
  // the hole below it (so nothing is sliced). Re-solve if the art or the gate size changes.
  const oliM = mascot(OLI, 1867 / 1603, { x: -136, y: -188, w: 260 }, { fx: 0.5, fy: 0.4 })
  const makiM = mascot(MAKI, 1963 / 1394, { x: -45, y: -195, w: 250 }, { fx: 0.66, fy: 0.24 })

  const OK = 0.85   // Oli's scale while stuck
  const deep = oliM.headAt(0, 130, OK), ears = oliM.headAt(0, 60, OK), stuck = oliM.headAt(0, 4, OK), side = oliM.headAt(-34, 4, OK)
  const oli = {
    ...oliM,
    style: {
      opacity: kf(clock, [[0, 0], [950, 0], [1000, 1]]),
      transform: [
        { translateX: kf(clock, [[0, deep.x], [1150, ears.x], [1250, stuck.x], [1300, stuck.x], [1375, stuck.x + 6 * s], [1450, stuck.x - 6 * s], [1525, stuck.x + 6 * s], [1600, stuck.x], [1700, side.x], [1750, side.x - 3 * s], [1800, side.x + 3 * s], [1850, side.x - 3 * s], [1900, side.x], [2000, 0]]) },
        { translateY: kf(clock, [[0, deep.y], [950, deep.y], [1100, ears.y], [1150, ears.y], [1250, stuck.y], [1600, stuck.y], [1700, side.y], [1900, side.y], [2000, 0], [2400, -4 * s], [2550, 0]]) },
        { scaleX: kf(clock, [[0, OK], [1150, OK], [1200, OK * 0.92], [1250, OK * 1.04], [1300, OK], [1900, OK], [1960, 1.12], [2060, 0.9], [2160, 1.03], [2260, 1]]) },
        { scaleY: kf(clock, [[0, OK], [1150, OK], [1200, OK * 1.1], [1250, OK * 0.94], [1300, OK], [1900, OK], [1960, 0.82], [2060, 1.16], [2160, 0.97], [2260, 1], [2400, 1.02], [2550, 1]]) },
        { rotate: deg(clock, [[0, 0], [1300, 0], [1375, 4], [1450, -4], [1525, 4], [1600, 0], [1750, -3], [1800, 3], [1850, -3], [1900, 0], [2000, -9], [2150, -6], [2350, -10], [2550, -3], [END, -6]]) },
      ],
    },
  }
  const MK = 0.75   // Maki's scale while stuck
  const behind = makiM.headAt(40, 40, 0.55), beside = makiM.headAt(40, 2, MK)
  const maki = {
    ...makiM,
    style: {
      opacity: kf(clock, [[0, 0], [1550, 0], [1600, 1]]),
      transform: [
        { translateX: kf(clock, [[0, behind.x], [1550, behind.x], [1700, beside.x], [1750, beside.x + 3 * s], [1800, beside.x - 3 * s], [1850, beside.x + 3 * s], [1900, beside.x], [2040, 0]]) },
        { translateY: kf(clock, [[0, behind.y], [1550, behind.y], [1700, beside.y], [1900, beside.y], [2040, 0], [2440, -4 * s], [2590, 0]]) },
        { scaleX: kf(clock, [[0, 0.55], [1550, 0.55], [1700, MK], [1900, MK], [1990, 1.12], [2100, 0.9], [2200, 1.03], [2300, 1]]) },
        { scaleY: kf(clock, [[0, 0.55], [1550, 0.55], [1650, MK * 1.08], [1700, MK], [1900, MK], [1990, 0.82], [2100, 1.16], [2200, 0.97], [2300, 1], [2440, 1.02], [2590, 1]]) },
        { rotate: deg(clock, [[0, 0], [1700, 0], [1750, 3], [1800, -3], [1850, 3], [1900, 0], [2040, 9], [2190, 6], [2390, 10], [2590, 3], [END, 6]]) },
      ],
    },
  }
  // While stuck, Maki is only seen through the hole; his outstretched arms would otherwise
  // spill past the rim beside his head.
  const makiSpill = kf(clock, [[0, 0], [1960, 0], [2010, 1]])
  // Oli's ears splay outwards: rising through the hole their tips would cross the rim
  // detached from the rest of the ear, so he spills over only once his head squeezes up.
  const oliSpill = kf(clock, [[0, 0], [1180, 0], [1210, 1]])

  const lineY = cy + CLIP_LINE * s
  const wordTop = Math.max(insets.top + 24, cy - 398 * s)

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: BG, opacity: exit }]}
      onLayout={() => setLaidOut(true)}
      accessible
      accessibilityLabel="ADA"
      importantForAccessibility="yes"
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: emblemLoaded ? scene : 0 }]} importantForAccessibility="no-hide-descendants">
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: wordTop, alignItems: 'center', opacity: wordOpacity, transform: [{ translateY: wordY }] }}>
          <Image source={WORDMARK} fadeDuration={0} style={{ width: 190 * s, height: 190 * s * 184 / 570 }} resizeMode="contain" />
          {fontsLoaded && (
            <Text style={[styles.tagline, { fontSize: 17 * s }]} maxFontSizeMultiplier={1.15} numberOfLines={1}>
              {t('splashTagline', lang)}
            </Text>
          )}
        </Animated.View>

        <Animated.View style={[styles.circle, { left: cx - 92, top: cy - 92, width: 184, height: 184, backgroundColor: DISC, opacity: discOpacity, transform: [{ scale: discScale }] }]} />

        <Animated.View style={[styles.circle, { left: cx - GATE / 2, top: cy - GATE / 2, width: GATE, height: GATE, borderWidth: 5 * s, borderColor: TEAL_MID, opacity: shockOpacity, transform: [{ scale: shockScale }] }]} />

        <Animated.View style={{ position: 'absolute', left: cx - DIAL / 2, top: cy - DIAL / 2, width: DIAL, height: DIAL, opacity: gateOpacity, transform: [{ scaleX: gateX }, { scaleY: gateY }] }}>
          <Animated.View style={{ width: DIAL, height: DIAL, transform: [{ rotate: dialRotate }] }}>
            <View style={[styles.circle, { left: 0, top: 0, width: DIAL, height: DIAL, borderWidth: 8 * s, borderColor: TEAL }]} />
            <View style={[styles.circle, { left: 12 * s, top: 12 * s, width: DIAL - 24 * s, height: DIAL - 24 * s, borderWidth: 2 * s, borderColor: '#FFFFFF' }]} />
            {[0, 90, 180, 270].map(a => (
              <View key={a} style={{ position: 'absolute', left: DIAL / 2 - 6 * s, top: DIAL / 2 - 6 * s, width: 12 * s, height: 12 * s, transform: [{ rotate: `${a}deg` }, { translateY: -(DIAL / 2 - 6 * s) }, { rotate: '45deg' }], backgroundColor: TEAL_DARK }} />
            ))}
          </Animated.View>
        </Animated.View>

        <Animated.View style={[styles.circle, { left: cx - GATE / 2, top: cy - GATE / 2, width: GATE, height: GATE, overflow: 'hidden', backgroundColor: TEAL_DARK, opacity: gateOpacity, transform: [{ scaleX: gateX }, { scaleY: gateY }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', transform: [{ scale: tunnelScale }] }]}>
            <View style={[styles.ring, { width: 228 * s, height: 228 * s, backgroundColor: TEAL }]}>
              <View style={[styles.ring, { width: 164 * s, height: 164 * s, backgroundColor: TEAL_MID }]}>
                <View style={[styles.ring, { width: 100 * s, height: 100 * s, backgroundColor: TUNNEL_LIGHT }]}>
                  <View style={[styles.ring, { width: 42 * s, height: 42 * s, backgroundColor: BG }]} />
                </View>
              </View>
            </View>
          </Animated.View>
          <Animated.Image source={GATE_ROSE} fadeDuration={0} style={{ position: 'absolute', left: GATE / 2 - 65 * s, top: GATE / 2 - 65 * s, width: 130 * s, height: 130 * s, opacity: roseOpacity, transform: [{ rotate: roseRotate }] }} />
          {/* Undo the hole's rubber scale for the characters: the hole stretches around them,
              they do not stretch with it. */}
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scaleX: unGateX }, { scaleY: unGateY }] }]}>
            <Mascot m={maki} ox={GATE / 2} oy={GATE / 2} />
            <Mascot m={oli} ox={GATE / 2} oy={GATE / 2} />
          </Animated.View>
        </Animated.View>

        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: lineY, overflow: 'hidden', transform: [{ translateY: lineShift }] }}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: unLineShift }] }]}>
            <Mascot m={maki} ox={cx} oy={cy} opacity={makiSpill} />
            <Mascot m={oli} ox={cx} oy={cy} opacity={oliSpill} />
          </Animated.View>
        </Animated.View>

        <Animated.View style={{ position: 'absolute', left: cx - 40 * s, bottom: H - (cy - 198 * s), opacity: bubbleOpacity, transform: [{ scale: bubbleScale }], transformOrigin: '0% 100%' }}>
          <View style={styles.bubble}>
            {fontsLoaded && <Text style={styles.bubbleText} maxFontSizeMultiplier={1.15} numberOfLines={1}>{t('splashHello', lang)}</Text>}
          </View>
        </Animated.View>

        <Animated.View style={{ position: 'absolute', left: cx - EMBLEM_W * ROSE_FX, top: cy - EMBLEM_H * ROSE_FY, width: EMBLEM_W, height: EMBLEM_H, opacity: emblemOpacity, transform: [{ scale: emblemScale }], transformOrigin: `${ROSE_FX * 100}% ${ROSE_FY * 100}%` }}>
          <Image source={EMBLEM_BASE} fadeDuration={0} onLoad={() => setEmblemLoaded(true)} onError={() => setEmblemLoaded(true)} style={{ width: EMBLEM_W, height: EMBLEM_H }} />
          <Image source={EMBLEM_ROSE} fadeDuration={0} style={{ position: 'absolute', left: EMBLEM_W * ROSE_FX - ROSE_W / 2, top: EMBLEM_H * ROSE_FY - ROSE_W / 2, width: ROSE_W, height: ROSE_W }} />
        </Animated.View>
      </Animated.View>

      {!NEW_NATIVE && reduce !== true && <MorphFrame opacity={morphOpacity} W={W} cx={cx} cy={cy} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  circle: { position: 'absolute', borderRadius: 9999, backgroundColor: 'transparent' },
  ring: { borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  tagline: { marginTop: 8, color: TEAL_DARK, letterSpacing: 0.3, fontFamily: font.semibold },
  bubble: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: TEAL, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 8 },
  bubbleText: { fontSize: 18, color: TEAL_DARK, fontFamily: font.semibold },
})
