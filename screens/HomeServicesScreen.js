import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import HomeServiceProfileScreen from './HomeServiceProfileScreen'
import HomeServiceOnboardingScreen from './HomeServiceOnboardingScreen'

const CATEGORIES = [
  { key: 'plumber',     icon: 'water-outline',        labelKey: 'hsCategoryPlumber' },
  { key: 'electrician', icon: 'flash-outline',         labelKey: 'hsCategoryElectrician' },
  { key: 'carpenter',   icon: 'construct-outline',     labelKey: 'hsCategoryCarpenter' },
  { key: 'painter',     icon: 'color-palette-outline', labelKey: 'hsCategoryPainter' },
  { key: 'sewer',       icon: 'funnel-outline',        labelKey: 'hsCategorySewer' },
  { key: 'ac_tech',     icon: 'thermometer-outline',   labelKey: 'hsCategoryAcTech' },
  { key: 'locksmith',   icon: 'key-outline',           labelKey: 'hsCategoryLocksmith' },
  { key: 'tiler',       icon: 'grid-outline',          labelKey: 'hsCategoryTiler' },
  { key: 'handyman',    icon: 'hammer-outline',        labelKey: 'hsCategoryHandyman' },
]

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke']

function districtLabel(d, lang) {
  const map = {
    nicosia:   t('hsDistrictNicosia', lang),
    kyrenia:   t('hsDistrictKyrenia', lang),
    famagusta: t('hsDistrictFamagusta', lang),
    morphou:   t('hsDistrictMorphou', lang),
    iskele:    t('hsDistrictIskele', lang),
    lefke:     t('hsDistrictLefke', lang),
  }
  return map[d] || d
}

// ─── Category tile ────────────────────────────────────────────────────────────

