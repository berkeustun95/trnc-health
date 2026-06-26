import { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, FlatList, Dimensions, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'

const { width: W } = Dimensions.get('window')
const GALLERY_H    = 280

const CATEGORY_KEY = {
  castle_fortress: 'blCatCastleFortress',
  ancient_ruins:   'blCatAncientRuins',
  museum:          'blCatMuseum',
  religious_site:  'blCatReligiousSite',
  monument:        'blCatMonument',
  nature_scenic:   'blCatNatureScenic',
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

function placeDesc(place, lang) { return extractJsonb(place.description, lang) }
function placeName(place, lang) { return extractJsonb(place.name, lang) }

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

export default function PlaceProfileScreen({ place, lang, onBack }) {
  const [imgIdx, setImgIdx] = useState(0)

  const isBeach = place._type === 'beach'
  const pc      = isBeach ? placeColors.beach : placeColors.landmark
  const photos  = place.photo_urls || []

  function openDirections() {
    Linking.openURL(`https://maps.google.com/?q=${place.latitude},${place.longitude}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Back button — overlaid on gallery */}
      <TouchableOpacity style={s.backBtn} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
            <Text style={s.galleryEmoji}>{isBeach ? '🏖️' : '🏛️'}</Text>
          </View>
        )}

        <View style={s.body}>
          {/* Type + district row */}
          <View style={s.pillRow}>
            <View style={[s.typePill, { backgroundColor: pc.bg }]}>
              <Text style={[s.typePillText, { color: pc.text }]}>
                {t(isBeach ? 'blFilterBeaches' : 'blFilterLandmarks', lang)}
              </Text>
            </View>
            <View style={s.districtPill}>
              <Ionicons name="location-outline" size={12} color={colors.primary} />
              <Text style={s.districtPillText}>{districtLabel(place.district, lang)}</Text>
            </View>
          </View>

          {/* Name */}
          <Text style={s.name}>{placeName(place, lang)}</Text>

          {/* Attribute badges */}
          <View style={s.badgeRow}>
            {isBeach && place.blue_flag && (
              <View style={s.blueFlagBadge}>
                <Ionicons name="flag" size={13} color={colors.primary} />
                <Text style={s.blueFlagText}>{t('blBlueFlagLabel', lang)}</Text>
              </View>
            )}
            {isBeach && (
              <View style={s.accessBadge}>
                <Text style={s.accessText}>
                  {place.access_type === 'public'
                    ? t('blAccessPublic', lang)
                    : t('blAccessPrivate', lang)}
                </Text>
              </View>
            )}
            {!isBeach && CATEGORY_KEY[place.category] && (
              <View style={[s.catBadge, { backgroundColor: pc.bg }]}>
                <Text style={[s.catText, { color: pc.text }]}>
                  {t(CATEGORY_KEY[place.category], lang)}
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

          {/* Facilities (beaches only, when non-empty) */}
          {isBeach && place.facilities?.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t('blFacilitiesTitle', lang)}</Text>
              <View style={s.facilitiesWrap}>
                {place.facilities.map((f, i) => (
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
      <View style={s.footer}>
        <TouchableOpacity style={s.directionsBtn} onPress={openDirections} activeOpacity={0.85}>
          <Ionicons name="navigate-outline" size={18} color="#fff" />
          <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  // Gallery
  galleryImg:         { width: W, height: GALLERY_H },
  galleryPlaceholder: { width: W, height: GALLERY_H, alignItems: 'center', justifyContent: 'center' },
  galleryEmoji:       { fontSize: 80 },
  dotRow:             { flexDirection: 'row', justifyContent: 'center', gap: 6,
                        position: 'absolute', bottom: 12, left: 0, right: 0 },
  dot:                { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:          { backgroundColor: '#fff', width: 18 },

  // Back button (overlaid)
  backBtn: { position: 'absolute', top: 52, left: 16, zIndex: 10,
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
  catBadge:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  catText:      { fontSize: 13, fontFamily: 'Inter_700Bold' },

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
