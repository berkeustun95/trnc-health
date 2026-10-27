import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, Easing, StyleSheet, Platform, AccessibilityInfo, Dimensions, useWindowDimensions } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { BOOT_SPLASH_LIVE } from '../constants/flags'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BOOT_SPLASH_KEY, localDay, shouldPlaySplash, splashRecord } from '../utils/bootSplashDay'

// ─── Boot splash: the Oli & Maki gate clip, played ONCE ───────────────────────
//
// Berke's white clip (splash-white-final.mp4, 2026-10-27), 3.33 s at 1080x2560: 1.0 s of the v2
// logo turning into the gate, then his Oli & Maki clip recoloured from mint to white; logo and
// gate at the vertical centre. Two paths:
// - VIDEO_PATH (a binary with expo-splash-screen + expo-video, 1.4.2+): the native splash (the v2
//   logo on white) is held until this component's first still has drawn, then the mp4 plays
//   through expo-video. Every way out of the native splash is bounded, see hideNativeSplash().
// - Otherwise (every shipped binary before 1.4.2): the same clip as an animated WebP through
//   expo-image, native in every binary that receives an OTA, behind a "morph" frame.
// Vault 2026-10-24_boot-splash.md.

// The clip's own background, baked into its pixels: a literal, not a theme token that could drift from it.
const BG = '#FFFFFF'
const CLIP = require('../assets/splash/gate-video.webp')
const VIDEO = require('../assets/splash/gate-video.mp4')
const FIRST = require('../assets/splash/gate-video-first.jpg')
const LAST = require('../assets/splash/gate-video-last.jpg')
const WORDMARK = require('../assets/splash/wordmark.png')
const CLIP_W = 1080
const CLIP_H = 2560

// ─── Which first frame ──────────────────────────────────────────────────────
// No shipped binary has expo-splash-screen yet, so the native splash hides on the first JS
// frame and this one starts as a copy of it ("morph", Berke 2026-10-23). A binary that has the
// modules (1.4.2; Expo Go) draws the same copy over ITS native frame (the v2 logo on white). The
// clip's frame 0 is that logo, so the copy hands over to it with no fade (Berke 2026-10-27).
const devPath = __DEV__ ? process.env.EXPO_PUBLIC_SPLASH_PATH : undefined
const HAS_VIDEO_MODULES = !!requireOptionalNativeModule('ExpoSplashScreen') && !!requireOptionalNativeModule('ExpoVideo')
const VIDEO_PATH = devPath ? devPath === 'native' : HAS_VIDEO_MODULES
// WebP path: Android before 12 draws no icon splash, and the geometry below was measured on Android
// 13 only, so no morph there. VIDEO_PATH: the plugin's white + splash-icon.png frame is drawn on
// iOS and on every Android (androidx core-splashscreen draws the same icon below 12; unmeasured).
const MORPH = VIDEO_PATH || Platform.OS === 'ios' || Platform.Version >= 31
const IS_PREVIEW = Constants.expoConfig?.extra?.appVariant === 'preview'

// 1.4.1 native frame. Android 12+: the v2 adaptive-icon foreground centred on white; it draws
// 288 dp wide, centred on the SCREEN (SM-G985F / Android 13, measured 2026-10-26; the OEM icon
// mask is not copied). The RN window is shorter than the screen there, hence `cy` below. iOS: the v2 splash-icon.png,
// `contain`, a screen-width square. Goes away with stage A.
// 1.4.2 (VIDEO_PATH): the plugin draws splash-icon.png on white on both platforms (iOS legacy full-screen
// image view, contain; Android 288 dp slot, centred on the screen), and morph-ios@3x.png is that
// file downscaled, so it serves both, Android just drawn 288 dp wide.
const MORPH_ANDROID_W = 288
const MORPH_IMAGE = VIDEO_PATH || Platform.OS === 'ios'
  ? require('../assets/splash/morph-ios.png')
  : IS_PREVIEW ? require('../assets/splash/morph-android-preview.png') : require('../assets/splash/morph-android.png')
// Logo width as a share of each morph image, and of the clip's frame 0 (measured from the files).
// The native logo has one size (288 dp slot on Android, a screen-width square on iOS) and the clip
// scales with the screen, so the clip starts scaled to the native logo and eases to its own size
// while the logo turns into the gate (×1.00 on the S20+'s 384 dp, ×1.33 on every iPhone).
const MORPH_LOGO = VIDEO_PATH || Platform.OS === 'ios' ? 0.4915 : IS_PREVIEW ? 0.5606 : 0.5884
const CLIP_LOGO = 398 / 1080
const LOGO_TO_GATE = 1000

