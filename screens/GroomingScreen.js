import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import GroomingOnboardingScreen from './GroomingOnboardingScreen'

const CATEGORIES = [
  { key: 'barber',      labelKey: 'groomCatBarber' },
  { key: 'hairdresser', labelKey: 'groomCatHairdresser' },
  { key: 'nails',       labelKey: 'groomCatNails' },
  { key: 'beauty',      labelKey: 'groomCatBeauty' },
]
const CATEGORY_KEYS = Object.fromEntries(CATEGORIES.map(c => [c.key, c.labelKey]))

function categoryLabel(key, lang) { return t(CATEGORY_KEYS[key] || key, lang) }

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({ item, lang, onPress }) {
  const types = Array.isArray(item.service_types) ? item.service_types : []
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      {!!item.cover_image_url && (
        <Image source={{ uri: item.cover_image_url }} style={s.cardCover} resizeMode="cover" />
      )}
      <View style={s.cardBody}>
        <View style={s.cardTop}>
          {!!item.logo_url && (
            <Image source={{ uri: item.logo_url }} style={s.cardLogo} resizeMode="cover" />
          )}
          <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
        </View>

        {types.length > 0 && (
          <View style={s.badgeRow}>
            {types.map(ty => (
              <View key={ty} style={s.categoryBadge}>
                <Text style={s.categoryText}>{categoryLabel(ty, lang)}</Text>
              </View>
            ))}
          </View>
        )}

        {!!item.address && (
          <View style={s.cardRow}>
            <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
            <Text style={s.cardMeta} numberOfLines={1}>{item.address}</Text>
          </View>
        )}

        {!!item.description && (
          <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
        )}

        <View style={s.cardCta}>
          <Text style={s.cardCtaText}>{t('groomViewProfile', lang)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GroomingScreen({ lang, session, onBack, onRequireAccount, onOpenFacility }) {
  const [providers, setProviders]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(false)
  const [selected, setSelected]           = useState([]) // multi-select category keys
  const [regions, setRegions]             = useState([]) // multi-select region slugs
  const [showOnboarding, setShowOnboarding]     = useState(false)
  const [myFacility, setMyFacility]             = useState(null) // the caller's own grooming facility, if any

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    let query = supabase
      .from('facilities')
      .select('id, name, type, service_types, address, phone, opening_hours, description, languages, specialty, latitude, longitude, photos, verified, availability, cover_image_url, logo_url, provider_id, city, area')
      .eq('type', 'grooming')
      .eq('status', 'active')
      .order('name', { ascending: true })
    if (selected.length > 0) query = query.overlaps('service_types', selected)
    if (regions.length > 0) query = query.in('city', regions)
    const { data, error: err } = await query
    if (err) setError(true)
    else setProviders(data || [])
    setLoading(false)
  }, [selected, regions])

  function toggleCategory(key) {
    setSelected(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  function toggleRegion(key) {
    setRegions(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  useEffect(() => { load() }, [load])

  // Does the caller already own a grooming facility? Drives the CTA label (register vs manage).
  // Any status — a pending/suspended facility still means "manage", not "register".
  const checkMyFacility = useCallback(async () => {
    if (!session?.user?.id) { setMyFacility(null); return }
    const { data } = await supabase
      .from('facilities')
      .select('id, status')
      .eq('provider_id', session.user.id)
      .eq('type', 'grooming')
      .maybeSingle()
    setMyFacility(data ?? null)
  }, [session?.user?.id])

  useEffect(() => { checkMyFacility() }, [checkMyFacility])

  if (showOnboarding) {
    return (
      <GroomingOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowOnboarding(false)}
        onSubmitted={() => { setShowOnboarding(false); load(); checkMyFacility() }}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="grooming" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('groomTitle', lang)} lang={lang} />

      <View style={{ flex: 1 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.filterRow}
        >
          <TouchableOpacity
            style={[s.chip, selected.length === 0 && s.chipActive]}
            onPress={() => setSelected([])}
          >
            <Text style={[s.chipText, selected.length === 0 && s.chipTextActive]}>{t('groomFilterAll', lang)}</Text>
          </TouchableOpacity>
          {CATEGORIES.map(c => {
            const active = selected.includes(c.key)
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, active && s.chipActive]}
                onPress={() => toggleCategory(c.key)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>
                  {t(c.labelKey, lang)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.filterRow}
        >
          <TouchableOpacity
            style={[s.chip, regions.length === 0 && s.chipActive]}
            onPress={() => setRegions([])}
          >
            <Text style={[s.chipText, regions.length === 0 && s.chipTextActive]}>{t('groomFilterAll', lang)}</Text>
          </TouchableOpacity>
          {REGIONS.map(r => {
            const active = regions.includes(r)
            return (
              <TouchableOpacity
                key={r}
                style={[s.chip, active && s.chipActive]}
                onPress={() => toggleRegion(r)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{t(REGION_LABEL_KEY[r], lang)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

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
            data={providers}
            keyExtractor={item => item.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                <MascotIntroCard
                  module="grooming"
                  title={t('groomIntroTitle', lang)}
                  subtitle={t('groomIntroSub', lang)}
                  style={s.introCard}
                />
                <TouchableOpacity
                  style={s.ctaCard}
                  onPress={() => { if (onRequireAccount?.('gateGrooming')) return; setShowOnboarding(true) }}
                  activeOpacity={0.8}
                >
                  <View style={s.ctaIconWrap}>
                    <Ionicons name={myFacility ? 'construct-outline' : 'add-circle-outline'} size={26} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.ctaCardTitle}>{t(myFacility ? 'groomManageCta' : 'groomRegisterCTA', lang)}</Text>
                    <Text style={s.ctaCardSub}>{t(myFacility ? 'groomManageCtaSub' : 'groomRegisterCTASub', lang)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </>
            }
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <View style={s.emptyCard}>
                  <Ionicons name="cut-outline" size={42} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={s.emptyText}>{t('groomEmpty', lang)}</Text>
                  <Text style={s.emptySub}>{t('groomEmptySub', lang)}</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <ProviderCard item={item} lang={lang} onPress={() => onOpenFacility(item)} />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },

  // Category filter
  filterRow:      { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // List
  listContent:    { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  introCard:      { marginBottom: 4 },

  // Register CTA
  ctaCard:        { flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                    ...shadow, borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  ctaIconWrap:    { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight,
                    alignItems: 'center', justifyContent: 'center' },
  ctaCardTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  ctaCardSub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // Empty / error
  emptyWrap:      { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyCard:      { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24,
                    paddingVertical: 24, alignItems: 'center', ...shadow },
  emptyText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                    textAlign: 'center' },
  emptySub:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    textAlign: 'center', marginTop: 6, lineHeight: 19 },
  retryBtn:       { marginTop: 14, backgroundColor: colors.primaryLight, borderRadius: radius.md,
                    paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  // Provider card
  card:           { backgroundColor: colors.cardBg, borderRadius: radius.card, overflow: 'hidden',
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  cardCover:      { width: '100%', height: 120, backgroundColor: colors.border },
  cardBody:       { padding: 16 },
  cardLogo:       { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.border },
  cardTop:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 6, gap: 8 },
  cardName:       { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  categoryBadge:  { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 10 },
  categoryText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  cardRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  cardMeta:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardDesc:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginBottom: 10 },
  cardCta:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardCtaText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
