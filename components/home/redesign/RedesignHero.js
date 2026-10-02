import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { REGION_LABEL_KEY } from '../../../constants/regions'
import { resolveHero } from '../../../constants/homeHero'
import { weatherGroup, weatherLabelKey } from '../../../utils/facilityUtils'
import { IconButton } from '../../ui'
import HeroCreditSheet from '../HeroCreditSheet'
import { rampLayers } from '../HomeHero'

// The district photograph: ADA wordmark + frosted bell, and one row at the bottom — the
// district chip with its photo-credit "i" on the left, the weather chip on the right (Home v3:
// the weather tile left Home; the chip opens the weather sheet). No greeting, no search.
//
// ─── WHEN THE ROW IS TIGHT ──────────────────────────────────────────────────
// The weather chip is icon + temperature only and never shrinks. The location chip gets the
// rest: at 360dp+ "{district} · {landmark}" fits whole in all 9 locales (at 393dp+ at every
// font size); on narrower phones, or at 360dp with the largest font, ONLY the landmark
// ellipsizes. labels:check measures each district with its own landmark.
//
// Kept from V2: the district photo (resolveHero), the tap-through to the pictured place,
// the photo-credit sheet, the wordmark.
//
// ─── CONTRAST IS CARRIED BY THE PILL, NOT THE PHOTO ─────────────────────────
// White 12pt on rgba(0,0,0,HERO_PILL_ALPHA) is 5.74:1 over a pure-white pixel, so it holds
// on any photo, today's five or any added later. Measured on the real photos the BARE line
// failed 4 of 6 (Karpaz 2.65). scripts/check-hero-contrast.mjs reads HERO_PILL_ALPHA from
// this file and fails below 4.5:1.
// Home v3: 230pt INCLUDING the status bar (Berke, "shorter, ~230"), never less than the
// top row + chip row need under a tall inset.
export const HERO_TOTAL = 230
export const HERO_MIN_BODY = 176
export const HERO_PILL_ALPHA = 0.6
export const CHIP_CAP = 1.2   // large system text: the chip grows at most 1.2×
export const CHIP_CAP_NARROW = 1.0   // below 350dp the row cannot take growth (Gazimağusa + temp)
// Chip geometry, read by labels:check. Location: pad 2·CHIP_PAD, gaps CHIP_GAP, the inline "i".
// Weather: pad 2·WX_PAD, icon, gap, temperature. One ROW_GAP between them (space-between).
export const CHIP_PAD = 11
export const CHIP_GAP = 5
export const INFO_ICON = 15
export const WX_PAD = 9
export const WX_ICON = 14
export const ROW_GAP = 8

const TOP = rampLayers(0.32)
const BOTTOM = rampLayers(0.35)
const STEPS = TOP.length
const LOGO = require('../../../assets/hero/ada-wordmark-keyline.png')

const WEATHER_ION = {
  clear: 'sunny', partlyCloudy: 'partly-sunny', overcast: 'cloudy', fog: 'cloudy',
  drizzle: 'rainy', rain: 'rainy', snow: 'snow', showers: 'rainy', thunder: 'thunderstorm',
}

export const heroHeight = insetTop => Math.max(HERO_TOTAL, insetTop + HERO_MIN_BODY)

