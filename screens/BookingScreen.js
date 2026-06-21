import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, TextInput, KeyboardAvoidingView, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import ReviewsScreen from './ReviewsScreen'
import { ReviewSkeleton, SlotGridSkeleton } from '../components/Skeleton'

async function notifyProvider(facility, title, body) {
  if (!facility.provider_id) return
  try {
    const { data: prov } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', facility.provider_id)
      .maybeSingle()
    if (prov?.push_token) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ to: prov.push_token, title, body, sound: 'default' }),
      })
    }
    await supabase.from('notifications').insert({ user_id: facility.provider_id, title, body })
  } catch {}
}

const SLOT_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const SLOT_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function generateSlots(date, availability, bookedSlots) {
  if (!availability?.schedule) return []
  const dayKey = SLOT_DAY_KEYS[date.getDay()]
  const day = availability.schedule[dayKey]
  if (!day || day.closed) return []
  const [openH, openM] = (day.open ?? '09:00').split(':').map(Number)
  const [closeH, closeM] = (day.close ?? '17:00').split(':').map(Number)
  const duration = availability.slot_duration ?? 30
  const slots = []
  let h = openH, m = openM
  const now = new Date()
  while (h < closeH || (h === closeH && m < closeM)) {
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const slotDate = new Date(date)
    slotDate.setHours(h, m, 0, 0)
    slots.push({ label, isPast: slotDate <= now, isBooked: bookedSlots.has(label) })
    m += duration
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60 }
  }
  return slots
}

