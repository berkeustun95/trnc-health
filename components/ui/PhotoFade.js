import { useState } from 'react'
import { View, Image, StyleSheet, useWindowDimensions } from 'react-native'

// The photo-led ground (Welcome A, onboarding): a full-screen photo that fades seamlessly into
// deep teal at the bottom, with no panel and no edge. The teal is SOLID under the content
// block (`children`, laid out from the bottom) and fades upward from its top over FADE_FRAC
// of the screen — so the fade always ends exactly where the content begins, on any screen
// height and in any language. Every word of text therefore sits on solid PHOTO_TEAL:
// white on #083A39 is 12.54:1 (check-hero-contrast asserts the colour and the layout rule).
// A top scrim (black 0.5 → 0) keeps the status bar, the white logo and the glass buttons
// legible over a bright sky. `top` renders above everything (logo, language, skip).
export const PHOTO_TEAL = '#083A39'
export const FADE_FRAC = 0.32
const FADE = require('../../assets/oli-scenes/teal-fade.png')
const SCRIM = require('../../assets/oli-scenes/top-scrim.png')

export default function PhotoFade({ photo, top, children, scrimHeight = 180 }) {
  const { height } = useWindowDimensions()
  const [contentH, setContentH] = useState(Math.round(height * 0.42))
  const fadeLen = Math.round(height * FADE_FRAC)
  return (
    <View style={s.root}>
      {!!photo && <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />}
      <Image source={SCRIM} resizeMode="stretch" style={[s.scrim, { height: scrimHeight }]} />
      <View pointerEvents="none" style={[s.bottom, { height: contentH + fadeLen }]}>
        <Image source={FADE} resizeMode="stretch" style={{ width: '100%', height: fadeLen }} />
        <View style={s.solid} />
      </View>
      {top}
      <View style={s.content} onLayout={e => setContentH(Math.ceil(e.nativeEvent.layout.height))}>{children}</View>
    </View>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: PHOTO_TEAL },
  scrim:   { position: 'absolute', top: 0, left: 0, right: 0, width: '100%' },
  bottom:  { position: 'absolute', left: 0, right: 0, bottom: 0 },
  solid:   { flex: 1, backgroundColor: PHOTO_TEAL },
  content: { position: 'absolute', left: 0, right: 0, bottom: 0 },
})
