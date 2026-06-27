import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']

const DISTRICT_KEYS = {
  nicosia:   'blDistrictNicosia',
  kyrenia:   'blDistrictKyrenia',
  famagusta: 'blDistrictFamagusta',
  morphou:   'blDistrictMorphou',
  iskele:    'blDistrictIskele',
  lefke:     'blDistrictLefke',
  karpaz:    'blDistrictKarpaz',
}

function districtLabel(d, lang) { return t(DISTRICT_KEYS[d] || d, lang) }

// ─── Route card ───────────────────────────────────────────────────────────────

function RouteCard({ item, lang }) {
  return (
    <View style={s.card}>
      <View style={s.routeRow}>
        <Text style={s.routeDistrict}>{districtLabel(item.origin_district, lang)}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
        <Text style={s.routeDistrict}>{districtLabel(item.destination_district, lang)}</Text>
      </View>

      {!!item.terminal && (
        <View style={s.detailRow}>
          <Ionicons name="business-outline" size={13} color={colors.textSecondary} />
          <Text style={s.detailText}>{t('trBusTerminal', lang)}: {item.terminal}</Text>
        </View>
      )}
      {!!item.frequency && (
        <View style={s.detailRow}>
          <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
          <Text style={s.detailText}>{t('trBusFrequency', lang)}: {item.frequency}</Text>
        </View>
      )}
      {!!item.fare_note && (
        <View style={s.detailRow}>
          <Ionicons name="cash-outline" size={13} color={colors.textSecondary} />
          <Text style={s.detailText}>{t('trBusFare', lang)}: {item.fare_note}</Text>
        </View>
      )}
      {!!item.route_note && (
        <View style={s.detailRow}>
          <Ionicons name="information-circle-outline" size={13} color={colors.textSecondary} />
          <Text style={s.detailText}>{item.route_note}</Text>
        </View>
      )}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BusRoutesScreen({ lang, onBack }) {
  const [routes,      setRoutes]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [origin,      setOrigin]      = useState(null)
  const [destination, setDestination] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('bus_routes')
      .select('*')
      .order('origin_district')
      .order('destination_district')
    if (origin)      query = query.eq('origin_district', origin)
    if (destination) query = query.eq('destination_district', destination)
    const { data } = await query
    setRoutes(data || [])
    setLoading(false)
  }, [origin, destination])

  useEffect(() => { load() }, [load])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('trTitle', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{t('trBusTitle', lang)}</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={s.filterSection}>
        <Text style={s.filterLabel}>{t('trBusOrigin', lang)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          <TouchableOpacity
            style={[s.chip, !origin && s.chipActive]}
            onPress={() => setOrigin(null)}
          >
            <Text style={[s.chipText, !origin && s.chipTextActive]}>{t('trBusAllOrigins', lang)}</Text>
          </TouchableOpacity>
          {DISTRICTS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.chip, origin === d && s.chipActive]}
              onPress={() => setOrigin(d)}
            >
              <Text style={[s.chipText, origin === d && s.chipTextActive]}>{districtLabel(d, lang)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[s.filterLabel, { marginTop: 10 }]}>{t('trBusDestination', lang)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          <TouchableOpacity
            style={[s.chip, !destination && s.chipActive]}
            onPress={() => setDestination(null)}
          >
            <Text style={[s.chipText, !destination && s.chipTextActive]}>{t('trBusAllDestinations', lang)}</Text>
          </TouchableOpacity>
          {DISTRICTS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.chip, destination === d && s.chipActive]}
              onPress={() => setDestination(d)}
            >
              <Text style={[s.chipText, destination === d && s.chipTextActive]}>{districtLabel(d, lang)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading
        ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 48 }} />
        : (
          <FlatList
            data={routes}
            keyExtractor={item => item.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Ionicons name="bus-outline" size={42} color={colors.border} />
                <Text style={s.emptyText}>{t('trBusNoRoutes', lang)}</Text>
              </View>
            }
            renderItem={({ item }) => <RouteCard item={item} lang={lang} />}
          />
        )
      }
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },

  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg,
                    borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:       { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120 },
  backPillText:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  headerTitle:    { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold',
                    color: colors.textPrimary },

  filterSection:  { backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border,
                    paddingTop: 12, paddingBottom: 8 },
  filterLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                    textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16,
                    marginBottom: 6 },
  filterRow:      { paddingHorizontal: 16, gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  listContent:    { padding: 16, paddingBottom: 40, gap: 12 },
  emptyWrap:      { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    textAlign: 'center' },

  card:           { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  routeDistrict:  { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  detailRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  detailText:     { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19 },
})
