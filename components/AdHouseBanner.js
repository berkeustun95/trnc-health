import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { colors } from '../constants/theme'
import { adRatioFor } from '../constants/ads'

// ─── ADA's own banner, shown by AdSlot in the two AD_HOUSE_PLACEMENTS ───────
//
// Same box as a paid 3.2:1 banner, so a sold campaign replaces it without moving anything. NO "Sponsorlu"
// label: it is not an advert, it is ADA. Only AdSlot may import this (check-ad-placement.mjs).
//
// PARKED PLACEHOLDER: the content (emblem chip, one title, one CTA) is not final. Copy and artwork are
// parked (Berke 2026-11-22); the box, the tap and the counters are what this slice ships.
// boxRef: AdSlot measures this box to tell whether the banner is on screen (the margin sits outside it).
export default function AdHouseBanner({ boxRef, position, lang, onPress }) {
  return (
    <View ref={boxRef} collapsable={false} style={s.box}>
      <TouchableOpacity
        style={[s.slot, { aspectRatio: adRatioFor(position) }]}
        onPress={onPress}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={`${t('adHouseTitle', lang)}. ${t('adHouseCta', lang)}`}
      >
        <View style={s.chip}>
          <Image source={require('../assets/brand/v2/ada-emblem.webp')} style={s.emblem} resizeMode="contain" />
        </View>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={2}>{t('adHouseTitle', lang)}</Text>
          <View style={s.cta}>
            <Text style={s.ctaText} numberOfLines={1}>{t('adHouseCta', lang)}</Text>
            <Ionicons name="arrow-forward" size={13} color="#FFFFFF" />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  // Same rules as AdSlot's s.slot; the fill is the app's teal instead of artwork.
  box: { width: '100%', marginTop: 24 },
  slot: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
  },
  chip: {
    width: 56, height: 56, borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  emblem: { width: 38, height: 38 },
  text: { flex: 1, gap: 8 },
  title: { fontSize: 15, lineHeight: 19, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  cta: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%',
    backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FFFFFF',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3,
  },
  ctaText: { flexShrink: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
})
