import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { areaOptions, areaName } from '../constants/areas'
import { pricedServices, formatPriceRange } from '../utils/servicePrices'
import { GARAGE_CATEGORIES } from './GaragesScreen'

// Fields kept identical to the garages directory select so a tapped result opens a
// fully-rendered FacilityProfileScreen (which reads the passed row, no re-fetch).
const SELECT =
  'id, name, type, service_types, service_prices, address, phone, opening_hours, description, cover_image_url, logo_url, photos, availability, city, area, featured_until'

function serviceLabel(key, lang) {
  const c = GARAGE_CATEGORIES.find(x => x.key === key)
  return t(c?.labelKey || key, lang)
}

// ─── Ranked result row ──────────────────────────────────────────────────────
function CompareRow({ item, rank, lang, onPress }) {
  const locale = item.area && item.city
    ? `${areaName(item.area, item.city)}, ${t(REGION_LABEL_KEY[item.city], lang)}`
    : item.city && REGION_LABEL_KEY[item.city]
      ? t(REGION_LABEL_KEY[item.city], lang)
      : null
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.85}>
      <View style={s.rank}><Text style={s.rankText}>{rank}</Text></View>
      {item.logo_url
        ? <Image source={{ uri: item.logo_url }} style={s.logo} resizeMode="cover" />
        : <View style={[s.logo, s.logoFallback]}><Ionicons name="car-sport-outline" size={18} color={colors.textSecondary} /></View>
      }
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        {!!locale && (
          <View style={s.localeRow}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={s.locale} numberOfLines={1}>{locale}</Text>
          </View>
        )}
      </View>
      <View style={s.priceTag}>
        <Text style={s.priceText}>{formatPriceRange(item._price)}</Text>
      </View>
    </TouchableOpacity>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function GaragePriceCompareScreen({ lang, onBack, onOpenFacility }) {
  const [service, setService] = useState('muayene') // single-select; muayene default
  const [regions, setRegions] = useState([])         // multi-select region slugs
  const [areas, setAreas]     = useState([])         // area slugs (only when 1 region)
  const [garages, setGarages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    let query = supabase
      .from('facilities')
      .select(SELECT)
      .eq('type', 'garage')
      .eq('status', 'active')
      .is('hidden_at', null)   // moderation: also drop Hidden listings (RLS 20260820 is the gate)
      .overlaps('service_types', [service])
    if (regions.length > 0) query = query.in('city', regions)
    if (areas.length > 0) query = query.in('area', areas)
    const { data, error: err } = await query
    if (err) { console.warn('price compare load error:', err.message, err.code); setError(true); setLoading(false); return }
    // Keep only garages with a numeric price for the chosen service, ranked by 'from' asc.
    const ranked = (data || [])
      .map(g => { const p = pricedServices(g, [service])[0]; return p ? { ...g, _price: p } : null })
      .filter(Boolean)
      .sort((a, b) => a._price.from - b._price.from)
    setGarages(ranked)
    setLoading(false)
  }, [service, regions, areas])

  useEffect(() => { load() }, [load])

  // Region change clears any chosen areas (same discipline as the directory).
  function toggleRegion(key) {
    setRegions(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
    setAreas([])
  }
  function toggleArea(key) {
    setAreas(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="garages" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('priceCompareTitle', lang)} lang={lang} />

      <View style={{ flex: 1 }}>
        {/* Service picker (single-select, required) */}
        <Text style={s.pickerLabel}>{t('priceCompareService', lang)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.filterRow}>
          {GARAGE_CATEGORIES.map(c => {
            const active = service === c.key
            return (
              <TouchableOpacity key={c.key} style={[s.chip, active && s.chipActive]} onPress={() => setService(c.key)}>
                <Ionicons name={c.icon} size={13} color={active ? colors.primary : colors.textSecondary} />
                <Text style={[s.chipText, active && s.chipTextActive]}>{t(c.labelKey, lang)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Region filter (multi-select) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.filterRow}>
          <TouchableOpacity style={[s.chip, regions.length === 0 && s.chipActive]} onPress={() => { setRegions([]); setAreas([]) }}>
            <Text style={[s.chipText, regions.length === 0 && s.chipTextActive]}>{t('filterAll', lang)}</Text>
          </TouchableOpacity>
          {REGIONS.map(r => {
            const active = regions.includes(r)
            return (
              <TouchableOpacity key={r} style={[s.chip, active && s.chipActive]} onPress={() => toggleRegion(r)}>
                <Text style={[s.chipText, active && s.chipTextActive]}>{t(REGION_LABEL_KEY[r], lang)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Dependent area sub-row: only when EXACTLY ONE region is selected. */}
        {regions.length === 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.filterRow}>
            <TouchableOpacity style={[s.areaChip, areas.length === 0 && s.chipActive]} onPress={() => setAreas([])}>
              <Text style={[s.chipText, areas.length === 0 && s.chipTextActive]}>{t('filterAll', lang)}</Text>
            </TouchableOpacity>
            {areaOptions(regions[0]).map(a => {
              const active = areas.includes(a.value)
              return (
                <TouchableOpacity key={a.value} style={[s.areaChip, active && s.chipActive]} onPress={() => toggleArea(a.value)}>
                  <Text style={[s.chipText, active && s.chipTextActive]}>{a.label}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 48 }} />
        ) : error ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyCard}>
              <Ionicons name="wifi-outline" size={42} color={colors.border} style={{ marginBottom: 10 }} />
              <Text style={s.emptyText}>{t('facilityLoadError', lang)}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={load}>
                <Text style={s.retryBtnText}>{t('tryAgain', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <FlatList
            data={garages}
            keyExtractor={item => item.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <Text style={s.intro}>{t('priceCompareIntro', lang)}</Text>
            }
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <View style={s.emptyCard}>
                  <Ionicons name="pricetags-outline" size={42} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={s.emptyText}>{t('priceCompareEmpty', lang)}</Text>
                  <Text style={s.emptySub}>{serviceLabel(service, lang)}</Text>
                </View>
              </View>
            }
            renderItem={({ item, index }) => (
              <CompareRow item={item} rank={index + 1} lang={lang} onPress={() => onOpenFacility?.(item)} />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },

  pickerLabel:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                    paddingHorizontal: 16, paddingTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterRow:      { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  areaChip:       { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },

  listContent:    { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  intro:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginBottom: 6 },

  row:            { flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14,
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  rank:           { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryLight,
                    alignItems: 'center', justifyContent: 'center' },
  rankText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  logo:           { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.border },
  logoFallback:   { alignItems: 'center', justifyContent: 'center' },
  name:           { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  localeRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locale:         { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  priceTag:       { backgroundColor: colors.primaryLight, borderRadius: radius.md,
                    paddingHorizontal: 10, paddingVertical: 6 },
  priceText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  emptyWrap:      { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyCard:      { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24,
                    paddingVertical: 24, alignItems: 'center', ...shadow },
  emptyText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  emptySub:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary,
                    textAlign: 'center', marginTop: 6 },
  retryBtn:       { marginTop: 14, backgroundColor: colors.primaryLight, borderRadius: radius.md,
                    paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
})
