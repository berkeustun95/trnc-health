import { useState, useEffect } from 'react'
import { useScrollMemory, forgetScroll } from '../utils/scrollMemory'
import { View, Text, Image, ScrollView, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, StyleSheet, Linking, Dimensions, Alert } from 'react-native'
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
import { notifyFacilityOwner } from '../utils/notify'
import { HEALTH_TYPES } from '../constants/facilityTypes'
import { GARAGE_CATEGORIES } from './GaragesScreen'
import BackButton from '../components/BackButton'
import OsmAttribution from '../components/OsmAttribution'
import { REDESIGN } from '../constants/redesign'
import { DetailScaffold, InfoRow, IconButton } from '../components/ui'
import { type as TYPE, radii } from '../constants/theme'

const GARAGE_LABEL_KEY = Object.fromEntries(GARAGE_CATEGORIES.map(c => [c.key, c.labelKey]))
const GARAGE_KEY_ORDER = GARAGE_CATEGORIES.map(c => c.key)

const SW = Dimensions.get('window').width

const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const TYPE_ION = {
  pharmacy: 'medkit-outline', clinic: 'medical-outline', hospital: 'business-outline', dentist: 'medical-outline',
  vet: 'paw-outline', grooming: 'cut-outline', garage: 'car-sport-outline',
}

