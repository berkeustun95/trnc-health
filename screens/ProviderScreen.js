import { useState, useEffect } from 'react'
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, ScrollView, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import QuizReviewScreen from './quiz/QuizReviewScreen'
import { SPECIALTIES_BY_TYPE } from '../constants/specialties'

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

async function sendPushNotification(token, title, body) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    })
  } catch { /* non-critical */ }
}

async function recordNotification(userId, title, body) {
  try {
    await supabase.from('notifications').insert({ user_id: userId, title, body })
  } catch { /* non-critical */ }
}

export default function ProviderScreen({ session, lang = 'English', facility, trialDaysLeft, onFacilityUpdated }) {
  const isPharmacy   = facility.type === 'pharmacy'
  const showQuizTabs = isPharmacy && (facility.membership_tier === 'pro' || facility.is_quiz_partner)

  const [tab, setTab] = useState(isPharmacy ? 'qa' : 'requests')
  const [appointments, setAppointments] = useState([])
  const [pastConfirmed, setPastConfirmed] = useState([])
  const [noShowLoading, setNoShowLoading] = useState(null)
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(false)
  const [replyTexts, setReplyTexts] = useState({})
  const [submittingReply, setSubmittingReply] = useState(null)
  const [quizReviews, setQuizReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [activeReview, setActiveReview] = useState(null)
  const [archivedReviews, setArchivedReviews] = useState([])
  const [loadingArchive, setLoadingArchive] = useState(false)
  const [activeArchive, setActiveArchive] = useState(null)
  const [stats, setStats] = useState(null)
  const [editPhone, setEditPhone] = useState(facility.phone ?? '')
  const [editAddress, setEditAddress] = useState(facility.address ?? '')
  const [editHours, setEditHours] = useState(facility.opening_hours ?? '')
  const [editDescription, setEditDescription] = useState(facility.description ?? '')
  const [editLanguages, setEditLanguages] = useState(Array.isArray(facility.languages) ? facility.languages : [])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [coverUrl, setCoverUrl] = useState(facility.cover_image_url ?? null)
  const [logoUrl, setLogoUrl] = useState(facility.logo_url ?? null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [imageError, setImageError] = useState(null)
  const [specialty, setSpecialty] = useState(
    Array.isArray(facility.specialty) ? facility.specialty : (facility.specialty ? [facility.specialty] : [])
  )

  useEffect(() => {
    async function load() {
      if (!isPharmacy) {
        const { data, error } = await supabase
          .from('appointments')
          .select('id, requested_time, customer_id')
          .eq('facility_id', facility.id)
          .eq('status', 'pending')
          .order('requested_time')
        if (!error) setAppointments(data)

        const { data: past } = await supabase
          .from('appointments')
          .select('id, requested_time, customer_id')
          .eq('facility_id', facility.id)
          .eq('status', 'confirmed')
          .lt('requested_time', new Date().toISOString())
          .order('requested_time', { ascending: false })
          .limit(20)
        if (past) setPastConfirmed(past)
      }
      setLoading(false)
    }
    load()
    loadQuestions()
    loadStats()
    if (showQuizTabs) { loadQuizReviews(); loadArchivedReviews() }
  }, [])

  async function loadStats() {
    const [{ data: apptData }, { data: quizData }] = await Promise.all([
      supabase.from('appointments').select('status').eq('facility_id', facility.id),
      supabase.from('quiz_submissions').select('status').eq('assigned_facility_id', facility.id),
    ])
    setStats({
      appt: {
        pending:   apptData?.filter(a => a.status === 'pending').length   ?? 0,
        confirmed: apptData?.filter(a => a.status === 'confirmed').length ?? 0,
        cancelled: apptData?.filter(a => a.status === 'cancelled').length ?? 0,
      },
      quiz: {
        pending:  quizData?.filter(q => q.status === 'pending').length  ?? 0,
        approved: quizData?.filter(q => q.status === 'approved').length ?? 0,
        rejected: quizData?.filter(q => q.status === 'rejected').length ?? 0,
      },
    })
  }

  async function loadArchivedReviews() {
    setLoadingArchive(true)
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, customer_id, answers, generated_result, final_result, reviewed_at, created_at')
      .eq('assigned_facility_id', facility.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
    if (data) setArchivedReviews(data)
    setLoadingArchive(false)
  }

  async function loadQuizReviews() {
    setLoadingReviews(true)
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, customer_id, answers, generated_result, created_at')
      .eq('assigned_facility_id', facility.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (data) setQuizReviews(data)
    setLoadingReviews(false)
  }

  async function loadQuestions() {
    setLoadingQ(true)
    const { data } = await supabase
      .from('questions')
      .select('id, body, created_at, answers(id, body, created_at)')
      .eq('facility_id', facility.id)
      .order('created_at', { ascending: false })
    if (data) setQuestions(data)
    setLoadingQ(false)
  }

  async function submitReply(questionId) {
    const body = replyTexts[questionId]?.trim()
    if (!body) return
    setSubmittingReply(questionId)
    const { error } = await supabase.from('answers').insert({
      question_id: questionId,
      provider_id: session.user.id,
      body,
    })
    if (!error) {
      setReplyTexts(prev => ({ ...prev, [questionId]: '' }))
      await loadQuestions()
    }
    setSubmittingReply(null)
  }

  async function updateStatus(id, status, customerId) {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id)
    if (!error) {
      const { data: profile } = await supabase
        .from('profiles').select('push_token, preferred_language').eq('id', customerId).maybeSingle()
      if (profile) {
        const confirmed = status === 'confirmed'
        const cLang = profile.preferred_language || 'English'
        const title = confirmed ? t('notifApptConfirmedTitle', cLang) : t('notifApptDeclinedTitle', cLang)
        const body = confirmed
          ? t('notifApptConfirmedBody', cLang).replace('{name}', facility.name)
          : t('notifApptDeclinedBody', cLang).replace('{name}', facility.name)
        if (profile.push_token) await sendPushNotification(profile.push_token, title, body)
        await recordNotification(customerId, title, body)
      }
      setAppointments(prev => prev.filter(a => a.id !== id))
    }
  }

  async function markNoShow(appointmentId, customerId) {
    setNoShowLoading(appointmentId)
    const { error } = await supabase.rpc('record_no_show', { p_appointment_id: appointmentId })
    if (!error) {
      setPastConfirmed(prev => prev.filter(a => a.id !== appointmentId))
    }
    setNoShowLoading(null)
  }

  async function saveSpecialty(val) {
    const next = specialty.includes(val) ? specialty.filter(s => s !== val) : [...specialty, val]
    setSpecialty(next)
    await supabase.from('facilities').update({ specialty: next.length ? next : null }).eq('id', facility.id)
    if (onFacilityUpdated) onFacilityUpdated()
  }

  async function pickAndUploadImage(type) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { setImageError('Photo library permission denied'); return }
    const isCover = type === 'cover'
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: isCover ? [16, 9] : [1, 1],
      quality: 0.7,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    if (isCover) setUploadingCover(true); else setUploadingLogo(true)
    setImageError(null)
    try {
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path = `${facility.id}/${type}.${ext}`
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: uploadError } = await supabase.storage
        .from('facility-images')
        .upload(path, decode(asset.base64), { contentType, upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('facility-images').getPublicUrl(path)
      const url = `${publicUrl}?t=${Date.now()}`
      const field = isCover ? 'cover_image_url' : 'logo_url'
      await supabase.from('facilities').update({ [field]: url }).eq('id', facility.id)
      if (isCover) setCoverUrl(url); else setLogoUrl(url)
      if (onFacilityUpdated) onFacilityUpdated()
    } catch (err) {
      console.error('Image upload error:', err)
      setImageError('Upload failed. Try again.')
    } finally {
      if (isCover) setUploadingCover(false); else setUploadingLogo(false)
    }
  }

  async function saveListing() {
    setSaving(true)
    const { error } = await supabase
      .from('facilities')
      .update({
        phone: editPhone.trim() || null,
        address: editAddress.trim() || null,
        opening_hours: editHours.trim() || null,
        description: editDescription.trim() || null,
        languages: editLanguages.length > 0 ? editLanguages : null,
      })
      .eq('id', facility.id)
    setSaving(false)
    if (!error) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      if (onFacilityUpdated) onFacilityUpdated()
    }
  }

  if (activeReview) {
    return (
      <QuizReviewScreen
        submission={activeReview}
        onApproved={async () => {
          const customerId = activeReview.customer_id
          if (customerId) {
            const { data: customerProfile } = await supabase
              .from('profiles').select('push_token, preferred_language').eq('id', customerId).maybeSingle()
            if (customerProfile) {
              const cLang = customerProfile.preferred_language || 'English'
              const title = t('notifQuizTitle', cLang)
              const body = t('notifQuizBody', cLang).replace('{name}', facility.name)
              if (customerProfile.push_token) await sendPushNotification(customerProfile.push_token, title, body)
              await recordNotification(customerId, title, body)
            }
          }
          setActiveReview(null)
          loadQuizReviews()
          loadArchivedReviews()
        }}
        onBack={() => setActiveReview(null)}
      />
    )
  }

  if (activeArchive) {
    return (
      <QuizReviewScreen submission={activeArchive} onBack={() => setActiveArchive(null)} readOnly />
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('../assets/adalogo.png')} style={styles.headerIcon} resizeMode="contain" />
            <View>
              <Text style={styles.facilityTag} numberOfLines={1}>{facility.name}</Text>
              <View style={facility.membership_tier === 'pro' ? styles.proBadge : styles.basicBadge}>
                <Text style={facility.membership_tier === 'pro' ? styles.proBadgeText : styles.basicBadgeText}>
                  {facility.membership_tier === 'pro' ? 'PRO' : 'BASIC'}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
        </View>

        {trialDaysLeft !== null && trialDaysLeft !== undefined && (
          <TouchableOpacity
            style={styles.trialBanner}
            onPress={() => Linking.openURL('mailto:berke.ustun95@gmail.com?subject=ADA%20Provider%20Activation')}
            activeOpacity={0.8}
          >
            <Text style={styles.trialText}>
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left in your free trial — tap to contact us
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.tabs}>
          {!isPharmacy && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'requests' && styles.tabBtnActive]}
              onPress={() => setTab('requests')}
            >
              <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>{t('tabRequests', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'qa' && styles.tabBtnActive]}
            onPress={() => setTab('qa')}
          >
            <Text style={[styles.tabText, tab === 'qa' && styles.tabTextActive]}>{t('tabQA', lang)}</Text>
          </TouchableOpacity>
          {showQuizTabs && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'quiz' && styles.tabBtnActive]}
              onPress={() => setTab('quiz')}
            >
              <View style={styles.tabWithBadge}>
                <Text style={[styles.tabText, tab === 'quiz' && styles.tabTextActive]}>{t('tabReviews', lang)}</Text>
                {quizReviews.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{quizReviews.length}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
          {showQuizTabs && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'archive' && styles.tabBtnActive]}
              onPress={() => setTab('archive')}
            >
              <Text style={[styles.tabText, tab === 'archive' && styles.tabTextActive]}>{t('tabArchive', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'stats' && styles.tabBtnActive]}
            onPress={() => setTab('stats')}
          >
            <Text style={[styles.tabText, tab === 'stats' && styles.tabTextActive]}>{t('tabStats', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'profile' && styles.tabBtnActive]}
            onPress={() => setTab('profile')}
          >
            <Text style={[styles.tabText, tab === 'profile' && styles.tabTextActive]}>{t('tabProfile', lang)}</Text>
          </TouchableOpacity>
        </View>

        {tab === 'profile' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Cover Photo</Text>
              <TouchableOpacity style={styles.coverUploadArea} onPress={() => pickAndUploadImage('cover')} activeOpacity={0.8}>
                {coverUrl
                  ? <Image source={{ uri: coverUrl }} style={styles.coverPreview} resizeMode="cover" />
                  : <View style={styles.uploadPlaceholder}>
                      <Feather name="camera" size={22} color={colors.textSecondary} />
                      <Text style={styles.uploadHint}>Tap to add cover photo</Text>
                    </View>
                }
                {uploadingCover && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />}
                {coverUrl && (
                  <View style={styles.uploadEditBadge}>
                    <Feather name="edit-2" size={11} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Logo</Text>
              <TouchableOpacity style={styles.logoUploadArea} onPress={() => pickAndUploadImage('logo')} activeOpacity={0.8}>
                {logoUrl
                  ? <Image source={{ uri: logoUrl }} style={styles.logoPreview} resizeMode="cover" />
                  : <View style={styles.uploadPlaceholder}>
                      <Feather name="image" size={18} color={colors.textSecondary} />
                      <Text style={styles.uploadHint}>Tap to add logo</Text>
                    </View>
                }
                {uploadingLogo && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />}
                {logoUrl && (
                  <View style={styles.uploadEditBadge}>
                    <Feather name="edit-2" size={11} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              {imageError && <Text style={styles.imageErrorText}>{imageError}</Text>}
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>{t('phone', lang)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder="(0392) 000 00 00"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
              />
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('labelAddress', lang)}</Text>
              <TextInput
                style={[styles.fieldInput, { minHeight: 64 }]}
                value={editAddress}
                onChangeText={setEditAddress}
                placeholder="Street, district, city"
                placeholderTextColor={colors.textSecondary}
                multiline
              />
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('labelHours', lang)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={editHours}
                onChangeText={setEditHours}
                placeholder={t('hoursHint', lang)}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
              />

              {SPECIALTIES_BY_TYPE[facility.type] && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Specialty</Text>
                  <View style={styles.specialtyGrid}>
                    {SPECIALTIES_BY_TYPE[facility.type].map(sp => (
                      <TouchableOpacity
                        key={sp}
                        style={[styles.specialtyChip, specialty.includes(sp) && styles.specialtyChipActive]}
                        onPress={() => saveSpecialty(sp)}
                      >
                        <Text style={[styles.specialtyChipText, specialty.includes(sp) && styles.specialtyChipTextActive]}>
                          {sp}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>About / Description</Text>
              <TextInput
                style={[styles.fieldInput, { minHeight: 80 }]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Brief description visible to customers…"
                placeholderTextColor={colors.textSecondary}
                multiline
                textAlignVertical="top"
              />

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>{t('languagesSpoken', lang)}</Text>
              <View style={styles.specialtyGrid}>
                {['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'German', 'French', 'Persian'].map(l => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.specialtyChip, editLanguages.includes(l) && styles.specialtyChipActive]}
                    onPress={() => setEditLanguages(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}
                  >
                    <Text style={[styles.specialtyChipText, editLanguages.includes(l) && styles.specialtyChipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, (saving || saveSuccess) && { opacity: 0.7 }]}
                onPress={saveListing}
                disabled={saving || saveSuccess}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>{saveSuccess ? t('saved', lang) : t('save', lang)}</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : tab === 'archive' ? (
          loadingArchive ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : archivedReviews.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Feather name="archive" size={28} color={colors.textSecondary} /></View>
              <Text style={styles.emptyTitle}>{t('noApprovedReviews', lang)}</Text>
              <Text style={styles.emptySub}>{t('approvedReviewsHere', lang)}</Text>
            </View>
          ) : (
            <FlatList
              data={archivedReviews}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, styles.reviewCard]} onPress={() => setActiveArchive(item)} activeOpacity={0.7}>
                  <View style={styles.reviewCardLeft}>
                    <View style={[styles.reviewIcon, { backgroundColor: colors.successLight }]}>
                      <Feather name="check" size={16} color={colors.success} />
                    </View>
                    <View>
                      <Text style={styles.reviewTitle}>{t('approvedReview', lang)}</Text>
                      <Text style={styles.reviewTime}>{new Date(item.reviewed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                      <Text style={[styles.reviewCount, { color: colors.success }]}>
                        {t('supplementsApproved', lang).replace('{n}', item.final_result?.stack?.length ?? 0)}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
            />
          )
        ) : tab === 'quiz' ? (
          loadingReviews ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : quizReviews.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Ionicons name="flask-outline" size={28} color={colors.textSecondary} /></View>
              <Text style={styles.emptyTitle}>{t('noPendingReviews', lang)}</Text>
              <Text style={styles.emptySub}>{t('quizRequestsHere', lang)}</Text>
            </View>
          ) : (
            <FlatList
              data={quizReviews}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, styles.reviewCard]} onPress={() => setActiveReview(item)} activeOpacity={0.7}>
                  <View style={styles.reviewCardLeft}>
                    <View style={styles.reviewIcon}>
                      <Ionicons name="flask-outline" size={20} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={styles.reviewTitle}>{t('quizReview', lang)}</Text>
                      <Text style={styles.reviewMemberId}>#{item.customer_id?.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
                      <Text style={styles.reviewTime}>{new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</Text>
                      <Text style={styles.reviewCount}>{t('supplementsRecommended', lang).replace('{n}', item.generated_result?.stack?.length ?? 0)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
            />
          )
        ) : tab === 'stats' ? (
          !stats ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {!isPharmacy && (
                <>
                  <Text style={styles.sectionTitle}>{t('statAppointments', lang)}</Text>
                  <View style={styles.statRow}>
                    <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                      <Text style={[styles.statNum, { color: colors.accent }]}>{stats.appt.pending}</Text>
                      <Text style={styles.statLabel}>{t('statusPending', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                      <Text style={[styles.statNum, { color: colors.success }]}>{stats.appt.confirmed}</Text>
                      <Text style={styles.statLabel}>{t('statusConfirmed', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.dangerLight }]}>
                      <Text style={[styles.statNum, { color: colors.danger }]}>{stats.appt.cancelled}</Text>
                      <Text style={styles.statLabel}>{t('statusCancelled', lang)}</Text>
                    </View>
                  </View>
                </>
              )}

              <Text style={[styles.sectionTitle, !isPharmacy && { marginTop: 24 }]}>{t('tabQA', lang)}</Text>
              <View style={styles.statRow}>
                <View style={[styles.statTile, { backgroundColor: colors.cardBg }]}>
                  <Text style={[styles.statNum, { color: colors.textPrimary }]}>{questions.length}</Text>
                  <Text style={styles.statLabel}>{t('statTotal', lang)}</Text>
                </View>
                <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                  <Text style={[styles.statNum, { color: colors.success }]}>{questions.filter(q => q.answers?.length > 0).length}</Text>
                  <Text style={styles.statLabel}>{t('statAnswered', lang)}</Text>
                </View>
                <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                  <Text style={[styles.statNum, { color: colors.accent }]}>{questions.filter(q => !q.answers?.length).length}</Text>
                  <Text style={styles.statLabel}>{t('statUnanswered', lang)}</Text>
                </View>
              </View>

              {showQuizTabs && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('statQuizReviews', lang)}</Text>
                  <View style={styles.statRow}>
                    <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                      <Text style={[styles.statNum, { color: colors.accent }]}>{stats.quiz.pending}</Text>
                      <Text style={styles.statLabel}>{t('statusPending', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                      <Text style={[styles.statNum, { color: colors.success }]}>{stats.quiz.approved}</Text>
                      <Text style={styles.statLabel}>{t('statApproved', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.dangerLight }]}>
                      <Text style={[styles.statNum, { color: colors.danger }]}>{stats.quiz.rejected}</Text>
                      <Text style={styles.statLabel}>{t('statRejected', lang)}</Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          )
        ) : tab === 'requests' ? (
          appointments.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Feather name="check-circle" size={28} color={colors.success} /></View>
              <Text style={styles.emptyTitle}>{t('allClear', lang)}</Text>
              <Text style={styles.emptySub}>{t('noPendingRequests', lang)}</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {appointments.map(item => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.timeLabel}>{t('requestedTime', lang)}</Text>
                  <Text style={styles.timeValue}>
                    {new Date(item.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.confirmBtn} onPress={() => updateStatus(item.id, 'confirmed', item.customer_id)}>
                      <Text style={styles.confirmText}>{t('confirm', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineBtn} onPress={() => updateStatus(item.id, 'cancelled', item.customer_id)}>
                      <Text style={styles.declineText}>{t('decline', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {pastConfirmed.length > 0 && (
                <>
                  <Text style={styles.noShowSectionLabel}>PAST — MARK NO-SHOWS</Text>
                  {pastConfirmed.map(item => (
                    <View key={item.id} style={styles.card}>
                      <Text style={styles.timeLabel}>{t('requestedTime', lang)}</Text>
                      <Text style={styles.timeValue}>
                        {new Date(item.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </Text>
                      <TouchableOpacity
                        style={[styles.noShowBtn, noShowLoading === item.id && { opacity: 0.6 }]}
                        onPress={() => markNoShow(item.id, item.customer_id)}
                        disabled={noShowLoading === item.id}
                      >
                        {noShowLoading === item.id
                          ? <ActivityIndicator size="small" color={colors.danger} />
                          : <Text style={styles.noShowText}>{t('noShowBtn', lang)}</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          )
        ) : (
          loadingQ ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {questions.length === 0 ? (
                <View style={styles.empty}>
                  <View style={styles.emptyIconWrap}><Ionicons name="chatbubble-outline" size={28} color={colors.textSecondary} /></View>
                  <Text style={styles.emptyTitle}>{t('noQuestions', lang)}</Text>
                  <Text style={styles.emptySub}>{t('questionsFromCustomers', lang)}</Text>
                </View>
              ) : (
                questions.map(q => (
                  <View key={q.id} style={styles.card}>
                    <Text style={styles.qBody}>{q.body}</Text>
                    {q.answers && q.answers.length > 0 ? (
                      <View style={styles.answerBlock}>
                        <Text style={styles.answerLabel}>{t('yourAnswer', lang)}</Text>
                        <Text style={styles.answerBody}>{q.answers[0].body}</Text>
                      </View>
                    ) : (
                      <View style={styles.replyRow}>
                        <TextInput
                          style={styles.replyInput}
                          value={replyTexts[q.id] ?? ''}
                          onChangeText={val => setReplyTexts(prev => ({ ...prev, [q.id]: val }))}
                          placeholder={t('writeYourAnswer', lang)}
                          placeholderTextColor={colors.textSecondary}
                          multiline
                        />
                        <TouchableOpacity
                          style={[styles.replyBtn, (!replyTexts[q.id]?.trim() || submittingReply === q.id) && { opacity: 0.4 }]}
                          onPress={() => submitReply(q.id)}
                          disabled={!replyTexts[q.id]?.trim() || submittingReply === q.id}
                        >
                          {submittingReply === q.id
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.replyBtnText}>{t('send', lang)}</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          )
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },
  container:      { flex: 1, paddingHorizontal: 16 },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 12 },
  headerLeft:     { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 10 },
  headerIcon:     { width: 36, height: 36, borderRadius: 8, flexShrink: 0 },
  facilityTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  facilityTag:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  proBadge:       { backgroundColor: colors.primary, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  proBadgeText:   { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
  basicBadge:     { backgroundColor: '#F3F4F6', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  basicBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#6B7280', letterSpacing: 0.5 },
  signOutBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  trialBanner:    { backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 12 },
  trialText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#92400E', textAlign: 'center' },
  sectionTitle:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  listContent:    { paddingBottom: 32 },
  card:           { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, ...shadow },
  timeLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  timeValue:      { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 14 },
  actions:        { flexDirection: 'row', gap: 10 },
  confirmBtn:     { flex: 1, backgroundColor: colors.successLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.success },
  declineBtn:          { flex: 1, backgroundColor: colors.dangerLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  declineText:         { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.danger },
  noShowSectionLabel:  { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, marginTop: 24, marginBottom: 8 },
  noShowBtn:           { alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.dangerLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 80, alignItems: 'center' },
  noShowText:          { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  tabs:           { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, marginBottom: 16 },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive:   { backgroundColor: colors.surface, ...shadow },
  tabText:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  tabWithBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabBadge:       { backgroundColor: colors.danger, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  tabBadgeText:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  reviewCard:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  reviewIconText: { fontSize: 20 },
  reviewTitle:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  reviewMemberId: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, marginTop: 2 },
  reviewTime:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  reviewCount:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 2 },
  reviewArrow:    { fontSize: 18, color: colors.primary, fontFamily: 'Inter_700Bold' },
  qBody:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 12, lineHeight: 20 },
  answerBlock:    { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10 },
  answerLabel:    { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  answerBody:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  replyRow:       { gap: 8 },
  replyInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  replyBtn:       { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  replyBtnText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  statRow:        { flexDirection: 'row', gap: 10, marginBottom: 4 },
  statTile:       { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  statNum:        { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  statLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
  fieldLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  fieldInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface },
  saveBtn:        { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  coverUploadArea:  { height: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  coverPreview:     { width: '100%', height: '100%' },
  logoUploadArea:   { width: 90, height: 90, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  logoPreview:      { width: '100%', height: '100%' },
  uploadPlaceholder: { alignItems: 'center', gap: 8 },
  uploadHint:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  uploadEditBadge:  { position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  imageErrorText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 8 },
  specialtyGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  specialtyChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  specialtyChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  specialtyChipText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  specialtyChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyIconWrap:  { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...shadow },
  emptyTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
})
