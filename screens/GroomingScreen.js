import { useState, useEffect, useCallback } from 'react'
import { useScrollMemory, forgetScroll } from '../utils/scrollMemory'
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
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
import { areaOptions } from '../constants/areas'
import FilterDropdown from '../components/FilterDropdown'
import GroomingOnboardingScreen from './GroomingOnboardingScreen'
import { REDESIGN } from '../constants/redesign'
import { colors as C, category as CAT, type, radii, elevation, press } from '../constants/theme'
import {
  ScreenHeader as UiHeader, FilterBar, Dropdown, InfoBanner, ListCard, ErrorState, EmptyState, CardSkeleton,
  ModuleScreen,
} from '../components/ui'

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

// Redesign CTA row (register / manage / price compare): same targets and copy as the legacy cards.
function RCtaRow({ icon, title, sub, onPress }) {
  return (
    <TouchableOpacity style={r.cta} onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}>
      <View style={r.ctaIcon}><Ionicons name={icon} size={24} color={CAT.homeLife.ink} /></View>
      <View style={{ flex: 1 }}>
        <Text style={r.ctaTitle}>{title}</Text>
        <Text style={r.ctaSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
    </TouchableOpacity>
  )
}

// Redesign card: the equal ListCard. Call + directions use the SAME URLs the facility profile
// opens (tel:<phone>, maps.google.com/?q=<address>).
function RProviderCard({ item, lang, onPress }) {
  const types = Array.isArray(item.service_types) ? item.service_types : []
  const thumb = item.logo_url || item.cover_image_url
  return (
    <ListCard
      title={item.name}
      subtitle={types.map(ty => categoryLabel(ty, lang)).join(' · ')}
      leading={thumb ? { uri: thumb } : { icon: 'cut-outline', category: 'homeLife' }}
      meta={[{ icon: 'location-outline', text: item.address }]}
      onPress={onPress}
      lang={lang}
      actions={[
        item.phone ? { kind: 'call', onPress: () => Linking.openURL(`tel:${item.phone}`) } : null,
        item.address ? { kind: 'directions', onPress: () => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(item.address)}`) } : null,
      ]}
    >
      {!!item.description && <Text style={r.desc} numberOfLines={2}>{item.description}</Text>}
    </ListCard>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GroomingScreen({ lang, session, onBack, onRequireAccount, onOpenFacility, backRef = null }) {
  const [providers, setProviders]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(false)
  const [selected, setSelected]           = useState([]) // multi-select category keys
  const [regions, setRegions]             = useState([]) // multi-select region slugs
  const [areas, setAreas]                 = useState([]) // multi-select area slugs (only when 1 region)
  const [showOnboarding, setShowOnboarding]     = useState(false)
  const listMem = useScrollMemory('groom:list')
  // App's hardware-back chain asks this before closing the module: the same steps as the
  // on-screen backs, topmost layer first (slice 10, 2026-09-28).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (showOnboarding) { setShowOnboarding(false); return true }
      return false
    }
    return () => { backRef.current = null }
  })
  useEffect(() => () => forgetScroll('groom:'), [])
  const [myFacility, setMyFacility]             = useState(null) // the caller's own grooming facility, if any

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    let query = supabase
      .from('facilities')
      .select('id, name, type, service_types, address, phone, opening_hours, description, languages, specialty, latitude, longitude, photos, verified, availability, cover_image_url, logo_url, provider_id, city, area')
      .eq('type', 'grooming')
      .eq('status', 'active')
      .is('hidden_at', null)   // moderation: also drop Hidden listings (RLS 20260820 is the gate)
      .order('name', { ascending: true })
    if (selected.length > 0) query = query.overlaps('service_types', selected)
    if (regions.length > 0) query = query.in('city', regions)
    // Area sub-filter only ever holds slugs for the single selected region (cleared
    // on any region change), so ANDing it with the city filter can't leak cross-region.
    if (areas.length > 0) query = query.in('area', areas)
    const { data, error: err } = await query
    if (err) setError(true)
    else setProviders(data || [])
    setLoading(false)
  }, [selected, regions, areas])

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

  if (REDESIGN) {
    return (
      <ModuleScreen topic="grooming">
      <SafeAreaView style={r.safe} edges={['top']}>
        <UiHeader onBack={onBack} title={t('groomTitle', lang)} lang={lang} />
        <FilterBar>
          <Dropdown
            label={t('ddCategory', lang)}
            options={CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))}
            multi values={selected} onChange={setSelected} lang={lang}
          />
          <Dropdown
            label={t('ddDistrict', lang)}
            options={REGIONS.map(rg => ({ value: rg, label: t(REGION_LABEL_KEY[rg], lang) }))}
            multi values={regions} onChange={arr => { setRegions(arr); setAreas([]) }} lang={lang}
          />
          {regions.length === 1 && (
            <Dropdown
              label={t('ddArea', lang)}
              options={areaOptions(regions[0])}
              multi values={areas} onChange={setAreas} lang={lang}
            />
          )}
        </FilterBar>
        {loading ? (
          <View style={r.list}>
            <CardSkeleton height={150} />
            <CardSkeleton height={150} />
          </View>
        ) : error ? (
          <ErrorState message={t('facilityLoadError', lang)} onRetry={load} lang={lang} />
        ) : (
          <FlatList
            {...listMem}
            data={providers}
            keyExtractor={item => item.id}
            contentContainerStyle={r.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={r.header}>
                <InfoBanner icon="cut-outline" category="homeLife" title={t('groomIntroTitle', lang)} message={t('groomIntroSub', lang)} />
                <RCtaRow
                  icon={myFacility ? 'construct-outline' : 'add-circle-outline'}
                  title={t(myFacility ? 'groomManageCta' : 'groomRegisterCTA', lang)}
                  sub={t(myFacility ? 'groomManageCtaSub' : 'groomRegisterCTASub', lang)}
                  onPress={() => { if (onRequireAccount?.('gateGrooming')) return; setShowOnboarding(true) }}
                />
              </View>
            }
            ListEmptyComponent={<EmptyState icon="cut-outline" category="homeLife" title={t('groomEmpty', lang)} message={t('groomEmptySub', lang)} />}
            renderItem={({ item }) => <RProviderCard item={item} lang={lang} onPress={() => onOpenFacility(item)} />}
          />
        )}
      </SafeAreaView>
      </ModuleScreen>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="grooming" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('groomTitle', lang)} lang={lang} />

      <View style={{ flex: 1 }}>
        <View style={s.ddRow}>
          <FilterDropdown
            label={t('ddCategory', lang)}
            options={CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))}
            multi values={selected} onChange={setSelected} lang={lang}
          />
          <FilterDropdown
            label={t('ddDistrict', lang)}
            options={REGIONS.map(r => ({ value: r, label: t(REGION_LABEL_KEY[r], lang) }))}
            multi values={regions} onChange={arr => { setRegions(arr); setAreas([]) }} lang={lang}
          />
          {/* Area only when EXACTLY ONE district is selected; a district change clears it. */}
          {regions.length === 1 && (
            <FilterDropdown
              label={t('ddArea', lang)}
              options={areaOptions(regions[0])}
              multi values={areas} onChange={setAreas} lang={lang}
            />
          )}
        </View>

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
            {...listMem}
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

  // Filters
  ddRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10, flexShrink: 0 },

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

// Redesign styles (REDESIGN only).
const r = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: 'transparent' },
  list:     { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  desc:     { ...type.small, color: C.textSecondary, marginTop: 10 },
  cta:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, backgroundColor: 'rgba(255,255,255,0.93)',
              borderRadius: 20, padding: 14, ...elevation.card },
  ctaIcon:  { width: 44, height: 44, borderRadius: radii.tile, backgroundColor: CAT.homeLife.bg,
              alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { ...type.rowTitle, color: C.textPrimary },
  ctaSub:   { ...type.small, color: C.textSecondary, marginTop: 2 },
  header:   { gap: 12, marginBottom: 4 },
})
