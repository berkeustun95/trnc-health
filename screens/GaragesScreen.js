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
import FeaturedBadge from '../components/FeaturedBadge'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { areaOptions } from '../constants/areas'
import { FEATURED_LIVE, PRICE_COMPARE_LIVE, MODULE_FLAGS } from '../constants/flags'
import { partitionFeatured, isFeatured } from '../utils/featured'
import { pricedServices, formatPriceRange } from '../utils/servicePrices'
import GarageOnboardingScreen from './GarageOnboardingScreen'
import GaragePriceCompareScreen from './GaragePriceCompareScreen'

// Multi-tag auto-service categories. A garage can offer several; the directory
// filters with .overlaps() (OR semantics). Keys must match the DB CHECK +
// create_garage_facility() in 20260731_garages_directory.sql.
export const GARAGE_CATEGORIES = [
  { key: 'muayene', icon: 'clipboard-outline', labelKey: 'garageCatMuayene' },
  { key: 'repair',  icon: 'build-outline',     labelKey: 'garageCatRepair' },
  { key: 'tyres',   icon: 'ellipse-outline',   labelKey: 'garageCatTyres' },
  { key: 'wash',    icon: 'water-outline',     labelKey: 'garageCatWash' },
  { key: 'parts',   icon: 'cog-outline',       labelKey: 'garageCatParts' },
  { key: 'towing',  icon: 'car-outline',       labelKey: 'garageCatTowing' },
]
const CATEGORY_KEYS = Object.fromEntries(GARAGE_CATEGORIES.map(c => [c.key, c.labelKey]))

function categoryLabel(key, lang) { return t(CATEGORY_KEYS[key] || key, lang) }

// ─── Garage card ──────────────────────────────────────────────────────────────

const CATEGORY_ORDER = GARAGE_CATEGORIES.map(c => c.key)

