import { View, Image, StyleSheet, useWindowDimensions } from 'react-native'

// The Oli ground as a full-width BAND (welcome, sign-in, profile setup): the Home Oli bar's
// gradient (#084B4A → #58B5AE) and glow, one mascot scene right-anchored in the right 40%,
// and `children` (white text) in the left BAND_TEXT_ZONE. Same rule as the Oli bar: text
// stays in the zone (labels:check), and check-hero-contrast renders this band at
// 320/360/393dp and takes the brightest pixel in the zone. `top` pads for a status bar the
// band runs under; the glow is placed relative to the band BODY below it.
export const BAND_H = 150
export const BAND_TEXT_ZONE = 0.56
export const BAND_TEXT_LEFT = 20
export const BAND_GLOW_SIZE = 140
// Type for text on the band (labels:check mirrors these): 1.15 growth, none below 350dp.
export const BAND_FONT_CAP = 1.15
export const BAND_FONT_CAP_NARROW = 1.0
export const bandCap = w => (w < 350 ? BAND_FONT_CAP_NARROW : BAND_FONT_CAP)
export const BAND_GLOW_CX = 0.8
export const BAND_GLOW_CY = 0.55
const ART_ZONE = 0.4
const BG = require('../../assets/oli-scenes/oli-bg.png')
const GLOW = require('../../assets/oli-scenes/oli-glow.png')

export default function OliBand({ scene, top = 0, height = BAND_H, children, style }) {
  const { width } = useWindowDimensions()
  const src = scene ? Image.resolveAssetSource(scene) : null
  const artH = src ? Math.min(height - 14, (width * ART_ZONE - 16) / (src.width / src.height)) : 0
  return (
    <View style={[{ height: height + top, overflow: 'hidden' }, style]}>
      <Image source={BG} resizeMode="stretch" style={s.fill} />
      <Image source={GLOW} style={{ position: 'absolute', width: BAND_GLOW_SIZE, height: BAND_GLOW_SIZE,
        left: width * BAND_GLOW_CX - BAND_GLOW_SIZE / 2, top: top + height * BAND_GLOW_CY - BAND_GLOW_SIZE / 2 }} />
      {!!scene && (
        <Image source={scene} resizeMode="contain" accessibilityIgnoresInvertColors
          style={{ position: 'absolute', right: 16, bottom: 0, height: artH, width: artH * src.width / src.height }} />
      )}
      <View style={[s.text, { top, width: width * BAND_TEXT_ZONE }]}>{children}</View>
    </View>
  )
}

const s = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  text: { position: 'absolute', bottom: 0, left: 0, paddingLeft: BAND_TEXT_LEFT, justifyContent: 'center' },
})
