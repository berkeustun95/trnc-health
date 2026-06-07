import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, TextInput, KeyboardAvoidingView, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import ReviewsScreen from './ReviewsScreen'

export default function BookingScreen({ facility, session, lang, onBack }) {
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d
  })
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [questions, setQuestions] = useState([])
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [newQ, setNewQ] = useState('')
  const [qError, setQError] = useState(null)
  const [submittingQ, setSubmittingQ] = useState(false)
  const [reviews, setReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewTotal, setReviewTotal] = useState(0)
  const [showAllReviews, setShowAllReviews] = useState(false)

  useEffect(() => { loadQuestions(); loadReviews() }, [])

  async function loadReviews() {
    setReviewsLoading(true)
    try {
      const { data, error, count } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at', { count: 'exact' })
        .eq('facility_id', facility.id)
        .order('created_at', { ascending: false })
        .limit(5)
      if (!error && data) {
        setReviews(data)
        setReviewTotal(count ?? 0)
      }
    } finally {
      setReviewsLoading(false)
    }
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
    const body = newQ.trim()
    if (!body) return
    setSubmittingQ(true)
    setQError(null)
    const { error } = await supabase.from('questions').insert({
      facility_id: facility.id,
      customer_id: session.user.id,
      body,
    })
    if (!error) { setNewQ(''); await loadQuestions() }
    else setQError(t('questionSubmitError', lang))
    setSubmittingQ(false)
  }

  async function submit() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.from('appointments').insert({
      customer_id: session.user.id,
      facility_id: facility.id,
      requested_time: date.toISOString(),
    })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  const tc = typeColors[facility.type] || typeColors.clinic

  if (showAllReviews) {
    return <ReviewsScreen facility={facility} lang={lang} onBack={() => setShowAllReviews(false)} />
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.successRing}>
            <Feather name="check" size={32} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>{t('requestSent', lang)}</Text>
          <Text style={styles.successSub}>
            {t('requestSentSub', lang).replace('{name}', facility.name)}
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>{t('backToList', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={styles.backText}>{t('back', lang)}</Text>
        </TouchableOpacity>

        {facility.cover_image_url ? (
          <Image source={{ uri: facility.cover_image_url }} style={styles.coverHero} resizeMode="cover" />
        ) : null}

        <View style={styles.facilityCard}>
          <View style={styles.facilityCardTop}>
            <View style={{ flex: 1 }}>
              <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
                <Text style={[styles.typeBadgeText, { color: tc.text }]}>{t(facility.type, lang)}</Text>
              </View>
              <Text style={styles.facilityName}>{facility.name}</Text>
              {facility.specialty ? <Text style={styles.specialtyLabel}>{facility.specialty}</Text> : null}
            </View>
            {facility.logo_url ? (
              <Image source={{ uri: facility.logo_url }} style={styles.facilityLogo} resizeMode="contain" />
            ) : null}
          </View>
          {facility.address ? (
            <View style={styles.infoRow}>
              <Feather name="map-pin" size={13} color={colors.textSecondary} />
              <Text style={styles.facilityAddress}>{facility.address}</Text>
            </View>
          ) : null}
          {facility.opening_hours ? (
            <View style={styles.infoRow}>
              <Feather name="clock" size={13} color={colors.textSecondary} />
              <Text style={styles.facilityHours}>{facility.opening_hours}</Text>
            </View>
          ) : null}
          {facility.website ? (
            <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(facility.website)}>
              <Feather name="globe" size={13} color={colors.primary} />
              <Text style={[styles.facilityHours, { color: colors.primary }]}>{t('visitWebsite', lang)}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {reviewsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 20 }} />
        ) : reviews.length > 0 && (() => {
          const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
          return (
            <>
              <Text style={styles.sectionLabel}>{t('tabReviews', lang)} · ⭐ {avg} ({reviews.length})</Text>
              {reviews.map(r => (
                <View key={r.id} style={styles.reviewCard}>
                  <View style={styles.reviewTop}>
                    <Text style={styles.reviewStars}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </Text>
                    <Text style={styles.reviewDate}>
                      {new Date(r.created_at).toLocaleDateString([], { dateStyle: 'short' })}
                    </Text>
                  </View>
                  {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                </View>
              ))}
              <TouchableOpacity style={styles.seeAllBtn} onPress={() => setShowAllReviews(true)}>
                <Text style={styles.seeAllText}>
                  {reviewTotal > 5 ? `See all ${reviewTotal} reviews` : 'See all reviews'}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
              <View style={styles.divider} />
            </>
          )
        })()}

        {facility.type !== 'pharmacy' && (
          <>
            <Text style={styles.sectionLabel}>{t('requestedTime', lang)}</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
              <Text style={styles.dateBtnText}>
                {date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {showPicker && (
              <DateTimePicker
                value={date}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date()}
                onChange={(_, selected) => {
                  if (Platform.OS !== 'ios') setShowPicker(false)
                  if (selected) setDate(selected)
                }}
              />
            )}

            {showPicker && Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.doneBtn} onPress={() => setShowPicker(false)}>
                <Text style={styles.doneBtnText}>{t('done', lang)}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {facility.type !== 'pharmacy' && (
          <>
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitText}>{t('requestAppointment', lang)}</Text>
              }
            </TouchableOpacity>
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>{t('questionsAnswers', lang)}</Text>

        <View style={styles.askRow}>
          <TextInput
            style={styles.askInput}
            value={newQ}
            onChangeText={setNewQ}
            placeholder={t('askPlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
            multiline
          />
          <TouchableOpacity
            style={[styles.askBtn, (!newQ.trim() || submittingQ) && { opacity: 0.4 }]}
            onPress={submitQuestion}
            disabled={!newQ.trim() || submittingQ}
          >
            {submittingQ
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.askBtnText}>{t('ask', lang)}</Text>
            }
          </TouchableOpacity>
        </View>

        {qError && <Text style={styles.error}>{qError}</Text>}

        {questionsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
        ) : questions.length === 0 ? (
          <Text style={styles.noQText}>{t('noQuestions', lang)}</Text>
        ) : (
          questions.map(q => (
            <View key={q.id} style={styles.qCard}>
              <Text style={styles.qBody}>{q.body}</Text>
              {q.answers && q.answers.length > 0 ? (
                <View style={styles.answerBlock}>
                  <Text style={styles.answerLabel}>{t('providerAnswer', lang)}</Text>
                  <Text style={styles.answerBody}>{q.answers[0].body}</Text>
                </View>
              ) : (
                <Text style={styles.noAnswer}>{t('awaitingAnswer', lang)}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  container:       { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, flexGrow: 1 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  backRow:         { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20 },
  backText:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  coverHero:       { width: '100%', height: 180, borderRadius: 16, marginBottom: 12, ...shadow },
  facilityCard:    { backgroundColor: colors.cardBg, borderRadius: 16, padding: 18, marginBottom: 28, ...shadow },
  facilityCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  facilityLogo:    { width: 52, height: 52, borderRadius: 10, backgroundColor: colors.border, flexShrink: 0 },
  typeBadge:       { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 10 },
  typeBadgeText:   { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  facilityName:    { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  specialtyLabel:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 10 },
  infoRow:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  facilityAddress: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },
  facilityHours:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },
  sectionLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  dateBtn:         { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 16, ...shadow, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateBtnText:     { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  doneBtn:         { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 8 },
  doneBtnText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },
  error:           { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 10 },
  submit:          { backgroundColor: colors.primary, borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 8 },
  submitText:      { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  divider:         { height: 1, backgroundColor: colors.border, marginVertical: 28 },
  askRow:          { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginBottom: 16 },
  askInput:        { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 100 },
  askBtn:          { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center', alignItems: 'center' },
  askBtnText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  noQText:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  qCard:           { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
  qBody:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 10, lineHeight: 20 },
  answerBlock:     { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10 },
  answerLabel:     { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  answerBody:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  noAnswer:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, fontStyle: 'italic' },
  seeAllBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, marginBottom: 4 },
  seeAllText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  reviewCard:      { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 8, ...shadow },
  reviewTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reviewStars:     { fontSize: 14, color: '#F5A623', letterSpacing: 1 },
  reviewDate:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  reviewComment:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  successRing:     { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successLight, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  successSub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  backBtn:         { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40 },
  backBtnText:     { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
})