function CategoryTile({ item, lang, onPress }) {
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
              <Text style={s.verifiedText}>{t('hsVerified', lang)}</Text>
            </View>
          )}
          <View style={s.districtBadge}>
            <Text style={s.districtText}>{districtLabel(item.district, lang)}</Text>
          </View>
        </View>
      </View>

      {!!item.description && (
        <Text style={s.cardDesc} numberOfLines={3}>{item.description}</Text>
      )}

      {item.service_types.length > 0 && (
        <View style={s.tagRow}>
          {item.service_types.map(st => {
            const cat = CATEGORIES.find(c => c.key === st)
            return (
              <View key={st} style={s.tag}>
                <Text style={s.tagText}>{cat ? t(cat.labelKey, lang) : st}</Text>
              </View>
            )
          })}
        </View>
      )}

      <View style={s.btnRow}>
        {canCall && (
          <TouchableOpacity
            style={s.callBtn}
            onPress={() => Linking.openURL(`tel:${phone}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={15} color="#fff" />
            <Text style={s.callBtnText}>{t('hsCall', lang)}</Text>
          </TouchableOpacity>
        )}
        {canWA && (
          <TouchableOpacity
            style={s.waBtn}
            onPress={() => Linking.openURL(`https://wa.me/${waNum}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-whatsapp" size={15} color="#fff" />
            <Text style={s.waBtnText}>{t('hsWhatsApp', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeServicesScreen({ lang, session, onBack }) {
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [providers, setProviders]               = useState([])
  const [loading, setLoading]                   = useState(false)

  const loadProviders = useCallback(async (category, district) => {
    setLoading(true)
    let query = supabase
      .from('home_services')
      .select('*')
      .eq('status', 'active')
      .contains('service_types', [category])
      .order('verified', { ascending: false })
      .order('name')

    if (district) query = query.eq('district', district)

    const { data } = await query
    setProviders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedCategory) loadProviders(selectedCategory, selectedDistrict)
  }, [selectedCategory, selectedDistrict, loadProviders])

  function selectCategory(key) {
    setSelectedDistrict(null)
    setSelectedCategory(key)
  }

  function handleBack() {
    if (selectedProvider) {
      setSelectedProvider(null)
    } else if (selectedCategory) {
      setSelectedCategory(null)
      setSelectedDistrict(null)
      setProviders([])
    } else {
      onBack()
    }
  }

  if (showOnboarding) {
    return (
      <HomeServiceOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowOnboarding(false)}
        onSubmitted={() => setShowOnboarding(false)}
      />
    )
  }

  if (selectedProvider) {
    return (
      <HomeServiceProfileScreen
        provider={selectedProvider}
        lang={lang}
        onBack={() => setSelectedProvider(null)}
      />
    )
  }

  const activeCat    = CATEGORIES.find(c => c.key === selectedCategory)
  const headerTitle  = activeCat ? t(activeCat.labelKey, lang) : t('hsTitle', lang)
  const backLabel    = selectedCategory ? t('hsBackToCategories', lang) : t('back', lang)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="home_services" />
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={handleBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{backLabel}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        <View style={{ width: 80 }} />
      </View>

      {!selectedCategory ? (
        <ScrollView
          contentContainerStyle={s.catScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.subtitle}>{t('hsSubtitle', lang)}</Text>
          <View style={s.grid}>
            {CATEGORIES.map(cat => (
              <CategoryTile
                key={cat.key}
                item={cat}
                lang={lang}
                onPress={() => selectCategory(cat.key)}
              />
            ))}
          </View>

          <TouchableOpacity style={s.ctaCard} onPress={() => setShowOnboarding(true)} activeOpacity={0.8}>
            <View style={s.ctaIconWrap}>
              <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.ctaCardTitle}>{t('hsRegisterCTA', lang)}</Text>
              <Text style={s.ctaCardSub}>{t('hsRegisterCTASub', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.districtRow}
          >
            <TouchableOpacity
              style={[s.chip, !selectedDistrict && s.chipActive]}
              onPress={() => setSelectedDistrict(null)}
            >
              <Text style={[s.chipText, !selectedDistrict && s.chipTextActive]}>
                {t('hsAllDistricts', lang)}
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
                    <Ionicons name="search-outline" size={42} color={colors.border} />
                    <Text style={s.emptyText}>{t('hsNoProviders', lang)}</Text>
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
  safe:           { flex: 1, backgroundColor: colors.bg },

  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg,
                    borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:       { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120 },
  backPillText:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  headerTitle:    { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold',
                    color: colors.textPrimary },

  // Category picker
  catScroll:      { padding: 20, paddingBottom: 40 },
  subtitle:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    marginBottom: 20, textAlign: 'center' },
  grid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catTile:        { width: '47%', backgroundColor: colors.cardBg, borderRadius: radius.card,
                    padding: 18, alignItems: 'center', gap: 10, ...shadow,
                    borderWidth: 1, borderColor: colors.border },
  catIconWrap:    { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight,
                    alignItems: 'center', justifyContent: 'center' },
  catLabel:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                    textAlign: 'center' },

  // Register CTA
  ctaCard:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
                    backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  ctaIconWrap:    { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                    alignItems: 'center', justifyContent: 'center' },
  ctaCardTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                    marginBottom: 2 },
  ctaCardSub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // District filter
  districtRow:    { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Provider list
  listContent:    { padding: 16, paddingBottom: 40, gap: 12 },
  emptyWrap:      { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    textAlign: 'center' },

  // Provider card
  card:           { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  cardTop:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
                    marginBottom: 6, gap: 8 },
  cardName:       { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  cardBadges:     { alignItems: 'flex-end', gap: 4 },
  verifiedBadge:  { flexDirection: 'row', alignItems: 'center', gap: 3,
                    backgroundColor: colors.successLight, paddingHorizontal: 7, paddingVertical: 3,
                    borderRadius: 10 },
  verifiedText:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.success },
  districtBadge:  { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 10 },
  districtText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },
  cardDesc:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginBottom: 10 },
  tagRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  tag:            { backgroundColor: colors.accentLight, paddingHorizontal: 9, paddingVertical: 4,
                    borderRadius: 10 },
  tagText:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.accent },
  btnRow:         { flexDirection: 'row', gap: 10 },
  callBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, backgroundColor: colors.primary, borderRadius: radius.md,
                    paddingVertical: 10 },
  callBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  waBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, backgroundColor: '#25D366', borderRadius: radius.md,
                    paddingVertical: 10 },
  waBtnText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
