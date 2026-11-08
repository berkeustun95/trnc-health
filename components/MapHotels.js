// KITOB hotels on the Keşfet map (stage 3, Berke 2026-11-07: all 102 as their own layer, icon pins,
// linking to Oteller and its booking button). Icon markers, not pinColor: the hue wheel is full.
import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, radii, elevation, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { HOTEL_CLASS_STARS, HOTEL_CLASS_LABEL_KEY } from '../constants/hotels'
import { hotelBookingUrl } from '../utils/hotelBooking'
import { logContactEvent } from '../utils/logContactEvent'
import { IconButton, RemoteImage } from './ui'

export const HOTEL_INK = CAT.homeLife.ink
export const HOTEL_COLUMNS = 'id, name, kitob_class, region, lat, lng, photo_url, external_id, hotelrunner_url'

// Android snapshots a custom-child Marker on first layout: track briefly, then stop (ClusterMarker).
export function HotelMarker({ hotel, count, coordinate, onPress }) {
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    setTracks(true)
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [count])
  return (
    <Marker coordinate={coordinate} tracksViewChanges={tracks} anchor={{ x: 0.5, y: 0.5 }}
      onPress={e => { e.stopPropagation(); onPress() }}>
      <View collapsable={false} style={count ? [m.cluster, { width: count < 10 ? 34 : 40, height: count < 10 ? 34 : 40 }] : m.pin}>
        {count ? <Text style={m.count}>{count}</Text> : <Ionicons name="bed" size={15} color="#fff" />}
      </View>
    </Marker>
  )
}

export function HotelCard({ hotel, lang, onClose, onOpenHotels, bottom }) {
  const stars = HOTEL_CLASS_STARS[hotel.kitob_class]
  const cls = stars ? '★'.repeat(stars) : (HOTEL_CLASS_LABEL_KEY[hotel.kitob_class] ? t(HOTEL_CLASS_LABEL_KEY[hotel.kitob_class], lang) : null)
  const region = REGION_LABEL_KEY[hotel.region] ? t(REGION_LABEL_KEY[hotel.region], lang) : hotel.region
  const bookUrl = hotelBookingUrl(hotel)
  const book = () => {
    logContactEvent('hotels', hotel.id, 'book', hotel.region)
    Linking.openURL(bookUrl).catch(() => {})
  }
  return (
    <View style={[s.card, bottom != null && { bottom }]}>
      <View style={s.row}>
        {hotel.photo_url
          ? <RemoteImage source={{ uri: hotel.photo_url }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
          : <View style={[s.thumb, s.thumbIcon]}><Ionicons name="bed" size={22} color={HOTEL_INK} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={2}>{hotel.name}</Text>
          <Text style={s.sub} numberOfLines={1}>{[cls, region].filter(Boolean).join(' · ')}</Text>
        </View>
        <IconButton icon="close" onPress={onClose} accessibilityLabel={t('uiClose', lang)} color={colors.textSecondary} style={s.close} />
      </View>
      <View style={s.actions}>
        {!!bookUrl && (
          <TouchableOpacity style={[s.btn, s.btnMain]} onPress={book} activeOpacity={press.card} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={16} color="#fff" />
            <Text style={[s.btnText, { color: '#fff' }]}>{t('hotelBook', lang)}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.btn} onPress={onOpenHotels} activeOpacity={press.card} accessibilityRole="button">
          <Text style={s.btnText}>{t('mapHotelOpen', lang)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const m = StyleSheet.create({
  pin:     { width: 30, height: 30, borderRadius: 15, backgroundColor: HOTEL_INK, borderWidth: 2, borderColor: '#fff',
             alignItems: 'center', justifyContent: 'center' },
  cluster: { borderRadius: 20, backgroundColor: HOTEL_INK, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  count:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
})

const s = StyleSheet.create({
  card:     { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.cardBg, borderRadius: radii.card,
              padding: 14, gap: 12, ...elevation.floating },
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumb:    { width: 56, height: 56, borderRadius: radii.tile, backgroundColor: colors.border },
  thumbIcon:{ backgroundColor: CAT.homeLife.bg, alignItems: 'center', justifyContent: 'center' },
  name:     { ...type.rowTitle, color: colors.textPrimary },
  sub:      { ...type.small, color: colors.textSecondary, marginTop: 2 },
  close:    { marginTop: -10, marginRight: -10 },
  actions:  { flexDirection: 'row', gap: 10 },
  btn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11,
              borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.border },
  btnMain:  { backgroundColor: HOTEL_INK, borderColor: HOTEL_INK },
  btnText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
})
