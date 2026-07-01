import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import MapView, { Marker } from 'react-native-maps'
import { supabase } from '../lib/supabase'
import PlaceSubmitScreen from './PlaceSubmitScreen'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']

const CATEGORY_KEY = {
  castle_fortress: 'blCatCastleFortress',
  ancient_ruins:   'blCatAncientRuins',
  museum:          'blCatMuseum',
  religious_site:  'blCatReligiousSite',
  monument:        'blCatMonument',
  nature_scenic:   'blCatNatureScenic',
}

const TRNC_CENTER = { latitude: 35.2, longitude: 33.5, latitudeDelta: 0.9, longitudeDelta: 0.9 }

const PIN_COLORS = {
  beach:    placeColors.beach.text,    // '#0369A1'
  landmark: placeColors.landmark.text, // '#A16207'
}

function extractJsonb(obj, lang) {
  if (!obj) return ''
  if (typeof obj !== 'object') return String(obj)
  const code = LANG_CODES[lang] ?? lang
  let result = obj[code] ?? obj.en ?? Object.values(obj)[0]
  if (result != null && typeof result === 'object') {
    result = result[code] ?? result.en ?? Object.values(result)[0]
  }
  return result != null ? String(result) : ''
}

function placeDesc(item, lang) { return extractJsonb(item.description, lang) }
function placeName(item, lang) { return extractJsonb(item.name, lang) }

function districtLabel(d, lang) {
  const map = {
    nicosia:   t('blDistrictNicosia', lang),
    kyrenia:   t('blDistrictKyrenia', lang),
    famagusta: t('blDistrictFamagusta', lang),
    morphou:   t('blDistrictMorphou', lang),
    iskele:    t('blDistrictIskele', lang),
    lefke:     t('blDistrictLefke', lang),
    karpaz:    t('blDistrictKarpaz', lang),
  }
  return map[d] || d
}

// ─── Place card (list view) ───────────────────────────────────────────────────

