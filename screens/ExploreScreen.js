import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import MapView, { Marker } from 'react-native-maps'
import * as Updates from 'expo-updates'   // TEMPORARY (build marker) — remove before Slice 3
import { supabase } from '../lib/supabase'
import ExploreSubmitScreen from './ExploreSubmitScreen'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import {
  EXPLORE_GROUPS, GROUP_ORDER, GROUP_META, CATEGORY_LABEL_KEY,
  categoryToGroup, groupVisible,
} from '../constants/exploreCategories'

const TRNC_CENTER = { latitude: 35.2, longitude: 33.5, latitudeDelta: 0.9, longitudeDelta: 0.9 }

// TEMPORARY build marker (remove before Slice 3). Proves which OTA the device is running.
// Its very presence proves this new bundle loaded — no earlier bundle renders this line.
let BUILD_MARKER = 'n/a'
try {
  BUILD_MARKER = Updates.isEmbeddedLaunch
    ? 'EMBEDDED (no OTA applied)'
    : `OTA ${(Updates.updateId || '').slice(0, 8) || 'unknown'}`
} catch (e) { BUILD_MARKER = 'unavailable' }

// name_i18n[lang] if present, else fall through to the plain `name` column (never '').
function extractI18n(obj, lang) {
  if (!obj) return ''
  if (typeof obj !== 'object') return String(obj)
  const code = LANG_CODES[lang] ?? lang
  let result = obj[code] ?? obj.en ?? Object.values(obj)[0]
  if (result != null && typeof result === 'object') {
    result = result[code] ?? result.en ?? Object.values(result)[0]
  }
  return result != null ? String(result) : ''
}
function placeName(p, lang) { return extractI18n(p.name_i18n, lang) || p.name || '' }
function placeDesc(p, lang) { return extractI18n(p.description_i18n, lang) }

function regionLabel(region, lang) {
  return REGION_LABEL_KEY[region] ? t(REGION_LABEL_KEY[region], lang) : (region || '')
}
function categoryLabel(category, lang) {
  const key = CATEGORY_LABEL_KEY[category]
  return key ? t(key, lang) : category   // keyless categories → raw slug (admin-only today)
}
function groupLabel(group, lang) {
  const key = GROUP_META[group]?.labelKey
  return key ? t(key, lang) : group      // keyless groups → raw slug (admin-only today)
}
function groupEmoji(group) {
  if (group === 'nature')   return '🏖️'
  if (group === 'heritage') return '🏛️'
  return '📍'
}

// ─── Place card (list view) ───────────────────────────────────────────────────