export default function BookingScreen({ facility, session, lang, blockedUntil, onBack }) {
  const hasSlots = !!facility.availability

  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d
  })
  const [showPicker, setShowPicker] = useState(false)

  // slot picker state (only used when facility.availability is set)
  const [selectedDate, setSelectedDate]   = useState(null)
  const [selectedSlot, setSelectedSlot]   = useState(null)
  const [bookedSlots, setBookedSlots]     = useState(new Set())
  const [loadingSlots, setLoadingSlots]   = useState(false)

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
    if (!error) {
      setNewQ('')
      await loadQuestions()
      notifyProvider(facility, 'New Question', `${facility.name} received a new question from a customer.`)
    } else setQError(t('questionSubmitError', lang))
    setSubmittingQ(false)
  }

  async function loadBookedSlots(d) {
    setLoadingSlots(true)
    const start = new Date(d); start.setHours(0, 0, 0, 0)
    const end   = new Date(d); end.setHours(23, 59, 59, 999)
    const { data } = await supabase
      .from('appointments')
      .select('requested_time')
      .eq('facility_id', facility.id)
      .in('status', ['pending', 'confirmed'])
      .gte('requested_time', start.toISOString())
      .lte('requested_time', end.toISOString())
    const booked = new Set((data ?? []).map(a => {
      const t = new Date(a.requested_time)
      return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    }))
    setBookedSlots(booked)
    setLoadingSlots(false)
  }

  async function submit() {
    setLoading(true)
    setError(null)
    let requestedTime = date.toISOString()
    if (hasSlots && selectedDate && selectedSlot) {
      const [h, m] = selectedSlot.split(':').map(Number)
      const d = new Date(selectedDate)
      d.setHours(h, m, 0, 0)
      requestedTime = d.toISOString()
    }
    const { error } = await supabase.from('appointments').insert({
      customer_id: session.user.id,
      facility_id: facility.id,
      requested_time: requestedTime,
    })
    if (error) setError(error.message)
    else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setDone(true)
      notifyProvider(facility, 'New Appointment Request', `${facility.name} has a new appointment request.`)
    }
    setLoading(false)
  }

  function openAndroidDateTimePicker() {
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      display: 'spinner',
      minimumDate: new Date(),
      onChange: (_, selectedDate) => {
        if (!selectedDate) return
        DateTimePickerAndroid.open({
          value: selectedDate,
          mode: 'time',
          display: 'spinner',
          onChange: (_, selectedTime) => {
            if (!selectedTime) return
            const combined = new Date(selectedDate)
            combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0)
            setDate(combined)
          },
        })
      },
    })
  }

  const tc = typeColors[facility.type] || typeColors.clinic

  if (showAllReviews) {
    return <ReviewsScreen facility={facility} lang={lang} onBack={() => setShowAllReviews(false)} />
  }

  const isBlocked = blockedUntil && new Date(blockedUntil) > new Date()
  if (facility.type !== 'pharmacy' && isBlocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <TouchableOpacity onPress={onBack} style={[styles.backRow, { alignSelf: 'flex-start', marginBottom: 32 }]}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backText}>{t('back', lang)}</Text>
          </TouchableOpacity>
          <View style={[styles.successRing, { backgroundColor: '#FDE8EC' }]}>
            <Feather name="slash" size={32} color={colors.danger} />
          </View>
          <Text style={[styles.successTitle, { color: colors.danger }]}>{t('bookingBlocked', lang)}</Text>
          <Text style={styles.successSub}>
            {t('bookingBlockedMsg', lang).replace('{date}', new Date(blockedUntil).toLocaleDateString([], { dateStyle: 'medium' }))}
          </Text>
        </View>
      </SafeAreaView>
    )
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
              {facility.specialty?.length ? <Text style={styles.specialtyLabel}>{Array.isArray(facility.specialty) ? facility.specialty.join(' · ') : facility.specialty}</Text> : null}
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
          {facility.opening_hours && !facility.opening_hours.trim().startsWith('{') ? (
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
          <>{[0, 1].map(i => <ReviewSkeleton key={i} />)}</>
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
                  {t('seeAllReviews', lang).replace('{n}', reviewTotal)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
              <View style={styles.divider} />
            </>
          )
        })()}

        {facility.type !== 'pharmacy' && (
          <>
            {hasSlots ? (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const dates = Array.from({ length: 14 }, (_, i) => {
                const d = new Date(today); d.setDate(today.getDate() + i); return d
              })
              const slots = selectedDate ? generateSlots(selectedDate, facility.availability, bookedSlots) : []
              const canBook = selectedDate && selectedSlot
              return (
                <>
                  <Text style={styles.sectionLabel}>{t('selectDate', lang)}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8 }}>
                    {dates.map((d, i) => {
                      const isSelected = selectedDate && d.toDateString() === selectedDate.toDateString()
                      return (
                        <TouchableOpacity
                          key={i}
                          style={[styles.dateChip, isSelected && styles.dateChipActive]}
                          onPress={() => { setSelectedDate(d); setSelectedSlot(null); loadBookedSlots(d) }}
                        >
                          <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextActive]}>{SLOT_DAY_LABELS[d.getDay()]}</Text>
                          <Text style={[styles.dateChipNum, isSelected && styles.dateChipTextActive]}>{d.getDate()}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </ScrollView>

                  {selectedDate && (
                    <>
                      <Text style={styles.sectionLabel}>{t('selectTime', lang)}</Text>
                      {loadingSlots ? (
                        <SlotGridSkeleton />
                      ) : slots.length === 0 ? (
                        <Text style={styles.noSlots}>{t('closedDay', lang)}</Text>
                      ) : (
                        <View style={styles.slotGrid}>
                          {slots.map(slot => {
                            const isSelected = selectedSlot === slot.label
                            const unavailable = slot.isPast || slot.isBooked
                            return (
                              <TouchableOpacity
                                key={slot.label}
                                style={[
                                  styles.slotChip,
                                  isSelected && styles.slotChipActive,
                                  unavailable && styles.slotChipUnavailable,
                                ]}
                                onPress={() => !unavailable && setSelectedSlot(slot.label)}
                                disabled={unavailable}
                              >
                                <Text style={[
                                  styles.slotChipText,
                                  isSelected && styles.slotChipTextActive,
                                  unavailable && styles.slotChipTextUnavailable,
                                ]}>
                                  {slot.label}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      )}
                    </>
                  )}

                  {error && <Text style={styles.error}>{error}</Text>}
                  <TouchableOpacity
                    style={[styles.submit, !canBook && { opacity: 0.4 }]}
                    onPress={submit}
                    disabled={loading || !canBook}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.submitText}>
                          {canBook
                            ? `${t('requestAppointment', lang)} · ${selectedSlot}`
                            : t('requestAppointment', lang)}
                        </Text>
                    }
                  </TouchableOpacity>
                </>
              )
            })() : (
              <>
                <Text style={styles.sectionLabel}>{t('requestedTime', lang)}</Text>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={Platform.OS === 'ios' ? () => setShowPicker(true) : openAndroidDateTimePicker}
                >
                  <Text style={styles.dateBtnText}>
                    {date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                {showPicker && Platform.OS === 'ios' && (
                  <DateTimePicker
                    value={date}
                    mode="datetime"
                    display="spinner"
                    minimumDate={new Date()}
                    onChange={(_, selected) => { if (selected) setDate(selected) }}
                  />
                )}

                {showPicker && Platform.OS === 'ios' && (
                  <TouchableOpacity style={styles.doneBtn} onPress={() => setShowPicker(false)}>
                    <Text style={styles.doneBtnText}>{t('done', lang)}</Text>
                  </TouchableOpacity>
                )}

                {error && <Text style={styles.error}>{error}</Text>}
                <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.submitText}>{t('requestAppointment', lang)}</Text>
                  }
                </TouchableOpacity>
              </>
            )}
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
            maxLength={300}
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
  dateChip:           { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.cardBg, minWidth: 54, ...shadow },
  dateChipActive:     { backgroundColor: colors.primary },
  dateChipDay:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  dateChipNum:        { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },
  dateChipTextActive: { color: '#fff' },
  slotGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  slotChip:           { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  slotChipActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  slotChipUnavailable:{ backgroundColor: colors.surface, opacity: 0.45 },
  slotChipText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  slotChipTextActive: { color: '#fff' },
  slotChipTextUnavailable: { color: colors.textSecondary },
  noSlots:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 20 },
  successRing:     { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successLight, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  successSub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  backBtn:         { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40 },
  backBtnText:     { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
})
