import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native'
import { t } from '../constants/i18n'
import { colors } from '../constants/theme'
import { adRatioFor } from '../constants/ads'

// ─── ADA's own banner, shown by AdSlot in the two AD_HOUSE_PLACEMENTS ───────
//
// Same box as a paid 3.2:1 banner, so a sold campaign replaces it without moving anything. NO "Sponsorlu"
// label: it is not an advert, it is ADA. Only AdSlot may import this (check-ad-placement.mjs).
// "Empty space" card (Berke 2026-11-23): deep teal, dashed white frame, headline + line left, pill right.
// The whole card is the tap target; the pill is visual only.
// Fit rule: when a locale or a large font makes the text column taller than the frame, the supporting line
// is dropped first; only then may the headline shrink (adjustsFontSizeToFit). Nothing clips the frame.
// boxRef: AdSlot measures this box to tell whether the banner is on screen (the margin sits outside it).
export default function AdHouseBanner({ boxRef, position, lang, onPress }) {
  const { fontScale } = useWindowDimensions()
  const [room, setRoom] = useState(0)
  const [need, setNeed] = useState(0)
  const [showLine, setShowLine] = useState(true)

  useEffect(() => { setShowLine(true) }, [lang, fontScale])
  useEffect(() => {
    if (showLine && room > 0 && need > room) setShowLine(false)
  }, [showLine, room, need])

  const measured = room > 0 && need > 0
  return (
    <View ref={boxRef} collapsable={false} style={s.box}>
      <TouchableOpacity
        style={[s.slot, { aspectRatio: adRatioFor(position) }]}
        onPress={onPress}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={`${t('adHouseTitle', lang)}. ${t('adHouseCta', lang)}`}
      >
        <View style={s.frame} onLayout={e => setRoom(e.nativeEvent.layout.height - 2 * (FRAME_BORDER + FRAME_PAD_V))}>
          <View
            style={[s.text, !measured && s.hidden]}
            onLayout={e => setNeed(e.nativeEvent.layout.height)}
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={s.title} numberOfLines={2} adjustsFontSizeToFit={!showLine} minimumFontScale={0.7}>
              {t('adHouseTitle', lang)}
            </Text>
            {showLine && <Text style={s.line} numberOfLines={2}>{t('adHouseLine', lang)}</Text>}
          </View>
          <View style={s.pill} importantForAccessibility="no-hide-descendants">
            <Text style={s.pillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {t('adHouseCta', lang)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  )
}

const FRAME_BORDER = 1.5
const FRAME_PAD_V = 6

const s = StyleSheet.create({
  box: { width: '100%', marginTop: 24 },
  slot: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.primaryDark,
    padding: 8,
  },
  frame: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: FRAME_BORDER,
    borderStyle: 'dashed',
    borderColor: colors.onPrimary,
    borderRadius: 8,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: FRAME_PAD_V,
    overflow: 'hidden',
  },
  text: { flex: 1, gap: 3 },
  hidden: { opacity: 0 },
  title: { fontSize: 15, lineHeight: 19, fontFamily: 'Inter_700Bold', color: colors.onPrimary },
  line: { fontSize: 12, lineHeight: 16, fontFamily: 'Inter_400Regular', color: colors.onPrimary },
  pill: {
    flexShrink: 0,
    maxWidth: '42%',
    backgroundColor: colors.onPrimary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primaryDark, textAlign: 'center' },
})
