import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Linking
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const LANGUAGES = [
  { key: 'English',  label: 'English'    },
  { key: 'Turkish',  label: 'Türkçe'     },
  { key: 'Arabic',   label: 'العربية'    },
  { key: 'Russian',  label: 'Русский'    },
  { key: 'Greek',    label: 'Ελληνικά'  },
  { key: 'French',   label: 'Français'   },
  { key: 'Spanish',  label: 'Español'    },
  { key: 'German',   label: 'Deutsch'    },
  { key: 'Persian',  label: 'فارسی'      },
]

const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const TYPE_COLORS = {
  pharmacy: { bg: '#F3E8FF', text: '#7C3AED' },
  clinic:   { bg: '#E6F7F7', text: '#0E7C7B' },
  hospital: { bg: '#FDE8EC', text: '#D1495B' },
  dentist:  { bg: '#E8F5EE', text: '#2E9E5B' },
}

function AppointmentDetail({ booking, lang, reviewedIds, reviewsMap, ratingValue, ratingComment, reviewError, onRatingChange, onCommentChange, onSubmitReview, onCancelBooking, onBack }) {
  const f           = booking.facilities ?? {}
  const isPending   = booking.status === 'pending'
  const isConfirmed = booking.status === 'confirmed'
  const reviewed    = reviewedIds.has(booking.id)
  const review      = reviewsMap.get(booking.id)
  const tc          = TYPE_COLORS[f.type] ?? TYPE_COLORS.clinic

  const statusLabel     = isConfirmed ? t('statusConfirmed', lang) : isPending ? t('statusPending', lang) : t('statusCancelled', lang)
  const statusPillStyle = isConfirmed ? s.pillGreen : isPending ? s.pillOrange : s.pillRed
  const statusTextStyle = isConfirmed ? s.pillTextGreen : isPending ? s.pillTextOrange : s.pillTextRed

  function openMaps() {
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(f.address || f.name || '')}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <TouchableOpacity onPress={onBack}>
              <Text style={s.backText}>{t('back', lang)}</Text>
            </TouchableOpacity>
            <Text style={s.title}>{t('bookingDetail', lang)}</Text>
            <View style={statusPillStyle}>
              <Text style={statusTextStyle}>{statusLabel}</Text>
            </View>
          </View>

          <View style={s.detailFacilityCard}>
            <View style={[s.detailTypeIcon, { backgroundColor: tc.bg }]}>
              <Text style={s.detailTypeIconText}>{TYPE_ICONS[f.type] ?? '🏥'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.detailFacilityName}>{f.name}</Text>
              <View style={[s.typeBadgeSmall, { backgroundColor: tc.bg }]}>
                <Text style={[s.typeBadgeSmallText, { color: tc.text }]}>{t(f.type, lang)}</Text>
              </View>
            </View>
          </View>

          {f.address ? (
            <View style={s.detailInfoRow}>
              <Text style={s.detailInfoIcon}>📍</Text>
              <Text style={s.detailInfoText} numberOfLines={2}>{f.address}</Text>
              <TouchableOpacity onPress={openMaps} style={s.detailInfoBtn}>
                <Text style={s.detailInfoBtnText}>{t('getDirections', lang)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {f.phone ? (
            <View style={s.detailInfoRow}>
              <Text style={s.detailInfoIcon}>📞</Text>
              <Text style={s.detailInfoText}>{f.phone}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${f.phone}`)} style={s.detailInfoBtn}>
                <Text style={s.detailInfoBtnText}>{t('call', lang)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {f.opening_hours ? (
            <View style={s.detailInfoRow}>
              <Text style={s.detailInfoIcon}>🕐</Text>
              <Text style={s.detailInfoText}>{f.opening_hours}</Text>
            </View>
          ) : null}

          <View style={s.detailDivider} />

          <Text style={s.detailSectionLabel}>{t('requestedTime', lang)}</Text>
          <Text style={s.detailApptTime}>
            {new Date(booking.requested_time).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}
          </Text>
          <Text style={s.bookingRef}>{t('bookingRef', lang)}: {booking.id.slice(0, 8).toUpperCase()}</Text>

          {isPending && (
            <TouchableOpacity style={[s.cancelBtn, { marginTop: 16 }]} onPress={() => onCancelBooking(booking.id)}>
              <Text style={s.cancelBtnText}>{t('cancelAppt', lang)}</Text>
            </TouchableOpacity>
          )}

          {isConfirmed && !reviewed && (
            <View style={s.detailReviewSection}>
              <Text style={s.detailSectionLabel}>{t('rateVisit', lang)}</Text>
              <View style={s.starsRow}>
                {[1,2,3,4,5].map(star => (
                  <TouchableOpacity key={star} onPress={() => onRatingChange(star)} activeOpacity={0.7}>
                    <Text style={[s.star, ratingValue >= star && s.starActive]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={s.commentInput}
                value={ratingComment}
                onChangeText={onCommentChange}
                placeholder={t('commentOptional', lang)}
                placeholderTextColor={colors.textSecondary}
                multiline
              />
              {reviewError ? <Text style={s.reviewErrorText}>{reviewError}</Text> : null}
              <TouchableOpacity
                style={[s.submitReviewBtn, !ratingValue && { opacity: 0.4 }]}
                onPress={onSubmitReview}
                disabled={!ratingValue}
              >
                <Text style={s.submitReviewText}>{t('save', lang)}</Text>
              </TouchableOpacity>
            </View>
          )}

          {isConfirmed && reviewed && review && (
            <View style={s.detailReviewSection}>
              <Text style={s.detailSectionLabel}>{t('yourReview', lang)}</Text>
              <View style={s.starsRow}>
                {[1,2,3,4,5].map(star => (
                  <Text key={star} style={[s.star, review.rating >= star && s.starActive]}>★</Text>
                ))}
              </View>
              {review.comment ? <Text style={s.detailReviewComment}>{review.comment}</Text> : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default function ProfileScreen({ session, lang, onBack, onLangChange }) {
  const [profile, setProfile]               = useState(null)
  const [form, setForm]                     = useState({ full_name: '', phone: '', nationality: '', preferred_language: 'English' })
  const [loading, setLoading]               = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [error, setError]                   = useState(null)
  const [bookings, setBookings]             = useState([])
  const [reviewedIds, setReviewedIds]       = useState(new Set())
  const [reviewsMap, setReviewsMap]         = useState(new Map())
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [ratingValue, setRatingValue]       = useState(0)
  const [ratingComment, setRatingComment]   = useState('')
  const [reviewError, setReviewError]       = useState(null)

  useEffect(() => {
    supabase.from('profiles')
      .select('full_name, phone, nationality, preferred_language, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data)
          setForm({
            full_name: data.full_name ?? '',
            phone: data.phone ?? '',
            nationality: data.nationality ?? '',
            preferred_language: data.preferred_language ?? 'English',
          })
        }
        setLoading(false)
      })

    supabase.from('appointments')
      .select('id, requested_time, status, facility_id, facilities(name, address, phone, type, opening_hours)')
      .eq('customer_id', session.user.id)
      .order('requested_time', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (data) setBookings(data) })

    supabase.from('reviews')
      .select('appointment_id, rating, comment')
      .eq('customer_id', session.user.id)
      .then(({ data }) => {
        if (data) {
          setReviewedIds(new Set(data.map(r => r.appointment_id)))
          setReviewsMap(new Map(data.map(r => [r.appointment_id, { rating: r.rating, comment: r.comment }])))
        }
      })
  }, [])

  async function cancelBooking(bookingId) {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .eq('customer_id', session.user.id)
    if (!error) {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b))
      setSelectedBooking(prev => prev?.id === bookingId ? { ...prev, status: 'cancelled' } : prev)
    }
  }

  async function submitReview(booking) {
    if (!ratingValue) return
    setReviewError(null)
    const { error } = await supabase.from('reviews').insert({
      customer_id: session.user.id,
      facility_id: booking.facility_id,
      appointment_id: booking.id,
      rating: ratingValue,
      comment: ratingComment.trim() || null,
    })
    if (!error) {
      setReviewedIds(prev => new Set([...prev, booking.id]))
      setReviewsMap(prev => new Map([...prev, [booking.id, { rating: ratingValue, comment: ratingComment.trim() || null }]]))
      setRatingValue(0)
      setRatingComment('')
    } else {
      setReviewError(error.message)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        nationality: form.nationality.trim() || null,
        preferred_language: form.preferred_language,
      })
      .eq('id', session.user.id)
    if (err) setError(err.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onLangChange?.(form.preferred_language)
    }
    setSaving(false)
  }

  const set = key => val => setForm(f => ({ ...f, [key]: val }))

  async function selectLang(langKey) {
    set('preferred_language')(langKey)
    await supabase.from('profiles').update({ preferred_language: langKey }).eq('id', session.user.id)
    onLangChange?.(langKey)
  }

  const initials = form.full_name.trim()
    ? form.full_name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : session.user.email[0].toUpperCase()

  const memberId = session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  if (selectedBooking) {
    return (
      <AppointmentDetail
        booking={selectedBooking}
        lang={lang}
        reviewedIds={reviewedIds}
        reviewsMap={reviewsMap}
        ratingValue={ratingValue}
        ratingComment={ratingComment}
        reviewError={reviewError}
        onRatingChange={setRatingValue}
        onCommentChange={setRatingComment}
        onSubmitReview={() => submitReview(selectedBooking)}
        onCancelBooking={cancelBooking}
        onBack={() => setSelectedBooking(null)}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={s.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.header}>
            <TouchableOpacity onPress={onBack}>
              <Text style={s.backText}>{t('back', lang)}</Text>
            </TouchableOpacity>
            <Text style={s.title}>{t('profile', lang)}</Text>
            <TouchableOpacity onPress={save} disabled={saving}>
              <Text style={[s.saveText, saving && { opacity: 0.4 }]}>
                {saved ? t('saved', lang) : saving ? t('saving', lang) : t('save', lang)}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={s.avatarSection}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <Text style={s.emailText}>{session.user.email}</Text>
            <View style={s.rolePill}>
              <Text style={s.rolePillText}>{profile?.role ?? 'customer'}</Text>
            </View>
          </View>

          <View style={s.memberCard}>
            <View style={s.memberCardTop}>
              <View>
                <Text style={s.memberLabel}>{t('membershipId', lang)}</Text>
                <Text style={s.memberId}>{memberId}</Text>
              </View>
              <View style={s.qrPlaceholder}>
                <Text style={s.qrIcon}>▦</Text>
              </View>
            </View>
            <Text style={s.memberSub}>{t('discountQrSoon', lang)}</Text>
          </View>

          <Text style={s.sectionTitle}>{t('myBookings', lang)}</Text>
          {bookings.length === 0 ? (
            <Text style={s.noBookingsText}>{t('noBookings', lang)}</Text>
          ) : (
            bookings.map(b => {
              const isPending   = b.status === 'pending'
              const isConfirmed = b.status === 'confirmed'
              const statusLabel = isConfirmed ? t('statusConfirmed', lang)
                : isPending ? t('statusPending', lang)
                : t('statusCancelled', lang)
              const statusStyle     = isConfirmed ? s.pillGreen : isPending ? s.pillOrange : s.pillRed
              const statusTextStyle = isConfirmed ? s.pillTextGreen : isPending ? s.pillTextOrange : s.pillTextRed
              return (
                <TouchableOpacity
                  key={b.id}
                  style={s.bookingCard}
                  activeOpacity={0.75}
                  onPress={() => { setRatingValue(0); setRatingComment(''); setReviewError(null); setSelectedBooking(b) }}
                >
                  <View style={s.bookingTop}>
                    <Text style={s.bookingFacility} numberOfLines={1}>{b.facilities?.name ?? '—'}</Text>
                    <View style={statusStyle}>
                      <Text style={statusTextStyle}>{statusLabel}</Text>
                    </View>
                  </View>
                  <Text style={s.bookingTime}>
                    {new Date(b.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                  <Text style={s.bookingRef}>{t('bookingRef', lang)}: {b.id.slice(0, 8).toUpperCase()}</Text>
                  {isConfirmed && reviewedIds.has(b.id) && (
                    <Text style={s.reviewedBadge}>{t('reviewDone', lang)} ★</Text>
                  )}
                </TouchableOpacity>
              )
            })
          )}

          <Text style={s.sectionTitle}>{t('personalInfo', lang)}</Text>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>{t('fullName', lang)}</Text>
            <TextInput
              style={s.input}
              value={form.full_name}
              onChangeText={set('full_name')}
              placeholder="Your full name"
              placeholderTextColor={colors.border}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>{t('phone', lang)}</Text>
            <TextInput
              style={s.input}
              value={form.phone}
              onChangeText={set('phone')}
              placeholder="+90 555 000 00 00"
              placeholderTextColor={colors.border}
              keyboardType="phone-pad"
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>{t('nationality', lang)}</Text>
            <TextInput
              style={s.input}
              value={form.nationality}
              onChangeText={set('nationality')}
              placeholder="e.g. British, Turkish, Iranian"
              placeholderTextColor={colors.border}
            />
          </View>

          <Text style={s.sectionTitle}>{t('preferences', lang)}</Text>
          <Text style={s.fieldLabel}>{t('preferredLanguage', lang)}</Text>
          <View style={s.langGrid}>
            {LANGUAGES.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[s.langChip, form.preferred_language === key && s.langChipActive]}
                onPress={() => selectLang(key)}
              >
                <Text style={[s.langChipText, form.preferred_language === key && s.langChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity style={s.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={s.signOutText}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container:        { paddingHorizontal: 20, paddingBottom: 48 },

  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 20 },
  title:            { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  backText:         { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  saveText:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },

  avatarSection:    { alignItems: 'center', marginBottom: 24 },
  avatar:           { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText:       { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff' },
  emailText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 8 },
  rolePill:         { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.primaryLight },
  rolePillText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'capitalize' },

  memberCard:       { backgroundColor: colors.primary, borderRadius: 16, padding: 20, marginBottom: 28, ...shadow },
  memberCardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  memberLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  memberId:         { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 2 },
  memberSub:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)' },
  qrPlaceholder:    { width: 48, height: 48, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  qrIcon:           { fontSize: 24, color: '#fff' },

  sectionTitle:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14, marginTop: 4 },
  fieldGroup:       { marginBottom: 16 },
  fieldLabel:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:            { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },

  langGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 },
  langChip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  langChipActive:   { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  langChipText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  langChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  noBookingsText:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 20, marginTop: 2 },
  bookingCard:      { backgroundColor: colors.cardBg, borderRadius: 12, padding: 14, marginBottom: 10, ...shadow },
  bookingTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  bookingFacility:  { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  bookingTime:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  bookingRef:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5 },
  pillGreen:        { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: colors.successLight },
  pillOrange:       { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: colors.accentLight },
  pillRed:          { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: colors.dangerLight },
  pillTextGreen:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.success },
  pillTextOrange:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent },
  pillTextRed:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.danger },
  cancelBtn:        { alignSelf: 'flex-start', backgroundColor: colors.dangerLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  cancelBtnText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  reviewedBadge:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.success, marginTop: 8 },
  starsRow:         { flexDirection: 'row', gap: 8 },
  star:             { fontSize: 28, color: colors.border },
  starActive:       { color: '#F5A623' },
  commentInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  submitReviewBtn:  { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  submitReviewText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  reviewErrorText:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger },
  errorText:        { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12 },
  signOutBtn:       { borderWidth: 1.5, borderColor: colors.danger, borderRadius: 12, padding: 15, alignItems: 'center' },
  signOutText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.danger },

  // Appointment detail view
  detailFacilityCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4, backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, ...shadow },
  detailTypeIcon:      { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  detailTypeIconText:  { fontSize: 24 },
  detailFacilityName:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  typeBadgeSmall:      { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  typeBadgeSmallText:  { fontSize: 11, fontFamily: 'Inter_700Bold' },
  detailInfoRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailInfoIcon:      { fontSize: 16, width: 22, textAlign: 'center' },
  detailInfoText:      { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  detailInfoBtn:       { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  detailInfoBtnText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  detailDivider:       { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  detailSectionLabel:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  detailApptTime:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  detailReviewSection: { marginTop: 24, gap: 12 },
  detailReviewComment: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, fontStyle: 'italic' },
})
