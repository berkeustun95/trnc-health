import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font } from '../constants/theme'
import { t } from '../constants/i18n'
import { MorphFrame, NEW_NATIVE, useReduceMotion } from './BootSplash'

// ─── Boot splash: the Oli & Maki gate clip as an animated WebP (OTA stopgap) ──
//
// Berke's 2.4 s clip (ada-splash-final.mp4), colour-corrected to a constant #CBFAE8 and extended top and bottom
// to phone height (gate at the vertical centre), played ONCE through expo-image, which is
// native in every 1.3.0 / 1.4.0 binary. The final splash is the same clip through
// expo-video in the next store build; this is what OTA users get until then.

const BG = '#CBFAE8'
const TEAL_DARK = '#0A5E5D'
const CLIP = require('../assets/splash/gate-video.webp')
const LAST = require('../assets/splash/gate-video-last.jpg')
const WORDMARK = require('../assets/splash/wordmark.png')
const CLIP_W = 1080
const CLIP_H = 2560

// expo-image is native from 1.3.0; requiring its entry where it is missing kills the app at
// launch, so App.js renders this only when the module exists.
export const WEBP_SPLASH_AVAILABLE = !!requireOptionalNativeModule('ExpoImage')
const ExpoImage = WEBP_SPLASH_AVAILABLE ? require('expo-image').Image : null

// ms from the clip's first displayed frame. The clip runs 2.39 s and holds its last frame.
const WORD_IN = 1600
// The fade starts once the clip has landed on its held smile (Berke 2026-10-24).
const EXIT_MIN = 2400
const EXIT_MAX = 2650
const EXIT_FADE = 250
const REDUCED_MIN = 1200

export default function BootSplashWebp({ ready, lang, fontsLoaded, onDone }) {
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduce = useReduceMotion()
  const morph = useRef(new Animated.Value(1)).current
  const word = useRef(new Animated.Value(0)).current
  const exit = useRef(new Animated.Value(1)).current
  const [shownAt, setShownAt] = useState(null)
  const readyAt = useRef(null)

  useEffect(() => {
    if (ready && readyAt.current == null) readyAt.current = Date.now()
  }, [ready])

  // Reduce Motion: no clip, the last frame + wordmark from the start.
  useEffect(() => {
    if (reduce === true && shownAt == null) { word.setValue(1); setShownAt(Date.now()) }
  }, [reduce])

  useEffect(() => {
    if (shownAt == null) return
    Animated.timing(morph, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    if (!reduce) {
      Animated.timing(word, { toValue: 1, duration: 300, delay: WORD_IN, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
  }, [shownAt])

  useEffect(() => {
    if (shownAt == null) return
    const min = reduce ? REDUCED_MIN : EXIT_MIN
    const sinceShown = readyAt.current == null ? Infinity : readyAt.current - shownAt
    const at = Math.min(EXIT_MAX, Math.max(min, sinceShown))
    const timer = setTimeout(() => {
      Animated.timing(exit, { toValue: 0, duration: EXIT_FADE, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(() => onDone?.())
    }, Math.max(0, at - (Date.now() - shownAt)))
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
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BG, opacity: exit }]} accessible accessibilityLabel="ADA" importantForAccessibility="yes">
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        {reduce === false && (
          <ExpoImage
            source={CLIP}
            autoplay
            contentFit="cover"
            cachePolicy="none"
            onDisplay={() => setShownAt(t0 => t0 ?? Date.now())}
            style={{ position: 'absolute', left: 0, top, width: cw, height: ch }}
          />
        )}
        {reduce === true && (
          <Image source={LAST} fadeDuration={0} style={{ position: 'absolute', left: 0, top, width: cw, height: ch }} />
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
      {!NEW_NATIVE && <MorphFrame opacity={morph} W={W} cx={W / 2} cy={H / 2} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tagline: { marginTop: 8, color: TEAL_DARK, letterSpacing: 0.3, fontFamily: font.semibold },
})