export default function FacilityProfileScreen({ facility, lang, session, isFavorite, onToggleFavorite, onBack, onRequireAccount, backRef = null }) {
  // Any signed-in viewer who is NOT the listing's owner may report it. Logged-out
  // taps fall through to onRequireAccount inside ContentReportMenu. Unclaimed
  // health facilities (provider_id null) are reportable by anyone signed in.
  const canReport = facility.provider_id !== session?.user?.id
  // Both sides must be real before this is an ownership claim: for a signed-out viewer
  // `session?.user?.id` and a missing `provider_id` are both undefined, and undefined ===
  // undefined would hide the composer from every guest.
  const isOwner = !!session?.user?.id && facility.provider_id === session.user.id
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
  const [myReview, setMyReview]             = useState(null)
  const [ratingValue, setRatingValue]       = useState(0)
  const [ratingComment, setRatingComment]   = useState('')
  const [reviewError, setReviewError]       = useState(null)
  const [submittingReview, setSubmittingReview] = useState(false)

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

  // The viewer's own live review, which switches the composer to a read-only card.
  // maybeSingle() returns {data: null, error: null} on zero rows — it does not throw.
  // A soft-deleted review is invisible to its own author under the read policy, so
  // deleting one correctly puts the composer back.
  // ─── RPC FIRST, COLUMN SECOND — this must work on BOTH sides of 20261033 ───
  //
  // 20261033 revokes SELECT on reviews.customer_id, and Postgres requires SELECT on any
  // column read in a WHERE clause — so the `.eq('customer_id', …)` filter below stops
  // working at the same moment the column does. get_my_review() is the replacement.
  //
  // Both paths are kept because this OTA ships BEFORE the migration is applied: until
  // then the function does not exist (PostgREST 404s with PGRST202) and the column is
  // still readable; afterwards the reverse. One of the two always works. Same shape as
  // loadBlocks() in ProfileScreen — see 20261032.
  async function loadMyReview() {
    if (!session?.user?.id) { setMyReview(null); return }
    const { data, error } = await supabase.rpc('get_my_review', { p_facility_id: facility.id })
    if (!error) { setMyReview(data?.[0] ?? null); return }
    const { data: row } = await supabase.from('reviews')
      .select('id, rating, comment')
      .eq('facility_id', facility.id)
      .eq('customer_id', session.user.id)
      .maybeSingle()
    setMyReview(row ?? null)
  }

  // THE APP'S ONLY REVIEW-WRITE PATH as of 20261004. It used to sit behind an appointment
  // in ProfileScreen, which is why removing bookings would otherwise have left reviews
  // readable and unwritable. Keyed on facility_id now (20261003 dropped appointment_id);
  // reviews_customer_facility_live_uniq already enforces one live review per customer per
  // facility, so the partial index — not this screen — is the boundary.
  async function submitReview() {
    if (onRequireAccount?.('gateReview')) return
    if (!ratingValue || submittingReview) return
    setSubmittingReview(true)
    setReviewError(null)
    const comment = ratingComment.trim()

    // Inline preview of the same matcher the DB trigger runs. The trigger is the real
    // boundary; this only saves the user a round trip.
    if (comment && await containsBlockedTerm(comment)) {
      setReviewError(t('contentBlockedTerm', lang))
      setSubmittingReview(false)
      return
    }

    const { error } = await supabase.from('reviews').insert({
      customer_id: session.user.id,
      facility_id: facility.id,
      rating:      ratingValue,
      comment:     comment || null,
    })
    if (!error) {
      setRatingValue(0)
      setRatingComment('')
      await Promise.all([loadMyReview(), reloadReviews()])
    } else {
      const key = moderationErrorKey(error, { contentType: 'review', text: comment })
      setReviewError(key ? t(key, lang) : error.message)
    }
    setSubmittingReview(false)
  }

  // Soft delete. .select() is mandatory: an UPDATE that RLS filters out matches zero rows
  // and returns NO error, so without it a failed delete would clear the card here and
  // leave the review live for everyone else.
  function deleteReview(reviewId) {
    Alert.alert('', t('deleteReviewConfirm', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      {
        text: t('deleteReview', lang),
        style: 'destructive',
        onPress: async () => {
          const { data, error } = await supabase.from('reviews')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', reviewId)
            .select('id')
          if (error || !data?.length) { Alert.alert('', t('deleteFailed', lang)); return }
          setMyReview(null)
          await reloadReviews()
        },
      },
    ])
  }

  async function loadQuestions() {
    setQuestionsLoading(true)
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('id, body, created_at, customer_id, answers(id, body, created_at)')
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
      notifyFacilityOwner(facility, 'question')
    } else {
      const key = moderationErrorKey(error, { contentType: 'question', text: body })
      setQError(key ? t(key, lang) : t('questionSubmitError', lang))
    }
    setSubmittingQ(false)
  }

  // Soft delete. .select() is mandatory: an UPDATE that RLS filters out matches zero rows
  // and returns NO error, so without it a failed delete would vanish from this list and
  // stay live for the facility's provider.
  function deleteQuestion(questionId) {
    Alert.alert('', t('deleteQuestionConfirm', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      {
        text: t('deleteQuestion', lang),
        style: 'destructive',
        onPress: async () => {
          const { data, error } = await supabase.from('questions')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', questionId)
            .select('id')
          if (error || !data?.length) { Alert.alert('', t('deleteFailed', lang)); return }
          setQuestions(prev => prev.filter(q => q.id !== questionId))
        },
      },
    ])
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
    loadMyReview()
  }, [facility.id])

  // All reviews is an early return: the profile's scroll comes back when it closes, and
  // Android back closes Reviews, not the profile (App's chain asks backRef first; slice 10).
  const profileMem = useScrollMemory('facility:' + facility.id)
  useEffect(() => () => forgetScroll('facility:'), [])
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => { if (showAllReviews) { setShowAllReviews(false); return true } return false }
    return () => { backRef.current = null }
  })

  if (showAllReviews) {
    return <ReviewsScreen facility={facility} lang={lang} average={reviewAvg} onBack={() => setShowAllReviews(false)} onRequireAccount={onRequireAccount} />
  }

  const tc         = typeColors[facility.type] || typeColors.clinic
  const isHealthType = HEALTH_TYPES.includes(facility.type)
  const garagePrices = facility.type === 'garage' ? pricedServices(facility, GARAGE_KEY_ORDER) : []
  const languages  = Array.isArray(facility.languages)
    ? facility.languages
    : typeof facility.languages === 'string' && facility.languages
      ? facility.languages.split(',').map(l => l.trim()).filter(Boolean)
      : []

  // Shared by both paths. `sx` is the legacy sheet when REDESIGN is off, so the legacy tree
  // renders exactly as before; the redesign overrides a few keys (headings, card grounds).
  const sx = REDESIGN ? RS : s
  const infoSections = (
    <>
      {/* Languages */}
      {languages.length > 0 && (
        <View style={sx.section}>
          <Text style={sx.sectionLabel}>{t('languagesSpoken', lang)}</Text>
          <View style={sx.chipRow}>
            {languages.map(l => (
              <View key={l} style={sx.chip}>
                <Text style={sx.chipText}>{l}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Credentials */}
      {credentials.length > 0 && (
        <View style={sx.section}>
          <Text style={sx.sectionLabel}>{t('qualificationsLabel', lang)}</Text>
          {credentials.map(cred => (
            <View key={cred.id} style={sx.credRow}>
              <Text style={sx.credIcon}>{cred.cred_type === 'diploma' ? '🎓' : '📜'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={sx.credTitle}>{cred.title}</Text>
                <Text style={sx.credSub}>{cred.institution}{cred.year ? ` · ${cred.year}` : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* About */}
      {facility.description ? (
        <View style={sx.section}>
          <Text style={sx.sectionLabel}>{t('aboutFacility', lang)}</Text>
          <Text style={sx.description}>{facility.description}</Text>
        </View>
      ) : null}

      {/* Service prices (garage physical-service ranges, TL) */}
      {garagePrices.length > 0 && (
        <View style={sx.section}>
          <Text style={sx.sectionLabel}>{t('garagePricesLabel', lang)}</Text>
          {garagePrices.map(p => (
            <View key={p.key} style={sx.priceRow}>
              <Text style={sx.priceService}>{t(GARAGE_LABEL_KEY[p.key] || p.key, lang)}</Text>
              <Text style={sx.priceValue}>{formatPriceRange(p)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Map location */}
      {facility.latitude != null && facility.longitude != null && (
        <View style={sx.section}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${facility.latitude},${facility.longitude}`)}
          >
            <MapView
              style={sx.miniMap}
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
            {facility.geocode_source === 'osm' && <OsmAttribution lang={lang} overlay />}
          </TouchableOpacity>
        </View>
      )}
    </>
  )
  const reviewsSection = (
      <View style={sx.section}>
        <Text style={sx.sectionLabel}>{t('tabReviews', lang)}</Text>

        {/* Write / show your own review. A provider does not review their own
            listing; a signed-out viewer sees the stars and is gated on tap. */}
        {!reviewsLoading && !isOwner && (myReview ? (
          <View style={sx.myReviewBox}>
            <Text style={sx.myReviewLabel}>{t('yourReview', lang)}</Text>
            <View style={sx.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <Text key={star} style={[sx.star, myReview.rating >= star && sx.starActive]}>★</Text>
              ))}
            </View>
            {myReview.comment ? <Text style={sx.myReviewComment}>{myReview.comment}</Text> : null}
            <TouchableOpacity onPress={() => deleteReview(myReview.id)} style={{ alignSelf: 'flex-start' }} accessibilityRole="button">
              <Text style={sx.deleteReviewText}>{t('deleteReview', lang)}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={sx.myReviewBox}>
            <Text style={sx.myReviewLabel}>{t('rateVisit', lang)}</Text>
            <View style={sx.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <TouchableOpacity
                  key={star}
                  onPress={() => { if (onRequireAccount?.('gateReview')) return; setRatingValue(star) }}
                  activeOpacity={0.7}
                >
                  <Text style={[sx.star, ratingValue >= star && sx.starActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            {ratingValue > 0 && (
              <>
                <TextInput
                  style={sx.commentInput}
                  value={ratingComment}
                  onChangeText={setRatingComment}
                  placeholder={t('commentOptional', lang)}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={500}
                />
                {reviewError ? <Text style={sx.error}>{reviewError}</Text> : null}
                <TouchableOpacity
                  style={[sx.submitReviewBtn, submittingReview && { opacity: 0.4 }]}
                  onPress={submitReview}
                  disabled={submittingReview}
                >
                  {submittingReview
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={sx.submitReviewText}>{t('save', lang)}</Text>}
                </TouchableOpacity>
                <Text style={sx.termsNotice}>{t('termsAgreeContent', lang)}</Text>
              </>
            )}
          </View>
        ))}

        {reviewsLoading ? (
          <>{[0, 1].map(i => <ReviewSkeleton key={i} />)}</>
        ) : reviews.length === 0 ? (
          <View style={sx.noReviewsWrap}>
            <Ionicons name="star-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
            <Text style={sx.noReviewsTitle}>{t('noReviews', lang)}</Text>
            <Text style={sx.noReviewsSub}>{t('firstReviewPrompt', lang)}</Text>
          </View>
        ) : (
          <>
            {reviewAvg && (
              <View style={sx.avgRow}>
                <Text style={sx.avgNum}>{reviewAvg}</Text>
                <View>
                  <Text style={sx.avgStars}>{'★'.repeat(Math.round(parseFloat(reviewAvg)))}{'☆'.repeat(5 - Math.round(parseFloat(reviewAvg)))}</Text>
                  <Text style={sx.reviewCount}>{t('reviewCountLabel', lang).replace('{n}', reviewTotal)}</Text>
                </View>
              </View>
            )}
            {reviews.map(r => (
              <View key={r.id} style={sx.reviewCard}>
                <View style={sx.reviewTop}>
                  <Text style={sx.stars}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</Text>
                  <View style={sx.reviewTopRight}>
                    <Text style={sx.reviewDate}>{new Date(r.created_at).toLocaleDateString([], { dateStyle: 'medium' })}</Text>
                    <ContentReportMenu contentType="review" contentId={r.id} lang={lang} onBlocked={reloadReviews} onRequireAccount={onRequireAccount} />
                  </View>
                </View>
                {r.comment ? <Text style={sx.reviewComment}>{r.comment}</Text> : null}
              </View>
            ))}
            {reviewTotal > 3 && (
              <TouchableOpacity style={sx.seeAllBtn} onPress={() => setShowAllReviews(true)}>
                <Text style={sx.seeAllText}>{t('seeAllReviews', lang).replace('{n}', reviewTotal)}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
  )
  const questionsSection = (
      <View style={sx.section}>
        <Text style={sx.sectionLabel}>{t('questionsAnswers', lang)}</Text>

        <View style={sx.askRow}>
          <TextInput
            style={sx.askInput}
            value={newQ}
            onChangeText={setNewQ}
            placeholder={t('askPlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={300}
          />
          <TouchableOpacity
            style={[sx.askBtn, (!newQ.trim() || submittingQ) && { opacity: 0.4 }]}
            onPress={submitQuestion}
            disabled={!newQ.trim() || submittingQ}
          >
            {submittingQ
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={sx.askBtnText}>{t('ask', lang)}</Text>
            }
          </TouchableOpacity>
        </View>

        {qError && <Text style={sx.error}>{qError}</Text>}

        <Text style={sx.termsNotice}>{t('termsAgreeContent', lang)}</Text>

        {questionsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
        ) : questions.length === 0 ? (
          <Text style={sx.noQText}>{t('noQuestions', lang)}</Text>
        ) : (
          questions.map(q => (
            <View key={q.id} style={sx.qCard}>
              <Text style={sx.qBody}>{q.body}</Text>
              {q.answers && q.answers.length > 0 ? (
                <View style={sx.answerBlock}>
                  <View style={sx.answerTop}>
                    <Text style={sx.answerLabel}>{t('providerAnswer', lang)}</Text>
                    <ContentReportMenu contentType="answer" contentId={q.answers[0].id} lang={lang} onRequireAccount={onRequireAccount} />
                  </View>
                  <Text style={sx.answerBody}>{q.answers[0].body}</Text>
                </View>
              ) : (
                <Text style={sx.noAnswer}>{t('awaitingAnswer', lang)}</Text>
              )}
              {q.customer_id && q.customer_id === session?.user?.id && (
                <TouchableOpacity
                  onPress={() => deleteQuestion(q.id)}
                  style={{ alignSelf: 'flex-start', marginTop: 8 }}
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger }}>
                    {t('deleteQuestion', lang)}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>
  )
  const lightboxModal = (
    <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
      <TouchableOpacity style={s.lightboxBg} onPress={() => setLightbox(null)} activeOpacity={1}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('uiClose', lang)} style={s.lightboxClose} onPress={() => setLightbox(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
        {lightbox && (
          <Image source={{ uri: lightbox }} style={s.lightboxImg} resizeMode="contain" />
        )}
      </TouchableOpacity>
    </Modal>
  )

  // ─── Redesign (S4) ───────────────────────────────────────────────────────────
  // Same state, handlers and URLs as the legacy tree. Removed vs legacy: nothing the user can
  // act on. The review average appears ONCE (reviewsSection), never also in the header.
  if (REDESIGN) {
    const cat = ['garage', 'grooming'].includes(facility.type) ? 'homeLife' : 'health'
    const gallery = [facility.cover_image_url, ...(Array.isArray(facility.photos) ? facility.photos : [])].filter(Boolean)
    const hasPin = facility.latitude != null && facility.longitude != null
    const actions = [
      facility.phone ? { kind: 'call', onPress: () => Linking.openURL(`tel:${facility.phone}`), accessibilityLabel: `${t('call', lang)} ${facility.phone}` } : null,
      hasPin
        ? { kind: 'directions', onPress: () => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${facility.latitude},${facility.longitude}`) }
        : facility.address
          ? { kind: 'directions', onPress: () => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(facility.address)}`) }
          : null,
    ].filter(Boolean)
    const specialty = facility.specialty?.length
      ? (Array.isArray(facility.specialty) ? facility.specialty.join(' · ') : facility.specialty)
      : null
    return (
      <View style={{ flex: 1 }}>
        {/* profileMem keeps the scroll position when coming back from all reviews;
            DetailScaffold spreads scrollProps onto its own ScrollView. */}
        <DetailScaffold
          photo={facility.cover_image_url ? { uri: facility.cover_image_url } : null}
          icon={TYPE_ION[facility.type] || 'medical-outline'}
          tag={{ label: t(facility.type, lang), category: cat, icon: TYPE_ION[facility.type] }}
          title={facility.name}
          subtitle={specialty}
          onBack={onBack}
          lang={lang}
          scrollProps={profileMem}
          actions={actions.length ? actions : undefined}
          headerRight={(
            <View style={RS.headerRight}>
              {canReport && (
                <View style={RS.frost}>
                  <ContentReportMenu contentType="facility" contentId={facility.id} lang={lang} onRequireAccount={onRequireAccount} />
                </View>
              )}
              <IconButton
                icon={isFavorite ? 'heart' : 'heart-outline'}
                variant="frosted"
                color={isFavorite ? colors.danger : colors.textPrimary}
                onPress={onToggleFavorite}
                accessibilityLabel={t('favourites', lang)}
              />
            </View>
          )}
        >
          {facility.logo_url ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setLightbox(facility.logo_url)} style={RS.logoWrap}
              accessibilityRole="imagebutton" accessibilityLabel={facility.name}>
              <Image source={{ uri: facility.logo_url }} style={RS.logo} resizeMode="contain" />
            </TouchableOpacity>
          ) : null}

          {gallery.length > 0 && (
            <FlatList
              data={gallery}
              keyExtractor={(_, i) => String(i)}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={RS.gallery}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => setLightbox(item)} activeOpacity={0.85} accessibilityRole="imagebutton">
                  <Image source={{ uri: item }} style={RS.photoThumb} resizeMode="cover" />
                </TouchableOpacity>
              )}
            />
          )}

          <View style={RS.facts}>
            <InfoRow icon="location-outline" category={cat} label={t('labelAddress', lang)} value={facility.address}
              onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(facility.address)}`)} />
            <InfoRow icon="map-outline" category={cat}
              value={facility.city && REGION_LABEL_KEY[facility.city]
                ? `${facility.area ? `${areaName(facility.area, facility.city)}, ` : ''}${t(REGION_LABEL_KEY[facility.city], lang)}`
                : null} />
            <InfoRow icon="call-outline" category={cat} label={t('phone', lang)} value={facility.phone}
              onPress={() => Linking.openURL(`tel:${facility.phone}`)} />
            <InfoRow icon="time-outline" category={cat} label={t('labelHours', lang)}
              value={facility.opening_hours ? formatHoursDisplay(facility.opening_hours) : null} />
            <InfoRow icon="globe-outline" category={cat} value={facility.website ? t('visitWebsite', lang) : null}
              onPress={() => Linking.openURL(facility.website)} divider={false} />
          </View>

          {infoSections}
          {reviewsSection}
          {questionsSection}
        </DetailScaffold>
        {lightboxModal}
      </View>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScrollView {...profileMem} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

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
              <TouchableOpacity onPress={onToggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button" accessibilityState={{ selected: !!isFavorite }}
                accessibilityLabel={t(isFavorite ? 'uiFavRemove' : 'uiFavAdd', lang)}>
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

            {infoSections}

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

            {/* Reviews */}
            {reviewsSection}

            {/* Questions & Answers — shown for every facility type, incl. pharmacy */}
            {questionsSection}
          </View>
        </ScrollView>

        {/* Photo lightbox */}
        {lightboxModal}

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
  scheduleHoursToday:{ fontFamily: 'Inter_700Bold', color: colors.primary },
  photoSection:      { marginBottom: 20 },
  photoThumb:        { width: 140, height: 105, borderRadius: 12, backgroundColor: colors.border },
  lightboxBg:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxClose:     { position: 'absolute', top: 52, right: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  lightboxImg:       { width: SW, height: SW * 0.75 },
  myReviewBox:       { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, marginBottom: 16, gap: 12, backgroundColor: 'transparent' },
  myReviewLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  myReviewComment:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, fontStyle: 'italic' },
  deleteReviewText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  starsRow:          { flexDirection: 'row', gap: 8 },
  star:              { fontSize: 28, color: colors.border },
  starActive:        { color: '#F5A623' },
  commentInput:      { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  submitReviewBtn:   { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  submitReviewText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  noReviewsWrap:     { alignItems: 'center', paddingVertical: 20 },
  noReviewsTitle:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  noReviewsSub:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
})

// Redesign overrides: the legacy keys the shared sections read, re-set on the new tokens.
// Sections sit on the white sheet, so their cards drop to the canvas ground with no shadow.
const FLAT = { shadowOpacity: 0, elevation: 0 }
const RS = {
  ...s,
  section:      { marginTop: 24 },
  sectionLabel: { ...TYPE.sectionHeading, color: colors.textPrimary, marginBottom: 10 },
  chip:         { backgroundColor: colors.canvas, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:     { ...TYPE.small, color: colors.textPrimary },
  description:  { ...TYPE.body, color: colors.textPrimary },
  miniMap:      { ...s.miniMap, borderRadius: radii.card },
  reviewCard:   { ...s.reviewCard, ...FLAT, backgroundColor: colors.canvas, borderRadius: radii.card },
  qCard:        { ...s.qCard, ...FLAT, backgroundColor: colors.canvas, borderRadius: radii.card },
  myReviewBox:  { ...s.myReviewBox, borderColor: colors.fieldBorder, backgroundColor: colors.card, borderRadius: radii.card },
  askInput:     { ...s.askInput, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.card, minHeight: 44 },
  askBtn:       { ...s.askBtn, minHeight: 44 },
  commentInput: { ...s.commentInput, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.card },
  ...StyleSheet.create({
    headerRight: { flexDirection: 'row', gap: 8 },
    frost:       { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
    logoWrap:    { alignSelf: 'flex-start', marginTop: 14 },
    logo:        { width: 56, height: 56, borderRadius: radii.tile, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.card },
    gallery:     { marginTop: 16, flexGrow: 0 },
    photoThumb:  { width: 140, height: 105, borderRadius: radii.tile, backgroundColor: colors.border },
    facts:       { marginTop: 12 },
  }),
}
