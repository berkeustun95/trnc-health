import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import TransportProfileScreen from './TransportProfileScreen'
import TransportOnboardingScreen from './TransportOnboardingScreen'
import BusRoutesScreen from './BusRoutesScreen'

const PROVIDER_TYPES = [
  { key: 'taxi',             icon: 'car-outline',      labelKey: 'trTypeTaxi' },
  { key: 'car_rental',       icon: 'key-outline',      labelKey: 'trTypeCarRental' },
  { key: 'airport_transfer', icon: 'airplane-outline', labelKey: 'trTypeAirportTransfer' },
]

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

const AIRPORT_KEYS = {
  ercan:   'trAirportErcan',
  larnaca: 'trAirportLarnaca',
  both:    'trAirportBoth',
}

function districtLabel(d, lang) { return t(DISTRICT_KEYS[d] || d, lang) }

// ─── Type tile ────────────────────────────────────────────────────────────────

function TypeTile({ item, lang, onPress }) {
  return (
    <TouchableOpacity style={s.catTile} onPress={onPress} activeOpacity={0.75}>
      <View style={s.catIconWrap}>
        <Ionicons name={item.icon} size={28} color={colors.primary} />
      </View>
      <Text style={s.catLabel} numberOfLines={2}>{t(item.labelKey, lang)}</Text>
    </TouchableOpacity>
  )
}

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({ item, lang, onPress }) {
  const canCall = item.contact_pref === 'call'     || item.contact_pref === 'both'
  const canWA   = item.contact_pref === 'whatsapp' || item.contact_pref === 'both'
  const phone   = item.phone.replace(/\s/g, '')
  const waNum   = (item.whatsapp || item.phone).replace(/[\s+]/g, '')

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardTop}>
        <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
        <View style={s.cardBadges}>
          {item.verified && (
            <View style={s.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={12} color={colors.success} />
              <Text style={s.verifiedText}>{t('trVerified', lang)}</Text>
            </View>
          )}
          <View style={s.districtBadge}>
            <Text style={s.districtText}>{districtLabel(item.district, lang)}</Text>
          </View>
        </View>
      </View>

      {item.type === 'airport_transfer' && item.airport && (
        <View style={s.airportRow}>
          <Ionicons name="airplane-outline" size={12} color={colors.textSecondary} />
          <Text style={s.airportText}>{t(AIRPORT_KEYS[item.airport], lang)}</Text>
        </View>
      )}

      {!!item.description && (
        <Text style={s.cardDesc} numberOfLines={3}>{item.description}</Text>
      )}

      <View style={s.btnRow}>
        {canCall && (
          <TouchableOpacity
            style={s.callBtn}
            onPress={() => Linking.openURL(`tel:${phone}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={15} color="#fff" />
            <Text style={s.callBtnText}>{t('trCall', lang)}</Text>
          </TouchableOpacity>
        )}
        {canWA && (
          <TouchableOpacity
            style={s.waBtn}
            onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-whatsapp" size={15} color="#fff" />
            <Text style={s.waBtnText}>{t('trWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TransportScreen({ lang, session, onBack, onRequireAccount }) {
  const [selectedType,     setSelectedType]     = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [showBusRoutes,    setShowBusRoutes]    = useState(false)
  const [providers,        setProviders]        = useState([])
  const [loading,          setLoading]          = useState(false)

  const loadProviders = useCallback(async (type, district) => {
    setLoading(true)
    let query = supabase
      .from('transport_providers')
      .select('*')
      .eq('status', 'active')
      .eq('type', type)
      .order('verified', { ascending: false })
      .order('name')
    if (district) query = query.eq('district', district)
    const { data } = await query
    setProviders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedType) loadProviders(selectedType, selectedDistrict)
  }, [selectedType, selectedDistrict, loadProviders])

  function selectType(key) {
    setSelectedDistrict(null)
    setSelectedType(key)
  }

  function handleBack() {
    if (selectedProvider) { setSelectedProvider(null) }
    else if (selectedType) { setSelectedType(null); setSelectedDistrict(null); setProviders([]) }
    else { onBack() }
  }

  if (showBusRoutes) {
    return <BusRoutesScreen lang={lang} onBack={() => setShowBusRoutes(false)} />
  }

  if (showOnboarding) {
    return (
      <TransportOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowOnboarding(false)}
        onSubmitted={() => setShowOnboarding(false)}
      />
    )
  }

  if (selectedProvider) {
    return (
      <TransportProfileScreen
        provider={selectedProvider}
        lang={lang}
        onBack={() => setSelectedProvider(null)}
      />
    )
  }

  const activeTypeObj = PROVIDER_TYPES.find(tp => tp.key === selectedType)
  const headerTitle   = activeTypeObj ? t(activeTypeObj.labelKey, lang) : t('trTitle', lang)
  const backLabel     = selectedType ? t('trTitle', lang) : t('back', lang)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="transportation" />
      <ScreenHeader onBack={handleBack} backLabel={backLabel} title={headerTitle} lang={lang} />

      {!selectedType ? (
        <ScrollView contentContainerStyle={s.catScroll} showsVerticalScrollIndicator={false}>
          <View style={s.subtitleCard}>
            <Text style={s.subtitle}>{t('trSubtitle', lang)}</Text>
          </View>
          <View style={s.grid}>
            {PROVIDER_TYPES.map(type => (
              <TypeTile
                key={type.key}
                item={type}
                lang={lang}
                onPress={() => selectType(type.key)}
              />
            ))}
            <TouchableOpacity style={s.catTile} onPress={() => setShowBusRoutes(true)} activeOpacity={0.75}>
              <View style={s.catIconWrap}>
                <Ionicons name="bus-outline" size={28} color={colors.primary} />
              </View>
              <Text style={s.catLabel} numberOfLines={2}>{t('trTypeBus', lang)}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.ctaCard} onPress={() => { if (onRequireAccount?.('gateTransport')) return; setShowOnboarding(true) }} activeOpacity={0.8}>
            <View style={s.ctaIconWrap}>
              <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.ctaCardTitle}>{t('trRegisterCTA', lang)}</Text>
              <Text style={s.ctaCardSub}>{t('trRegisterCTASub', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={s.districtRow}
          >
            <TouchableOpacity
              style={[s.chip, !selectedDistrict && s.chipActive]}
              onPress={() => setSelectedDistrict(null)}
            >
              <Text style={[s.chipText, !selectedDistrict && s.chipTextActive]}>
                {t('trAllDistricts', lang)}
              </Text>
            </TouchableOpacity>
            {DISTRICTS.map(d => (
              <TouchableOpacity
                key={d}
                style={[s.chip, selectedDistrict === d && s.chipActive]}
                onPress={() => setSelectedDistrict(d)}
              >
                <Text style={[s.chipText, selectedDistrict === d && s.chipTextActive]}>
                  {districtLabel(d, lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading
            ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 48 }} />
            : (
              <FlatList
                data={providers}
                keyExtractor={item => item.id}
                contentContainerStyle={s.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.emptyWrap}>
                    <View style={s.emptyCard}>
                      <Ionicons name="search-outline" size={42} color={colors.border} style={{ marginBottom: 10 }} />
                      <Text style={s.emptyText}>{t('trNoProviders', lang)}</Text>
                    </View>
                  </View>
                }
                renderItem={({ item }) => (
                  <ProviderCard item={item} lang={lang} onPress={() => setSelectedProvider(item)} />
                )}
              />
            )
          }
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },


  // Landing
  catScroll:          { padding: 20, paddingBottom: 40 },
  subtitleCard:       { backgroundColor: colors.cardBg, borderRadius: 14, paddingHorizontal: 16,
                        paddingVertical: 12, marginBottom: 20, ...shadow },
  subtitle:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                        textAlign: 'center' },
  grid:               { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catTile:            { width: '47%', backgroundColor: colors.cardBg, borderRadius: radius.card,
                        padding: 18, alignItems: 'center', gap: 10, ...shadow,
                        borderWidth: 1, borderColor: colors.border },
  catIconWrap:        { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight,
                        alignItems: 'center', justifyContent: 'center' },
  catLabel:           { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                        textAlign: 'center' },

  // Register CTA
  ctaCard:            { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
                        backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                        ...shadow, borderWidth: 1, borderColor: colors.border },
  ctaIconWrap:        { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                        alignItems: 'center', justifyContent: 'center' },
  ctaCardTitle:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                        marginBottom: 2 },
  ctaCardSub:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // District filter
  districtRow:        { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:               { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                        backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:         { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:     { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Provider list
  listContent:        { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  emptyWrap:          { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyCard:          { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24,
                        paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyText:          { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                        textAlign: 'center' },

  // Provider card
  card:               { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                        ...shadow, borderWidth: 1, borderColor: colors.border },
  cardTop:            { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
                        marginBottom: 6, gap: 8 },
  cardName:           { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  cardBadges:         { alignItems: 'flex-end', gap: 4 },
  verifiedBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3,
                        backgroundColor: colors.successLight, paddingHorizontal: 7, paddingVertical: 3,
                        borderRadius: 10 },
  verifiedText:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.success },
  districtBadge:      { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                        borderRadius: 10 },
  districtText:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },
  airportRow:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  airportText:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardDesc:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                        lineHeight: 19, marginBottom: 10 },
  btnRow:             { flexDirection: 'row', gap: 10 },
  callBtn:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 6, backgroundColor: colors.primary, borderRadius: radius.md,
                        paddingVertical: 10 },
  callBtnText:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  waBtn:              { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 6, backgroundColor: '#25D366', borderRadius: radius.md,
                        paddingVertical: 10 },
  waBtnText:          { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