function PlaceCard({ item, lang, onPress }) {
  const group   = categoryToGroup(item.category)
  const pc      = GROUP_META[group]?.colorToken || placeColors.landmark
  const isBeach = item.category === 'beach'
  const photo   = item.cover_image_url || item.photos?.[0]

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.88}>
      <View style={s.photoWrap}>
        {photo
          ? <Image source={{ uri: photo }} style={s.photo} resizeMode="cover" />
          : <View style={[s.photoPlaceholder, { backgroundColor: pc.bg }]}>
              <Text style={s.photoEmoji}>{groupEmoji(group)}</Text>
            </View>
        }
        <View style={[s.typePill, { backgroundColor: pc.bg }]}>
          <Text style={[s.typePillText, { color: pc.text }]}>
            {categoryLabel(item.category, lang)}
          </Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{placeName(item, lang)}</Text>
          <View style={s.districtBadge}>
            <Text style={s.districtText}>{regionLabel(item.region, lang)}</Text>
          </View>
        </View>

        {(isBeach && (item.blue_flag || item.access_type)) && (
          <View style={s.badgeRow}>
            {isBeach && item.blue_flag && (
              <View style={s.blueFlagBadge}>
                <Ionicons name="flag" size={11} color={colors.primary} />
                <Text style={s.blueFlagText}>{t('blBlueFlagLabel', lang)}</Text>
              </View>
            )}
            {isBeach && item.access_type && (
              <View style={s.accessBadge}>
                <Text style={s.accessText}>
                  {item.access_type === 'public' ? t('blAccessPublic', lang) : t('blAccessPrivate', lang)}
                </Text>
              </View>
            )}
          </View>
        )}

        {!!placeDesc(item, lang) && (
          <Text style={s.desc} numberOfLines={2}>{placeDesc(item, lang)}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Map pin bottom card ───────────────────────────────────────────────────────

function BottomPinCard({ item, lang, onClose, onViewProfile }) {
  const group = categoryToGroup(item.category)
  const pc    = GROUP_META[group]?.colorToken || placeColors.landmark
  const photo = item.cover_image_url || item.photos?.[0]

  return (
    <View style={pm.card}>
      <View style={pm.row}>
        {photo
          ? <Image source={{ uri: photo }} style={pm.thumb} resizeMode="cover" />
          : <View style={[pm.thumb, pm.thumbFallback, { backgroundColor: pc.bg }]}>
              <Text style={pm.thumbEmoji}>{groupEmoji(group)}</Text>
            </View>
        }
        <View style={{ flex: 1 }}>
          <View style={[pm.typeBadge, { backgroundColor: pc.bg }]}>
            <Text style={[pm.typeBadgeText, { color: pc.text }]}>
              {categoryLabel(item.category, lang)}
            </Text>
          </View>
          <Text style={pm.name} numberOfLines={1}>{placeName(item, lang)}</Text>
          <Text style={pm.district}>{regionLabel(item.region, lang)}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {!!placeDesc(item, lang) && (
        <Text style={pm.desc} numberOfLines={2}>{placeDesc(item, lang)}</Text>
      )}
      <TouchableOpacity style={pm.viewBtn} onPress={onViewProfile} activeOpacity={0.85}>
        <Text style={pm.viewBtnText}>{t('viewProfile', lang)}</Text>
        <Ionicons name="chevron-forward" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  )
}

// ─── Map view ─────────────────────────────────────────────────────────────────

function PlacesMapView({ places, userLocation, lang, onSelectPlace }) {
  const [selectedPin, setSelectedPin] = useState(null)

  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude,
        latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : TRNC_CENTER

  const pinnable = places.filter(p => p.latitude != null && p.longitude != null)

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation={!!userLocation}
        onPress={() => setSelectedPin(null)}
      >
        {pinnable.map(p => {
          const group = categoryToGroup(p.category)
          const pc    = GROUP_META[group]?.colorToken || placeColors.landmark
          return (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              pinColor={pc.text}
              tracksViewChanges={false}
              onPress={e => { e.stopPropagation(); setSelectedPin(p) }}
            />
          )
        })}
      </MapView>

      {selectedPin && (
        <BottomPinCard
          item={selectedPin}
          lang={lang}
          onClose={() => setSelectedPin(null)}
          onViewProfile={() => { setSelectedPin(null); onSelectPlace?.(selectedPin) }}
        />
      )}
    </View>
  )
}

// ─── Group-tile landing ────────────────────────────────────────────────────────

function GroupTiles({ counts, visibleGroups, lang, onSelectGroup }) {
  return (
    <ScrollView contentContainerStyle={s.tilesWrap} showsVerticalScrollIndicator={false}>
      {visibleGroups.map(g => {
        const meta = GROUP_META[g] || {}
        const pc   = meta.colorToken || placeColors.landmark
        return (
          <TouchableOpacity
            key={g}
            style={s.tile}
            onPress={() => onSelectGroup(g)}
            activeOpacity={0.85}
          >
            <View style={[s.tileIcon, { backgroundColor: pc.bg }]}>
              <Ionicons name={meta.icon || 'ellipse-outline'} size={26} color={pc.text} />
            </View>
            <Text style={s.tileLabel} numberOfLines={1}>{groupLabel(g, lang)}</Text>
            <Text style={s.tileCount}>{counts[g] || 0}</Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExploreScreen({ lang, onBack, onSelectPlace, userLocation, session, onRequireAccount, isAdmin = false }) {
  const [places,      setPlaces]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [activeGroup, setActiveGroup] = useState(null)   // null = group-tile landing
  const [activeCat,   setActiveCat]   = useState(null)   // null = all categories in group
  const [region,      setRegion]      = useState(null)   // null = all regions
  const [view,        setView]        = useState('list') // 'list' | 'map'
  const [showSubmit,  setShowSubmit]  = useState(false)
  const [dbgChipH, setDbgChipH] = useState(0)  // TEMPORARY onLayout instrumentation (remove before Slice 3)
  const [dbgRowH,  setDbgRowH]  = useState(0)  // TEMPORARY onLayout instrumentation (remove before Slice 3)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('places').select('*').eq('status', 'active')
      setPlaces((data || []).sort((a, b) =>
        placeName(a, 'en').localeCompare(placeName(b, 'en'))
      ))
    } catch (err) {
      console.error('Explore load error:', err)
      setPlaces([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Group counts over the fetched active set — the threshold gate reads these.
  const counts = useMemo(() => {
    const c = {}
    for (const p of places) {
      const g = categoryToGroup(p.category)
      if (g) c[g] = (c[g] || 0) + 1
    }
    return c
  }, [places])

  const visibleGroups = useMemo(
    () => GROUP_ORDER.filter(g => groupVisible(g, counts[g] || 0, isAdmin)),
    [counts, isAdmin]
  )

  // Categories inside the active group that actually have rows (for the sub-filter chips).
  const groupCats = useMemo(() => {
    if (!activeGroup) return []
    const present = new Set(places.filter(p => categoryToGroup(p.category) === activeGroup).map(p => p.category))
    return EXPLORE_GROUPS[activeGroup].filter(c => present.has(c))
  }, [activeGroup, places])

  // Filtered list for the active group.
  // AREA RULE: no area filter exists yet (backfilled rows are area=NULL, and the area
  // UI needs Slice-5 i18n). When one is added it must exclude area=NULL ONLY while a
  // specific area is selected — region-level and unfiltered views always include them.
  const filtered = useMemo(() => {
    if (!activeGroup) return []
    return places.filter(p =>
      categoryToGroup(p.category) === activeGroup
      && (!activeCat || p.category === activeCat)
      && (!region || p.region === region)
    )
  }, [places, activeGroup, activeCat, region])

  function openGroup(g) { setActiveGroup(g); setActiveCat(null); setRegion(null); setView('list') }
  function leaveGroup()  { setActiveGroup(null); setActiveCat(null); setRegion(null) }

  if (showSubmit) {
    return (
      <ExploreSubmitScreen
        session={session}
        lang={lang}
        onBack={() => setShowSubmit(false)}
        onSubmitted={() => { setShowSubmit(false); load() }}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="beaches_landmarks" />
      <ScreenHeader
        onBack={activeGroup ? leaveGroup : onBack}
        title={activeGroup ? groupLabel(activeGroup, lang) : t('blTitle', lang)}
        lang={lang}
        rightElement={activeGroup ? (
          <TouchableOpacity
            style={s.viewToggle}
            onPress={() => setView(v => v === 'list' ? 'map' : 'list')}
            activeOpacity={0.75}
          >
            <Ionicons
              name={view === 'list' ? 'map-outline' : 'list-outline'}
              size={20}
              color={colors.primary}
            />
          </TouchableOpacity>
        ) : null}
      />

      {/* TEMPORARY build marker (remove before Slice 3) */}
      <Text style={s.buildMarker}>build: {BUILD_MARKER}  ·  chip={dbgChipH} row={dbgRowH}</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
      ) : !activeGroup ? (
        <GroupTiles
          counts={counts}
          visibleGroups={visibleGroups}
          lang={lang}
          onSelectGroup={openGroup}
        />
      ) : view === 'map' ? (
        <PlacesMapView
          places={filtered}
          userLocation={userLocation}
          lang={lang}
          onSelectPlace={onSelectPlace}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {/* Category sub-filter (only when the group has >1 category with data).
              Horizontal ScrollView + shared chip styles — matches the shipped
              grooming/garages filter rows (a flex-wrap View squashes the chips). */}
          {groupCats.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, flexShrink: 0 }}
              contentContainerStyle={s.filterRow}
            >
              <TouchableOpacity
                style={[s.chip, !activeCat && s.chipActive]}
                onPress={() => setActiveCat(null)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, !activeCat && s.chipTextActive]}>{t('blFilterAll', lang)}</Text>
              </TouchableOpacity>
              {groupCats.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, activeCat === c && s.chipActive]}
                  onPress={() => setActiveCat(c)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipText, activeCat === c && s.chipTextActive]}>
                    {categoryLabel(c, lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Region filter — DIAGNOSTIC: onLayout instrumentation. Measures whether the chip
              and row heights shrink once the result list becomes scrollable (>=3 cards).
              Values shown in the build-marker strip. Revert after. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={s.filterRow}
            onLayout={e => setDbgRowH(Math.round(e.nativeEvent.layout.height))}
          >
            <TouchableOpacity
              style={[s.chip, !region && s.chipActive]}
              onPress={() => setRegion(null)}
              onLayout={e => setDbgChipH(Math.round(e.nativeEvent.layout.height))}
            >
              <Text style={[s.chipText, !region && s.chipTextActive]}>{t('blDistrictAll', lang)}</Text>
            </TouchableOpacity>
            {REGIONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[s.chip, region === r && s.chipActive]}
                onPress={() => setRegion(r)}
              >
                <Text style={[s.chipText, region === r && s.chipTextActive]}>{regionLabel(r, lang)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* List */}
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <View style={s.emptyCard}>
                  <Ionicons name="map-outline" size={44} color={colors.border} style={{ marginBottom: 10 }} />
                  <Text style={s.emptyText}>{t('blNoPlaces', lang)}</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <PlaceCard
                item={item}
                lang={lang}
                onPress={() => onSelectPlace?.(item)}
              />
            )}
          />
        </View>
      )}

      {/* FAB — authenticated users only; real-account gate before the submit form */}
      {!!session && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => { if (onRequireAccount?.('gatePlaceSubmit')) return; setShowSubmit(true) }}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  )
}

const PHOTO_H = 160

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg },

  // TEMPORARY build marker (remove before Slice 3)
  buildMarker: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', textAlign: 'center',
                 paddingVertical: 4, backgroundColor: colors.primary, letterSpacing: 0.3 },

  viewToggle:   { minWidth: 70, alignItems: 'flex-end',
                  padding: 6, borderRadius: radius.sm,
                  backgroundColor: colors.primaryLight },

  // Group tiles
  tilesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 },
  tile:      { width: '47%', backgroundColor: colors.cardBg, borderRadius: radius.card,
               borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow },
  tileIcon:  { width: 48, height: 48, borderRadius: 14, alignItems: 'center',
               justifyContent: 'center', marginBottom: 12 },
  tileLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  tileCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },

  // Filter rows (category sub-filter + region) — horizontal ScrollViews, shipped pattern.
  filterRow:      { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, minHeight: 35,  // minHeight = measured natural height; defensive floor vs sibling compression
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
  emptyWrap:   { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyCard:   { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24,
                 paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyText:   { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },

  // Card
  card:             { backgroundColor: colors.cardBg, borderRadius: radius.card, overflow: 'hidden',
                      borderWidth: 1, borderColor: colors.border, ...shadow },
  photoWrap:        { height: PHOTO_H, position: 'relative' },
  photo:            { width: '100%', height: PHOTO_H },
  photoPlaceholder: { width: '100%', height: PHOTO_H, alignItems: 'center', justifyContent: 'center' },
  photoEmoji:       { fontSize: 52 },
  typePill:         { position: 'absolute', top: 10, right: 10,
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  typePillText:     { fontSize: 11, fontFamily: 'Inter_700Bold' },

  cardBody:     { padding: 14 },
  nameRow:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
                  gap: 8, marginBottom: 8 },
  name:         { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  districtBadge:{ backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 10, flexShrink: 0 },
  districtText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },

  badgeRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  blueFlagBadge:{ flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 10 },
  blueFlagText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  accessBadge:  { backgroundColor: colors.bg, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  accessText:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  desc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 19 },

  fab: { position: 'absolute', bottom: 24, right: 16,
         width: 52, height: 52, borderRadius: 26,
         backgroundColor: colors.primary,
         alignItems: 'center', justifyContent: 'center', ...shadow },
})

// ─── Map pin card styles ───────────────────────────────────────────────────────

const pm = StyleSheet.create({
  card:         { position: 'absolute', bottom: 24, left: 16, right: 16,
                  backgroundColor: colors.cardBg, borderRadius: 20, padding: 16, ...shadow },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  thumb:        { width: 56, height: 56, borderRadius: 12, flexShrink: 0 },
  thumbFallback:{ justifyContent: 'center', alignItems: 'center' },
  thumbEmoji:   { fontSize: 24 },
  typeBadge:    { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 3 },
  typeBadgeText:{ fontSize: 10, fontFamily: 'Inter_700Bold' },
  name:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.2 },
  district:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  desc:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  lineHeight: 18, marginBottom: 12 },
  viewBtn:      { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  viewBtnText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
