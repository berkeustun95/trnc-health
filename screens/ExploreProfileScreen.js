import { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, FlatList, Dimensions, Linking,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { categoryToGroup, GROUP_META, CATEGORY_LABEL_KEY } from '../constants/exploreCategories'
import ContentReportMenu from '../components/ContentReportMenu'

const { width: W } = Dimensions.get('window')
const GALLERY_H    = 280

// name_i18n[lang] if present, else fall through to the plain `name` column. NEVER an
// empty string when name_i18n is NULL — café rows have name only.
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
function placeName(place, lang) { return extractI18n(place.name_i18n, lang) || place.name || '' }
function placeDesc(place, lang) { return extractI18n(place.description_i18n, lang) }

function groupEmoji(group) {
  if (group === 'nature')   return '🏖️'
  if (group === 'heritage') return '🏛️'
  return '📍'
}
function regionLabel(region, lang) {
  return REGION_LABEL_KEY[region] ? t(REGION_LABEL_KEY[region], lang) : (region || '')
}
function categoryLabel(category, lang) {
  const key = CATEGORY_LABEL_KEY[category]
  return key ? t(key, lang) : category   // keyless categories: raw slug (admin-only today)
}

export default function ExploreProfileScreen({ place, lang, onBack, onRequireAccount }) {
  const insets = useSafeAreaInsets()
  const [imgIdx, setImgIdx] = useState(0)

  const group   = categoryToGroup(place.category)
  const pc      = GROUP_META[group]?.colorToken || placeColors.landmark
  const isBeach = place.category === 'beach'
  const photos  = place.photos || []

  function openDirections() {
    Linking.openURL(`https://maps.google.com/?q=${place.latitude},${place.longitude}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Back button — overlaid on gallery */}
      <TouchableOpacity style={[s.backBtn, { top: insets.top + 8 }]} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Gallery */}
        {photos.length > 0 ? (
          <View>
            <FlatList
              data={photos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              onMomentumScrollEnd={e =>
                setImgIdx(Math.round(e.nativeEvent.contentOffset.x / W))
              }
              renderItem={({ item }) => (
                <Image source={{ uri: item }} style={s.galleryImg} resizeMode="cover" />
              )}
            />
            {photos.length > 1 && (
              <View style={s.dotRow}>
                {photos.map((_, i) => (
                  <View key={i} style={[s.dot, i === imgIdx && s.dotActive]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[s.galleryPlaceholder, { backgroundColor: pc.bg }]}>
            <Text style={s.galleryEmoji}>{groupEmoji(group)}</Text>
          </View>
        )}

        {/* Attribution for the currently visible photo (CC BY-SA requires it). */}
        {photos.length > 0 && place.photo_credits?.[imgIdx] ? (
          <Text style={s.photoCredit}>{place.photo_credits[imgIdx]}</Text>
        ) : null}

        <View style={s.body}>
          {/* Category + region row */}
          <View style={s.pillRow}>
            <View style={[s.typePill, { backgroundColor: pc.bg }]}>
              <Text style={[s.typePillText, { color: pc.text }]}>
                {categoryLabel(place.category, lang)}
              </Text>
            </View>
            <View style={s.districtPill}>
              <Ionicons name="location-outline" size={12} color={colors.primary} />
              <Text style={s.districtPillText}>{regionLabel(place.region, lang)}</Text>
            </View>
            <ContentReportMenu
              contentType="place"
              contentId={place.id}
              lang={lang}
              onRequireAccount={onRequireAccount}
              style={{ marginLeft: 'auto' }}
            />
          </View>

          {/* Name */}
          <Text style={s.name}>{placeName(place, lang)}</Text>

          {/* Attribute badges — beach-relevant fields only render for beaches */}
          <View style={s.badgeRow}>
            {isBeach && place.blue_flag && (
              <View style={s.blueFlagBadge}>
                <Ionicons name="flag" size={13} color={colors.primary} />
                <Text style={s.blueFlagText}>{t('blBlueFlagLabel', lang)}</Text>
              </View>
            )}
            {isBeach && place.access_type && (
              <View style={s.accessBadge}>
                <Text style={s.accessText}>
                  {place.access_type === 'public'
                    ? t('blAccessPublic', lang)
                    : t('blAccessPrivate', lang)}
                </Text>
              </View>
            )}
          </View>

          {/* Description */}
          {!!placeDesc(place, lang) && (
            <View style={s.section}>
              <Text style={s.desc}>{placeDesc(place, lang)}</Text>
            </View>
          )}

          {/* Amenities (any category, when non-empty) — was beach "facilities" */}
          {place.amenities?.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t('blFacilitiesTitle', lang)}</Text>
              <View style={s.facilitiesWrap}>
                {place.amenities.map((f, i) => (
                  <View key={i} style={s.facilityChip}>
                    <Text style={s.facilityChipText}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Fixed footer */}
      {place.latitude != null && place.longitude != null && (
        <View style={s.footer}>
          <TouchableOpacity style={s.directionsBtn} onPress={openDirections} activeOpacity={0.85}>
            <Ionicons name="navigate-outline" size={18} color="#fff" />
            <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  // Gallery
  galleryImg:         { width: W, height: GALLERY_H },
  photoCredit:        { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                        paddingHorizontal: 16, paddingTop: 8 },
  galleryPlaceholder: { width: W, height: GALLERY_H, alignItems: 'center', justifyContent: 'center' },
  galleryEmoji:       { fontSize: 80 },
  dotRow:             { flexDirection: 'row', justifyContent: 'center', gap: 6,
                        position: 'absolute', bottom: 12, left: 0, right: 0 },
  dot:                { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:          { backgroundColor: '#fff', width: 18 },

  // Back button (overlaid)
  backBtn: { position: 'absolute', left: 16, zIndex: 10,
             width: 38, height: 38, borderRadius: 19,
             backgroundColor: 'rgba(0,0,0,0.35)',
             alignItems: 'center', justifyContent: 'center' },

  // Body
  body:    { padding: 20, gap: 0 },

  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  typePill:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  typePillText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  districtPill: { flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: colors.primaryLight,
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  districtPillText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary },

  name: { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
          letterSpacing: -0.4, marginBottom: 12 },

  badgeRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  blueFlagBadge:{ flexDirection: 'row', alignItems: 'center', gap: 5,
                  backgroundColor: colors.primaryLight,
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  blueFlagText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  accessBadge:  { backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 6,
                  borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  accessText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  section:      { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },

  desc: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
          lineHeight: 23 },

  facilitiesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  facilityChip:   { backgroundColor: placeColors.beach.bg,
                    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  facilityChipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: placeColors.beach.text },

  // Footer
  footer:        { position: 'absolute', bottom: 0, left: 0, right: 0,
                   backgroundColor: colors.cardBg,
                   borderTopWidth: 1, borderTopColor: colors.border,
                   paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  directionsBtn: { backgroundColor: colors.primary, borderRadius: radius.md,
                   paddingVertical: 15, flexDirection: 'row',
                   alignItems: 'center', justifyContent: 'center', gap: 8 },
  directionsBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
