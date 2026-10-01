import { useSyncExternalStore } from 'react'
import { View, Image, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../../constants/theme'

// Module photo behind a module screen — two candidate styles, compared on device before one
// is applied to every module (Berke, 2026-10-01):
//   'photo' (A) — the photo across the top (PHOTO_H + status bar), a top scrim for the WHITE
//                 header text, fading into the canvas; dropdowns and cards scroll over the fade.
//   'wash'  (C) — the photo behind the whole screen under a canvas-coloured veil (WASH_VEIL);
//                 the header stays dark text, cards stay white.
// check-hero-contrast measures both on the real module photos (320/360/393dp):
//   A: white text over the photo darkened by HEADER_SCRIM (solid over `textZone`, then a
//      SCRIM_FADE-pt fade) — the first try (a 0.5 scrim fading at once) gave 1.06–3.7:1 over
//      these bright skies, so the scrim HOLDS over every line of text that sits on the photo.
//   C: textPrimary (8.9:1) and WASH_SECONDARY (5.46:1; colors.textSecondary was 3.6:1 over the
//      darkest veiled pixel) — so secondary text drawn directly on the wash uses WASH_SECONDARY.
//
// The style is a DEV-ONLY toggle (BackdropToggle, a chip shown only in __DEV__ builds), held in
// a module store so all three screens switch together. Release builds (ADA Preview) use the
// default, DEFAULT_BACKDROP.
export const PHOTO_H = 300
export const WASH_VEIL = 0.82
export const HEADER_SCRIM = 0.6
export const SCRIM_FADE = 80
export const WASH_SECONDARY = '#3E4A59'
export const DEFAULT_BACKDROP = 'photo'
const DARK_FADE = require('../../assets/oli-scenes/dark-fade.png')
const CANVAS_FADE = require('../../assets/oli-scenes/canvas-fade.png')

let mode = DEFAULT_BACKDROP
const subs = new Set()
const store = {
  get: () => mode,
  set: m => { mode = m; subs.forEach(f => f()) },
  subscribe: f => { subs.add(f); return () => subs.delete(f) },
}
export function useBackdropMode() {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

// textZone: pt below the status bar that carries white text on the photo (header 64 by default;
// the facility list's title + subtitle + search need more).
export default function ModuleBackdrop({ photo, textZone = 64 }) {
  const m = useBackdropMode()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  if (!photo) return null
  if (m === 'wash') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, opacity: WASH_VEIL }]} />
      </View>
    )
  }
  const h = Math.max(PHOTO_H, textZone + SCRIM_FADE + 60) + insets.top
  const fade = Math.round(h * 0.45)
  return (
    <View pointerEvents="none" style={[s.top, { height: Math.min(h, height) }]}>
      <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      <View style={[s.band, { top: 0, height: insets.top + textZone, backgroundColor: `rgba(0,0,0,${HEADER_SCRIM})` }]} />
      <Image source={DARK_FADE} resizeMode="stretch" style={[s.band, { top: insets.top + textZone, height: SCRIM_FADE }]} />
      <Image source={CANVAS_FADE} resizeMode="stretch" style={[s.band, { bottom: 0, height: fade }]} />
    </View>
  )
}

// The screen's text tone for the current style: 'light' (white, over the photo — A) or 'wash'
// (dark text, secondary in WASH_SECONDARY — C). ScreenHeader and EmptyState take it as `tone`.
export function useBackdropHeaderTone() {
  return useBackdropMode() === 'photo' ? 'light' : 'wash'
}

export function BackdropToggle() {
  const m = useBackdropMode()
  const insets = useSafeAreaInsets()
  if (!__DEV__) return null
  return (
    <TouchableOpacity style={[s.toggle, { bottom: insets.bottom + 16 }]} activeOpacity={0.8}
      onPress={() => store.set(m === 'photo' ? 'wash' : 'photo')}
      accessibilityRole="button" accessibilityLabel={`DEV backdrop ${m}`}>
      <Text style={s.toggleText}>DEV · {m === 'photo' ? 'A photo header' : 'C soft wash'}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  top:        { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  band:       { position: 'absolute', left: 0, right: 0, width: '100%' },
  toggle:     { position: 'absolute', left: 16, minHeight: 36, paddingHorizontal: 12, justifyContent: 'center',
                borderRadius: radii.pill, backgroundColor: 'rgba(26,43,51,0.85)' },
  toggleText: { ...type.meta, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
})
