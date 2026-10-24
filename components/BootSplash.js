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
const NEW_NATIVE = devPath ? devPath === 'native' : !!requireOptionalNativeModule('ExpoSplashScreen')
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

function useReduceMotion() {
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
function Mascot({ m, ox, oy }) {
  return (
    <Animated.Image
      source={m.src}
      fadeDuration={0}
      style={[{ position: 'absolute', left: ox + m.left, top: oy + m.top, width: m.w, height: m.h, transformOrigin: '50% 100%' }, m.style]}
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
  //   700    emblem grows
  //   1050   zoom into the compass: gate opens, dial ring spins, white rose spins and fades
  //   1450   Oli then Maki rush up the tunnel, small → big
  //   2000   burst out over the rim, 1.14 → 1 overshoot, shockwave
  //   2150   lean + bob, wordmark + tagline; 2300 "Merhaba!" — landed by 2500, held to the exit
  const emblemScale = kf(clock, [[0, 1], [700, 1], [875, 1.6], [1050, 1.85], [1200, 2.6], [1350, 4.4]])
  const emblemOpacity = kf(clock, [[0, 1], [1050, 1], [1150, 0.6], [1350, 0]])
  const discOpacity = kf(clock, [[0, 1], [700, 1], [1000, 0]])
  const discScale = kf(clock, [[0, 1], [700, 1], [1050, 1.4]])
  const gateOpacity = kf(clock, [[0, 0], [1050, 0], [1150, 1]])
  const gateScale = kf(clock, [[0, 0.3], [1050, 0.3], [1200, 0.75], [1350, 1]])
  const dialRotate = deg(clock, [[0, 0], [1050, 0], [1350, 180], [END, 290]])
  const tunnelScale = kf(clock, [[0, 1], [1350, 1], [1750, 1.06], [2150, 1]])
  const roseOpacity = kf(clock, [[0, 0], [1050, 0], [1150, 1], [1350, 1], [1550, 0]])
  const roseRotate = deg(clock, [[0, 0], [1050, 0], [1350, 300], [1550, 540]])
  const shockOpacity = kf(clock, [[0, 0], [1990, 0], [2010, 0.9], [2400, 0]])
  const shockScale = kf(clock, [[0, 1], [2000, 1], [2400, 1.5]])
  const wordOpacity = kf(clock, [[0, 0], [2150, 0], [2450, 1]])
  const wordY = kf(clock, [[0, -14], [2150, -14], [2450, 0]])
  const bubbleOpacity = kf(clock, [[0, 0], [2300, 0], [2400, 1]])
  const bubbleScale = kf(clock, [[0, 0.4], [2300, 0.4], [2400, 1.08], [2500, 1]])
  const morphOpacity = kf(clock, [[0, 1], [80, 1], [380, 0]])

  // Mascot geometry at s = 1, relative to the gate centre.
  // Each grows from its bottom centre; `start` puts that point near the tunnel's centre.
  const mascot = (src, aspect, box, start, delay, sign) => {
    const d = delay
    const w = box.w * s
    return {
      src, w, h: w / aspect, left: box.x * s, top: box.y * s,
      style: {
        opacity: kf(clock, [[0, 0], [1450 + d, 0], [1520 + d, 1]]),
        transform: [
          { translateX: kf(clock, [[0, start.x * s], [1450 + d, start.x * s], [1700 + d, start.x * 0.7 * s], [2000 + d, 0]]) },
          { translateY: kf(clock, [[0, start.y * s], [1450 + d, start.y * s], [1700 + d, start.y * 0.7 * s], [2000 + d, 0]]) },
          { scale: kf(clock, [[0, 0.18], [1450 + d, 0.18], [1700 + d, 0.45], [2000 + d, 1.14], [2150 + d, 0.97], [2300 + d, 1.02], [2450 + d, 1], [2600 + d, 1.01], [END, 1]]) },
          { rotate: deg(clock, [[0, 0], [1450 + d, 0], [2000 + d, 9 * sign], [2150 + d, 6 * sign], [2400 + d, 10 * sign], [2600 + d, 3 * sign], [END, 6 * sign]]) },
        ],
      },
    }
  }
  // Positions are solved, not eyeballed: at the final pose no pixel of Oli's ring-cut edge
  // lands outside the hole above the clip line, and no pixel of either body lands outside
  // the hole below it (so nothing is sliced). Re-solve if the art or the gate size changes.
  const oli = mascot(OLI, 1867 / 1603, { x: -136, y: -188, w: 260 }, { x: 5, y: -30 }, 0, -1)
  const maki = mascot(MAKI, 1963 / 1394, { x: -45, y: -195, w: 250 }, { x: -75, y: 15 }, 50, 1)

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

        <Animated.View style={{ position: 'absolute', left: cx - DIAL / 2, top: cy - DIAL / 2, width: DIAL, height: DIAL, opacity: gateOpacity, transform: [{ scale: gateScale }, { rotate: dialRotate }] }}>
          <View style={[styles.circle, { left: 0, top: 0, width: DIAL, height: DIAL, borderWidth: 8 * s, borderColor: TEAL }]} />
          <View style={[styles.circle, { left: 12 * s, top: 12 * s, width: DIAL - 24 * s, height: DIAL - 24 * s, borderWidth: 2 * s, borderColor: '#FFFFFF' }]} />
          {[0, 90, 180, 270].map(a => (
            <View key={a} style={{ position: 'absolute', left: DIAL / 2 - 6 * s, top: DIAL / 2 - 6 * s, width: 12 * s, height: 12 * s, transform: [{ rotate: `${a}deg` }, { translateY: -(DIAL / 2 - 6 * s) }, { rotate: '45deg' }], backgroundColor: TEAL_DARK }} />
          ))}
        </Animated.View>

        <Animated.View style={[styles.circle, { left: cx - GATE / 2, top: cy - GATE / 2, width: GATE, height: GATE, overflow: 'hidden', backgroundColor: TEAL_DARK, opacity: gateOpacity, transform: [{ scale: gateScale }] }]}>
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
          <Mascot m={maki} ox={GATE / 2} oy={GATE / 2} />
          <Mascot m={oli} ox={GATE / 2} oy={GATE / 2} />
        </Animated.View>

        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: lineY, overflow: 'hidden' }}>
          <Mascot m={maki} ox={cx} oy={cy} />
          <Mascot m={oli} ox={cx} oy={cy} />
        </View>

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

      {!NEW_NATIVE && reduce !== true && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: morphOpacity }]}>
          {Platform.OS === 'ios'
            ? <Image source={MORPH_IMAGE} fadeDuration={0} resizeMode="contain" style={{ position: 'absolute', left: 0, top: cy - W / 2, width: W, height: W }} />
            : <Image source={MORPH_IMAGE} fadeDuration={0} style={{ position: 'absolute', left: cx - MORPH_ANDROID_W / 2, top: cy + MORPH_ANDROID_DY - MORPH_ANDROID_W / 2, width: MORPH_ANDROID_W, height: MORPH_ANDROID_W }} />}
        </Animated.View>
      )}
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
