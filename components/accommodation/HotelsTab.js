import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, FlatList, ActivityIndicator, Linking, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'
import FilterDropdown from '../FilterDropdown'
import { REGIONS, REGION_LABEL_KEY } from '../../constants/regions'
import { HOTEL_CLASSES, HOTEL_CLASS_LABEL_KEY, HOTEL_CLASS_STARS } from '../../constants/hotels'
import { logContactEvent } from '../../utils/logContactEvent'

// The Oteller tab of Emlak & Konaklama (HOTELS_LIVE). KITOB member hotels from
// public.hotels (20261059): RLS returns only published, listed rows, so there is no
// status filter here to forget. The whole list is ~150 rows, so it is fetched once and
// filtered on the device — the dropdowns answer instantly and only offer values that
// actually have a hotel behind them.

const COLUMNS = 'id, name, kitob_class, region, address, phone, website, lat, lng, photo_url, is_kitob_member'
const CLASS_RANK = Object.fromEntries(HOTEL_CLASSES.map((k, i) => [k, i]))
const collator = new Intl.Collator('tr')

const classLabel = (k, lang) => t(HOTEL_CLASS_LABEL_KEY[k], lang)
const districtLabel = (r, lang) => t(REGION_LABEL_KEY[r], lang)

function HotelCard({ hotel, lang, district }) {
  const stars = HOTEL_CLASS_STARS[hotel.kitob_class] || 0
  const place = [districtLabel(hotel.region, lang), hotel.address].filter(Boolean).join(' · ')

  function call() {
    logContactEvent('hotels', hotel.id, 'call', district)
    Linking.openURL(`tel:${hotel.phone.replace(/\s/g, '')}`).catch(() => {})
  }
  function website() {
    logContactEvent('hotels', hotel.id, 'website', district)
    Linking.openURL(hotel.website).catch(() => {})
  }
  // Coordinates when KITOB supplied them; otherwise a name search, which lands on the
  // hotel's own map listing far more often than on nothing.
  function map() {
    logContactEvent('hotels', hotel.id, 'maps', district)
    const q = hotel.lat != null
      ? `${hotel.lat},${hotel.lng}`
      : encodeURIComponent(`${hotel.name}, ${t(REGION_LABEL_KEY[hotel.region], 'Turkish')}, Kuzey Kıbrıs`)
    Linking.openURL(`https://maps.google.com/?q=${q}`).catch(() => {})
  }

  return (
    <View style={hs.card}>
      {!!hotel.photo_url && <Image source={{ uri: hotel.photo_url }} style={hs.photo} resizeMode="cover" />}
      <View style={hs.cardBody}>
        <Text style={hs.name} numberOfLines={2}>{hotel.name}</Text>

        <View style={hs.metaRow}>
          {stars > 0 && (
            <View style={hs.stars} accessibilityLabel={classLabel(hotel.kitob_class, lang)}>
              {Array.from({ length: stars }, (_, i) => (
                <Ionicons key={i} name="star" size={13} color={colors.tintLifestyleFg} />
              ))}
            </View>
          )}
          <Text style={hs.classText} numberOfLines={1}>{classLabel(hotel.kitob_class, lang)}</Text>
          {hotel.is_kitob_member && (
            <View style={hs.badge}>
              <Ionicons name="ribbon-outline" size={12} color={colors.tintServiceFg} />
              <Text style={hs.badgeText} numberOfLines={1}>{t('hotelKitobMember', lang)}</Text>
            </View>
          )}
        </View>

        <View style={hs.placeRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={hs.placeText} numberOfLines={2}>{place}</Text>
        </View>

        <View style={hs.actions}>
          {!!hotel.phone && (
            <TouchableOpacity style={[hs.action, hs.actionPrimary]} onPress={call} activeOpacity={0.85}>
              <Ionicons name="call-outline" size={16} color="#fff" />
              <Text style={[hs.actionText, hs.actionTextPrimary]} numberOfLines={1}>{t('hotelCall', lang)}</Text>
            </TouchableOpacity>
          )}
          {!!hotel.website && (
            <TouchableOpacity style={hs.action} onPress={website} activeOpacity={0.85}>
              <Ionicons name="globe-outline" size={16} color={colors.primary} />
              <Text style={hs.actionText} numberOfLines={1}>{t('hotelWebsite', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={hs.action} onPress={map} activeOpacity={0.85}>
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={hs.actionText} numberOfLines={1}>{t('hotelMap', lang)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// While the table has no published hotel. Only reachable with HOTELS_LIVE on, which waits
// for KITOB's data — so in practice this is the go-live safety net, not a screen users see.
function HotelsComingSoon({ lang }) {
  return (
    <View style={hs.soon}>
      <View style={hs.mascotWrap}>
        <Image source={require('../../assets/oli-button.png')} style={hs.mascot} resizeMode="cover" />
      </View>
      <View style={hs.soonBadge}>
        <Text style={hs.soonBadgeText}>{t('comingSoonBadge', lang)}</Text>
      </View>
      <Text style={hs.soonTitle}>{t('hotelsSoonTitle', lang)}</Text>
      <Text style={hs.soonBody}>{t('hotelsSoonBody', lang)}</Text>
    </View>
  )
}

export default function HotelsTab({ lang }) {
  const [hotels, setHotels]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [failed, setFailed]     = useState(false)
  const [klass, setKlass]       = useState(null)
  const [district, setDistrict] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    const { data, error } = await supabase.from('hotels').select(COLUMNS).range(0, 999)
    if (error || !data) setFailed(true)
    else setHotels(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => [...hotels].sort((a, b) =>
    (CLASS_RANK[a.kitob_class] - CLASS_RANK[b.kitob_class]) || collator.compare(a.name, b.name)), [hotels])

  const classOpts = useMemo(() => HOTEL_CLASSES
    .filter(k => hotels.some(h => h.kitob_class === k))
    .map(k => ({ value: k, label: classLabel(k, lang) })), [hotels, lang])
  const districtOpts = useMemo(() => REGIONS
    .filter(r => hotels.some(h => h.region === r))
    .map(r => ({ value: r, label: districtLabel(r, lang) })), [hotels, lang])

  const shown = sorted.filter(h => (!klass || h.kitob_class === klass) && (!district || h.region === district))

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} size="large" color={colors.primary} />

  if (failed) {
    return (
      <View style={hs.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.border} />
        <Text style={hs.emptyTitle}>{t('hotelsLoadError', lang)}</Text>
        <TouchableOpacity style={hs.retry} onPress={load}>
          <Text style={hs.retryText}>{t('tryAgain', lang)}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (hotels.length === 0) return <HotelsComingSoon lang={lang} />

  return (
    <View style={{ flex: 1 }}>
      <View style={hs.filterBar}>
        <FilterDropdown label={t('hotelFilterClass', lang)} lang={lang}
          options={classOpts} value={klass} onChange={setKlass} />
        <FilterDropdown label={t('accomFilterDistrict', lang)} lang={lang}
          options={districtOpts} value={district} onChange={setDistrict} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={h => h.id}
        contentContainerStyle={hs.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={7}
        renderItem={({ item }) => <HotelCard hotel={item} lang={lang} district={district} />}
        ListEmptyComponent={
          <View style={hs.center}>
            <Ionicons name="bed-outline" size={40} color={colors.border} />
            <Text style={hs.emptyTitle}>{t('hotelsNoResults', lang)}</Text>
            <TouchableOpacity style={hs.retry} onPress={() => { setKlass(null); setDistrict(null) }}>
              <Text style={hs.retryText}>{t('accomClear', lang)}</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  )
}

const hs = StyleSheet.create({
  // flexShrink:0 — a fixed-height row above a scrolling list (CLAUDE.md).
  filterBar:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12, flexShrink: 0 },
  listContent:   { paddingHorizontal: 16, paddingBottom: 32 },

  card:          { backgroundColor: colors.cardBg, borderRadius: 20, marginBottom: 14, overflow: 'hidden', ...shadow },
  photo:         { width: '100%', height: 150, backgroundColor: colors.border },
  cardBody:      { padding: 16 },
  name:          { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 22 },
  metaRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  stars:         { flexDirection: 'row', gap: 1 },
  classText:     { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  badge:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.tintServiceBg },
  badgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.tintServiceFg },
  placeRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 8 },
  placeText:     { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },

  actions:       { flexDirection: 'row', gap: 8, marginTop: 14 },
  // borderWidth + borderRadius needs an explicit backgroundColor on Android (CLAUDE.md).
  action:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                   paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1.5,
                   borderColor: colors.primary, backgroundColor: 'transparent' },
  actionPrimary: { backgroundColor: colors.primary },
  actionText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, flexShrink: 1 },
  actionTextPrimary: { color: '#fff' },

  center:        { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle:    { fontSize: 15, fontFamily: 'Inter_500Medium', color: colors.textSecondary, textAlign: 'center' },
  retry:         { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.primaryLight },
  retryText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  soon:          { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  mascotWrap:    { width: 132, height: 132, borderRadius: 66, backgroundColor: colors.tintServiceBg, alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...shadow },
  mascot:        { width: 116, height: 116, borderRadius: 58 },
  soonBadge:     { backgroundColor: colors.tintServiceBg, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 14, marginBottom: 14 },
  soonBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.tintServiceFg, textTransform: 'uppercase', letterSpacing: 0.6 },
  soonTitle:     { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  soonBody:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
})