export default function RedesignHero({
  region, lang, hasUnread, hideActions, onShowNotifs, onOpenMenu, hamburgerRef, onOpenPlace,
  weatherData, onOpenWeather, weatherRef,
}) {
  const insets = useSafeAreaInsets()
  const chipCap = useWindowDimensions().width < 350 ? CHIP_CAP_NARROW : CHIP_CAP
  const [creditOpen, setCreditOpen] = useState(false)
  const { source, placeId, credit, isGeneric, landmark } = resolveHero(region)
  const district = region && REGION_LABEL_KEY[region]
    ? t(REGION_LABEL_KEY[region], lang)
    : t('homeHeroFallbackTitle', lang)
  const height = heroHeight(insets.top)
  const cur = weatherData?.current
  const temp = cur?.temperature_2m != null ? `${Math.round(cur.temperature_2m)}°` : null
  // The tile's short forecast term for "partly cloudy" (ru/fr/es), as the tile had.
  const condKey = cur ? weatherLabelKey(cur.symbol) : null
  const cond = condKey ? t(condKey === 'weatherPartlyCloudy' ? 'hrWxPartlyTile' : condKey, lang) : null
  const tappable = !!placeId

  const body = (
    <View style={StyleSheet.absoluteFill}>
      <Image source={source} style={s.photo} resizeMode="cover" fadeDuration={0} />
      {TOP.map((a, i) => (
        <View key={`t${i}`} pointerEvents="none"
          style={[s.band, { top: 0, height: (height * 0.45 / STEPS) * (i + 1), backgroundColor: `rgba(0,0,0,${a})` }]} />
      ))}
      {isGeneric && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]} />}
      {BOTTOM.map((a, i) => (
        <View key={`b${i}`} pointerEvents="none"
          style={[s.band, { bottom: 0, height: (height * 0.45 / STEPS) * (i + 1), backgroundColor: `rgba(0,0,0,${a})` }]} />
      ))}
    </View>
  )

  return (
    <View style={[s.hero, { height }]}>
      {tappable ? (
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={0.92} onPress={() => onOpenPlace?.(placeId)}
          accessibilityRole="button" accessibilityLabel={district}>
          {body}
        </TouchableOpacity>
      ) : body}

      <View style={[s.topRow, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Image source={LOGO} style={s.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
        {!hideActions && (
          <View style={s.actions}>
            <IconButton icon="notifications-outline" variant="frosted" onPress={onShowNotifs}
              badge={hasUnread} accessibilityLabel={t('notifications', lang)} />
            {!!onOpenMenu && (
              <IconButton ref={hamburgerRef} icon="menu" variant="frosted" onPress={onOpenMenu}
                accessibilityLabel={t('uiMenu', lang)} />
            )}
          </View>
        )}
      </View>

      <View style={s.chipRow} pointerEvents="box-none">
        {/* "{district} · {landmark}" with the photo-credit "i" INSIDE the chip: the whole chip
            opens the credit sheet. At 360dp+ the full text fits in all 9 locales (labels:check);
            the landmark — a Turkish proper name in every locale — is the only part that may
            ellipsize, on narrower phones or at large font sizes. The district never shrinks. */}
        <TouchableOpacity style={s.chip} disabled={!credit} onPress={() => setCreditOpen(true)} activeOpacity={0.8}
          hitSlop={{ top: 9, bottom: 9 }} accessibilityRole={credit ? 'button' : 'text'}
          accessibilityLabel={[district, landmark, credit ? t('heroCreditTitle', lang) : null].filter(Boolean).join(', ')}>
          <Text style={s.chipText} numberOfLines={1} maxFontSizeMultiplier={chipCap}>{district}</Text>
          {!!landmark && (
            <>
              <Text style={s.chipText} maxFontSizeMultiplier={chipCap}>·</Text>
              <Text style={[s.chipText, s.chipLandmark]} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={chipCap}>{landmark}</Text>
            </>
          )}
          {!!credit && <Ionicons name="information-circle-outline" size={INFO_ICON} color="#FFFFFF" />}
        </TouchableOpacity>
        {/* Icon + temperature only; the condition is in the label and the weather sheet. No
            weather yet (loading, or the call failed — weatherData stays null) → no chip. */}
        {!!temp && (
          <TouchableOpacity ref={weatherRef} collapsable={false} style={[s.chip, s.wxChip]} onPress={onOpenWeather}
            hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="button"
            accessibilityLabel={[t('homeWeatherTitle', lang), temp, cond].filter(Boolean).join(', ')}>
            <Ionicons name={WEATHER_ION[weatherGroup(cur.symbol)] || 'thermometer'} size={WX_ICON} color="#FFFFFF" />
            <Text style={s.chipText} maxFontSizeMultiplier={chipCap}>{temp}</Text>
          </TouchableOpacity>
        )}
      </View>

      <HeroCreditSheet visible={creditOpen} credit={credit} lang={lang} onClose={() => setCreditOpen(false)} />
    </View>
  )
}

const s = StyleSheet.create({
  hero:     { overflow: 'hidden', backgroundColor: colors.border,
              borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  photo:    { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  band:     { position: 'absolute', left: 0, right: 0 },
  topRow:   { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo:     { width: 40, height: 44 },
  actions:  { flexDirection: 'row', gap: 8 },
  chipRow:  { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ROW_GAP },
  chip:     { flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP, flexShrink: 1,
              backgroundColor: `rgba(0,0,0,${HERO_PILL_ALPHA})`, borderRadius: 999,
              paddingHorizontal: CHIP_PAD, paddingVertical: 6 },
  chipText: { ...type.meta, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', flexShrink: 0 },
  chipLandmark: { fontFamily: 'Inter_500Medium', flexShrink: 1 },
  wxChip:   { flexShrink: 0, paddingHorizontal: WX_PAD, gap: 4 },
})
