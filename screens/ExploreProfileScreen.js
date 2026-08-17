import { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, FlatList, Dimensions, Linking, Modal, TextInput, ActivityIndicator,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, placeColors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { categoryToGroup, GROUP_META, CATEGORY_LABEL_KEY } from '../constants/exploreCategories'
import { EXPLORE_FEATURED_LIVE } from '../constants/flags'
import { isFeatured } from '../utils/featured'
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

export default function ExploreProfileScreen({ place, lang, session, onBack, onRequireAccount }) {
  const insets = useSafeAreaInsets()
  const [imgIdx, setImgIdx] = useState(0)

  const group   = categoryToGroup(place.category)
  const pc      = GROUP_META[group]?.colorToken || placeColors.landmark
  const isBeach = place.category === 'beach'
  const photos  = place.photos || []

  // Owner affordances. provider_id is threaded via BROWSE_COLS (D1). featured_requested_at is
  // deliberately NOT in the browse select (anti-steering), so "already requested" isn't shown —
  // request_featured_place is idempotent, so a repeat tap is a silent no-op server-side.
  const uid         = session?.user?.id
  const isOwner     = !!uid && place.provider_id === uid
  const isUnclaimed = place.provider_id == null
  const featuredNow = isFeatured(place)

  const [claimOpen, setClaimOpen] = useState(false)
  const [claimNote, setClaimNote] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimErr,  setClaimErr]  = useState(null)
  const [claimed,   setClaimed]   = useState(false)   // local: submitted this session
  const [featBusy,  setFeatBusy]  = useState(false)
  const [featSent,  setFeatSent]  = useState(false)

  const showClaim   = isUnclaimed && !claimed
  const showFeature = isOwner && EXPLORE_FEATURED_LIVE && !featuredNow && !featSent

  function openDirections() {
    Linking.openURL(`https://maps.google.com/?q=${place.latitude},${place.longitude}`)
  }

  function startClaim() {
    if (onRequireAccount?.('gatePlaceClaim')) return   // real account required (blocks guests)
    setClaimErr(null); setClaimNote(''); setClaimOpen(true)
  }

  async function submitClaim() {
    setClaimBusy(true); setClaimErr(null)
    const { error } = await supabase.from('place_claims').insert({
      place_id: place.id,
      requester_id: uid,
      evidence_note: claimNote.trim() || null,
    })
    setClaimBusy(false)
    if (error) { setClaimErr(t('exploreClaimErr', lang)); return }   // guard: already claimed / dup pending
    setClaimOpen(false); setClaimed(true)
  }

  async function requestFeatured() {
    setFeatBusy(true)
    const { error } = await supabase.rpc('request_featured_place', { p_place_id: place.id })
    setFeatBusy(false)
    if (!error) setFeatSent(true)
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

          {/* Owner affordances — claim (unclaimed) / request featured (owner, dark) */}
          {showClaim && (
            <View style={s.ownerCard}>
              <Text style={s.ownerCardTitle}>{t('exploreClaimTitle', lang)}</Text>
              <TouchableOpacity style={s.claimBtn} onPress={startClaim} activeOpacity={0.85}>
                <Ionicons name="ribbon-outline" size={17} color={colors.primary} />
                <Text style={s.claimBtnText}>{t('exploreClaimCta', lang)}</Text>
              </TouchableOpacity>
            </View>
          )}
          {claimed && (
            <View style={s.ownerNotice}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={s.ownerNoticeText}>{t('exploreClaimDone', lang)}</Text>
            </View>
          )}

          {showFeature && (
            <View style={s.ownerCard}>
              <Text style={s.ownerCardTitle}>{t('exploreFeatureTitle', lang)}</Text>
              <Text style={s.ownerCardBody}>{t('exploreFeatureBody', lang)}</Text>
              <TouchableOpacity style={s.featBtn} onPress={requestFeatured} activeOpacity={0.85} disabled={featBusy}>
                {featBusy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.featBtnText}>{t('exploreFeatureCta', lang)}</Text>}
              </TouchableOpacity>
            </View>
          )}
          {featSent && (
            <View style={s.ownerNotice}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={s.ownerNoticeText}>{t('exploreFeatureDone', lang)}</Text>
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

      {/* Claim modal — optional evidence note → insert place_claims (guard: unclaimed + no dup) */}
      <Modal visible={claimOpen} transparent animationType="fade" onRequestClose={() => setClaimOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{t('exploreClaimCta', lang)}</Text>
            <Text style={s.modalLabel}>{t('exploreClaimNoteLabel', lang)}</Text>
            <TextInput
              style={s.modalInput}
              value={claimNote}
              onChangeText={setClaimNote}
              placeholder={t('exploreClaimNotePlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            {claimErr && <Text style={s.modalErr}>{claimErr}</Text>}
            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setClaimOpen(false)} disabled={claimBusy}>
                <Text style={s.modalCancelText}>{t('cancel', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalSubmit} onPress={submitClaim} disabled={claimBusy} activeOpacity={0.85}>
                {claimBusy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.modalSubmitText}>{t('exploreClaimSubmit', lang)}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  // Owner affordances (claim / featured)
  ownerCard:      { backgroundColor: colors.cardBg, borderRadius: radius.card, borderWidth: 1,
                    borderColor: colors.border, padding: 16, marginBottom: 16, ...shadow },
  ownerCardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  ownerCardBody:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                    lineHeight: 19, marginBottom: 12 },
  claimBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingVertical: 13 },
  claimBtnText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  featBtn:        { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 13,
                    alignItems: 'center', justifyContent: 'center' },
  featBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  ownerNotice:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg,
                    borderRadius: radius.md, padding: 14, marginBottom: 16 },
  ownerNoticeText:{ flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  // Claim modal
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard:      { backgroundColor: colors.cardBg, borderRadius: 20, padding: 20, ...shadow },
  modalTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12 },
  modalLabel:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 8 },
  modalInput:     { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12,
                    fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
                    minHeight: 72, textAlignVertical: 'top', backgroundColor: colors.bg },
  modalErr:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 10 },
  modalBtnRow:    { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancel:    { flex: 1, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center',
                    borderWidth: 1.5, borderColor: colors.border },
  modalCancelText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  modalSubmit:    { flex: 1.4, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center',
                    justifyContent: 'center', backgroundColor: colors.primary },
  modalSubmitText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
