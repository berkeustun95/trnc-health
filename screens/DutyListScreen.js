import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, SectionList, FlatList } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const REGION_CENTERS = {
  'Lefkoşa':   { latitude: 35.1856, longitude: 33.3823 },
  'Girne':     { latitude: 35.3421, longitude: 33.3154 },
  'Gazimağusa':{ latitude: 35.1234, longitude: 33.9402 },
  'Güzelyurt': { latitude: 35.1997, longitude: 32.9935 },
  'İskele':    { latitude: 35.2907, longitude: 33.8937 },
  'Lefke':     { latitude: 35.1177, longitude: 32.8489 },
  'Karpaz':    { latitude: 35.5700, longitude: 34.2000 },
  'Mesarya':   { latitude: 35.1500, longitude: 33.6000 },
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function PharmacyCard({ item, showRegionBadge, lang }) {
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Text style={s.pharmacyName}>{item.name}</Text>
        <View style={s.hoursBadge}>
          <Text style={s.hoursText}>{item.open_from}–{item.open_until}</Text>
        </View>
      </View>
      {(showRegionBadge && item.region) || item._dist != null ? (
        <View style={s.metaRow}>
          {showRegionBadge && item.region ? (
            <View style={s.regionInlineBadge}>
              <Text style={s.regionInlineText}>{item.region}</Text>
            </View>
          ) : null}
          {item._dist != null ? (
            <Text style={s.distanceText}>{item._dist.toFixed(1)} km</Text>
          ) : null}
        </View>
      ) : null}
      {item.address ? (
        <View style={s.addressRow}>
          <Feather name="map-pin" size={12} color={colors.textSecondary} />
          <Text style={s.addressText} numberOfLines={2}>{item.address}</Text>
        </View>
      ) : null}
      <View style={s.cardActions}>
        {item.phone ? (
          <TouchableOpacity
            style={s.callBtn}
            onPress={() => Linking.openURL(`tel:${item.phone.replace(/\s+/g, '')}`)}
            activeOpacity={0.7}
          >
            <Feather name="phone" size={13} color={colors.accent} />
            <Text style={s.callBtnText}>{item.phone}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={s.directionsBtn}
          onPress={() => Linking.openURL(
            `https://maps.google.com/?q=${encodeURIComponent(item.name)}`
          )}
          activeOpacity={0.7}
        >
          <Feather name="navigation" size={13} color={colors.primary} />
          <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function DutyListScreen({ onBack, lang, userLocation, locationDenied }) {
  const [pharmacies, setPharmacies] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)

  const sortByDistance = !!userLocation && !locationDenied

  useEffect(() => {
    async function load() {
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const { data } = await supabase
        .from('duty_list')
        .select('id, name, address, phone, open_from, open_until, region')
        .eq('duty_date', today)

      if (data && data.length > 0) {
        if (userLocation && !locationDenied) {
          const withDist = data.map(row => {
            const center = REGION_CENTERS[row.region]
            const dist = center
              ? haversineKm(userLocation.latitude, userLocation.longitude, center.latitude, center.longitude)
              : null
            return { ...row, _dist: dist }
          }).sort((a, b) => {
            if (a._dist == null && b._dist == null) return 0
            if (a._dist == null) return 1
            if (b._dist == null) return -1
            return a._dist - b._dist
          })
          setPharmacies(withDist)
        } else {
          const map = {}
          const ordered = [...data].sort((a, b) =>
            (a.region ?? '').localeCompare(b.region ?? '') || a.name.localeCompare(b.name)
          )
          for (const row of ordered) {
            if (!map[row.region]) map[row.region] = []
            map[row.region].push(row)
          }
          setSections(Object.entries(map).map(([title, data]) => ({ title, data })))
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  const d = new Date()
  const dateLabel = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="duty_pharmacy" />
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={s.backText}>{t('back', lang)}</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.title}>{t('dutyPharmacies', lang)}</Text>
            <Text style={s.dateText}>{dateLabel}</Text>
          </View>
          <View style={s.headerRight} />
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (sortByDistance ? pharmacies : sections).length === 0 ? (
          <View style={s.center}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="medical-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={s.emptyText}>{t('noDutyToday', lang)}</Text>
          </View>
        ) : sortByDistance ? (
          <FlatList
            data={pharmacies}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) => (
              <PharmacyCard item={item} showRegionBadge lang={lang} />
            )}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.listContent}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={s.regionHeader}>
                <Text style={s.regionName}>{section.title}</Text>
                <View style={s.regionBadge}>
                  <Text style={s.regionCount}>{section.data.length}</Text>
                </View>
              </View>
            )}
            renderItem={({ item }) => (
              <PharmacyCard item={item} showRegionBadge={false} lang={lang} />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  container:    { flex: 1, paddingHorizontal: 16 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:       { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 16, paddingBottom: 16 },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 70 },
  backText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight:  { minWidth: 70 },
  title:        { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dateText:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 12, ...shadow },
  emptyText:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 },
  listContent:  { paddingBottom: 40 },

  regionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  regionName:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  regionBadge:  { backgroundColor: colors.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  regionCount:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  metaRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  regionInlineBadge: { backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  regionInlineText:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  distanceText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  card:         { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 8, ...shadow },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  pharmacyName: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 20 },
  hoursBadge:   { backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  hoursText:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  addressRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  addressText:  { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },
  cardActions:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  callBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentLight, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  callBtnText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.accent },
  directionsBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primaryLight, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  directionsBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
