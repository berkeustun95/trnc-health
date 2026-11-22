import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../../../constants/i18n'
import { press, colors, radii, space, type, font } from '../../../constants/theme'
import { TILE_FONT_CAP } from './Widgets'

// ─── Home: Veles Bit Postası banner (Berke, 2026-11-22) ─────────────────────
// A news site card under the hero, before the Oli bar. Fixed 64pt; every text is one line and the
// font may grow only to TILE_FONT_CAP. Shown only while VELES is on (HomeScreen decides). NOT an ad:
// no "Sponsorlu", nothing from ad_banners. The pill says the site is in Turkish and is hidden for
// Turkish readers. The logo is ONE file (assets/veles/veles-logo.png): swapping it is a one-file change.
export const VELES_BANNER_H = 64
export const VELES_BANNER_GAP = 12
export const VELES_BANNER_BLOCK_H = VELES_BANNER_GAP + VELES_BANNER_H   // marginTop + card, what the hero gives back / the Oli check adds
export const VELES_NAME = 'Veles Bit Postası'
// TODO(Berke): Veles brand colour (neutral placeholder until the brand is supplied)
export const VELES_BRAND = '#3F4E57'

const LOGO = require('../../../assets/veles/veles-logo.png')

export default function VelesBanner({ lang, onPress }) {
  const inTurkish = lang !== 'Turkish'
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card} accessibilityRole="link"
      accessibilityLabel={t('velesBannerA11y', lang)}>
      <Image source={LOGO} style={s.logo} resizeMode="cover" accessibilityIgnoresInvertColors />
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={TILE_FONT_CAP}>{VELES_NAME}</Text>
        <Text style={s.sub} numberOfLines={1} maxFontSizeMultiplier={TILE_FONT_CAP}>{t('velesBannerSub', lang)}</Text>
      </View>
      {inTurkish && (
        <View style={s.pill}>
          <Text style={s.pillText} numberOfLines={1} maxFontSizeMultiplier={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {t('velesBannerInTurkish', lang)}
          </Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={20} color={colors.tileInk} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:     { height: VELES_BANNER_H, flexDirection: 'row', alignItems: 'center', gap: space[12], backgroundColor: colors.card,
              borderRadius: radii.widget, paddingHorizontal: space[12], overflow: 'hidden' },
  logo:     { width: 44, height: 44, borderRadius: radii.md },
  text:     { flex: 1, minWidth: 0, gap: 1 },
  title:    { fontSize: 15, lineHeight: 20, fontFamily: font.bold, color: VELES_BRAND },
  sub:      { ...type.meta, color: colors.tileInk },
  pill:     { flexShrink: 1, maxWidth: 96, backgroundColor: colors.soft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { ...type.meta, fontFamily: font.bold, color: colors.tileInk },
})
