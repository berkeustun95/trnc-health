import { useState } from 'react'
import { View, Image, StyleSheet, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'

// The photo-led ground (Welcome A, onboarding), round 2 (Berke's device check: "a foggy blur,
// nothing recognisable"). The photo must read as a PHOTO:
//   · it shows clearly above the BOUNDARY — ~55% of the screen, raised automatically when the
//     content below needs more room — with NO scrim over it;
//   · it is cropped by `focus` ({ x, y } = the recognisable part's centre in the source, 0–1;
//     `zoom` ≥ 1 enlarges it) so that part sits in the visible top area, centred at ~55% of
//     the photo zone;
//   · it fades softly into PHOTO_TEAL over FADE_FRAC of the screen ending AT the boundary;
//   · the Oli & Maki `mascot` (MASCOT pt, centred) sits ON the boundary;
//   · every word of text sits below it, on solid teal — white on #083A39 is 12.54:1
//     (check-hero-contrast). Only a light TOP_SCRIM strip remains, for the status-bar icons;
//     the language / skip buttons carry their own dark glass (measured on the real photos).
export const PHOTO_TEAL = '#083A39'
export const FADE_FRAC = 0.14
export const MASCOT = 150
export const BOUNDARY_FRAC = 0.55
export const BOUNDARY_MAX = 0.65  // a short content block lets the photo grow (to 65%), never an empty teal band
export const TOP_SCRIM = 0.35
export const TOP_SCRIM_H = 110
// Dark glass behind white text on the photo (language button, Atla): AA over a pure-white pixel.
export const PHOTO_GLASS = 0.55
const FADE = require('../../assets/oli-scenes/teal-fade.png')
const DARK = require('../../assets/oli-scenes/dark-fade.png')   // black 0.6 → 0; drawn at TOP_SCRIM/0.6 opacity
const SRC_W = 704, SRC_H = 1520   // the module photos (assets/backgrounds)

export default function PhotoFade({ photo, focus = { x: 0.5, y: 0.5, zoom: 1 }, mascot, top, children }) {
  const { width: W, height: H } = useWindowDimensions()
  const [contentH, setContentH] = useState(Math.round(H * 0.4))
  const mascotHalf = mascot ? MASCOT / 2 : 0
  // The boundary hugs the content: right above it (+ the mascot's lower half), kept between
  // 30% and BOUNDARY_MAX of the screen — ~55% on a typical phone with typical content.
  const boundary = Math.max(Math.round(H * 0.3), Math.min(Math.round(H * BOUNDARY_MAX), H - contentH - mascotHalf - 8))
  const fadeLen = Math.round(H * FADE_FRAC)
  // Cover-scale the photo, then zoom, then place the focal point at 55% of the photo zone.
  const s = Math.max(W / SRC_W, H / SRC_H) * (focus.zoom || 1)
  const iw = SRC_W * s, ih = SRC_H * s
  const left = Math.min(0, Math.max(W - iw, W / 2 - focus.x * iw))
  const topY = Math.min(0, Math.max(boundary - ih, boundary * 0.55 - focus.y * ih))
  return (
    <View style={s_.root}>
      <StatusBar style="light" />
      {!!photo && (
        <View style={[s_.photoZone, { height: boundary }]}>
          <Image source={photo} style={{ position: 'absolute', left, top: topY, width: iw, height: ih }}
            resizeMode="cover" accessibilityIgnoresInvertColors />
        </View>
      )}
      <Image source={DARK} resizeMode="stretch"
        style={[s_.band, { top: 0, height: TOP_SCRIM_H, opacity: TOP_SCRIM / 0.6 }]} />
      <Image source={FADE} resizeMode="stretch" style={[s_.band, { top: boundary - fadeLen, height: fadeLen }]} />
      <View style={[s_.solid, { top: boundary }]} />
      {!!mascot && (
        <Image source={mascot} resizeMode="contain" accessibilityIgnoresInvertColors
          style={[s_.mascot, { top: boundary - mascotHalf, left: W / 2 - MASCOT / 2 }]} />
      )}
      {top}
      <View style={s_.content} onLayout={e => setContentH(Math.ceil(e.nativeEvent.layout.height))}>{children}</View>
    </View>
  )
}

const s_ = StyleSheet.create({
  root:      { flex: 1, backgroundColor: PHOTO_TEAL },
  photoZone: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  band:      { position: 'absolute', left: 0, right: 0, width: '100%' },
  solid:     { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: PHOTO_TEAL },
  mascot:    { position: 'absolute', width: MASCOT, height: MASCOT },
  content:   { position: 'absolute', left: 0, right: 0, bottom: 0 },
})
