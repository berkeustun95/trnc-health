import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, Easing, StyleSheet, Platform, AccessibilityInfo, useWindowDimensions } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, colors } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── Boot splash: the Oli & Maki gate clip as an animated WebP (OTA stopgap) ──
//
// Berke's 2.4 s clip (ada-splash-final.mp4), colour-corrected to a constant #CBFAE8 and
// extended top and bottom to phone height (gate at the vertical centre), played ONCE through
// expo-image, which is native in every binary that receives this OTA. The final splash is the
// same clip through expo-video plus a matching native splash (stage A, next native build);
// this is what OTA users get until then. Vault 2026-10-24_boot-splash.md.

const BG = '#CBFAE8'
const CLIP = require('../assets/splash/gate-video.webp')
const FIRST = require('../assets/splash/gate-video-first.jpg')
const LAST = require('../assets/splash/gate-video-last.jpg')
const WORDMARK = require('../assets/splash/wordmark.png')
const CLIP_W = 1080
const CLIP_H = 2560

// ─── Which first frame ──────────────────────────────────────────────────────
// No shipped binary has expo-splash-screen yet, so the native splash hides on the first JS
// frame and this one starts as a copy of it ("morph", Berke 2026-10-23), then fades into the
// clip's still gate. A binary that has the module (stage A; Expo Go) skips the morph.
const devPath = __DEV__ ? process.env.EXPO_PUBLIC_SPLASH_PATH : undefined
const NEW_NATIVE = devPath ? devPath === 'native' : !!requireOptionalNativeModule('ExpoSplashScreen')
// Android before 12 draws no icon splash, and the geometry below was measured on Android 13
// only: the morph is not drawn there.
const MORPH = !NEW_NATIVE && (Platform.OS === 'ios' || Platform.Version >= 31)
const IS_PREVIEW = Constants.expoConfig?.extra?.appVariant === 'preview'

// 1.4.1 native frame. Android 12+: the v2 adaptive-icon foreground centred on white; the
// 1024 px foreground draws 264 dp wide, centre 11 dp below the window centre (SM-G985F /
// Android 13, measured 2026-10-24 on the old icon; same canvas). iOS: the v2 splash-icon.png,
// `contain`, a screen-width square. Goes away with stage A.
const MORPH_ANDROID_W = 264
const MORPH_ANDROID_DY = 11
const MORPH_IMAGE = Platform.OS === 'ios'
  ? require('../assets/splash/morph-ios.png')
  : IS_PREVIEW ? require('../assets/splash/morph-android-preview.png') : require('../assets/splash/morph-android.png')

function MorphFrame({ opacity, W, cx, cy }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, opacity }]}>
      {Platform.OS === 'ios'
        ? <Image source={MORPH_IMAGE} fadeDuration={0} resizeMode="contain" style={{ position: 'absolute', left: 0, top: cy - W / 2, width: W, height: W }} />
        : <Image source={MORPH_IMAGE} fadeDuration={0} style={{ position: 'absolute', left: cx - MORPH_ANDROID_W / 2, top: cy + MORPH_ANDROID_DY - MORPH_ANDROID_W / 2, width: MORPH_ANDROID_W, height: MORPH_ANDROID_W }} />}
    </Animated.View>
  )
}

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

// expo-image is native from 1.3.0; requiring its entry where it is missing kills the app at
// launch, so App.js renders this only when the module exists, and the entry is require()d
// inside a function, never at module scope (check-native-import-safety).
export const SPLASH_AVAILABLE = !!requireOptionalNativeModule('ExpoImage')
let ExpoImage
function loadExpoImage() {
  if (ExpoImage === undefined) ExpoImage = SPLASH_AVAILABLE ? require('expo-image').Image : null
  return ExpoImage
}

// ms from the clip's first displayed frame. The clip runs 2.39 s and holds its last frame.
const WORD_IN = 1600
// The fade starts once the clip has landed on its held smile (Berke 2026-10-24).
const EXIT_MIN = 2400
const EXIT_MAX = 2650
const EXIT_FADE = 250
const REDUCED_MIN = 1200
// Whatever happens (the clip never decodes, onDisplay never fires), the splash is gone this
// long after it mounts: while it is up it takes every touch and holds back the force-update
// notice. Durations here are Berke's approved timings (2026-10-24), not motion tokens.
const HARD_CAP = 4000

