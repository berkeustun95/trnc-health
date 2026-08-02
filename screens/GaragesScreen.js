import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import GarageOnboardingScreen from './GarageOnboardingScreen'

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

function GarageCard({ item, lang, onPress }) {
  const types = Array.isArray(item.service_types) ? item.service_types : []
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>

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
    </TouchableOpacity>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GaragesScreen({ lang, session, onBack, onRequireAccount, onOpenFacility }) {
  const [garages, setGarages]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(false)
  const [selected, setSelected]       = useState([]) // multi-select category keys
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [myGarage, setMyGarage]       = useState(null) // the caller's own garage row, if any

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    let query = supabase
      .from('facilities')
      .select('id, name, type, service_types, address, phone, opening_hours, description')
      .eq('type', 'garage')
      .eq('status', 'active')
      .order('name', { ascending: true })
    if (selected.length > 0) query = query.overlaps('service_types', selected)
    const { data, error: err } = await query
    if (err) setError(true)
    else setGarages(data || [])
    setLoading(false)
  }, [selected])

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
            renderItem={({ item }) => <GarageCard item={item} lang={lang} onPress={() => onOpenFacility?.(item)} />}
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

  // Garage card
  card:           { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                    ...shadow, borderWidth: 1, borderColor: colors.border },
  cardName:       { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  categoryBadge:  { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 10 },
  categoryText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  cardRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  cardMeta:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardDesc:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginTop: 2, marginBottom: 10 },
  cardCta:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardCtaText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
