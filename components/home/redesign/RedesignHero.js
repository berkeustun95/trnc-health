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

// The district photograph: ADA wordmark + frosted bell (and menu while the drawer exists),
// and ONE line of text — the district, on a dark pill, with the photo-credit "i" beside it.
// No greeting, no headline, no search: search lives in the Oli card below (Slice 1 rev).
//
// Kept from V2: the district photo (resolveHero), the tap-through to the pictured place,
// the photo-credit sheet, the wordmark.
//
// ─── CONTRAST IS CARRIED BY THE PILL, NOT THE PHOTO ─────────────────────────
// White 12pt on rgba(0,0,0,HERO_PILL_ALPHA) is 5.74:1 over a pure-white pixel, so it holds
// on any photo, today's five or any added later. Measured on the real photos the BARE line
// failed 4 of 6 (Karpaz 2.65). scripts/check-hero-contrast.mjs reads HERO_PILL_ALPHA from
// this file and fails below 4.5:1.
export const HERO_H = 196
export const HERO_PILL_ALPHA = 0.6

const TOP = rampLayers(0.32)
const BOTTOM = rampLayers(0.35)
const STEPS = TOP.length
const LOGO = require('../../../assets/hero/ada-wordmark-keyline.png')

export default function RedesignHero({
  region, lang, hasUnread, hideActions, onShowNotifs, onOpenMenu, hamburgerRef, onOpenPlace,
}) {
  const insets = useSafeAreaInsets()
  const [creditOpen, setCreditOpen] = useState(false)
  const { source, placeId, credit, isGeneric, landmark } = resolveHero(region)
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
        {/* "{district} · {landmark}". The landmark is a Turkish proper name in every locale
            and is the ONLY part allowed to ellipsize: the district never shrinks. */}
        <View style={s.chip} accessibilityRole="text" accessibilityLabel={landmark ? `${district}, ${landmark}` : district}>
          <Ionicons name="location" size={13} color="#FFFFFF" />
          <Text style={s.chipText} numberOfLines={1}>{district}</Text>
          {!!landmark && (
            <>
              <Text style={s.chipText}>·</Text>
              <Text style={[s.chipText, s.chipLandmark]} numberOfLines={1} ellipsizeMode="tail">{landmark}</Text>
            </>
          )}
        </View>
        {!!credit && (
          <TouchableOpacity style={s.info} onPress={() => setCreditOpen(true)}
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            accessibilityRole="button" accessibilityLabel={t('heroCreditTitle', lang)}>
            <Ionicons name="information" size={14} color="#FFFFFF" />
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
  chipRow:  { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip:     { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1,
              backgroundColor: `rgba(0,0,0,${HERO_PILL_ALPHA})`, borderRadius: 999,
              paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { ...type.meta, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', flexShrink: 0 },
  chipLandmark: { fontFamily: 'Inter_500Medium', flexShrink: 1 },
  info:     { width: 26, height: 26, borderRadius: 13, backgroundColor: `rgba(0,0,0,${HERO_PILL_ALPHA})`,
              justifyContent: 'center', alignItems: 'center' },
})
