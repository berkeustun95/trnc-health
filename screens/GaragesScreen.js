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
import FeaturedBadge from '../components/FeaturedBadge'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { areaOptions } from '../constants/areas'
import FilterDropdown from '../components/FilterDropdown'
import { FEATURED_LIVE, PRICE_COMPARE_LIVE, MODULE_FLAGS } from '../constants/flags'
import { partitionFeatured, isFeatured } from '../utils/featured'
import { pricedServices, formatPriceRange } from '../utils/servicePrices'
import GarageOnboardingScreen from './GarageOnboardingScreen'
import GaragePriceCompareScreen from './GaragePriceCompareScreen'
import { REDESIGN } from '../constants/redesign'
import { colors as C, category as CAT, type, radii, elevation, press } from '../constants/theme'
import {
  ScreenHeader as UiHeader, FilterBar, Dropdown, InfoBanner, ListCard, ErrorState, EmptyState, CardSkeleton,
} from '../components/ui'

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
// opens (tel:<phone>, maps.google.com/?q=<address>). Featured stays exactly as gated today.
function RGarageCard({ item, lang, onPress, showFeatured }) {
  const types  = Array.isArray(item.service_types) ? item.service_types : []
  const priced = pricedServices(item, CATEGORY_ORDER)
  const thumb  = item.logo_url || item.cover_image_url
  return (
    <ListCard
      title={item.name}
      subtitle={types.map(ty => categoryLabel(ty, lang)).join(' · ')}
      leading={thumb ? { uri: thumb } : { icon: 'car-sport-outline', category: 'homeLife' }}
      badge={showFeatured && isFeatured(item) ? t('featuredBadge', lang) : null}
      meta={[
        priced.length > 0 ? { icon: 'pricetag-outline', text: `${categoryLabel(priced[0].key, lang)} ${formatPriceRange(priced[0])}${priced.length > 1 ? `  +${priced.length - 1}` : ''}` } : null,
        { icon: 'location-outline', text: item.address },
        { icon: 'time-outline', text: item.opening_hours },
      ]}
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

export default function GaragesScreen({ lang, session, onBack, onRequireAccount, onOpenFacility, onShowTowing, isAdmin = false, backRef = null }) {
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
  const listMem = useScrollMemory('gar:list')
  // App's hardware-back chain asks this before closing the module: the same steps as the
  // on-screen backs, topmost layer first (slice 10, 2026-09-28).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (showCompare) { setShowCompare(false); return true }
      if (showOnboarding) { setShowOnboarding(false); return true }
      return false
    }
    return () => { backRef.current = null }
  })
  useEffect(() => () => forgetScroll('gar:'), [])
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

  if (REDESIGN) {
    return (
      <SafeAreaView style={r.safe} edges={['top']}>
        <UiHeader onBack={onBack} title={t('garagesTitle', lang)} lang={lang} />
        {MODULE_FLAGS.towing && !!onShowTowing && (
          <View style={r.towingWrap}>
            <RCtaRow icon="car-outline" title={t('menuTowing', lang)} sub={t('towingFromGaragesSub', lang)} onPress={onShowTowing} />
          </View>
        )}
        <FilterBar>
          <Dropdown
            label={t('ddCategory', lang)}
            options={GARAGE_CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))}
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
            data={garages}
            keyExtractor={item => item.id}
            contentContainerStyle={r.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={r.header}>
                <InfoBanner icon="car-sport-outline" category="homeLife" title={t('garageIntroTitle', lang)} message={t('garageIntroSub', lang)} />
                <RCtaRow
                  icon={myGarage ? 'construct-outline' : 'add-circle-outline'}
                  title={t(myGarage ? 'garageManageCta' : 'garageListCta', lang)}
                  sub={t(myGarage ? 'garageManageCtaSub' : 'garageListCtaSub', lang)}
                  onPress={() => { if (onRequireAccount?.('gateGarage')) return; setShowOnboarding(true) }}
                />
                {priceCompareVisible && (
                  <RCtaRow icon="pricetags-outline" title={t('priceCompareCta', lang)} sub={t('priceCompareCtaSub', lang)} onPress={() => setShowCompare(true)} />
                )}
              </View>
            }
            ListEmptyComponent={<EmptyState icon="car-sport-outline" category="homeLife" title={t('garageEmpty', lang)} message={t('garageEmptySub', lang)} />}
            renderItem={({ item }) => <RGarageCard item={item} lang={lang} showFeatured={showFeatured} onPress={() => onOpenFacility?.(item)} />}
          />
        )}
      </SafeAreaView>
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

        <View style={s.ddRow}>
          <FilterDropdown
            label={t('ddCategory', lang)}
            options={GARAGE_CATEGORIES.map(c => ({ value: c.key, label: t(c.labelKey, lang) }))}
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
  towingTitle:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  towingSub:      { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
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

// Redesign styles (REDESIGN only).
const r = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.canvas },
  list:     { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 12 },
  desc:     { ...type.small, color: C.textSecondary, marginTop: 10 },
  cta:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, backgroundColor: C.card,
              borderRadius: radii.card, padding: 14, ...elevation.card },
  ctaIcon:  { width: 44, height: 44, borderRadius: radii.tile, backgroundColor: CAT.homeLife.bg,
              alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { ...type.rowTitle, color: C.textPrimary },
  ctaSub:   { ...type.small, color: C.textSecondary, marginTop: 2 },
  header:   { gap: 12, marginBottom: 4 },
  towingWrap: { flexShrink: 0, paddingHorizontal: 16, paddingTop: 4 },
})