export default function BootSplash({ ready, lang, fontsLoaded, onDone }) {
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduce = useReduceMotion()
  const ExpoImage = loadExpoImage()
  const morph = useRef(new Animated.Value(1)).current
  const word = useRef(new Animated.Value(0)).current
  const exit = useRef(new Animated.Value(1)).current
  const [shownAt, setShownAt] = useState(null)
  const [firstShown, setFirstShown] = useState(false)
  const readyAt = useRef(null)
  const done = useRef(false)
  const [leaving, setLeaving] = useState(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    setLeaving(true)
    Animated.timing(exit, { toValue: 0, duration: EXIT_FADE, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => onDone?.())
  }

  useEffect(() => {
    const timer = setTimeout(finish, HARD_CAP)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (ready && readyAt.current == null) readyAt.current = Date.now()
  }, [ready])

  // Reduce Motion: no clip, the last frame + wordmark; the clock starts when that frame is up.
  useEffect(() => {
    if (reduce === true) word.setValue(1)
  }, [reduce])

  useEffect(() => {
    if (firstShown || shownAt != null) {
      Animated.timing(morph, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
  }, [firstShown, shownAt])

  useEffect(() => {
    if (shownAt == null) return
    if (!reduce) {
      Animated.timing(word, { toValue: 1, duration: 300, delay: WORD_IN, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
  }, [shownAt])

  useEffect(() => {
    if (shownAt == null) return
    const min = reduce ? REDUCED_MIN : EXIT_MIN
    const sinceShown = readyAt.current == null ? Infinity : readyAt.current - shownAt
    const at = Math.min(EXIT_MAX, Math.max(min, sinceShown))
    const timer = setTimeout(finish, Math.max(0, at - (Date.now() - shownAt)))
    return () => clearTimeout(timer)
  }, [ready, shownAt])

  // Cover the width (the arms run off the screen edge, as in the clip), gate at the
  // window's vertical centre.
  const cw = W
  const ch = W * CLIP_H / CLIP_W
  const top = H / 2 - ch / 2
  // Below the gate: on the held frame Oli's ears fill the top of the screen.
  const wordTop = Math.min(H / 2 + 130 * (W / 390), H - insets.bottom - 110)
  const s = Math.max(0.85, Math.min(1.1, W / 390))

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: BG, opacity: exit }]}
      pointerEvents={leaving ? 'none' : 'auto'}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`ADA, ${t('splashTagline', lang)}`}
      importantForAccessibility="yes"
    >
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        {/* Decoding the clip takes ~0.6 s on the S20+; its first frames are this same still
            gate, so the still shows at once and the clip starts on top of it invisibly. */}
        {reduce === false && (
          <Image source={FIRST} fadeDuration={0} onLoad={() => setFirstShown(true)} style={{ position: 'absolute', left: 0, top, width: cw, height: ch }} />
        )}
        {reduce === false && (
          <ExpoImage
            source={CLIP}
            autoplay
            contentFit="cover"
            cachePolicy="none"
            onDisplay={() => setShownAt(t0 => t0 ?? Date.now())}
            onError={() => setShownAt(t0 => t0 ?? Date.now())}
            style={{ position: 'absolute', left: 0, top, width: cw, height: ch }}
          />
        )}
        {reduce === true && (
          <Image source={LAST} fadeDuration={0} onLoad={() => setShownAt(t0 => t0 ?? Date.now())} onError={() => setShownAt(t0 => t0 ?? Date.now())} style={{ position: 'absolute', left: 0, top, width: cw, height: ch }} />
        )}
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: wordTop, alignItems: 'center', opacity: word }}>
          <Image source={WORDMARK} fadeDuration={0} style={{ width: 190 * s, height: 190 * s * 184 / 570 }} resizeMode="contain" />
          {fontsLoaded && (
            <Text style={[styles.tagline, { fontSize: 17 * s }]} maxFontSizeMultiplier={1.15} numberOfLines={1}>
              {t('splashTagline', lang)}
            </Text>
          )}
        </Animated.View>
      </View>
      {MORPH && <MorphFrame opacity={morph} W={W} cx={W / 2} cy={H / 2} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tagline: { marginTop: 8, color: colors.primaryDark, letterSpacing: 0.3, fontFamily: font.semibold },
})
