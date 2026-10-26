import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, Easing, StyleSheet, Platform, AccessibilityInfo, Dimensions, useWindowDimensions } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, colors, motion } from '../constants/theme'
import { t } from '../constants/i18n'
import { BOOT_SPLASH_LIVE } from '../constants/flags'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BOOT_SPLASH_KEY, localDay, shouldPlaySplash, splashRecord } from '../utils/bootSplashDay'

// ─── Boot splash: the Oli & Maki gate clip, played ONCE ───────────────────────
//
// Berke's 2.4 s clip (ada-splash-final.mp4), colour-corrected to a constant #CBFAE8 and
// extended top and bottom to phone height (gate at the vertical centre). Two paths:
// - VIDEO_PATH (a binary with expo-splash-screen + expo-video, 1.4.2+): the native splash (mint
//   + gate) is held until this component's first still has drawn, then the mp4 plays through
//   expo-video. Every way out of the native splash is bounded, see hideNativeSplash().
// - Otherwise (every shipped binary before 1.4.2): the same clip as an animated WebP through
//   expo-image, native in every binary that receives an OTA, behind a "morph" frame.
// Vault 2026-10-24_boot-splash.md.

const BG = '#CBFAE8'
const CLIP = require('../assets/splash/gate-video.webp')
const VIDEO = require('../assets/splash/gate-video.mp4')
const FIRST = require('../assets/splash/gate-video-first.jpg')
const LAST = require('../assets/splash/gate-video-last.jpg')
const WORDMARK = require('../assets/splash/wordmark.png')
const CLIP_W = 1080
const CLIP_H = 2560

// ─── Which first frame ──────────────────────────────────────────────────────
// No shipped binary has expo-splash-screen yet, so the native splash hides on the first JS
// frame and this one starts as a copy of it ("morph", Berke 2026-10-23), then fades into the
// clip's still gate. A binary that has the modules (1.4.2; Expo Go) skips the morph.
const devPath = __DEV__ ? process.env.EXPO_PUBLIC_SPLASH_PATH : undefined
const HAS_VIDEO_MODULES = !!requireOptionalNativeModule('ExpoSplashScreen') && !!requireOptionalNativeModule('ExpoVideo')
const VIDEO_PATH = devPath ? devPath === 'native' : HAS_VIDEO_MODULES
const NEW_NATIVE = VIDEO_PATH
// Android before 12 draws no icon splash, and the geometry below was measured on Android 13
// only: the morph is not drawn there.
const MORPH = !NEW_NATIVE && (Platform.OS === 'ios' || Platform.Version >= 31)
// Android's native splash draws the gate 166 dp wide on every phone (the OS icon slot); the clip's
// gate is 468/1080 of its width, so the first still grows from one to the other (measured 2026-10-26).
const GROW = VIDEO_PATH && Platform.OS === 'android'
const NATIVE_GATE_DP = 166
const CLIP_GATE = 468 / 1080
const FirstImage = GROW ? Animated.Image : Image
const IS_PREVIEW = Constants.expoConfig?.extra?.appVariant === 'preview'

// 1.4.1 native frame. Android 12+: the v2 adaptive-icon foreground centred on white; it draws
// 288 dp wide, centred on the SCREEN (SM-G985F / Android 13, measured 2026-10-26; the OEM icon
// mask is not copied). The RN window is shorter than the screen there, hence `cy` below. iOS: the v2 splash-icon.png,
// `contain`, a screen-width square. Goes away with stage A.
const MORPH_ANDROID_W = 288
const MORPH_IMAGE = Platform.OS === 'ios'
  ? require('../assets/splash/morph-ios.png')
  : IS_PREVIEW ? require('../assets/splash/morph-android-preview.png') : require('../assets/splash/morph-android.png')

