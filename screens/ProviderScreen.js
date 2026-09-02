import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, ScrollView, Linking, Modal, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import HoursPicker from '../components/HoursPicker'
import MapPinPicker from '../components/MapPinPicker'
import FacilityPhotoManager from '../components/FacilityPhotoManager'
import ContentReportMenu from '../components/ContentReportMenu'
import ListingHiddenBanner from '../components/ListingHiddenBanner'
import { containsBlockedTerm, moderationErrorKey } from '../utils/profanity'
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

const STATUS_COLORS = {
  pending:   { bg: '#FFF0EB', text: '#FF8552' },
  confirmed: { bg: '#E6F4F4', text: '#0E7C7B' },
  completed: { bg: '#E6F5ED', text: '#2E9E5B' },
  cancelled: { bg: '#FAEAEC', text: '#D1495B' },
}

export default function ProviderScreen({ session, lang = 'English', facility, trialDaysLeft, onFacilityUpdated }) {
  const [tab, setTab] = useState('qa')
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(false)
  const [replyTexts, setReplyTexts] = useState({})
  const [submittingReply, setSubmittingReply] = useState(null)
  const [editPhone, setEditPhone] = useState(facility.phone ?? '')
  const [editAddress, setEditAddress] = useState(facility.address ?? '')
  const [editHours, setEditHours] = useState(facility.opening_hours ?? '')
  const [editDescription, setEditDescription] = useState(facility.description ?? '')
  const [editLanguages, setEditLanguages] = useState(
    Array.isArray(facility.languages)
      ? facility.languages
      : typeof facility.languages === 'string' && facility.languages
        ? facility.languages.split(',').map(l => l.trim()).filter(Boolean)
        : []
  )
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [specialty, setSpecialty] = useState(
    Array.isArray(facility.specialty) ? facility.specialty : (facility.specialty ? [facility.specialty] : [])
  )
  const [facilityLat, setFacilityLat]   = useState(facility.latitude ?? null)
  const [facilityLng, setFacilityLng]   = useState(facility.longitude ?? null)
  const [showMapPicker, setShowMapPicker] = useState(false)

  const [credentials, setCredentials]         = useState([])
  const [credModalVisible, setCredModalVisible] = useState(false)
  const [newCred, setNewCred]                 = useState({ cred_type: 'diploma', title: '', institution: '', year: '' })
  const [savingCred, setSavingCred]           = useState(false)
  const [credImageUri, setCredImageUri]       = useState(null)
  const [credImageBase64, setCredImageBase64] = useState(null)
  const [uploadingCredDoc, setUploadingCredDoc] = useState(false)
  const [submissionHistory, setSubmissionHistory] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingAccount, setDeletingAccount]     = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(false)
    }
    load()
    loadQuestions()
    loadCredentials()
    loadSubmissionHistory()
  }, [])

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

    if (await containsBlockedTerm(body)) {
      Alert.alert('', t('contentBlockedTerm', lang))
      setSubmittingReply(null)
      return
    }

    const { error } = await supabase.from('answers').insert({
      question_id: questionId,
      provider_id: session.user.id,
      body,
    })
    if (!error) {
      setReplyTexts(prev => ({ ...prev, [questionId]: '' }))
      await loadQuestions()
    } else {
      const key = moderationErrorKey(error, { contentType: 'answer', text: body })
      if (key) Alert.alert('', t(key, lang))
    }
    setSubmittingReply(null)
  }

  async function saveSpecialty(val) {
    const next = specialty.includes(val) ? specialty.filter(s => s !== val) : [...specialty, val]
    setSpecialty(next)
    await supabase.from('facilities').update({ specialty: next.length ? next : null }).eq('id', facility.id)
    if (onFacilityUpdated) onFacilityUpdated()
  }

  async function confirmFacilityLocation(lat, lng) {
    const { error } = await supabase
      .from('facilities')
      .update({ latitude: lat, longitude: lng })
      .eq('id', facility.id)
    if (!error) {
      setFacilityLat(lat)
      setFacilityLng(lng)
      if (onFacilityUpdated) onFacilityUpdated()
    }
    setShowMapPicker(false)
  }

  async function saveListing() {
    setSaving(true)
    const { error } = await supabase
      .from('facility_change_requests')
      .insert({
        facility_id: facility.id,
        provider_id: session.user.id,
        proposed_changes: {
          phone: editPhone.trim() || null,
          address: editAddress.trim() || null,
          opening_hours: editHours.trim() || null,
          description: editDescription.trim() || null,
          languages: editLanguages.length > 0 ? editLanguages.join(', ') : null,
        },
      })
    setSaving(false)
    if (!error) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } else {
      const key = moderationErrorKey(error)
      if (key) Alert.alert('', t(key, lang))
    }
  }

  async function loadCredentials() {
    const { data } = await supabase
      .from('provider_credentials')
      .select('id, cred_type, title, institution, year, status, rejection_reason, document_url, created_at')
      .eq('facility_id', facility.id)
      .order('created_at', { ascending: false })
    setCredentials(data ?? [])
  }

  async function loadSubmissionHistory() {
    const { data } = await supabase
      .from('facility_change_requests')
      .select('id, proposed_changes, status, rejection_reason, created_at')
      .eq('facility_id', facility.id)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10)
    setSubmissionHistory(data ?? [])
  }

  async function pickCredDoc() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    })
    if (result.canceled) return
    setCredImageUri(result.assets[0].uri)
    setCredImageBase64(result.assets[0].base64)
  }

  async function saveCred() {
    if (!newCred.title.trim() || !newCred.institution.trim()) return
    setSavingCred(true)
    let document_url = null
    if (credImageBase64) {
      setUploadingCredDoc(true)
      let upFailed = false
      try {
        const ext = (credImageUri?.split('.').pop() || 'jpg').toLowerCase()
        const path = `${session.user.id}/${Date.now()}.${ext}`
        const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
        const { error: upErr } = await supabase.storage
          .from('provider-credentials')
          .upload(path, decode(credImageBase64), { contentType })
        if (upErr) upFailed = true
        // Store the private object PATH; a signed URL is minted at view time.
        else document_url = path
      } catch {
        upFailed = true
      }
      setUploadingCredDoc(false)
      // Abort before insert: never write a credential row with a missing
      // document_url (that was the orphan source — insert used to run regardless).
      if (upFailed) {
        setSavingCred(false)
        Alert.alert('', t('uploadFailed', lang))
        return
      }
    }
    await supabase.from('provider_credentials').insert({
      facility_id:  facility.id,
      provider_id:  session.user.id,
      cred_type:    newCred.cred_type,
      title:        newCred.title.trim(),
      institution:  newCred.institution.trim(),
      year:         newCred.year ? parseInt(newCred.year, 10) : null,
      document_url,
    })
    setNewCred({ cred_type: 'diploma', title: '', institution: '', year: '' })
    setCredImageUri(null)
    setCredImageBase64(null)
    setCredModalVisible(false)
    setSavingCred(false)
    loadCredentials()
  }

  async function deleteAccount() {
    setDeletingAccount(true)
    setDeleteAccountError(null)
    const { error } = await supabase.rpc('delete_own_account')
    if (error) {
      setDeleteAccountError(error.message)
      setDeletingAccount(false)
      return
    }
    await supabase.auth.signOut()
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

        <ListingHiddenBanner
          hiddenAt={facility.hidden_at}
          hiddenReason={facility.hidden_reason}
          lang={lang}
          style={{ marginHorizontal: 16, marginTop: 12 }}
        />

        {trialDaysLeft !== null && trialDaysLeft !== undefined && (
          <TouchableOpacity
            style={styles.trialBanner}
            onPress={() => Linking.openURL('mailto:getadaapp@gmail.com?subject=ADA%20Provider%20Activation')}
            activeOpacity={0.8}
          >
            <Text style={styles.trialText}>
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left in your free trial — tap to contact us
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'qa' && styles.tabBtnActive]}
            onPress={() => setTab('qa')}
          >
            <Text style={[styles.tabText, tab === 'qa' && styles.tabTextActive]}>{t('tabQA', lang)}</Text>
          </TouchableOpacity>
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
          <>
          <KeyboardAwareForm>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
            <FacilityPhotoManager
              facilityId={facility.id}
              initialCover={facility.cover_image_url}
              initialLogo={facility.logo_url}
              initialPhotos={facility.photos}
              lang={lang}
              onFacilityUpdated={onFacilityUpdated}
            />

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
                maxLength={200}
              />
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>{t('labelHours', lang)}</Text>
              <HoursPicker value={editHours} onChange={setEditHours} />

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

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 20, marginBottom: 0 }}>
                <Text style={styles.fieldLabel}>About / Description</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: editDescription.length > 450 ? colors.danger : colors.textSecondary }}>{editDescription.length}/500</Text>
              </View>
              <TextInput
                style={[styles.fieldInput, { minHeight: 80 }]}
                value={editDescription}
                onChangeText={v => setEditDescription(v.slice(0, 500))}
                placeholder="Brief description visible to customers…"
                placeholderTextColor={colors.textSecondary}
                multiline
                textAlignVertical="top"
                maxLength={500}
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
                  : <Text style={styles.saveBtnText}>{saveSuccess ? t('submitted', lang) : t('submitForReview', lang)}</Text>
                }
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { marginTop: 16 }]}>
              <Text style={styles.fieldLabel}>Map Location</Text>
              {facilityLat != null && facilityLng != null ? (
                <View style={styles.locationSetRow}>
                  <Feather name="map-pin" size={14} color={colors.success} />
                  <Text style={styles.locationSetText}>{facilityLat.toFixed(5)}, {facilityLng.toFixed(5)}</Text>
                </View>
              ) : (
                <Text style={styles.locationNotSet}>Not set — your facility won't appear on the map.</Text>
              )}
              <TouchableOpacity
                style={styles.locationBtn}
                onPress={() => setShowMapPicker(true)}
                activeOpacity={0.8}
              >
                <Feather name="map-pin" size={14} color="#fff" />
                <Text style={styles.locationBtnText}>
                  {facilityLat != null ? 'Update pin' : 'Pin on map'}
                </Text>
              </TouchableOpacity>
              <MapPinPicker
                visible={showMapPicker}
                lang={lang}
                initialLat={facilityLat}
                initialLng={facilityLng}
                onConfirm={confirmFacilityLocation}
                onCancel={() => setShowMapPicker(false)}
              />
            </View>

            {/* ── Credentials ──────────────────────────────────── */}
            <View style={[styles.card, { marginTop: 16 }]}>
              <View style={styles.credHeader}>
                <Text style={styles.fieldLabel}>CREDENTIALS & QUALIFICATIONS</Text>
                <TouchableOpacity style={styles.credAddBtn} onPress={() => setCredModalVisible(true)}>
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={styles.credAddBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
              {credentials.length === 0 ? (
                <Text style={styles.credEmptyText}>No credentials yet. Add diplomas or certificates to build patient trust.</Text>
              ) : credentials.map(cred => {
                const statusColor = cred.status === 'approved' ? colors.success : cred.status === 'rejected' ? colors.danger : colors.accent
                const statusLabel = cred.status === 'approved' ? 'Approved' : cred.status === 'rejected' ? 'Rejected' : 'Pending review'
                return (
                  <View key={cred.id} style={styles.credRow}>
                    <Text style={styles.credIcon}>{cred.cred_type === 'diploma' ? '🎓' : '📜'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.credTitle}>{cred.title}</Text>
                      <Text style={styles.credSub}>{cred.institution}{cred.year ? ` · ${cred.year}` : ''}</Text>
                      <View style={[styles.credStatusPill, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.credStatusText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                      {cred.status === 'rejected' && cred.rejection_reason ? (
                        <Text style={styles.credRejectionReason}>Reason: {cred.rejection_reason}</Text>
                      ) : null}
                    </View>
                  </View>
                )
              })}
            </View>

            {/* ── Submission history ───────────────────────────── */}
            {submissionHistory.length > 0 && (
              <View style={[styles.card, { marginTop: 16, marginBottom: 8 }]}>
                <Text style={styles.fieldLabel}>RECENT SUBMISSIONS</Text>
                {submissionHistory.map(req => {
                  const isApproved = req.status === 'approved'
                  const color = isApproved ? colors.success : colors.danger
                  const fields = Object.keys(req.proposed_changes ?? {}).filter(k => req.proposed_changes[k] != null)
                  return (
                    <View key={req.id} style={styles.historyRow}>
                      <View style={[styles.historyDot, { backgroundColor: color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyStatus}>{isApproved ? 'Approved' : 'Rejected'} · {new Date(req.created_at).toLocaleDateString()}</Text>
                        <Text style={styles.historyFields} numberOfLines={1}>{fields.join(', ')}</Text>
                        {!isApproved && req.rejection_reason ? (
                          <Text style={styles.historyReason}>"{req.rejection_reason}"</Text>
                        ) : null}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

            {/* ── Delete account ───────────────────────────────── */}
            <View style={[styles.card, { marginTop: 16, marginBottom: 8 }]}>
              <Text style={styles.fieldLabel}>ACCOUNT</Text>
              {!showDeleteConfirm ? (
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.dangerLight, marginTop: 12 }]}
                  onPress={() => setShowDeleteConfirm(true)}
                >
                  <Text style={[styles.saveBtnText, { color: colors.danger }]}>Delete Account</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 8, marginBottom: 12 }}>
                    This will permanently delete your account and all associated data. This cannot be undone.
                  </Text>
                  {deleteAccountError && (
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginBottom: 8 }}>{deleteAccountError}</Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={[styles.saveBtn, { flex: 1, backgroundColor: colors.surfaceAlt }]}
                      onPress={() => setShowDeleteConfirm(false)}
                      disabled={deletingAccount}
                    >
                      <Text style={[styles.saveBtnText, { color: colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBtn, { flex: 1, backgroundColor: colors.danger, opacity: deletingAccount ? 0.7 : 1 }]}
                      onPress={deleteAccount}
                      disabled={deletingAccount}
                    >
                      {deletingAccount
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.saveBtnText}>Confirm Delete</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

          </ScrollView>
          </KeyboardAwareForm>

          {/* ── Add credential modal ─────────────────────────── */}
          <Modal visible={credModalVisible} animationType="slide" transparent onRequestClose={() => setCredModalVisible(false)}>
            <KeyboardAwareForm>
            <View style={styles.credModalOverlay}>
              <View style={styles.credModalSheet}>
                <View style={styles.credModalHeader}>
                  <Text style={styles.credModalTitle}>Add Credential</Text>
                  <TouchableOpacity onPress={() => setCredModalVisible(false)}>
                    <Feather name="x" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.fieldLabel}>TYPE</Text>
                  <View style={styles.credTypeRow}>
                    {[['diploma', '🎓 Diploma'], ['certificate', '📜 Certificate']].map(([val, label]) => (
                      <TouchableOpacity
                        key={val}
                        style={[styles.credTypeChip, newCred.cred_type === val && styles.credTypeChipActive]}
                        onPress={() => setNewCred(p => ({ ...p, cred_type: val }))}
                      >
                        <Text style={[styles.credTypeChipText, newCred.cred_type === val && styles.credTypeChipTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>TITLE *</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={newCred.title}
                    onChangeText={v => setNewCred(p => ({ ...p, title: v }))}
                    placeholder={newCred.cred_type === 'diploma' ? 'e.g. BSc Physiotherapy' : 'e.g. Nish Technique Certificate'}
                    placeholderTextColor={colors.textSecondary}
                    maxLength={120}
                  />
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>INSTITUTION *</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={newCred.institution}
                    onChangeText={v => setNewCred(p => ({ ...p, institution: v }))}
                    placeholder="e.g. Istanbul University"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={120}
                  />
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>YEAR</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={newCred.year}
                    onChangeText={v => setNewCred(p => ({ ...p, year: v.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="e.g. 2018"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>DOCUMENT (optional)</Text>
                  <TouchableOpacity style={styles.credDocBtn} onPress={pickCredDoc} activeOpacity={0.8}>
                    {credImageUri
                      ? <Text style={[styles.credDocBtnText, { color: colors.success }]}>Photo selected — tap to change</Text>
                      : <>
                          <Feather name="upload" size={15} color={colors.primary} />
                          <Text style={styles.credDocBtnText}>Upload photo of diploma / certificate</Text>
                        </>
                    }
                    {uploadingCredDoc && <ActivityIndicator size="small" color={colors.primary} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, { marginTop: 20 }, (!newCred.title.trim() || !newCred.institution.trim() || savingCred) && { opacity: 0.5 }]}
                    onPress={saveCred}
                    disabled={!newCred.title.trim() || !newCred.institution.trim() || savingCred}
                  >
                    {savingCred
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.saveBtnText}>Submit for review</Text>
                    }
                  </TouchableOpacity>
                  <Text style={styles.credModalDisclaimer}>Admin will review and approve your credential before it's visible to patients.</Text>
                </ScrollView>
              </View>
            </View>
          </KeyboardAwareForm>
          </Modal>
          </>

        ) : tab === 'stats' ? (
          loadingQ ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              <Text style={styles.sectionTitle}>{t('tabQA', lang)}</Text>
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

            </ScrollView>
          )
        ) : (
          loadingQ ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <KeyboardAwareForm>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {questions.length === 0 ? (
                <View style={styles.empty}>
                  <View style={styles.emptyIconWrap}><Ionicons name="chatbubble-outline" size={28} color={colors.textSecondary} /></View>
                  <Text style={styles.emptyTitle}>{t('noQuestions', lang)}</Text>
                  <Text style={styles.emptySub}>{t('questionsFromCustomers', lang)}</Text>
                </View>
              ) : (
                <>
                  {questions.every(q => q.answers?.length > 0) && (
                    <View style={styles.noNewQBanner}>
                      <Ionicons name="checkmark-circle-outline" size={18} color={colors.textSecondary} />
                      <Text style={styles.noNewQText}>{t('noNewQuestions', lang)}</Text>
                    </View>
                  )}
                  {questions.map(q => (
                  <View key={q.id} style={styles.card}>
                    <View style={styles.qTop}>
                      <Text style={[styles.qBody, { flex: 1 }]}>{q.body}</Text>
                      <ContentReportMenu contentType="question" contentId={q.id} lang={lang} />
                    </View>
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
                ))}
                </>
              )}
            </ScrollView>
            </KeyboardAwareForm>
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
  card:            { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, ...shadow },
  tabs:           { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, marginBottom: 16 },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive:   { backgroundColor: colors.surface, ...shadow },
  tabText:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  qTop:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
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
  locationSetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginTop: 4 },
  locationSetText:{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.success },
  locationNotSet: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 12, marginTop: 4 },
  locationBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  locationBtnText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  specialtyGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  specialtyChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  specialtyChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  specialtyChipText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  specialtyChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  noNewQBanner:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.cardBg, borderRadius: 12, padding: 12, marginBottom: 12 },
  noNewQText:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  emptyIconWrap:  { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...shadow },
  emptyTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  emptyTipBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  // credentials
  credHeader:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  credAddBtn:           { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  credAddBtnText:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  credEmptyText:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },
  credRow:              { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  credIcon:             { fontSize: 22, marginTop: 2 },
  credTitle:            { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  credSub:              { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  credStatusPill:       { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  credStatusText:       { fontSize: 11, fontFamily: 'Inter_700Bold' },
  credRejectionReason:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 3, fontStyle: 'italic' },

  // submission history
  historyRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  historyStatus:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  historyFields:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  historyReason:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 2, fontStyle: 'italic' },

  // credential add modal
  credModalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  credModalSheet:       { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '90%' },
  credModalHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  credModalTitle:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  credTypeRow:          { flexDirection: 'row', gap: 10 },
  credTypeChip:         { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: colors.surface },
  credTypeChipActive:   { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  credTypeChipText:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  credTypeChipTextActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },
  credDocBtn:           { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, borderStyle: 'dashed', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.primaryLight },
  credDocBtnText:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary },
  credModalDisclaimer:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 17 },
})