function PlaceCard({ item, lang, onPress }) {
  const isBeach = item._type === 'beach'
  const pc      = isBeach ? placeColors.beach : placeColors.landmark
  const photo   = item.photo_urls?.[0]

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.88}>
      <View style={s.photoWrap}>
        {photo
          ? <Image source={{ uri: photo }} style={s.photo} resizeMode="cover" />
          : <View style={[s.photoPlaceholder, { backgroundColor: pc.bg }]}>
              <Text style={s.photoEmoji}>{isBeach ? '🏖️' : '🏛️'}</Text>
            </View>
        }
        <View style={[s.typePill, { backgroundColor: pc.bg }]}>
          <Text style={[s.typePillText, { color: pc.text }]}>
            {t(isBeach ? 'blFilterBeaches' : 'blFilterLandmarks', lang)}
          </Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{placeName(item, lang)}</Text>
          <View style={s.districtBadge}>
            <Text style={s.districtText}>{districtLabel(item.district, lang)}</Text>
          </View>
        </View>

        <View style={s.badgeRow}>
          {isBeach && item.blue_flag && (
            <View style={s.blueFlagBadge}>
              <Ionicons name="flag" size={11} color={colors.primary} />
              <Text style={s.blueFlagText}>{t('blBlueFlagLabel', lang)}</Text>
            </View>
          )}
          {isBeach && (
            <View style={s.accessBadge}>
              <Text style={s.accessText}>
                {item.access_type === 'public' ? t('blAccessPublic', lang) : t('blAccessPrivate', lang)}
              </Text>
            </View>
          )}
          {!isBeach && CATEGORY_KEY[item.category] && (
            <View style={[s.catBadge, { backgroundColor: pc.bg }]}>
              <Text style={[s.catText, { color: pc.text }]}>{t(CATEGORY_KEY[item.category], lang)}</Text>
            </View>
          )}
        </View>

        {!!placeDesc(item, lang) && (
          <Text style={s.desc} numberOfLines={2}>{placeDesc(item, lang)}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Map pin bottom card ───────────────────────────────────────────────────────

function BottomPinCard({ item, lang, onClose, onViewProfile }) {
  const isBeach = item._type === 'beach'
  const pc      = isBeach ? placeColors.beach : placeColors.landmark
  const photo   = item.photo_urls?.[0]

  return (
    <View style={pm.card}>
      <View style={pm.row}>
        {photo
          ? <Image source={{ uri: photo }} style={pm.thumb} resizeMode="cover" />
          : <View style={[pm.thumb, pm.thumbFallback, { backgroundColor: pc.bg }]}>
              <Text style={pm.thumbEmoji}>{isBeach ? '🏖️' : '🏛️'}</Text>
            </View>
        }
        <View style={{ flex: 1 }}>
          <View style={[pm.typeBadge, { backgroundColor: pc.bg }]}>
            <Text style={[pm.typeBadgeText, { color: pc.text }]}>
              {t(isBeach ? 'blFilterBeaches' : 'blFilterLandmarks', lang)}
            </Text>
          </View>
          <Text style={pm.name} numberOfLines={1}>{placeName(item, lang)}</Text>
          <Text style={pm.district}>{districtLabel(item.district, lang)}</Text>
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
        {pinnable.map(p => (
          <Marker
            key={`${p._type}-${p.id}`}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            pinColor={PIN_COLORS[p._type]}
            tracksViewChanges={false}
            onPress={e => { e.stopPropagation(); setSelectedPin(p) }}
          />
        ))}
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BeachesLandmarksScreen({ lang, onBack, onSelectPlace, userLocation, session }) {
  const [placeType,   setPlaceType]   = useState('all')
  const [district,    setDistrict]    = useState(null)
  const [places,      setPlaces]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [view,        setView]        = useState('list') // 'list' | 'map'
  const [showSubmit,  setShowSubmit]  = useState(false)

  const load = useCallback(async (type, dist) => {
    setLoading(true)
    try {
      const fetchTable = async (table, tag) => {
        let q = supabase.from(table).select('*').eq('status', 'active')
        if (dist) q = q.eq('district', dist)
        const { data } = await q
        return (data || []).map(r => ({ ...r, _type: tag }))
      }

      const [beaches, landmarks] = await Promise.all([
        type !== 'landmark' ? fetchTable('beaches',   'beach')    : Promise.resolve([]),
        type !== 'beach'    ? fetchTable('landmarks', 'landmark') : Promise.resolve([]),
      ])

      setPlaces([...beaches, ...landmarks].sort((a, b) =>
        placeName(a, 'en').localeCompare(placeName(b, 'en'))
      ))
    } catch (err) {
      console.error('BL load error:', err)
      setPlaces([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(placeType, district) }, [placeType, district, load])

  function selectType(type) {
    setDistrict(null)
    setPlaceType(type)
  }

  const TYPE_FILTERS = [
    { key: 'all',      labelKey: 'blFilterAll' },
    { key: 'beach',    labelKey: 'blFilterBeaches' },
    { key: 'landmark', labelKey: 'blFilterLandmarks' },
  ]

  if (showSubmit) {
    return (
      <PlaceSubmitScreen
        session={session}
        lang={lang}
        onBack={() => setShowSubmit(false)}
        onSubmitted={() => { setShowSubmit(false); load(placeType, district) }}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="beaches_landmarks" />
      <ScreenHeader
        onBack={onBack}
        title={t('blTitle', lang)}
        lang={lang}
        rightElement={
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
        }
      />

      {view === 'map' ? (
        <PlacesMapView
          places={places}
          userLocation={userLocation}
          lang={lang}
          onSelectPlace={onSelectPlace}
        />
      ) : (
        <>
          {/* Type filter */}
          <View style={s.typeRow}>
            {TYPE_FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[s.typeChip, placeType === f.key && s.typeChipActive]}
                onPress={() => selectType(f.key)}
                activeOpacity={0.8}
              >
                <Text style={[s.typeChipText, placeType === f.key && s.typeChipTextActive]}>
                  {t(f.labelKey, lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flex: 1 }}>
            {/* District filter */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.districtRow}
            >
              <TouchableOpacity
                style={[s.chip, !district && s.chipActive]}
                onPress={() => setDistrict(null)}
              >
                <Text style={[s.chipText, !district && s.chipTextActive]}>{t('blDistrictAll', lang)}</Text>
              </TouchableOpacity>
              {DISTRICTS.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[s.chip, district === d && s.chipActive]}
                  onPress={() => setDistrict(d)}
                >
                  <Text style={[s.chipText, district === d && s.chipTextActive]}>{districtLabel(d, lang)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* List content */}
            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
            ) : (
              <FlatList
                data={places}
                keyExtractor={item => `${item._type}-${item.id}`}
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
            )}
          </View>
        </>
      )}
      {/* FAB — only for authenticated users */}
      {!!session && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => setShowSubmit(true)}
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

  viewToggle:   { minWidth: 70, alignItems: 'flex-end',
                  padding: 6, borderRadius: radius.sm,
                  backgroundColor: colors.primaryLight },

  // Type filter
  typeRow:            { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  typeChip:           { flex: 1, paddingVertical: 8, borderRadius: radius.md,
                        backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                        alignItems: 'center' },
  typeChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeChipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  typeChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // District filter
  districtRow:    { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  // List
  listContent: { padding: 16, paddingBottom: 40, gap: 16 },
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
  catBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  catText:      { fontSize: 11, fontFamily: 'Inter_700Bold' },

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
