import { useState, useEffect } from 'react'
import { View, Text, Image, ScrollView, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, StyleSheet, Linking, Dimensions } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { areaName } from '../constants/areas'
import ReviewsScreen from './ReviewsScreen'
import { ReviewSkeleton } from '../components/Skeleton'
import ContentReportMenu from '../components/ContentReportMenu'
import { formatHoursDisplay } from '../components/HoursPicker'
import { pricedServices, formatPriceRange } from '../utils/servicePrices'
import { containsBlockedTerm, moderationErrorKey } from '../utils/profanity'
import { notifyProvider } from '../utils/notify'
import { HEALTH_TYPES } from '../constants/facilityTypes'
import { GARAGE_CATEGORIES } from './GaragesScreen'
import BackButton from '../components/BackButton'

const GARAGE_LABEL_KEY = Object.fromEntries(GARAGE_CATEGORIES.map(c => [c.key, c.labelKey]))
const GARAGE_KEY_ORDER = GARAGE_CATEGORIES.map(c => c.key)

const SW = Dimensions.get('window').width
const SCHED_KEYS   = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const SCHED_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TODAY_KEY    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

export default function FacilityProfileScreen({ facility, lang, session, isFavorite, onToggleFavorite, onBook, onBack, onRequireAccount }) {
  // Any signed-in viewer who is NOT the listing's owner may report it. Logged-out
  // taps fall through to onRequireAccount inside ContentReportMenu. Unclaimed
  // health facilities (provider_id null) are reportable by anyone signed in.
  const canReport = facility.provider_id !== session?.user?.id
  const [reviews, setReviews]           = useState([])
  const [reviewTotal, setReviewTotal]   = useState(0)
  const [reviewAvg, setReviewAvg]       = useState(null)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [lightbox, setLightbox]             = useState(null)
  const [credentials, setCredentials]       = useState([])
  const [questions, setQuestions]           = useState([])
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [newQ, setNewQ]                     = useState('')
  const [qError, setQError]                 = useState(null)
  const [submittingQ, setSubmittingQ]       = useState(false)

  const reloadReviews = async () => {
    const [{ data, count }, { data: allRatings }] = await Promise.all([
      supabase.from('reviews').select('id, rating, comment, created_at', { count: 'exact' })
        .eq('facility_id', facility.id).order('created_at', { ascending: false }).limit(3),
      supabase.from('reviews').select('rating').eq('facility_id', facility.id),
    ])
    setReviews(data ?? [])
    setReviewTotal(count ?? 0)
    setReviewAvg(allRatings?.length
      ? (allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length).toFixed(1)
      : null)
  }

  async function loadQuestions() {
    setQuestionsLoading(true)
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('id, body, created_at, answers(id, body, created_at)')
        .eq('facility_id', facility.id)
        .order('created_at', { ascending: false })
      if (!error && data) setQuestions(data)
    } finally {
      setQuestionsLoading(false)
    }
  }

  async function submitQuestion() {
    if (onRequireAccount?.('gateQuestion')) return
    const body = newQ.trim()
    if (!body) return
    setSubmittingQ(true)
    setQError(null)

    if (await containsBlockedTerm(body)) {
      setQError(t('contentBlockedTerm', lang))
      setSubmittingQ(false)
      return
    }

    const { error } = await supabase.from('questions').insert({
      facility_id: facility.id,
      customer_id: session.user.id,
      body,
    })
    if (!error) {
      setNewQ('')
      await loadQuestions()
      notifyProvider(facility, 'notifNewQuestionTitle', 'notifNewQuestionBody')
    } else {
      const key = moderationErrorKey(error)
      setQError(key ? t(key, lang) : t('questionSubmitError', lang))
    }
    setSubmittingQ(false)
  }

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
    loadQuestions()
  }, [facility.id])

  if (showAllReviews) {
    return <ReviewsScreen facility={facility} lang={lang} onBack={() => setShowAllReviews(false)} onRequireAccount={onRequireAccount} />
  }

  const tc         = typeColors[facility.type] || typeColors.clinic
  const isHealthType = HEALTH_TYPES.includes(facility.type)
  const garagePrices = facility.type === 'garage' ? pricedServices(facility, GARAGE_KEY_ORDER) : []
  const languages  = Array.isArray(facility.languages)
    ? facility.languages
    : typeof facility.languages === 'string' && facility.languages
      ? facility.languages.split(',').map(l => l.trim()).filter(Boolean)
      : []

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: isHealthType ? 40 : (!facility.availability && facility.phone ? 160 : 108) }}>

          {/* Nav bar */}
          <View style={s.navBar}>
            <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {canReport && (
                <ContentReportMenu
                  contentType="facility"
                  contentId={facility.id}
                  lang={lang}
                  onRequireAccount={onRequireAccount}
                />
              )}
              <TouchableOpacity onPress={onToggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons
                  name={isFavorite ? 'heart' : 'heart-outline'}
                  size={22}
                  color={isFavorite ? colors.danger : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Cover image */}
          {facility.cover_image_url
            ? <TouchableOpacity activeOpacity={0.9} onPress={() => setLightbox(facility.cover_image_url)}>
                <Image source={{ uri: facility.cover_image_url }} style={s.cover} resizeMode="cover" />
              </TouchableOpacity>
            : <View style={[s.cover, s.coverFallback, { backgroundColor: tc.bg }]}>
                <Text style={s.coverFallbackIcon}>{TYPE_ICONS[facility.type] ?? '🏥'}</Text>
              </View>
          }

          <View style={s.body}>
            {/* Identity */}
            <View style={s.identityRow}>
              {facility.logo_url
                ? <TouchableOpacity activeOpacity={0.9} onPress={() => setLightbox(facility.logo_url)}>
                    <Image source={{ uri: facility.logo_url }} style={s.logo} resizeMode="contain" />
                  </TouchableOpacity>
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

            {/* Service prices (garage physical-service ranges, TL) */}
            {garagePrices.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>{t('garagePricesLabel', lang)}</Text>
                {garagePrices.map(p => (
                  <View key={p.key} style={s.priceRow}>
                    <Text style={s.priceService}>{t(GARAGE_LABEL_KEY[p.key] || p.key, lang)}</Text>
                    <Text style={s.priceValue}>{formatPriceRange(p)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Map location */}
            {facility.latitude != null && facility.longitude != null && (
              <View style={s.section}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${facility.latitude},${facility.longitude}`)}
                >
                  <MapView
                    style={s.miniMap}
                    pointerEvents="none"
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    initialRegion={{
                      latitude: facility.latitude,
                      longitude: facility.longitude,
                      latitudeDelta: 0.008,
                      longitudeDelta: 0.008,
                    }}
                  >
                    <Marker coordinate={{ latitude: facility.latitude, longitude: facility.longitude }} pinColor={colors.primary} />
                  </MapView>
                </TouchableOpacity>
              </View>
            )}

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
              {facility.city && REGION_LABEL_KEY[facility.city] ? (
                <View style={s.contactRow}>
                  <View style={[s.contactIcon, { backgroundColor: colors.primaryLight }]}>
                    <Feather name="map" size={15} color={colors.primary} />
                  </View>
                  <Text style={[s.contactText, { flex: 1 }]}>
                    {facility.area ? `${areaName(facility.area, facility.city)}, ` : ''}{t(REGION_LABEL_KEY[facility.city], lang)}
                  </Text>
                </View>
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
                        <View style={s.reviewTopRight}>
                          <Text style={s.reviewDate}>{new Date(r.created_at).toLocaleDateString([], { dateStyle: 'medium' })}</Text>
                          <ContentReportMenu contentType="review" contentId={r.id} lang={lang} onBlocked={reloadReviews} onRequireAccount={onRequireAccount} />
                        </View>
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

            {/* Questions & Answers — shown for every facility type, incl. pharmacy */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('questionsAnswers', lang)}</Text>

              <View style={s.askRow}>
                <TextInput
                  style={s.askInput}
                  value={newQ}
                  onChangeText={setNewQ}
                  placeholder={t('askPlaceholder', lang)}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={300}
                />
                <TouchableOpacity
                  style={[s.askBtn, (!newQ.trim() || submittingQ) && { opacity: 0.4 }]}
                  onPress={submitQuestion}
                  disabled={!newQ.trim() || submittingQ}
                >
                  {submittingQ
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.askBtnText}>{t('ask', lang)}</Text>
                  }
                </TouchableOpacity>
              </View>

              {qError && <Text style={s.error}>{qError}</Text>}

              <Text style={s.termsNotice}>{t('termsAgreeContent', lang)}</Text>

              {questionsLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
              ) : questions.length === 0 ? (
                <Text style={s.noQText}>{t('noQuestions', lang)}</Text>
              ) : (
                questions.map(q => (
                  <View key={q.id} style={s.qCard}>
                    <Text style={s.qBody}>{q.body}</Text>
                    {q.answers && q.answers.length > 0 ? (
                      <View style={s.answerBlock}>
                        <View style={s.answerTop}>
                          <Text style={s.answerLabel}>{t('providerAnswer', lang)}</Text>
                          <ContentReportMenu contentType="answer" contentId={q.answers[0].id} lang={lang} onRequireAccount={onRequireAccount} />
                        </View>
                        <Text style={s.answerBody}>{q.answers[0].body}</Text>
                      </View>
                    ) : (
                      <Text style={s.noAnswer}>{t('awaitingAnswer', lang)}</Text>
                    )}
                  </View>
                ))
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

        {/* Sticky Book CTA — hidden for health types (directory only) */}
        {!isHealthType && (
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
  miniMap:           { width: '100%', height: 150, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border },
  sectionLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:              { backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipText:          { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary },
  description:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },
  priceRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  priceService:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  priceValue:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
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
  reviewTopRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stars:             { fontSize: 14, color: '#F5A623', letterSpacing: 1 },
  reviewDate:        { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  reviewComment:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 19 },
  seeAllBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12 },
  seeAllText:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  error:             { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 10 },
  askRow:            { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginBottom: 16 },
  askInput:          { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 100 },
  askBtn:            { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center', alignItems: 'center' },
  askBtnText:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  noQText:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  qCard:             { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
  qBody:             { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 10, lineHeight: 20 },
  answerBlock:       { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10 },
  answerTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  termsNotice:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 16, marginTop: 8 },
  answerLabel:       { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  answerBody:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  noAnswer:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, fontStyle: 'italic' },
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
