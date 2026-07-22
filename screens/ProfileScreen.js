import { useState, useEffect } from 'react'
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
  Modal, LayoutAnimation, UIManager,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { getNatLabel } from '../constants/nationalityTranslations'
import LegalScreen from './LegalScreen'
import { containsBlockedTerm, moderationErrorKey } from '../utils/profanity'
import { PRESET_AVATARS, getPreset } from '../constants/avatars'

const NATIONALITIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Bosnia & Herzegovina',
  'Brazil', 'Bulgaria', 'Canada', 'China', 'Croatia', 'Cuba', 'Czech Republic',
  'Denmark', 'Egypt', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece',
  'Hungary', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Lebanon', 'Libya', 'Malaysia', 'Malta',
  'Mexico', 'Morocco', 'Netherlands', 'Nigeria', 'Norway', 'Pakistan', 'Palestine',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Saudi Arabia',
  'Serbia', 'Singapore', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden',
  'Switzerland', 'Syria', 'Thailand', 'Tunisia', 'Turkey', 'Northern Cyprus', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uzbekistan', 'Venezuela',
  'Vietnam', 'Yemen', 'Zimbabwe',
]

const COUNTRY_CODES = [
  { code: '+90',  label: 'Turkey' },
  { code: '+357', label: 'Cyprus' },
  { code: '+44',  label: 'United Kingdom' },
  { code: '+1',   label: 'USA / Canada' },
  { code: '+49',  label: 'Germany' },
  { code: '+33',  label: 'France' },
  { code: '+31',  label: 'Netherlands' },
  { code: '+46',  label: 'Sweden' },
  { code: '+39',  label: 'Italy' },
  { code: '+34',  label: 'Spain' },
  { code: '+30',  label: 'Greece' },
  { code: '+7',   label: 'Russia' },
  { code: '+98',  label: 'Iran' },
  { code: '+966', label: 'Saudi Arabia' },
  { code: '+971', label: 'UAE' },
  { code: '+962', label: 'Jordan' },
  { code: '+970', label: 'Palestine' },
  { code: '+964', label: 'Iraq' },
  { code: '+963', label: 'Syria' },
  { code: '+961', label: 'Lebanon' },
  { code: '+20',  label: 'Egypt' },
  { code: '+91',  label: 'India' },
  { code: '+86',  label: 'China' },
  { code: '+82',  label: 'South Korea' },
  { code: '+81',  label: 'Japan' },
  { code: '+61',  label: 'Australia' },
]

function decode(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  lookup['='.charCodeAt(0)] = 0
  const len = base64.length
  let bufLen = (len * 3) >> 2
  if (base64[len - 1] === '=') bufLen--
  if (base64[len - 2] === '=') bufLen--
  const buf = new ArrayBuffer(bufLen)
  const out = new Uint8Array(buf)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)]
    const b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)]
    const d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | d
  }
  return buf
}

function AvatarDisplay({ avatarUrl, initials, size = 72, textSize = 26 }) {
  const preset = getPreset(avatarUrl)
  if (preset) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: preset.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: textSize * 0.9 }}>{preset.emoji}</Text>
      </View>
    )
  }
  if (avatarUrl?.startsWith('http')) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: textSize, fontFamily: 'Inter_700Bold', color: '#fff' }}>{initials}</Text>
    </View>
  )
}


const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const TYPE_COLORS = {
  pharmacy: { bg: '#F3E8FF', text: '#7C3AED' },
  clinic:   { bg: '#E6F7F7', text: '#0E7C7B' },
  hospital: { bg: '#FDE8EC', text: '#D1495B' },
  dentist:  { bg: '#E8F5EE', text: '#2E9E5B' },
}