function GarageCard({ item, lang, onPress, showFeatured }) {
  const types  = Array.isArray(item.service_types) ? item.service_types : []
  const priced = pricedServices(item, CATEGORY_ORDER)
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      {!!item.cover_image_url && (
        <Image source={{ uri: item.cover_image_url }} style={s.cardCover} resizeMode="cover" />
      )}
      <View style={s.cardBody}>
        {showFeatured && isFeatured(item) && <FeaturedBadge lang={lang} style={{ marginBottom: 8 }} />}
        <View style={s.cardHead}>
          {!!item.logo_url && (
            <Image source={{ uri: item.logo_url }} style={s.cardLogo} resizeMode="cover" />
          )}
          <Text style={[s.cardName, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
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

        {priced.length > 0 && (
          <View style={s.priceRow}>
            <Ionicons name="pricetag-outline" size={13} color={colors.primary} />
            <Text style={s.priceText} numberOfLines={1}>
              {categoryLabel(priced[0].key, lang)} {formatPriceRange(priced[0])}
              {priced.length > 1 ? `  +${priced.length - 1}` : ''}
            </Text>
          </View>
        )}

        {!!item.address && (
          <View style={s.cardRow}>
            <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
            <Text style={s.cardMeta} numberOfLines={1}>{item.address}</Text>
          </View>
        )}

        {!!item.opening_hours && (
          <View style={s.cardRow}>
            <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
            <Text style={s.cardMeta} numberOfLines={1}>{item.opening_hours}</Text>
          </View>
        )}

        {!!item.description && (
          <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
        )}

        <View style={s.cardCta}>
          <Text style={s.cardCtaText}>{t('garageViewDetails', lang)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GaragesScreen({ lang, session, onBack, onRequireAccount, onOpenFacility, onShowTowing, isAdmin = false }) {
  // Dark launch: featured pinning + badge show only once live, or to an admin
  // previewing the directory. Mirrors the GARAGES_LIVE tile-gate.
  const showFeatured = FEATURED_LIVE || isAdmin
  // Dark launch: the price-compare entry + screen show only once live, or to an admin
  // previewing while the price dataset fills in. Mirrors the showFeatured gate.
  const priceCompareVisible = PRICE_COMPARE_LIVE || isAdmin
  const [garages, setGarages]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(false)
  const [selected, setSelected]       = useState([]) // multi-select category keys
  const [regions, setRegions]         = useState([]) // multi-select region slugs
  const [areas, setAreas]             = useState([]) // multi-select area slugs (only when 1 region)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [myGarage, setMyGarage]       = useState(null) // the caller's own garage row, if any

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    let query = supabase
      .from('facilities')
      .select('id, name, type, service_types, service_prices, address, phone, opening_hours, description, cover_image_url, logo_url, photos, availability, city, area, featured_until')
      .eq('type', 'garage')
      .eq('status', 'active')
      .is('hidden_at', null)   // moderation: also drop Hidden listings (RLS 20260820 is the gate)
      .order('name', { ascending: true })
    if (selected.length > 0) query = query.overlaps('service_types', selected)
    if (regions.length > 0) query = query.in('city', regions)
    // Area sub-filter only ever holds slugs for the single selected region (cleared
    // on any region change), so ANDing it with the city filter can't leak cross-region.
    if (areas.length > 0) query = query.in('area', areas)
    const { data, error: err } = await query
    if (err) { console.warn('garages load error:', err.message, err.code); setError(true) }
    // Featured rows pinned + fairly rotated to the top when surfacing is enabled;
    // otherwise the plain name sort is left untouched.
    else setGarages(showFeatured ? partitionFeatured(data || []) : (data || []))
    setLoading(false)
  }, [selected, regions, areas, showFeatured])

  // Changing the region selection clears any chosen areas — no stale area filter
  // survives a region change (same discipline as the onboarding city→area dropdown).
  function toggleRegion(key) {
    setRegions(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
    setAreas([])
  }

  function toggleArea(key) {
    setAreas(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  useEffect(() => { load() }, [load])

  // Does the caller already own a garage? Drives the CTA label (list vs manage).
  // Any status — a pending/suspended garage still means "manage", not "list".
  const checkMyGarage = useCallback(async () => {
    if (!session?.user?.id) { setMyGarage(null); return }
    const { data } = await supabase
      .from('facilities')
      .select('id, status')
      .eq('provider_id', session.user.id)
      .eq('type', 'garage')
      .maybeSingle()
    setMyGarage(data ?? null)
  }, [session?.user?.id])

  useEffect(() => { checkMyGarage() }, [checkMyGarage])

  function toggleCategory(key) {
    setSelected(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  if (showCompare) {
    return (
      <GaragePriceCompareScreen
        lang={lang}
        onBack={() => setShowCompare(false)}
        onOpenFacility={onOpenFacility}
      />
    )
  }

  if (showOnboarding) {
    return (
      <GarageOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowOnboarding(false)}
        onSubmitted={() => { setShowOnboarding(false); load(); checkMyGarage() }}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="garages" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('garagesTitle', lang)} lang={lang} />

      <View style={{ flex: 1 }}>
        {/* Broken down vs. needs a repair is the SAME journey — someone whose car will
            not start is as likely to open Garages as Towing. Gated on the module flag
            alone (no isAdmin): admins never reach this screen through the customer
            chain, so an isAdmin bypass here would be unreachable for them and hidden
            from everyone else. Preview by flipping the flag locally. */}
        {MODULE_FLAGS.towing && !!onShowTowing && (
          <TouchableOpacity style={s.towingRow} onPress={onShowTowing} activeOpacity={0.85}>
            <View style={s.towingIcon}>
              <Ionicons name="car-outline" size={19} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.towingTitle}>{t('menuTowing', lang)}</Text>
              <Text style={s.towingSub} numberOfLines={2}>{t('towingFromGaragesSub', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

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
            <Text style={[s.chipText, selected.length === 0 && s.chipTextActive]}>{t('filterAll', lang)}</Text>
          </TouchableOpacity>
          {GARAGE_CATEGORIES.map(c => {
            const active = selected.includes(c.key)
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, active && s.chipActive]}
                onPress={() => toggleCategory(c.key)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{t(c.labelKey, lang)}</Text>
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
            onPress={() => { setRegions([]); setAreas([]) }}
          >
            <Text style={[s.chipText, regions.length === 0 && s.chipTextActive]}>{t('filterAll', lang)}</Text>
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

        {/* Dependent area sub-row: only when EXACTLY ONE region is selected. */}
        {regions.length === 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={s.filterRow}
          >
            <TouchableOpacity
              style={[s.areaChip, areas.length === 0 && s.chipActive]}
              onPress={() => setAreas([])}
            >
              <Text style={[s.chipText, areas.length === 0 && s.chipTextActive]}>{t('filterAll', lang)}</Text>
            </TouchableOpacity>
            {areaOptions(regions[0]).map(a => {
              const active = areas.includes(a.value)
              return (
                <TouchableOpacity
                  key={a.value}
                  style={[s.areaChip, active && s.chipActive]}
                  onPress={() => toggleArea(a.value)}
                >
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
              <>
                <MascotIntroCard
                  module="garages"
                  title={t('garageIntroTitle', lang)}
                  subtitle={t('garageIntroSub', lang)}
                  style={s.introCard}
                />
                <TouchableOpacity
                  style={s.ctaCard}
                  onPress={() => { if (onRequireAccount?.('gateGarage')) return; setShowOnboarding(true) }}
                  activeOpacity={0.8}
                >
                  <View style={s.ctaIconWrap}>
                    <Ionicons name={myGarage ? 'construct-outline' : 'add-circle-outline'} size={26} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.ctaCardTitle}>{t(myGarage ? 'garageManageCta' : 'garageListCta', lang)}</Text>
                    <Text style={s.ctaCardSub}>{t(myGarage ? 'garageManageCtaSub' : 'garageListCtaSub', lang)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {priceCompareVisible && (
                  <TouchableOpacity style={s.ctaCard} onPress={() => setShowCompare(true)} activeOpacity={0.8}>
                    <View style={s.ctaIconWrap}>
                      <Ionicons name="pricetags-outline" size={24} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ctaCardTitle}>{t('priceCompareCta', lang)}</Text>
                      <Text style={s.ctaCardSub}>{t('priceCompareCtaSub', lang)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </>
            }
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <View style={s.emptyCard}>
                  <Ionicons name="car-sport-outline" size={42} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={s.emptyText}>{t('garageEmpty', lang)}</Text>
                  <Text style={s.emptySub}>{t('garageEmptySub', lang)}</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => <GarageCard item={item} lang={lang} showFeatured={showFeatured} onPress={() => onOpenFacility?.(item)} />}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },

  // Category filter
  towingRow:      { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 11,
                    marginHorizontal: 16, marginTop: 10, padding: 12,
                    backgroundColor: colors.cardBg, borderRadius: radius.md,
                    borderWidth: 1, borderColor: colors.border, ...shadow },
  towingIcon:     { width: 38, height: 38, borderRadius: 19, alignItems: 'center',
                    justifyContent: 'center', backgroundColor: colors.dangerLight },
  towingTitle:    { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  towingSub:      { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  filterRow:      { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  // Area sub-row chip: slightly smaller to signal it's dependent on the region above.
  areaChip:       { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },

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

  // Garage card
  card:           { backgroundColor: colors.cardBg, borderRadius: radius.card, overflow: 'hidden',
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  cardCover:      { width: '100%', height: 120, backgroundColor: colors.border },
  cardBody:       { padding: 16 },
  cardHead:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardLogo:       { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.border },
  cardName:       { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  categoryBadge:  { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 10 },
  categoryText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  cardRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  priceRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  priceText:      { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  cardMeta:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardDesc:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginTop: 2, marginBottom: 10 },
  cardCta:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardCtaText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
