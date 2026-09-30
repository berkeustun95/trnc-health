import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { REGION_LABEL_KEY } from '../../../constants/regions'
import { resolveHero } from '../../../constants/homeHero'
import { IconButton } from '../../ui'
import HeroCreditSheet from '../HeroCreditSheet'
import { rampLayers } from '../HomeHero'

// ~290pt city photograph: overline "Günaydın · {district}", headline, frosted 44pt bell and
// menu. The search pill is NOT inside: it floats over this hero's bottom edge and is
// rendered by the screen, so its search-open state can be the same element at the top.
//
// Kept from V2: the district photo (resolveHero), the tap-through to the pictured place,
// the photo-credit sheet, the ADA wordmark, and the stepped scrim.
//
// ─── CONTRAST, MEASURED ON THE REAL PHOTOS (p95 of the text rows, 3 device sizes) ───
// Headline (26/700 = large text, 3:1 floor) with this ramp (0.80 over 72%): worst Karpaz
// 5.74, generic 6.73, the rest 6.6–10.3. The 12pt overline could NOT be carried by a ramp
// that leaves the photo alive — bare it measures Karpaz 3.44 even at this ramp (2.65 at
// 0.72) — so it sits on its own rgba(0,0,0,0.60) pill: 5.74:1 over a pure-white pixel,
// i.e. whatever photo is behind it, today's five or any added later.
export const HERO_H = 290
export const PILL_OVERLAP = 26          // half the search pill's 52pt height

const TOP = rampLayers(0.32)
const BOTTOM = rampLayers(0.80)
const STEPS = TOP.length
const LOGO = require('../../../assets/hero/ada-wordmark-keyline.png')

export function greetingKey(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'hrGreetMorning'
  if (h >= 12 && h < 18) return 'hrGreetDay'
  return 'hrGreetEvening'
}

export default function RedesignHero({
  region, lang, hasUnread, hideActions, onShowNotifs, onOpenMenu, hamburgerRef, onOpenPlace,
}) {
  const insets = useSafeAreaInsets()
  const [creditOpen, setCreditOpen] = useState(false)
  const { source, placeId, credit, isGeneric } = resolveHero(region)
  const district = region && REGION_LABEL_KEY[region]
    ? t(REGION_LABEL_KEY[region], lang)
    : t('homeHeroFallbackTitle', lang)
  const height = HERO_H + insets.top
  const tappable = !!placeId

  const body = (
    <View style={StyleSheet.absoluteFill}>
      <Image source={source} style={s.photo} resizeMode="cover" fadeDuration={0} />
      {TOP.map((a, i) => (
        <View key={`t${i}`} pointerEvents="none"
          style={[s.band, { top: 0, height: (height * 0.4 / STEPS) * (i + 1), backgroundColor: `rgba(0,0,0,${a})` }]} />
      ))}
      {isGeneric && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]} />}
      {BOTTOM.map((a, i) => (
        <View key={`b${i}`} pointerEvents="none"
          style={[s.band, { bottom: 0, height: (height * 0.72 / STEPS) * (i + 1), backgroundColor: `rgba(0,0,0,${a})` }]} />
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
            <IconButton ref={hamburgerRef} icon="menu" variant="frosted" onPress={onOpenMenu}
              accessibilityLabel={t('uiMenu', lang)} />
          </View>
        )}
      </View>

      <View style={s.content} pointerEvents="box-none">
        <View style={s.overlineRow} pointerEvents="box-none">
          <Text style={s.overline} numberOfLines={1}>
            {t(greetingKey(), lang)} · {district}
          </Text>
          {!!credit && (
            <TouchableOpacity style={s.info} onPress={() => setCreditOpen(true)}
              hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
              accessibilityRole="button" accessibilityLabel={t('heroCreditTitle', lang)}>
              <Ionicons name="information" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.headline} numberOfLines={2} accessibilityRole="header">{t('hrHeadline', lang)}</Text>
      </View>

      <HeroCreditSheet visible={creditOpen} credit={credit} lang={lang} onClose={() => setCreditOpen(false)} />
    </View>
  )
}

const shadowText = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }

const s = StyleSheet.create({
  hero:        { overflow: 'hidden', backgroundColor: colors.border,
                 borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  photo:       { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  band:        { position: 'absolute', left: 0, right: 0 },
  topRow:      { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16,
                 flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { width: 40, height: 44 },
  actions:     { flexDirection: 'row', gap: 8 },
  content:     { position: 'absolute', left: 20, right: 20, bottom: PILL_OVERLAP + 20 },
  overlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  overline:    { ...type.meta, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', flexShrink: 1,
                 backgroundColor: 'rgba(0,0,0,0.60)', borderRadius: 13, overflow: 'hidden',
                 paddingHorizontal: 10, paddingVertical: 5 },
  info:        { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.42)',
                 justifyContent: 'center', alignItems: 'center' },
  headline:    { ...type.heroHeadline, color: '#FFFFFF', ...shadowText },
})