function AppointmentDetail({ booking, lang, reviewedIds, reviewsMap, ratingValue, ratingComment, reviewError, onRatingChange, onCommentChange, onSubmitReview, onCancelBooking, onOpenTerms, onBack }) {
  const f           = booking.facilities ?? {}
  const isPending   = booking.status === 'pending'
  const isConfirmed = booking.status === 'confirmed'
  const isCompleted = booking.status === 'completed'
  const reviewed    = reviewedIds.has(booking.id)
  const review      = reviewsMap.get(booking.id)
  const tc          = TYPE_COLORS[f.type] ?? TYPE_COLORS.clinic

  const statusLabel     = isConfirmed ? t('statusConfirmed', lang) : isPending ? t('statusPending', lang) : isCompleted ? t('statusCompleted', lang) : t('statusCancelled', lang)
  const statusPillStyle = isConfirmed ? s.pillGreen : isPending ? s.pillOrange : isCompleted ? s.pillGreen : s.pillRed
  const statusTextStyle = isConfirmed ? s.pillTextGreen : isPending ? s.pillTextOrange : isCompleted ? s.pillTextGreen : s.pillTextRed

  function openMaps() {
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(f.address || f.name || '')}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <TouchableOpacity onPress={onBack} style={s.backBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
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
              <Feather name="map-pin" size={15} color={colors.textSecondary} style={s.detailInfoIcon} />
              <Text style={s.detailInfoText} numberOfLines={2}>{f.address}</Text>
              <TouchableOpacity onPress={openMaps} style={s.detailInfoBtn}>
                <Text style={s.detailInfoBtnText}>{t('getDirections', lang)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {f.phone ? (
            <View style={s.detailInfoRow}>
              <Feather name="phone" size={15} color={colors.textSecondary} style={s.detailInfoIcon} />
              <Text style={s.detailInfoText}>{f.phone}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${f.phone}`)} style={s.detailInfoBtn}>
                <Text style={s.detailInfoBtnText}>{t('call', lang)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {f.opening_hours ? (
            <View style={s.detailInfoRow}>
              <Feather name="clock" size={15} color={colors.textSecondary} style={s.detailInfoIcon} />
              <Text style={s.detailInfoText}>{f.opening_hours}</Text>
            </View>
          ) : null}

          <View style={s.detailDivider} />

          <Text style={s.detailSectionLabel}>{t('requestedTime', lang)}</Text>
          <Text style={s.detailApptTime}>
            {new Date(booking.requested_time).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}
          </Text>
          <Text style={s.bookingRef}>{t('bookingRef', lang)}: {booking.id.slice(0, 8).toUpperCase()}</Text>

          {(isPending || isConfirmed) && (() => {
            const canCancel = new Date(booking.requested_time) > new Date(Date.now() + 24 * 60 * 60 * 1000)
            if (canCancel) return (
              <TouchableOpacity style={[s.cancelBtn, { marginTop: 16 }]} onPress={() => onCancelBooking(booking.id)}>
                <Text style={s.cancelBtnText}>{t('cancelAppt', lang)}</Text>
              </TouchableOpacity>
            )
            if (isConfirmed) return (
              <View style={[s.cancelLateBox, { marginTop: 16 }]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} style={{ marginTop: 1 }} />
                <Text style={s.cancelLateText}>{t('cancelLate', lang)}</Text>
              </View>
            )
            return null
          })()}

          {(isConfirmed || isCompleted) && !reviewed && (
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
              <Text style={s.termsNotice}>
                {t('termsAgreeContent', lang)}{' '}
                <Text style={s.termsNoticeLink} onPress={onOpenTerms}>{t('termsOfService', lang)}</Text>
              </Text>
            </View>
          )}

          {(isConfirmed || isCompleted) && reviewed && review && (
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

export default function ProfileScreen({ session, lang, onBack, onLangChange, onAvatarChange }) {
  const [profile, setProfile]               = useState(null)
  const [form, setForm]                     = useState({ full_name: '', phone: '', nationality: '', preferred_language: 'English' })
  const [savedForm, setSavedForm]           = useState(null)
  const [savedCC, setSavedCC]               = useState('+90')
  const [loading, setLoading]               = useState(true)
  const [loadError, setLoadError]           = useState(false)
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
  const [legalTab, setLegalTab]             = useState(null)
  const [blocks, setBlocks]                 = useState([])
  const [avatarUrl, setAvatarUrl]           = useState(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [avatarUploading, setAvatarUploading]   = useState(false)
  const [avatarError, setAvatarError]           = useState(null)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [deleting, setDeleting]                 = useState(false)
  const [deleteError, setDeleteError]           = useState(null)
  const [bookingsOpen, setBookingsOpen]         = useState(false)
  const [selectedCC, setSelectedCC]             = useState('+90')
  const [showCCPicker, setShowCCPicker]         = useState(false)
  const [showNatPicker, setShowNatPicker]       = useState(false)
  const [personalOpen, setPersonalOpen]         = useState(false)

  function toggleSection(setter) {
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true)
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setter(v => !v)
  }

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data, error } = await supabase.from('profiles')
          .select('full_name, phone, nationality, preferred_language, role, avatar_url')
          .eq('id', session.user.id)
          .single()
        if (error) { setLoadError(true); return }
        if (data) {
          setProfile(data)
          setAvatarUrl(data.avatar_url ?? null)
          const stored = data.phone ?? ''
          const matched = COUNTRY_CODES.find(c => stored.startsWith(c.code))
          if (matched) setSelectedCC(matched.code)
          const initialCC = matched?.code ?? '+90'
          setSavedCC(initialCC)
          const initialForm = {
            full_name: data.full_name ?? '',
            phone: matched ? stored.slice(matched.code.length).trim() : stored,
            nationality: data.nationality ?? '',
            preferred_language: data.preferred_language ?? 'English',
          }
          setForm(initialForm)
          setSavedForm(initialForm)
        }
      } finally {
        setLoading(false)
      }
    }

    async function loadBookings() {
      const { data } = await supabase.from('appointments')
        .select('id, requested_time, status, facility_id, facilities(name, address, phone, type, opening_hours)')
        .eq('customer_id', session.user.id)
        .order('requested_time', { ascending: false })
        .limit(20)
      if (data) setBookings(data)
    }

    async function loadReviews() {
      const { data } = await supabase.from('reviews')
        .select('appointment_id, rating, comment')
        .eq('customer_id', session.user.id)
      if (data) {
        setReviewedIds(new Set(data.map(r => r.appointment_id)))
        setReviewsMap(new Map(data.map(r => [r.appointment_id, { rating: r.rating, comment: r.comment }])))
      }
    }

    loadProfile()
    loadBookings()
    loadReviews()
    loadBlocks()
  }, [])

  // Deliberately NO names here. Reviews are anonymous, so showing "you blocked
  // Ahmet K." would reveal who wrote the review the user blocked from.
  async function loadBlocks() {
    const { data } = await supabase.from('blocks')
      .select('blocked_id, created_at')
      .order('created_at', { ascending: false })
    setBlocks(data ?? [])
  }

  async function unblock(blockedId) {
    const { error } = await supabase.from('blocks').delete()
      .eq('blocker_id', session.user.id)
      .eq('blocked_id', blockedId)
    if (!error) setBlocks(prev => prev.filter(b => b.blocked_id !== blockedId))
  }

  async function cancelBooking(bookingId) {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .eq('customer_id', session.user.id)
    if (!error) {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b))
      setSelectedBooking(prev => prev?.id === bookingId ? { ...prev, status: 'cancelled' } : prev)
      Notifications.cancelScheduledNotificationAsync(`appt-reminder-${bookingId}`).catch(() => {})
      Notifications.cancelScheduledNotificationAsync(`appt-review-${bookingId}`).catch(() => {})
    }
  }

  async function submitReview(booking) {
    if (!ratingValue) return
    setReviewError(null)

    // Pre-check for instant feedback; the DB trigger is the real boundary and is
    // re-checked below in case the cached term list is stale.
    if (await containsBlockedTerm(ratingComment)) {
      setReviewError(t('contentBlockedTerm', lang))
      return
    }

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
      const key = moderationErrorKey(error)
      setReviewError(key ? t(key, lang) : error.message)
    }
  }

  async function savePresetAvatar(id) {
    const val = `preset:${id}`
    await supabase.from('profiles').update({ avatar_url: val }).eq('id', session.user.id)
    setAvatarUrl(val)
    onAvatarChange?.(val)
    setShowAvatarPicker(false)
  }

  async function pickAndUploadPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setAvatarUploading(true)
    setAvatarError(null)
    try {
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path = `${session.user.id}/avatar.${ext}`
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType, upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${publicUrl}?t=${Date.now()}`
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', session.user.id)
      setAvatarUrl(url)
      onAvatarChange?.(url)
      setShowAvatarPicker(false)
    } catch {
      setAvatarError('Upload failed. Try again.')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function save() {
    if (form.phone.trim() && !/^\d{4,15}$/.test(form.phone.trim())) {
      setError('Enter a valid phone number (digits only, 4–15 characters)')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() ? (selectedCC + form.phone.trim()) : null,
        nationality: form.nationality.trim() || null,
        preferred_language: form.preferred_language,
      })
      .eq('id', session.user.id)
    if (err) setError(err.message)
    else {
      setSaved(true)
      setSavedForm({ ...form })
      setSavedCC(selectedCC)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('delete_own_account')
    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }
    await supabase.auth.signOut()
  }

  const set = key => val => setForm(f => ({ ...f, [key]: val }))

  const hasChanges = savedForm != null && (
    form.full_name !== savedForm.full_name ||
    form.phone !== savedForm.phone ||
    form.nationality !== savedForm.nationality ||
    form.preferred_language !== savedForm.preferred_language ||
    selectedCC !== savedCC
  )

  const initials = form.full_name.trim()
    ? form.full_name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (session.user.email?.[0] ?? t('guestLabel', lang)[0]).toUpperCase()

  const memberId = session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>⚠️</Text>
          <Text style={{ fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
            {t('profileLoadError', lang)}
          </Text>
          <TouchableOpacity onPress={onBack} style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary }}>{t('back', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (legalTab) {
    return <LegalScreen onBack={() => setLegalTab(null)} lang={lang} initialTab={legalTab} />
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
        onOpenTerms={() => setLegalTab('terms')}
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
            <TouchableOpacity onPress={onBack} style={s.backBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              <Text style={s.backText}>{t('back', lang)}</Text>
            </TouchableOpacity>
            <Text style={s.title}>{t('profile', lang)}</Text>
            <TouchableOpacity
              onPress={save}
              disabled={saving || !hasChanges}
              style={(!hasChanges && !saving) && { opacity: 0.35 }}
            >
              <Text style={[s.saveText, saving && { opacity: 0.4 }]}>
                {saved ? t('saved', lang) : saving ? t('saving', lang) : t('save', lang)}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={s.avatarSection}>
            <TouchableOpacity style={s.avatarWrap} onPress={() => { setAvatarError(null); setShowAvatarPicker(true) }} activeOpacity={0.8}>
              <AvatarDisplay avatarUrl={avatarUrl} initials={initials} size={80} textSize={28} />
              <View style={s.avatarEditBadge}>
                <Feather name="edit-2" size={11} color="#fff" />
              </View>
            </TouchableOpacity>
            <Text style={s.emailText}>{session.user.email ?? t('guestLabel', lang)}</Text>
            <View style={s.rolePill}>
              <Text style={s.rolePillText}>{profile?.role ?? 'customer'}</Text>
            </View>
          </View>

          <Modal visible={showAvatarPicker} animationType="slide" transparent onRequestClose={() => setShowAvatarPicker(false)}>
            <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowAvatarPicker(false)} />
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>{t('chooseAvatar', lang)}</Text>

              <TouchableOpacity style={s.uploadBtn} onPress={pickAndUploadPhoto} disabled={avatarUploading}>
                {avatarUploading
                  ? <ActivityIndicator color={colors.primary} />
                  : <>
                      <Feather name="camera" size={18} color={colors.primary} />
                      <Text style={s.uploadBtnText}>{t('uploadPhoto', lang)}</Text>
                    </>
                }
              </TouchableOpacity>

              {avatarError ? <Text style={s.avatarErrText}>{avatarError}</Text> : null}

              <Text style={s.modalSub}>{t('orPickAvatar', lang)}</Text>
              <View style={s.presetGrid}>
                {PRESET_AVATARS.map(av => (
                  <TouchableOpacity key={av.id} style={[s.presetItem, avatarUrl === `preset:${av.id}` && s.presetItemActive]} onPress={() => savePresetAvatar(av.id)}>
                    <View style={[s.presetCircle, { backgroundColor: av.bg }]}>
                      <Text style={s.presetEmoji}>{av.emoji}</Text>
                    </View>
                    {avatarUrl === `preset:${av.id}` && (
                      <View style={s.presetCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Modal>

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

          <TouchableOpacity style={s.accordionHeader} onPress={() => toggleSection(setBookingsOpen)} activeOpacity={0.7}>
            <Text style={s.accordionTitle}>{t('myBookings', lang)}</Text>
            <Ionicons name={bookingsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {bookingsOpen && (() => {
            const now = new Date()
            const upcoming = bookings.filter(b =>
              (b.status === 'pending' || b.status === 'confirmed') && new Date(b.requested_time) > now
            ).sort((a, b) => new Date(a.requested_time) - new Date(b.requested_time))
            const past = bookings.filter(b =>
              b.status === 'completed' || b.status === 'cancelled' || new Date(b.requested_time) <= now
            ).sort((a, b) => new Date(b.requested_time) - new Date(a.requested_time))

            function BookingCard({ b }) {
              const isPending   = b.status === 'pending'
              const isConfirmed = b.status === 'confirmed'
              const isCompleted = b.status === 'completed'
              const statusLabel = isConfirmed ? t('statusConfirmed', lang)
                : isPending ? t('statusPending', lang)
                : isCompleted ? t('statusCompleted', lang)
                : t('statusCancelled', lang)
              const statusStyle     = isConfirmed ? s.pillGreen : isPending ? s.pillOrange : isCompleted ? s.pillGreen : s.pillRed
              const statusTextStyle = isConfirmed ? s.pillTextGreen : isPending ? s.pillTextOrange : isCompleted ? s.pillTextGreen : s.pillTextRed
              return (
                <TouchableOpacity
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
                  {(isConfirmed || isCompleted) && reviewedIds.has(b.id) && (
                    <Text style={s.reviewedBadge}>{t('reviewDone', lang)} ★</Text>
                  )}
                </TouchableOpacity>
              )
            }

            if (bookings.length === 0) {
              return <Text style={s.noBookingsText}>{t('noBookings', lang)}</Text>
            }
            return (
              <View>
                <Text style={s.bookingSectionLabel}>{t('upcoming', lang)}</Text>
                {upcoming.length === 0
                  ? <Text style={s.noBookingsText}>{t('noUpcomingAppt', lang)}</Text>
                  : upcoming.map(b => <BookingCard key={b.id} b={b} />)
                }
                <Text style={[s.bookingSectionLabel, { marginTop: 16 }]}>{t('pastAppt', lang)}</Text>
                {past.length === 0
                  ? <Text style={s.noBookingsText}>{t('noPastAppt', lang)}</Text>
                  : past.map(b => <BookingCard key={b.id} b={b} />)
                }
              </View>
            )
          })()}

          <TouchableOpacity style={s.accordionHeader} onPress={() => toggleSection(setPersonalOpen)} activeOpacity={0.7}>
            <Text style={s.accordionTitle}>{t('personalInfo', lang)}</Text>
            <Ionicons name={personalOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {personalOpen && (
            <View>
              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('fullName', lang)}</Text>
                <TextInput
                  style={s.input}
                  value={form.full_name}
                  onChangeText={set('full_name')}
                  placeholder="Your full name"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('phone', lang)}</Text>
                <View style={s.phoneRow}>
                  <TouchableOpacity style={s.ccBtn} onPress={() => setShowCCPicker(true)}>
                    <Text style={s.ccBtnText}>{selectedCC}</Text>
                    <Feather name="chevron-down" size={13} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TextInput
                    style={s.phoneInput}
                    value={form.phone}
                    onChangeText={set('phone')}
                    placeholder="555 000 00 00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('nationality', lang)}</Text>
                <TouchableOpacity style={s.pickerBtn} onPress={() => setShowNatPicker(true)} activeOpacity={0.7}>
                  <Text style={[s.pickerBtnText, !form.nationality && s.pickerBtnPlaceholder]}>
                    {form.nationality ? getNatLabel(form.nationality, lang) : t('selectNationality', lang)}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {error && <Text style={s.errorText}>{error}</Text>}
            </View>
          )}

          {blocks.length > 0 && (
            <View style={s.blockedSection}>
              <Text style={s.sectionTitle}>{t('blockedReviewers', lang)}</Text>
              {blocks.map(b => (
                <View key={b.blocked_id} style={s.blockedRow}>
                  <Text style={s.blockedLabel}>
                    {t('blockedOn', lang).replace('{d}', new Date(b.created_at).toLocaleDateString([], { dateStyle: 'medium' }))}
                  </Text>
                  <TouchableOpacity style={s.unblockBtn} onPress={() => unblock(b.blocked_id)}>
                    <Text style={s.unblockText}>{t('unblock', lang)}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={s.legalRow}>
            <TouchableOpacity onPress={() => setLegalTab('privacy')}>
              <Text style={s.legalLink}>{t('privacyPolicy', lang)}</Text>
            </TouchableOpacity>
            <Text style={s.legalDot}>·</Text>
            <TouchableOpacity onPress={() => setLegalTab('terms')}>
              <Text style={s.legalLink}>{t('termsOfService', lang)}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={s.signOutText}>{t('signOut', lang)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.deleteAccountBtn} onPress={() => { setDeleteError(null); setDeleteConfirmVisible(true) }}>
            <Text style={s.deleteAccountText}>{t('deleteAccount', lang)}</Text>
          </TouchableOpacity>

          <Modal visible={deleteConfirmVisible} animationType="fade" transparent onRequestClose={() => setDeleteConfirmVisible(false)}>
            <View style={s.deleteModalBackdrop}>
              <View style={s.deleteModalCard}>
                <Text style={s.deleteModalTitle}>{t('deleteAccountTitle', lang)}</Text>
                <Text style={s.deleteModalWarning}>{t('deleteAccountWarning', lang)}</Text>
                {deleteError ? <Text style={s.deleteModalError}>{deleteError}</Text> : null}
                <TouchableOpacity
                  style={[s.deleteModalConfirmBtn, deleting && { opacity: 0.5 }]}
                  onPress={deleteAccount}
                  disabled={deleting}
                >
                  {deleting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.deleteModalConfirmText}>{t('deleteAccountConfirmBtn', lang)}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={s.deleteModalCancelBtn} onPress={() => setDeleteConfirmVisible(false)} disabled={deleting}>
                  <Text style={s.deleteModalCancelText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <Modal visible={showCCPicker} animationType="slide" transparent onRequestClose={() => setShowCCPicker(false)}>
            <View style={s.ccModalBackdrop}>
              <View style={s.ccModalCard}>
                <View style={s.ccModalHeader}>
                  <Text style={s.ccModalTitle}>Country Code</Text>
                  <TouchableOpacity onPress={() => setShowCCPicker(false)}>
                    <Feather name="x" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={COUNTRY_CODES}
                  keyExtractor={item => item.code}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[s.ccItem, selectedCC === item.code && s.ccItemActive]}
                      onPress={() => { setSelectedCC(item.code); setShowCCPicker(false) }}
                    >
                      <Text style={[s.ccItemCode, selectedCC === item.code && s.ccItemCodeActive]}>{item.code}</Text>
                      <Text style={[s.ccItemLabel, selectedCC === item.code && s.ccItemLabelActive]}>{item.label}</Text>
                      {selectedCC === item.code && <Feather name="check" size={15} color={colors.primary} />}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </View>
          </Modal>

          <Modal visible={showNatPicker} animationType="slide" transparent onRequestClose={() => setShowNatPicker(false)}>
            <View style={s.ccModalBackdrop}>
              <View style={s.ccModalCard}>
                <View style={s.ccModalHeader}>
                  <Text style={s.ccModalTitle}>{t('nationality', lang)}</Text>
                  <TouchableOpacity onPress={() => setShowNatPicker(false)}>
                    <Feather name="x" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={NATIONALITIES}
                  keyExtractor={item => item}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[s.ccItem, form.nationality === item && s.ccItemActive]}
                      onPress={() => { set('nationality')(item); setShowNatPicker(false) }}
                    >
                      <Text style={[s.ccItemLabel, form.nationality === item && s.ccItemLabelActive]}>{getNatLabel(item, lang)}</Text>
                      {form.nationality === item && <Feather name="check" size={15} color={colors.primary} />}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </View>
          </Modal>
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
  backBtn:          { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  saveText:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },

  avatarSection:    { alignItems: 'center', marginBottom: 24 },
  avatarWrap:       { marginBottom: 12, position: 'relative' },
  avatarEditBadge:  { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.bg },
  emailText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 8 },
  rolePill:         { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: colors.primaryLight },
  rolePillText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'capitalize' },

  memberCard:       { backgroundColor: colors.primary, borderRadius: 20, padding: 20, marginBottom: 28, ...shadow },
  memberCardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  memberLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  memberId:         { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 2 },
  memberSub:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)' },
  qrPlaceholder:    { width: 48, height: 48, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  qrIcon:           { fontSize: 24, color: '#fff' },

  sectionTitle:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14, marginTop: 4 },
  accordionHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 },
  accordionTitle:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldGroup:       { marginBottom: 16 },
  fieldLabel:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:            { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },
  pickerBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, backgroundColor: colors.surface },
  pickerBtnText:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  pickerBtnPlaceholder: { color: colors.border },

  noBookingsText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 12, marginTop: 2 },
  bookingSectionLabel:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  bookingCard:      { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
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
  cancelLateBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: colors.cardBg, borderRadius: 8, padding: 10 },
  cancelLateText:   { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },
  reviewedBadge:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.success, marginTop: 8 },
  starsRow:         { flexDirection: 'row', gap: 8 },
  star:             { fontSize: 28, color: colors.border },
  starActive:       { color: '#F5A623' },
  commentInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  submitReviewBtn:  { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  submitReviewText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  reviewErrorText:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger },
  termsNotice:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 16, marginTop: 10, textAlign: 'center' },
  termsNoticeLink:  { fontFamily: 'Inter_700Bold', color: colors.primary, textDecorationLine: 'underline' },
  blockedSection:   { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, marginTop: 8, marginBottom: 16 },
  blockedRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  blockedLabel:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  unblockBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primaryLight },
  unblockText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  errorText:        { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12 },
  legalRow:         { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 16 },
  legalLink:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textDecorationLine: 'underline' },
  legalDot:         { fontSize: 13, color: colors.textSecondary },
  signOutBtn:       { borderWidth: 1.5, borderColor: colors.danger, borderRadius: 12, padding: 15, alignItems: 'center' },
  signOutText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.danger },
  deleteAccountBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 12 },
  deleteAccountText:{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textDecorationLine: 'underline' },
  deleteModalBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  deleteModalCard:        { backgroundColor: colors.bg, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  deleteModalTitle:       { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12, textAlign: 'center' },
  deleteModalWarning:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  deleteModalError:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, textAlign: 'center', marginBottom: 12 },
  deleteModalConfirmBtn:  { backgroundColor: colors.danger, borderRadius: 12, padding: 15, alignItems: 'center', marginBottom: 10 },
  deleteModalConfirmText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  deleteModalCancelBtn:   { alignItems: 'center', padding: 12 },
  deleteModalCancelText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },

  // Phone + country code
  phoneRow:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' },
  ccBtn:            { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 14, borderRightWidth: 1.5, borderRightColor: colors.border },
  ccBtnText:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  phoneInput:       { flex: 1, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  ccModalBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  ccModalCard:      { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '70%' },
  ccModalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  ccModalTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  ccItem:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  ccItemActive:     { backgroundColor: colors.primaryLight, marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 8 },
  ccItemCode:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, width: 52 },
  ccItemCodeActive: { color: colors.primary },
  ccItemLabel:      { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  ccItemLabelActive:{ color: colors.textPrimary },

  // Avatar picker modal
  modalBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet:       { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 20 },
  modalTitle:       { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
  modalSub:         { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 14, textAlign: 'center' },
  uploadBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 14, padding: 14 },
  uploadBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  avatarErrText:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, textAlign: 'center', marginTop: 8 },
  presetGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  presetItem:       { position: 'relative' },
  presetItemActive: {},
  presetCircle:     { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  presetEmoji:      { fontSize: 30 },
  presetCheck:      { position: 'absolute', bottom: -2, right: -2, backgroundColor: colors.bg, borderRadius: 10 },

  // Appointment detail view
  detailFacilityCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4, backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, ...shadow },
  detailTypeIcon:      { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  detailTypeIconText:  { fontSize: 24 },
  detailFacilityName:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  typeBadgeSmall:      { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  typeBadgeSmallText:  { fontSize: 11, fontFamily: 'Inter_700Bold' },
  detailInfoRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailInfoIcon:      { width: 22, textAlign: 'center' },
  detailInfoText:      { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  detailInfoBtn:       { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  detailInfoBtnText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  detailDivider:       { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  detailSectionLabel:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  detailApptTime:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  detailReviewSection: { marginTop: 24, gap: 12 },
  detailReviewComment: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, fontStyle: 'italic' },
})
