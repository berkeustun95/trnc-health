import { useState, useEffect } from 'react'
import { View, Text, Image, ScrollView, FlatList, TouchableOpacity, Modal, StyleSheet, Linking, Dimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import ReviewsScreen from './ReviewsScreen'
import { ReviewSkeleton } from '../components/Skeleton'
import { formatHoursDisplay } from '../components/HoursPicker'

const SW = Dimensions.get('window').width
const SCHED_KEYS   = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const SCHED_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TODAY_KEY    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

export default function FacilityProfileScreen({ facility, lang, isFavorite, onToggleFavorite, onBook, onBack }) {
  const [reviews, setReviews]           = useState([])
  const [reviewTotal, setReviewTotal]   = useState(0)
  const [reviewAvg, setReviewAvg]       = useState(null)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [lightbox, setLightbox]             = useState(null)
  const [credentials, setCredentials]       = useState([])

  useEffect(() => {
    async function loadData() {
      const [
        { data, count },
        { data: allRatings },
        { data: creds },
      ] = await Promise.all([
        supabase.from('reviews').select('id, rating, comment, created_at', { count: 'exact' })
          .eq('facility_id', facility.id).order('created_at', { ascending: false }).limit(3),
        supabase.from('reviews').select('rating').eq('facility_id', facility.id),
        supabase.from('provider_credentials')
          .select('id, cred_type, title, institution, year')
          .eq('facility_id', facility.id)
          .eq('status', 'approved')
          .order('year', { ascending: false }),
      ])
      if (data) setReviews(data)
      setReviewTotal(count ?? 0)
      if (allRatings?.length) {
        setReviewAvg((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length).toFixed(1))
      }
      setReviewsLoading(false)
      setCredentials(creds ?? [])
    }
    loadData()
  }, [facility.id])

  if (showAllReviews) {
    return <ReviewsScreen facility={facility} lang={lang} onBack={() => setShowAllReviews(false)} />
  }

  const tc         = typeColors[facility.type] || typeColors.clinic
  const isPharmacy = facility.type === 'pharmacy'
  const languages  = Array.isArray(facility.languages)
    ? facility.languages
    : typeof facility.languages === 'string' && facility.languages
      ? facility.languages.split(',').map(l => l.trim()).filter(Boolean)
      : []

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: isPharmacy ? 40 : (!facility.availability && facility.phone ? 160 : 108) }}>

          {/* Nav bar */}
          <View style={s.navBar}>
            <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={s.backText}>{t('back', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onToggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={22}
                color={isFavorite ? colors.danger : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Cover image */}
          {facility.cover_image_url
            ? <Image source={{ uri: facility.cover_image_url }} style={s.cover} resizeMode="cover" />
            : <View style={[s.cover, s.coverFallback, { backgroundColor: tc.bg }]}>
                <Text style={s.coverFallbackIcon}>{TYPE_ICONS[facility.type] ?? '🏥'}</Text>
              </View>
          }

          <View style={s.body}>
            {/* Identity */}
            <View style={s.identityRow}>
              {facility.logo_url
                ? <Image source={{ uri: facility.logo_url }} style={s.logo} resizeMode="contain" />
                : <View style={[s.logo, s.logoFallback, { backgroundColor: tc.bg }]}>
                    <Text style={{ fontSize: 22 }}>{TYPE_ICONS[facility.type] ?? '🏥'}</Text>
                  </View>
              }
              <View style={{ flex: 1 }}>
                <View style={[s.typeBadge, { backgroundColor: tc.bg }]}>
                  <Text style={[s.typeBadgeText, { color: tc.text }]}>{t(facility.type, lang)}</Text>
                </View>
                <Text style={s.name}>{facility.name}</Text>
                {facility.specialty?.length
                  ? <Text style={s.specialty}>{Array.isArray(facility.specialty) ? facility.specialty.join(' · ') : facility.specialty}</Text>
                  : null
                }
              </View>
            </View>

            {/* Photo gallery */}
            {Array.isArray(facility.photos) && facility.photos.length > 0 && (
              <View style={s.photoSection}>
                <FlatList
                  data={facility.photos}
                  keyExtractor={(_, i) => String(i)}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => setLightbox(item)} activeOpacity={0.85}>
                      <Image source={{ uri: item }} style={s.photoThumb} resizeMode="cover" />
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            {/* Languages */}
            {languages.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('languagesSpoken', lang)}</Text>
                <View style={s.chipRow}>
                  {languages.map(l => (
                    <View key={l} style={s.chip}>
                      <Text style={s.chipText}>{l}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Credentials */}
            {credentials.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('qualificationsLabel', lang)}</Text>
                {credentials.map(cred => (
                  <View key={cred.id} style={s.credRow}>
                    <Text style={s.credIcon}>{cred.cred_type === 'diploma' ? '🎓' : '📜'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.credTitle}>{cred.title}</Text>
                      <Text style={s.credSub}>{cred.institution}{cred.year ? ` · ${cred.year}` : ''}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* About */}
            {facility.description ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('aboutFacility', lang)}</Text>
                <Text style={s.description}>{facility.description}</Text>
              </View>
            ) : null}

            {/* Contact */}
            <View style={s.section}>
              {facility.address ? (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(facility.address)}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Feather name="map-pin" size={15} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{facility.address}</Text>
                  <Text style={s.contactAction}>{t('getDirections', lang)}</Text>
                </TouchableOpacity>
              ) : null}
              {facility.phone ? (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(`tel:${facility.phone}`)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Feather name="phone" size={15} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{facility.phone}</Text>
                  <Text style={s.contactAction}>{t('call', lang)}</Text>
                </TouchableOpacity>
              ) : null}
              {facility.opening_hours ? (
                <View style={s.contactRow}>
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Feather name="clock" size={15} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>{formatHoursDisplay(facility.opening_hours)}</Text>
                </View>
              ) : null}
              {facility.website ? (
                <TouchableOpacity
                  style={s.contactRow}
                  onPress={() => Linking.openURL(facility.website)}
                  activeOpacity={0.7}
                >
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Feather name="globe" size={15} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1, color: colors.primary }]}>{t('visitWebsite', lang)}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Schedule */}
            {facility.availability?.schedule && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('scheduleLabel', lang)}</Text>
                <View style={s.scheduleCard}>
                  {SCHED_KEYS.map((key, i) => {
                    const day = facility.availability.schedule[key]
                    const isToday = key === TODAY_KEY[new Date().getDay()]
                    return (
                      <View key={key} style={[s.scheduleRow, isToday && s.scheduleRowToday, i === SCHED_KEYS.length - 1 && { borderBottomWidth: 0 }]}>
                        <Text style={[s.scheduleDay, isToday && s.scheduleDayToday]}>{SCHED_LABELS[i]}</Text>
                        {day?.closed
                          ? <Text style={s.scheduleClosed}>{t('closed', lang)}</Text>
                          : <Text style={[s.scheduleHours, isToday && s.scheduleHoursToday]}>{day?.open ?? '09:00'} – {day?.close ?? '17:00'}</Text>
                        }
                        {isToday && <Text style={s.todayLabel}>{t('todayLabel', lang)}</Text>}
                      </View>
                    )
                  })}
                  {facility.availability.slot_duration && (
                    <View style={s.slotDurationRow}>
                      <Feather name="clock" size={12} color={colors.textSecondary} />
                      <Text style={s.slotDurationText}>{t('minSlotLabel', lang).replace('{n}', facility.availability.slot_duration)}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Reviews */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('tabReviews', lang)}</Text>
              {reviewsLoading ? (
                <>{[0, 1].map(i => <ReviewSkeleton key={i} />)}</>
              ) : reviews.length === 0 ? (
                <View style={s.noReviewsWrap}>
                  <Ionicons name="star-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
                  <Text style={s.noReviewsTitle}>{t('noReviews', lang)}</Text>
                  <Text style={s.noReviewsSub}>{t('firstReviewPrompt', lang)}</Text>
                </View>
              ) : (
                <>
                  {reviewAvg && (
                    <View style={s.avgRow}>
                      <Text style={s.avgNum}>{reviewAvg}</Text>
                      <View>
                        <Text style={s.avgStars}>{'★'.repeat(Math.round(parseFloat(reviewAvg)))}{'☆'.repeat(5 - Math.round(parseFloat(reviewAvg)))}</Text>
                        <Text style={s.reviewCount}>{t('reviewCountLabel', lang).replace('{n}', reviewTotal)}</Text>
                      </View>
                    </View>
                  )}
                  {reviews.map(r => (
                    <View key={r.id} style={s.reviewCard}>
                      <View style={s.reviewTop}>
                        <Text style={s.stars}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</Text>
                        <Text style={s.reviewDate}>{new Date(r.created_at).toLocaleDateString([], { dateStyle: 'medium' })}</Text>
                      </View>
                      {r.comment ? <Text style={s.reviewComment}>{r.comment}</Text> : null}
                    </View>
                  ))}
                  {reviewTotal > 3 && (
                    <TouchableOpacity style={s.seeAllBtn} onPress={() => setShowAllReviews(true)}>
                      <Text style={s.seeAllText}>{t('seeAllReviews', lang).replace('{n}', reviewTotal)}</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Photo lightbox */}
        <Modal visible={!!lightbox} transparent animationType="fade">
          <TouchableOpacity style={s.lightboxBg} onPress={() => setLightbox(null)} activeOpacity={1}>
            <TouchableOpacity style={s.lightboxClose} onPress={() => setLightbox(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            {lightbox && (
              <Image source={{ uri: lightbox }} style={s.lightboxImg} resizeMode="contain" />
            )}
          </TouchableOpacity>
        </Modal>

        {/* Sticky Book CTA */}
        {!isPharmacy && (
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.ctaBtn} onPress={onBook} activeOpacity={0.85}>
              <Text style={s.ctaText}>
                {facility.availability ? t('requestAppointment', lang) : t('requestAppointment', lang)}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },
  navBar:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn:           { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  cover:             { width: '100%', height: 200 },
  coverFallback:     { justifyContent: 'center', alignItems: 'center' },
  coverFallbackIcon: { fontSize: 48 },
  body:              { paddingHorizontal: 16, paddingTop: 0 },
  identityRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: -28, marginBottom: 20 },
  logo:              { width: 64, height: 64, borderRadius: 16, borderWidth: 3, borderColor: colors.bg, ...shadow },
  logoFallback:      { justifyContent: 'center', alignItems: 'center' },
  typeBadge:         { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6, marginTop: 8 },
  typeBadgeText:     { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  name:              { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.3, marginBottom: 3 },
  specialty:         { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  section:           { marginBottom: 24 },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:              { backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipText:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary },
  description:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },
  credRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  credIcon:          { fontSize: 20, marginTop: 1 },
  credTitle:         { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  credSub:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  contactRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  contactIcon:       { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  contactText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  contactAction:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  avgRow:            { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  avgNum:            { fontSize: 40, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 44 },
  avgStars:          { fontSize: 15, color: '#F5A623', letterSpacing: 1 },
  reviewCount:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  reviewCard:        { backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  reviewTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  stars:             { fontSize: 14, color: '#F5A623', letterSpacing: 1 },
  reviewDate:        { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  reviewComment:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 19 },
  seeAllBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12 },
  seeAllText:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  scheduleCard:      { backgroundColor: colors.cardBg, borderRadius: 14, overflow: 'hidden', ...shadow },
  scheduleRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  scheduleRowToday:  { backgroundColor: colors.primaryLight },
  scheduleDay:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, width: 36 },
  scheduleDayToday:  { color: colors.primary },
  scheduleClosed:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },
  scheduleHours:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, flex: 1 },
  scheduleHoursToday:{ fontFamily: 'Inter_700Bold', color: colors.primary },
  todayLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  slotDurationRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  slotDurationText:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  photoSection:      { marginBottom: 20 },
  photoThumb:        { width: 140, height: 105, borderRadius: 12, backgroundColor: colors.border },
  lightboxBg:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxClose:     { position: 'absolute', top: 52, right: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  lightboxImg:       { width: SW, height: SW * 0.75 },
  noReviewsWrap:     { alignItems: 'center', paddingVertical: 20 },
  noReviewsTitle:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  noReviewsSub:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  ctaWrap:           { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 28, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  ctaBtn:            { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 17, alignItems: 'center', ...shadow },
  ctaText:           { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.2 },
  ctaSecondary:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 16, paddingVertical: 14 },
  ctaSecondaryText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
})
