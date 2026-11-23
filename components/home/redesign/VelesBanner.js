import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { t } from '../../../constants/i18n'
import { press, colors, radii, space, type, font, elevation } from '../../../constants/theme'
import { TILE_FONT_CAP } from './Widgets'

// ─── Home: Velesbit Postası banner (Berke, 2026-11-22) ─────────────────────
// A news site card under the hero, before the Oli bar. Fixed 64pt; every text is one line and the
// font may grow only to TILE_FONT_CAP. Shown only while VELES is on (HomeScreen decides). NOT an ad:
// no "Sponsorlu", nothing from ad_banners. The pill says the site is in Turkish and is hidden for
// Turkish readers. The logo is assets/veles/veles-logo-trimmed.png: Velesbit's own 1024×1024 file
// (veles-logo.png, kept as delivered) cropped to the drawing, pixels unchanged.
export const VELES_BANNER_H = 64
export const VELES_BANNER_GAP = 12
export const VELES_BANNER_BLOCK_H = VELES_BANNER_GAP + VELES_BANNER_H   // marginTop + card, what the hero gives back / the Oli check adds
export const VELES_NAME = 'Velesbit Postası'
// Velesbit's brand blue (Berke, 2026-11-23), the logo's own ink. Used on this banner only.
export const VELES_BRAND = '#0A5688'
// Their brand line: Turkish in every UI language, never translated (Berke, 2026-11-23).
export const VELES_SLOGAN = 'Adanın bütün haberleri tek sepette.'

const LOGO = require('../../../assets/veles/veles-logo-trimmed.png')

export default function VelesBanner({ lang, onPress }) {
  // Non-Turkish UIs: a "TR" badge says the news is in Turkish (the a11y label says it in full). The slogan gets
  // the whole second line: with a translated pill beside it, it was cut at 360 wide (Berke chose this, 2026-11-23).
  const showTurkishBadge = lang !== 'Turkish'
  return (
    <TouchableOpacity style={[s.card, elevation.card]} onPress={onPress} activeOpacity={press.card} accessibilityRole="link"
      accessibilityLabel={t('velesBannerA11y', lang)}>
      <Image source={LOGO} style={s.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
      <View style={s.text}>
        <View style={s.line1}>
          <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={TILE_FONT_CAP}>{VELES_NAME}</Text>
          {showTurkishBadge ? (
            <View style={s.badge}><Text style={s.badgeText} maxFontSizeMultiplier={TILE_FONT_CAP}>TR</Text></View>
          ) : null}
        </View>
        <Text style={s.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_FONT_CAP}>{VELES_SLOGAN}</Text>
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:     { height: VELES_BANNER_H, flexDirection: 'row', alignItems: 'center', gap: space[12], backgroundColor: colors.card,
              borderRadius: radii.widget, paddingHorizontal: space[12] },
  logo:     { width: 44, height: 44 },
  text:     { flex: 1, minWidth: 0, gap: 1 },
  line1:    { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  title:    { ...type.rowTitle, color: VELES_BRAND, flexShrink: 1 },
  sub:      { ...type.meta, color: colors.tileInk },
  badge:    { flexShrink: 0, backgroundColor: colors.soft, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { ...type.meta, fontFamily: font.bold, color: colors.tileInk },
})