function MorphFrame({ opacity, W, cx, cy }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, opacity }]}>
      {Platform.OS === 'ios'
        ? <Image source={MORPH_IMAGE} fadeDuration={0} resizeMode="contain" style={{ position: 'absolute', left: 0, top: cy - W / 2, width: W, height: W }} />
        : <Image source={MORPH_IMAGE} fadeDuration={0} style={{ position: 'absolute', left: cx - MORPH_ANDROID_W / 2, top: cy - MORPH_ANDROID_W / 2, width: MORPH_ANDROID_W, height: MORPH_ANDROID_W }} />}
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
// inside a function, never at module scope (check-native-import-safety). The video path needs
// expo-video and expo-splash-screen instead, not expo-image.
const HAS_IMAGE = !!requireOptionalNativeModule('ExpoImage')
export const SPLASH_AVAILABLE = VIDEO_PATH || HAS_IMAGE
// On in ADA Preview before it is on for everyone: the Previewed code is then main itself, so the
// "Nothing Previewed stays off main" lineage never waits on a flag commit (Berke 2026-10-25).
export const SPLASH_ON = BOOT_SPLASH_LIVE || IS_PREVIEW

// ─── Native splash hold (VIDEO_PATH only) ───────────────────────────────────
// Held from module eval until this component has drawn its own first frame. A held native
// splash covers every touch, so every way out is bounded: the first still drawn, finish() (itself
// capped by HARD_CAP once mounted), a skipped launch (claimSplash false), and SAFETY_MS from module
// eval for the cases where nothing mounts (claimSplash hangs, play never resolves).
const HOLD_NATIVE = SPLASH_ON && VIDEO_PATH
const SAFETY_MS = 5000
let nativeHidden = false
function hideNativeSplash() {
  if (nativeHidden) return
  nativeHidden = true
  try { Promise.resolve(require('expo-splash-screen').hideAsync()).catch(() => {}) } catch {}
}
// Native splash view fade-out; the grow waits it out so a smaller native gate never ghosts under a larger still.
const NATIVE_FADE = 200
function holdNativeSplash() {
  try {
    const SplashScreen = require('expo-splash-screen')
    SplashScreen.setOptions({ fade: true, duration: NATIVE_FADE })
    Promise.resolve(SplashScreen.preventAutoHideAsync()).catch(() => {})
  } catch {}
}
if (HOLD_NATIVE) {
  holdNativeSplash()
  setTimeout(hideNativeSplash, SAFETY_MS)
} else if (VIDEO_PATH) {
  // Flag off: iOS re-shows the native splash on an RN reload and a prior preventAutoHide persists.
  hideNativeSplash()
}

// Should this cold start play the clip? Records the play at once, so a launch killed mid-clip
// does not replay it the same day. A storage failure skips: the launch is then exactly as before.
export async function claimSplash(build) {
  try {
    const day = localDay()
    if (!shouldPlaySplash(await AsyncStorage.getItem(BOOT_SPLASH_KEY), day, build)) {
      // BootSplash is never mounted for a skipped launch, so release the native splash here.
      if (HOLD_NATIVE) hideNativeSplash()
      return false
    }
    await AsyncStorage.setItem(BOOT_SPLASH_KEY, splashRecord(day, build))
    return true
  } catch {
    if (HOLD_NATIVE) hideNativeSplash()
    return false
  }
}
let ExpoImage
function loadExpoImage() {
  if (ExpoImage === undefined) ExpoImage = !VIDEO_PATH && HAS_IMAGE ? require('expo-image').Image : null
  return ExpoImage
}
let ExpoVideo
function loadExpoVideo() {
  if (ExpoVideo === undefined) ExpoVideo = require('expo-video')
  return ExpoVideo
}

// Defined outside BootSplash so a re-render never remounts the player. Created only for a
// playing, non-Reduce-Motion launch. The player and view hold the last frame after the end.
function ClipVideo({ top, cw, ch, onShown }) {
  const { useVideoPlayer, VideoView } = loadExpoVideo()
  const player = useVideoPlayer(VIDEO, p => {
    p.muted = true
    p.loop = false
    p.audioMixingMode = 'mixWithOthers'
    p.showNowPlayingNotification = false
    p.staysActiveInBackground = false
    p.play()
  })
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'error') onShown() })
    return () => sub.remove()
  }, [player])
  return (
    <VideoView
      player={player}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
      allowsFullscreen={false}
      surfaceType="textureView"
      onFirstFrameRender={onShown}
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top, width: cw, height: ch }}
    />
  )
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
const CLIP_WATCHDOG = 1200

