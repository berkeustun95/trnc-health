import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { t } from '../constants/i18n'
import { colors, font, type, press } from '../constants/theme'
import { adRatioFor } from '../constants/ads'

// ─── ADA's own banner, shown by AdSlot in the two AD_HOUSE_PLACEMENTS ───────
//
// Same box as a paid 3.2:1 banner, so a sold campaign replaces it without moving anything. NO "Sponsorlu"
// label: it is not an advert, it is ADA. Only AdSlot may import this (check-ad-placement.mjs).
// "Empty space" card (Berke 2026-11-23): deep teal, dashed white frame, headline + line left, pill right.
// The whole card is the tap target; the pill is visual only.
// Fit rule (Berke): headline and line max 2 lines each; when they do not fit the frame, drop the line first,
// and only then shrink the headline. Nothing may clip. numberOfLines hides overflow from layout, so the
// decision reads unclamped hidden copies of the two texts (same width, same styles). The headline shrinks in
// steps of font size AND line height together (adjustsFontSizeToFit keeps the line height, leaving a gap).
// boxRef: AdSlot measures this box to tell whether the banner is on screen (the margin sits outside it).
export default function AdHouseBanner({ boxRef, position, lang, onPress }) {
  const [room, setRoom] = useState(0)
  const [k, setK] = useState(1)
  const [title, setTitle] = useState({ lines: 0, lk: 0, h: 0, hk: 0 })
  const [line, setLine] = useState({ lines: 0, h: 0 })

  useEffect(() => { setK(1) }, [lang])

  const titleMeasured = title.lk === k && title.hk === k && title.h > 0
  const measured = room > 0 && titleMeasured && line.h > 0
  const titleFits = title.lines <= 2 && title.h <= room
  const showLine = k === 1 && titleFits && line.lines <= 2 && title.h + TEXT_GAP + line.h <= room
  const canShrink = k > MIN_TITLE_SCALE + 0.001
  const settled = measured && (titleFits || !canShrink)

  useEffect(() => {
    if (measured && !titleFits && canShrink) setK(Math.round((k - TITLE_STEP) * 100) / 100)
  }, [measured, titleFits, canShrink, k])

  const titleScaled = [s.title, { fontSize: s.title.fontSize * k, lineHeight: s.title.lineHeight * k }]

  return (
    <View ref={boxRef} collapsable={false} style={s.box}>
      <TouchableOpacity
        style={[s.slot, { aspectRatio: adRatioFor(position) }]}
        onPress={onPress}
        activeOpacity={press.card}
        accessibilityRole="button"
        accessibilityLabel={`${t('adHouseTitle', lang)}. ${t('adHouseCta', lang)}`}
      >
        <View style={s.frame} onLayout={e => setRoom(e.nativeEvent.layout.height - 2 * (FRAME_BORDER + FRAME_PAD_V))}>
          <View style={s.text} importantForAccessibility="no-hide-descendants">
            <View style={s.probe} pointerEvents="none">
              <Text
                style={titleScaled}
                maxFontSizeMultiplier={TEXT_SCALE_CAP}
                onTextLayout={e => { const n = e.nativeEvent.lines.length; setTitle(p => (p.lines === n && p.lk === k ? p : { ...p, lines: n, lk: k })) }}
                onLayout={e => { const h = e.nativeEvent.layout.height; setTitle(p => (p.h === h && p.hk === k ? p : { ...p, h, hk: k })) }}
              >
                {t('adHouseTitle', lang)}
              </Text>
              <Text
                style={s.line}
                maxFontSizeMultiplier={TEXT_SCALE_CAP}
                onTextLayout={e => { const n = e.nativeEvent.lines.length; setLine(p => (p.lines === n ? p : { ...p, lines: n })) }}
                onLayout={e => { const h = e.nativeEvent.layout.height; setLine(p => (p.h === h ? p : { ...p, h })) }}
              >
                {t('adHouseLine', lang)}
              </Text>
            </View>
            <View style={!settled && s.hidden}>
              <Text
                style={[titleScaled, room > 0 && { maxHeight: room }]}
                numberOfLines={2}
                adjustsFontSizeToFit={settled && !titleFits}
                minimumFontScale={0.8}
                maxFontSizeMultiplier={TEXT_SCALE_CAP}
              >
                {t('adHouseTitle', lang)}
              </Text>
              {showLine && (
                <Text style={[s.line, s.lineGap]} numberOfLines={2} maxFontSizeMultiplier={TEXT_SCALE_CAP}>
                  {t('adHouseLine', lang)}
                </Text>
              )}
            </View>
          </View>
          <View style={s.pill} importantForAccessibility="no-hide-descendants">
            <Text
              style={s.pillText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={PILL_SCALE_CAP}
            >
              {t('adHouseCta', lang)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  )
}

const FRAME_BORDER = 1.5
const FRAME_PAD_V = 4
const TEXT_GAP = 2
const TEXT_SCALE_CAP = 1.6
const TITLE_STEP = 0.05
const MIN_TITLE_SCALE = 0.6
const PILL_SCALE_CAP = 1.4

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
    gap: 12,
    borderWidth: FRAME_BORDER,
    borderStyle: 'dashed',
    borderColor: colors.onPrimary,
    borderRadius: 8,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: FRAME_PAD_V,
    overflow: 'hidden',
  },
  text: { flex: 1 },
  probe: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  hidden: { opacity: 0 },
  title: { ...type.rowTitle, fontFamily: font.bold, color: colors.onPrimary },
  line: { ...type.meta, fontFamily: font.regular, color: colors.onPrimary },
  lineGap: { marginTop: TEXT_GAP },
  pill: {
    flexShrink: 0,
    maxWidth: '50%',
    backgroundColor: colors.onPrimary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillText: { ...type.small, fontFamily: font.bold, color: colors.primaryDark, textAlign: 'center' },
})