function MorphFrame({ opacity, W, cx, cy, onLoad }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, opacity }]}>
      {Platform.OS === 'ios'
        ? <Image source={MORPH_IMAGE} fadeDuration={0} onLoad={onLoad} onError={onLoad} resizeMode="contain" style={{ position: 'absolute', left: 0, top: cy - W / 2, width: W, height: W }} />
        : <Image source={MORPH_IMAGE} fadeDuration={0} onLoad={onLoad} onError={onLoad} style={{ position: 'absolute', left: cx - MORPH_ANDROID_W / 2, top: cy - MORPH_ANDROID_W / 2, width: MORPH_ANDROID_W, height: MORPH_ANDROID_W }} />}
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
// Held from module eval until this component has drawn its own first frame (the MorphFrame copy of
// the native frame, so the swap is invisible). A held native
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
function holdNativeSplash() {
  try {
    const SplashScreen = require('expo-splash-screen')
    SplashScreen.setOptions({ fade: true, duration: 200 })
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

// ms from the clip's first displayed frame. The clip runs 3.33 s and holds its last frame. The
// logo-to-gate second puts the old clip 958 ms later, so its approved beats move by that much.
const WORD_IN = 2560
// The fade starts once the clip has landed on its held smile (Berke 2026-10-24).
const EXIT_MIN = 3360
const EXIT_MAX = 3610
const EXIT_FADE = 250
const REDUCED_MIN = 1200
// Whatever happens (the clip never decodes, onDisplay never fires), the splash is gone this
// long after it mounts: while it is up it takes every touch and holds back the force-update
// notice. Durations here are Berke's approved timings (2026-10-24; moved +958 ms for the white
// clip, approved on device 2026-10-27), not motion tokens.
const HARD_CAP = 5000
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
  const startScale = MORPH ? (Platform.OS === 'ios' ? W : MORPH_ANDROID_W) * MORPH_LOGO / (CLIP_LOGO * W) : 1
  const zoom = useRef(new Animated.Value(startScale)).current
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

  const releaseNative = HOLD_NATIVE ? hideNativeSplash : undefined

  useEffect(() => {
    const timer = setTimeout(finish, HARD_CAP)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (ready && readyAt.current == null) readyAt.current = Date.now()
  }, [ready])

  // Reduce Motion: no clip, the last frame + wordmark; the clock starts when that frame is up.
  useEffect(() => {
    if (reduce === true) { word.setValue(1); zoom.setValue(1) }
  }, [reduce])

  // The still under the morph copy is the clip's frame 0 at the native logo's size: swap, no fade.
  useEffect(() => {
    if (firstShown || shownAt != null) morph.setValue(0)
  }, [firstShown, shownAt])

  // VIDEO_PATH only (the WebP path's timing is live behaviour): the still is up but the clip never
  // reports a frame or an error, so start the clocks anyway.
  useEffect(() => {
    if (!VIDEO_PATH || !firstShown || shownAt != null || reduce !== false) return
    const timer = setTimeout(() => setShownAt(t0 => t0 ?? Date.now()), CLIP_WATCHDOG)
    return () => clearTimeout(timer)
  }, [firstShown, shownAt, reduce])

  useEffect(() => {
    if (shownAt == null) return
    if (!reduce) {
      Animated.timing(zoom, { toValue: 1, duration: LOGO_TO_GATE, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start()
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
      ? <MorphFrame opacity={1} W={W} cx={W / 2} cy={cy} onLoad={releaseNative} />
      : <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
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
        {/* Scaled about the clip's centre (= the native logo's centre) from startScale to 1. */}
        <Animated.View style={{ position: 'absolute', left: 0, top, width: cw, height: ch, transform: [{ scale: zoom }] }}>
          {/* Decoding the clip takes ~0.6 s on the S20+; its first frames are this same still
              logo, so the still shows at once and the clip starts on top of it invisibly. */}
          {/* VIDEO_PATH: a TextureView inside a fading parent composites over black on Android
              (measured 2026-10-26). LAST sits under FIRST + the clip, decoded early; on exit they
              unmount so only LAST + wordmark + BG fade (the clip holds this frame once it ends). */}
          {VIDEO_PATH && reduce === false && (
            <Image source={LAST} fadeDuration={0} style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch }} />
          )}
          {reduce === false && !(VIDEO_PATH && leaving) && (
            <Image source={FIRST} fadeDuration={0} onLoad={() => { setFirstShown(true); if (HOLD_NATIVE) hideNativeSplash() }} onError={() => { if (!VIDEO_PATH) return; setFirstShown(true); if (HOLD_NATIVE) hideNativeSplash() }} style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch }} />
          )}
          {reduce === false && VIDEO_PATH && !leaving && (
            <ClipVideo top={0} cw={cw} ch={ch} onShown={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} />
          )}
          {reduce === false && !VIDEO_PATH && (
            <ExpoImage
              source={CLIP}
              autoplay
              contentFit="cover"
              cachePolicy="none"
              onDisplay={() => setShownAt(t0 => t0 ?? Date.now())}
              onError={() => setShownAt(t0 => t0 ?? Date.now())}
              style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch }}
            />
          )}
          {reduce === true && (
            <Image source={LAST} fadeDuration={0} onLoad={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} onError={() => { setShownAt(t0 => t0 ?? Date.now()); if (HOLD_NATIVE) hideNativeSplash() }} style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch }} />
          )}
        </Animated.View>
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: wordTop, alignItems: 'center', opacity: word }}>
          <Image source={WORDMARK} fadeDuration={0} style={{ width: 190 * s, height: 190 * s * 184 / 570 }} resizeMode="contain" />
          {fontsLoaded && (
            <Text style={[styles.tagline, { fontSize: 17 * s }]} maxFontSizeMultiplier={1.15} numberOfLines={1}>
              {t('splashTagline', lang)}
            </Text>
          )}
        </Animated.View>
      </View>
      {MORPH && <MorphFrame opacity={morph} W={W} cx={W / 2} cy={cy} onLoad={releaseNative} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tagline: { marginTop: 8, color: colors.primaryDark, letterSpacing: 0.3, fontFamily: font.semibold },
})