// `play` is null while App is still asking claimSplash(): only the copy of the native frame shows,
// so a skipped launch looks exactly like one without a splash.
export default function BootSplash({ play, ready, lang, fontsLoaded, onDone }) {
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // Android's window height is shorter than the screen (779 vs 853 dp on the S20+) while the
  // root draws full-screen; the native frame is centred on the screen.
  const cy = Platform.OS === 'android' ? Dimensions.get('screen').height / 2 : H / 2
  const reduce = useReduceMotion()
  const ExpoImage = loadExpoImage()
  const morph = useRef(new Animated.Value(1)).current
  const word = useRef(new Animated.Value(0)).current
  const exit = useRef(new Animated.Value(1)).current
  const grow = useRef(new Animated.Value(GROW ? NATIVE_GATE_DP / (CLIP_GATE * W) : 1)).current
  const [grown, setGrown] = useState(!GROW)
  const growing = useRef(false)
  const [shownAt, setShownAt] = useState(null)
  const [firstShown, setFirstShown] = useState(false)
  const readyAt = useRef(null)
  const done = useRef(false)
  const [leaving, setLeaving] = useState(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    if (HOLD_NATIVE) hideNativeSplash()
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

  // The first still has drawn: the native splash fades out over it while it grows to the clip's gate.
  const startGrow = () => {
    if (!GROW || growing.current) return
    growing.current = true
    Animated.timing(grow, { toValue: 1, duration: motion.base, delay: NATIVE_FADE, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => setGrown(true))
  }

  useEffect(() => {
    if (firstShown || shownAt != null) {
      Animated.timing(morph, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
  }, [firstShown, shownAt])

  // VIDEO_PATH only (the WebP path's timing is live behaviour): the still is up but the clip never
  // reports a frame or an error, so start the clocks anyway. Counted from the clip's mount (grown).
  useEffect(() => {
    if (!VIDEO_PATH || !firstShown || !grown || shownAt != null || reduce !== false) return
    const timer = setTimeout(() => setShownAt(t0 => t0 ?? Date.now()), CLIP_WATCHDOG)
    return () => clearTimeout(timer)
  }, [firstShown, grown, shownAt, reduce])

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

  // Undecided: look exactly like the native splash. With no morph to draw (Android < 12, a
  // stage-A binary) that is its plain window colour, never the app underneath.
  if (!play) {
    return MORPH
      ? <MorphFrame opacity={1} W={W} cx={W / 2} cy={cy} />
      : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: NEW_NATIVE ? BG : colors.card }]} />
  }

  // Cover the width (the arms run off the screen edge, as in the clip), gate at the
  // window's vertical centre.
  const cw = W
  const ch = W * CLIP_H / CLIP_W
  const top = cy - ch / 2
  // Below the gate: on the held frame Oli's ears fill the top of the screen.
  const wordTop = Math.min(cy + 130 * (W / 390), 2 * cy - insets.bottom - 110)
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
        {/* VIDEO_PATH: a TextureView inside a fading parent composites over black on Android
            (measured 2026-10-26). LAST sits under FIRST + the clip, decoded early; on exit they
            unmount so only LAST + wordmark + BG fade (the clip holds this frame once it ends).
            LAST is invisible until grown: FIRST starts shrunk and LAST's edges would show around it. */}
        {VIDEO_PATH && reduce === false && (
          <Image source={LAST} fadeDuration={0} style={[{ position: 'absolute', left: 0, top, width: cw, height: ch }, !grown && { opacity: 0 }]} />
        )}
        {reduce === false && !(VIDEO_PATH && leaving) && (
          <FirstImage source={FIRST} fadeDuration={0} onLoad={() => { setFirstShown(true); startGrow(); if (HOLD_NATIVE) hideNativeSplash() }} onError={() => { if (!VIDEO_PATH) return; setFirstShown(true); startGrow(); if (HOLD_NATIVE) hideNativeSplash() }} style={[{ position: 'absolute', left: 0, top, width: cw, height: ch }, GROW && { transform: [{ scale: grow }] }]} />
        )}
        {reduce === false && VIDEO_PATH && grown && !leaving && (
          <ClipVideo top={top} cw={cw} ch={ch} onShown={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} />
        )}
        {reduce === false && !VIDEO_PATH && (
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
          <Image source={LAST} fadeDuration={0} onLoad={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} onError={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} style={{ position: 'absolute', left: 0, top, width: cw, height: ch }} />
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
      {MORPH && <MorphFrame opacity={morph} W={W} cx={W / 2} cy={cy} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tagline: { marginTop: 8, color: colors.primaryDark, letterSpacing: 0.3, fontFamily: font.semibold },
})
