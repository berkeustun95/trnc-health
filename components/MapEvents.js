// Keşfet map events mode (2026-11-07): venue markers + a bottom strip of event cards with the
// Bugün / Bu hafta sonu / Bu hafta windows. Icon markers, not pinColor: Android keeps only a pin's
// hue and the wheel is full (constants/theme.js placeColors), the walking-route marker pattern.
import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, radii, elevation } from '../constants/theme'
import { t } from '../constants/i18n'
import { formatPetDate } from '../constants/petsContent'
import { MAP_EVENT_RANGES, eventIcon } from '../constants/mapEvents'
import { RemoteImage } from './ui'

export const EVENT_INK = CAT.explore.ink
const EVENT_BG = CAT.explore.bg

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const whenLabel = (e, lang) => { const s = new Date(e.start_date); return `${formatPetDate(s, lang)} · ${hhmm(s)}` }
const venueLabel = loc => (loc || '').split(',')[0].trim()

// Android snapshots a custom-child Marker on first layout: track briefly, then stop (ClusterMarker).
export function EventVenueMarker({ venue, active, onPress }) {
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    setTracks(true)
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [active, venue.events.length])
  const n = venue.events.length
  return (
    <Marker coordinate={{ latitude: venue.latitude, longitude: venue.longitude }} tracksViewChanges={tracks}
      anchor={{ x: 0.5, y: 0.5 }} zIndex={active ? 2 : 1}
      onPress={e => { e.stopPropagation(); onPress(venue) }}>
      {/* The pad keeps the badge inside the marker bitmap: Android clips a child past its parent's box. */}
      <View style={m.pad}>
        <View style={[m.pin, active && m.pinActive]}>
          <Ionicons name={eventIcon(venue.events[0].category)} size={active ? 17 : 15} color="#fff" />
        </View>
        {n > 1 && <View style={m.badge}><Text style={m.badgeText}>{n}</Text></View>}
      </View>
    </Marker>
  )
}

export function EventStrip({ events, counts, range, onRange, venueKey, onClearVenue, onOpen, lang, bottom }) {
  const scrollRef = useRef(null)
  useEffect(() => { scrollRef.current?.scrollTo({ x: 0, animated: false }) }, [range, venueKey])
  return (
    <View style={[s.wrap, bottom != null && { bottom }]} pointerEvents="box-none">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.ranges} style={s.rangeBar}>
        {venueKey ? (
          <TouchableOpacity style={[s.range, s.rangeOn]} onPress={onClearVenue} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
            <Text style={[s.rangeText, s.rangeTextOn]} numberOfLines={1}>{venueLabel(events[0]?.location) || t('menuEvents', lang)}</Text>
            <Ionicons name="close" size={14} color={EVENT_INK} />
          </TouchableOpacity>
        ) : MAP_EVENT_RANGES.map(r => {
          const on = r.key === range
          return (
            <TouchableOpacity key={r.key} style={[s.range, on && s.rangeOn]} onPress={() => onRange(r.key)} activeOpacity={0.85}
              accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[s.rangeText, on && s.rangeTextOn]}>{t(r.labelKey, lang)}</Text>
              <Text style={[s.rangeCount, on && s.rangeTextOn]}>{counts[r.key] ?? 0}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      {events.length === 0 ? (
        <View style={[s.card, s.empty]}>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          <Text style={s.emptyText}>{t('mapEventsEmpty', lang)}</Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {events.map(e => (
            <TouchableOpacity key={e.id} style={[s.card, s.pick]} onPress={() => onOpen(e)} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel={e.title}>
              {e.images?.[0]
                ? <RemoteImage source={{ uri: e.images[0] }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
                : <View style={[s.thumb, s.thumbIcon]}><Ionicons name={eventIcon(e.category)} size={22} color={EVENT_INK} /></View>}
              <View style={s.body}>
                <Text style={s.title} numberOfLines={2}>{e.title}</Text>
                <Text style={s.when} numberOfLines={1}>{whenLabel(e, lang)}</Text>
                {!!e.location && <Text style={s.where} numberOfLines={1}>{venueLabel(e.location)}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const m = StyleSheet.create({
  pin:       { width: 32, height: 32, borderRadius: 16, backgroundColor: EVENT_INK, borderWidth: 2, borderColor: '#fff',
               alignItems: 'center', justifyContent: 'center', ...elevation.floating },
  pinActive: { width: 38, height: 38, borderRadius: 19 },
  pad:       { paddingTop: 8, paddingRight: 12, paddingLeft: 12, paddingBottom: 4, alignItems: 'center' },
  badge:     { position: 'absolute', top: 1, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
               backgroundColor: '#fff', borderWidth: 1.5, borderColor: EVENT_INK, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: EVENT_INK },
})

const s = StyleSheet.create({
  wrap:        { position: 'absolute', left: 0, right: 0, bottom: 24, gap: 8 },
  rangeBar:    { flexGrow: 0 },
  ranges:      { paddingHorizontal: 16, gap: 8 },
  range:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
                 backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border, ...elevation.floating },
  rangeOn:     { backgroundColor: EVENT_BG, borderColor: EVENT_INK },
  rangeText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, maxWidth: 220 },
  rangeTextOn: { color: EVENT_INK },
  rangeCount:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  row:         { paddingHorizontal: 16, gap: 10 },
  card:        { backgroundColor: colors.cardBg, borderRadius: radii.card, ...elevation.floating },
  pick:        { width: 260, flexDirection: 'row', gap: 10, padding: 10 },
  thumb:       { width: 64, height: 64, borderRadius: radii.tile, backgroundColor: colors.border },
  thumbIcon:   { backgroundColor: EVENT_BG, alignItems: 'center', justifyContent: 'center' },
  body:        { flex: 1, gap: 2 },
  title:       { ...type.rowTitle, fontSize: 14, color: colors.textPrimary },
  when:        { ...type.small, color: EVENT_INK, fontFamily: 'Inter_600SemiBold' },
  where:       { ...type.small, color: colors.textSecondary },
  empty:       { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  emptyText:   { flex: 1, ...type.body, color: colors.textSecondary },
})
