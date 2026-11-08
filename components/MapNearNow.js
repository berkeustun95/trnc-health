// "Yakınımda şimdi" on the Keşfet map (stage 3): a pill over the map, and a panel of the nearest
// things open right now (constants/nearNow.js decides what is in it).
import { useEffect } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { addBackListener } from '../utils/backHandler'
import { eventIcon } from '../constants/mapEvents'
import { GROUP_META } from '../constants/exploreCategories'
import { IconButton } from './ui'
import { EVENT_INK } from './MapEvents'

const NEAR_INK = colors.primaryDark
const dist = (d, lang) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace('.', lang === 'en' ? '.' : ',')} km`)
const hhmm = s => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export function NearNowPill({ onPress, lang, bottom }) {
  return (
    <TouchableOpacity style={[s.pill, bottom != null && { bottom }]} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={t('nearNowTitle', lang)}>
      <Ionicons name="navigate" size={15} color="#fff" />
      <Text style={s.pillText}>{t('nearNowTitle', lang)}</Text>
    </TouchableOpacity>
  )
}

function rowLook(item, lang, nameOf) {
  if (item.kind === 'event') {
    const e = item.event
    return { icon: eventIcon(e.category), ink: EVENT_INK, title: e.title, note: `${t('dateToday', lang)} ${hhmm(e.start_date)}` }
  }
  const p = item.pin
  if (item.kind === 'duty') return { icon: 'medkit', ink: colors.accent, title: p.row.name, note: t('nearNowDuty', lang), ok: true }
  if (item.kind === 'eatery') return { icon: 'restaurant', ink: p.color, title: p.row.name, note: t('openNow', lang), ok: true }
  return { icon: GROUP_META[p.group]?.icon || 'location', ink: p.color, title: nameOf(p.row, lang),
           note: item.open === true ? t('openNow', lang) : null, ok: item.open === true }
}

export function NearNowPanel({ items, hasPos, locating, onLocate, onOpen, onClose, nameOf, lang, bottom, maxHeight }) {
  useEffect(() => {
    const sub = addBackListener(() => { onClose(); return true })
    return () => sub.remove()
  }, [onClose])
  return (
    <View style={[s.panel, bottom != null && { bottom }, { maxHeight }]}>
      <View style={s.head}>
        <Text style={s.title}>{t('nearNowTitle', lang)}</Text>
        <IconButton icon="close" onPress={onClose} accessibilityLabel={t('uiClose', lang)} color={colors.textSecondary} style={s.close} />
      </View>
      {!hasPos ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>{t('nearNowNeedLocation', lang)}</Text>
          <TouchableOpacity style={s.cta} onPress={onLocate} disabled={locating} activeOpacity={press.card} accessibilityRole="button">
            <Ionicons name="locate" size={16} color="#fff" />
            <Text style={s.ctaText}>{t('locateMe', lang)}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={s.empty}><Text style={s.emptyText}>{t('nearNowEmpty', lang)}</Text></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {items.map(item => {
            const l = rowLook(item, lang, nameOf)
            return (
              <TouchableOpacity key={item.key} style={s.row} onPress={() => onOpen(item)} activeOpacity={press.card}
                accessibilityRole="button" accessibilityLabel={l.title}>
                <View style={[s.dot, { backgroundColor: l.ink }]}><Ionicons name={l.icon} size={16} color="#fff" /></View>
                <View style={s.body}>
                  <Text style={s.name} numberOfLines={1}>{l.title}</Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {dist(item.km, lang)}
                    {!!l.note && <Text style={l.ok ? s.ok : null}>{`  ·  ${l.note}`}</Text>}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  pill:      { position: 'absolute', left: 16, bottom: 24, flexDirection: 'row', alignItems: 'center', gap: 8,
               paddingHorizontal: 16, paddingVertical: 11, borderRadius: radii.pill, backgroundColor: NEAR_INK, ...elevation.floating },
  pillText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  panel:     { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.cardBg, borderRadius: radii.card,
               paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, ...elevation.floating },
  head:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title:     { ...type.sheetTitle, color: colors.textPrimary },
  close:     { marginRight: -12 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
               borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  dot:       { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body:      { flex: 1 },
  name:      { ...type.rowTitle, fontSize: 15, color: colors.textPrimary },
  meta:      { ...type.small, color: colors.textSecondary, marginTop: 1 },
  ok:        { color: colors.primaryDark, fontFamily: 'Inter_600SemiBold' },
  empty:     { paddingVertical: 12, gap: 12 },
  emptyText: { ...type.body, color: colors.textSecondary },
  cta:       { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
               borderRadius: radii.pill, backgroundColor: NEAR_INK },
  ctaText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
