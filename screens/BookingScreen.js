import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, TextInput, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import ReviewsScreen from './ReviewsScreen'
import { ReviewSkeleton, SlotGridSkeleton } from '../components/Skeleton'
import ContentReportMenu from '../components/ContentReportMenu'
import { notifyFacilityOwner } from '../utils/notify'
import { HEALTH_TYPES } from '../constants/facilityTypes'
import BackButton from '../components/BackButton'

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

const GARAGE_SVC_KEY = {
  muayene: 'garageCatMuayene', repair: 'garageCatRepair', tyres: 'garageCatTyres',
  wash: 'garageCatWash', parts: 'garageCatParts', towing: 'garageCatTowing',
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
  const [selectedServices, setSelectedServices] = useState([]) // garage: chosen service_types
  const [carMake, setCarMake]   = useState('')
  const [carModel, setCarModel] = useState('')
  const [carYear, setCarYear]   = useState('')
  const [carPlate, setCarPlate] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [notes, setNotes]       = useState('')
  const [bookedSlots, setBookedSlots]     = useState(new Set())
  const [loadingSlots, setLoadingSlots]   = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [reviews, setReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewTotal, setReviewTotal] = useState(0)
  const [showAllReviews, setShowAllReviews] = useState(false)

  useEffect(() => { loadReviews() }, [])

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
    const payload = { customer_id: session.user.id, facility_id: facility.id, requested_time: requestedTime }
    if (facility.type === 'garage') {
      payload.garage_booking_details = {
        services: selectedServices,
        car: { make: carMake.trim() || null, model: carModel.trim() || null, year: carYear.trim() || null, plate: carPlate.trim() || null },
        phone: custPhone.trim() || null,
        notes: notes.trim() || null,
      }
    }
    const { error } = await supabase.from('appointments').insert(payload)
    if (error) {
      if (error.code === '23505') {
        // Slot was taken by another customer mid-race (DB unique guard fired).
        setError(t('slotTaken', lang))
        if (hasSlots && selectedDate) {
          setSelectedSlot(null)
          loadBookedSlots(selectedDate)
        }
      } else {
        setError(error.message)
      }
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setDone(true)
      notifyFacilityOwner(facility, 'appointment')
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
          <BackButton
            lang={lang}
            onPress={onBack}
            style={[styles.backRow, { alignSelf: 'flex-start', marginBottom: 32 }]}
          />
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
      <KeyboardAwareForm>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton lang={lang} onPress={onBack} style={styles.backRow} />

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
                    <View style={styles.reviewTopRight}>
                      <Text style={styles.reviewDate}>
                        {new Date(r.created_at).toLocaleDateString([], { dateStyle: 'short' })}
                      </Text>
                      <ContentReportMenu contentType="review" contentId={r.id} lang={lang} onBlocked={loadReviews} />
                    </View>
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

        {!HEALTH_TYPES.includes(facility.type) && (
          <>
            {facility.type === 'garage' && facility.service_types?.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{t('garageBkSelectServices', lang)}</Text>
                <View style={styles.serviceRow}>
                  {facility.service_types.map(st => {
                    const isSelected = selectedServices.includes(st)
                    return (
                      <TouchableOpacity
                        key={st}
                        style={[styles.serviceChip, isSelected && styles.serviceChipActive]}
                        onPress={() => setSelectedServices(prev => (prev.includes(st) ? prev.filter(k => k !== st) : [...prev, st]))}
                      >
                        <Text style={[styles.serviceChipText, isSelected && styles.serviceChipTextActive]}>
                          {t(GARAGE_SVC_KEY[st] || st, lang)}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <Text style={styles.sectionLabel}>{t('garageBkCarSection', lang)}</Text>
                <View style={styles.gRow}>
                  <TextInput style={[styles.gInput, styles.gInputHalf]} value={carMake} onChangeText={setCarMake}
                    placeholder={t('garageBkCarMake', lang)} placeholderTextColor={colors.textSecondary} />
                  <TextInput style={[styles.gInput, styles.gInputHalf]} value={carModel} onChangeText={setCarModel}
                    placeholder={t('garageBkCarModel', lang)} placeholderTextColor={colors.textSecondary} />
                </View>
                <View style={styles.gRow}>
                  <TextInput style={[styles.gInput, styles.gInputHalf]} value={carYear} onChangeText={setCarYear}
                    placeholder={t('garageBkCarYear', lang)} placeholderTextColor={colors.textSecondary} keyboardType="number-pad" maxLength={4} />
                  <TextInput style={[styles.gInput, styles.gInputHalf]} value={carPlate} onChangeText={setCarPlate}
                    placeholder={t('garageBkCarPlate', lang)} placeholderTextColor={colors.textSecondary} autoCapitalize="characters" />
                </View>

                <Text style={styles.sectionLabel}>{t('garageBkPhone', lang)}</Text>
                <TextInput style={styles.gInput} value={custPhone} onChangeText={setCustPhone}
                  placeholder="+90 5xx xxx xxxx" placeholderTextColor={colors.textSecondary} keyboardType="phone-pad" />

                <Text style={styles.sectionLabel}>{t('garageBkNotes', lang)}</Text>
                <TextInput style={[styles.gInput, styles.gInputMulti]} value={notes} onChangeText={setNotes}
                  placeholder={t('garageBkNotesPlaceholder', lang)} placeholderTextColor={colors.textSecondary}
                  multiline maxLength={500} textAlignVertical="top" />
              </>
            )}
            {hasSlots ? (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const dates = Array.from({ length: 14 }, (_, i) => {
                const d = new Date(today); d.setDate(today.getDate() + i); return d
              })
              const slots = selectedDate ? generateSlots(selectedDate, facility.availability, bookedSlots) : []
              const canBook = selectedDate && selectedSlot && (facility.type !== 'garage' || (selectedServices.length > 0 && !!custPhone.trim()))
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
                <TouchableOpacity
                  style={[styles.submit, (facility.type === 'garage' && !(selectedServices.length > 0 && custPhone.trim())) && { opacity: 0.4 }]}
                  onPress={submit}
                  disabled={loading || (facility.type === 'garage' && !(selectedServices.length > 0 && custPhone.trim()))}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.submitText}>{t('requestAppointment', lang)}</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAwareForm>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  container:       { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, flexGrow: 1 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  backRow:         { marginBottom: 20 },
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
  seeAllBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, marginBottom: 4 },
  seeAllText:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  reviewCard:      { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 8, ...shadow },
  reviewTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reviewTopRight:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewStars:     { fontSize: 14, color: '#F5A623', letterSpacing: 1 },
  reviewDate:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  reviewComment:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  dateChip:           { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.cardBg, minWidth: 54, ...shadow },
  dateChipActive:     { backgroundColor: colors.primary },
  dateChipDay:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  dateChipNum:        { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },
  dateChipTextActive: { color: '#fff' },
  slotGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  serviceRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  serviceChip:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
                        borderColor: colors.border, backgroundColor: colors.cardBg },
  serviceChipActive:  { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  serviceChipText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  serviceChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  gRow:               { flexDirection: 'row', gap: 10 },
  gInput:             { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
                        fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 12 },
  gInputHalf:         { flex: 1 },
  gInputMulti:        { minHeight: 90, paddingTop: 12 },
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
