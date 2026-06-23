import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

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
    const a = lookup[base64.charCodeAt(i)],  b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)], d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | d
  }
  return buf
}

async function uploadImage(bucket, path, base64, ext) {
  const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), { contentType, upsert: true })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path)
  return `${publicUrl}?t=${Date.now()}`
}

async function pickImage(aspect) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) { Alert.alert('Permission required', 'Photo library access is needed.'); return null }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true, aspect, quality: 0.75, base64: true,
  })
  if (result.canceled) return null
  return result.assets[0]
}

// ─── Pending / Rejected states ───────────────────────────────────────────────

function PendingState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>⏳</Text>
      <Text style={s.stateTitle}>{t('accomPendingAgent', lang)}</Text>
      <Text style={s.stateSub}>{t('accomPendingAgentSub', lang)}</Text>
      <TouchableOpacity style={s.closeBtn} onPress={onClose}>
        <Text style={s.closeBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function RejectedState({ reason, lang, onReapply, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>❌</Text>
      <Text style={s.stateTitle}>{t('accomRejectedAgent', lang)}</Text>
      <View style={s.reasonBox}>
        <Text style={s.reasonLabel}>{t('accomRejectedAgentSub', lang)}</Text>
        <Text style={s.reasonText}>{reason}</Text>
      </View>
      <TouchableOpacity style={s.primaryBtn} onPress={onReapply}>
        <Text style={s.primaryBtnText}>Re-apply</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function EstateAgentOnboardingScreen({ session, lang, onClose, onSubmitted }) {
  const [existingAgent, setExistingAgent] = useState(undefined)
  const [isAgency, setIsAgency]           = useState(false)
  const [reapplying, setReapplying]       = useState(false)

  // Agent form
  const [fullName, setFullName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [photoUrl, setPhotoUrl]   = useState(null)
  const [idDocUrl, setIdDocUrl]   = useState(null)

  // Agency form
  const [agencyName, setAgencyName]   = useState('')
  const [agencyAddr, setAgencyAddr]   = useState('')
  const [agencyPhone, setAgencyPhone] = useState('')
  const [agencyEmail, setAgencyEmail] = useState('')
  const [agencyWeb, setAgencyWeb]     = useState('')
  const [agencyDesc, setAgencyDesc]   = useState('')
  const [logoUrl, setLogoUrl]         = useState(null)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [checkingExisting, setCheckingExisting] = useState(true)

  useEffect(() => {
    async function check() {
      const { data } = await supabase
        .from('estate_agents')
        .select('id, status, rejection_reason')
        .eq('user_id', session.user.id)
        .maybeSingle()
      setExistingAgent(data)
      setCheckingExisting(false)
    }
    check()
  }, [session.user.id])

  async function pickAndUploadPhoto(field) {
    const asset = await pickImage([1, 1])
    if (!asset) return
    setUploading(true)
    try {
      const ext  = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const path = `${session.user.id}/${field}.${ext}`
      const url  = await uploadImage('property-images', path, asset.base64, ext)
      if (field === 'agent-photo')  setPhotoUrl(url)
      if (field === 'agent-id-doc') setIdDocUrl(url)
      if (field === 'agency-logo')  setLogoUrl(url)
    } catch {
      setError('Image upload failed. Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setError(null)
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (!phone.trim())    { setError('Phone number is required.'); return }
    if (!idDocUrl)        { setError('Please upload a copy of your ID or passport.'); return }
    if (isAgency && !agencyName.trim()) { setError('Agency name is required.'); return }

    setSaving(true)
    try {
      let agencyId = null

      // Create agency first if applicable
      if (isAgency) {
        const { data: ag, error: agErr } = await supabase
          .from('estate_agencies')
          .insert({
            owner_id: session.user.id,
            name:        agencyName.trim(),
            address:     agencyAddr.trim() || null,
            phone:       agencyPhone.trim() || null,
            email:       agencyEmail.trim() || null,
            website:     agencyWeb.trim() || null,
            description: agencyDesc.trim() || null,
            logo_url:    logoUrl,
          })
          .select('id')
          .single()
        if (agErr) throw agErr
        agencyId = ag.id
      }

      // Insert or update agent record
      const agentPayload = {
        user_id:         session.user.id,
        full_name:       fullName.trim(),
        phone:           phone.trim(),
        email:           email.trim() || null,
        photo_url:       photoUrl,
        id_document_url: idDocUrl,
        agency_id:       agencyId,
        status:          'pending',
        rejection_reason: null,
      }

      if (reapplying && existingAgent?.id) {
        const { error: updErr } = await supabase
          .from('estate_agents')
          .update(agentPayload)
          .eq('id', existingAgent.id)
        if (updErr) throw updErr
      } else {
        const { error: insErr } = await supabase.from('estate_agents').insert(agentPayload)
        if (insErr) throw insErr
      }

      onSubmitted?.()
    } catch (err) {
      setError(err.message || 'Submission failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checkingExisting) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    )
  }

  if (existingAgent?.status === 'pending' && !reapplying) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <PendingState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  if (existingAgent?.status === 'rejected' && !reapplying) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <RejectedState
          reason={existingAgent.rejection_reason || 'No reason given.'}
          lang={lang}
          onReapply={() => setReapplying(true)}
          onClose={onClose}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('accomAgentOnboardTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Type selector */}
          <Text style={s.sectionLabel}>I am…</Text>
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, !isAgency && s.typeBtnActive]}
              onPress={() => setIsAgency(false)}
            >
              <Ionicons name="person-outline" size={22} color={!isAgency ? '#fff' : colors.textSecondary} />
              <Text style={[s.typeBtnText, !isAgency && s.typeBtnTextActive]}>
                {t('accomIAmAgent', lang)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, isAgency && s.typeBtnActive]}
              onPress={() => setIsAgency(true)}
            >
              <Ionicons name="business-outline" size={22} color={isAgency ? '#fff' : colors.textSecondary} />
              <Text style={[s.typeBtnText, isAgency && s.typeBtnTextActive]}>
                {t('accomIRepresentAgency', lang)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Personal details */}
          <Text style={s.sectionLabel}>Personal details</Text>
          <Field label={t('accomAgentFullName', lang)}>
            <TextInput style={s.input} value={fullName} onChangeText={setFullName}
              placeholder="Your legal name" placeholderTextColor={colors.textSecondary} />
          </Field>
          <Field label={t('accomAgentPhone', lang)}>
            <TextInput style={s.input} value={phone} onChangeText={setPhone}
              placeholder="+90 548 000 0000" placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad" />
          </Field>
          <Field label={t('accomAgentEmail', lang)}>
            <TextInput style={s.input} value={email} onChangeText={setEmail}
              placeholder="email@example.com" placeholderTextColor={colors.textSecondary}
              keyboardType="email-address" autoCapitalize="none" />
          </Field>

          {/* Photo upload */}
          <Field label={t('accomUploadAgentPhoto', lang)}>
            <TouchableOpacity style={s.imageUploadBtn} onPress={() => pickAndUploadPhoto('agent-photo')} disabled={uploading}>
              {photoUrl
                ? <Image source={{ uri: photoUrl }} style={s.thumbSquare} />
                : <View style={s.imageUploadInner}>
                    <Ionicons name="camera-outline" size={28} color={colors.primary} />
                    <Text style={s.imageUploadText}>Tap to upload</Text>
                  </View>
              }
            </TouchableOpacity>
          </Field>

          {/* ID document */}
          <Field label={t('accomUploadId', lang)}>
            <TouchableOpacity style={s.imageUploadBtn} onPress={() => pickAndUploadPhoto('agent-id-doc')} disabled={uploading}>
              {idDocUrl
                ? <View style={[s.imageUploadInner, { backgroundColor: colors.successLight }]}>
                    <Ionicons name="checkmark-circle-outline" size={28} color={colors.success} />
                    <Text style={[s.imageUploadText, { color: colors.success }]}>Uploaded</Text>
                  </View>
                : <View style={s.imageUploadInner}>
                    <Ionicons name="document-outline" size={28} color={colors.primary} />
                    <Text style={s.imageUploadText}>Passport or national ID</Text>
                  </View>
              }
            </TouchableOpacity>
          </Field>

          {/* Agency details */}
          {isAgency && (
            <>
              <View style={s.sectionDivider} />
              <Text style={s.sectionLabel}>Agency details</Text>
              <Field label={t('accomAgencyName', lang)}>
                <TextInput style={s.input} value={agencyName} onChangeText={setAgencyName}
                  placeholder="Agency name" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label={t('accomAgencyAddress', lang)}>
                <TextInput style={s.input} value={agencyAddr} onChangeText={setAgencyAddr}
                  placeholder="Office address" placeholderTextColor={colors.textSecondary} />
              </Field>
              <Field label={t('accomAgencyPhone', lang)}>
                <TextInput style={s.input} value={agencyPhone} onChangeText={setAgencyPhone}
                  placeholder="+90 392 000 0000" placeholderTextColor={colors.textSecondary}
                  keyboardType="phone-pad" />
              </Field>
              <Field label={t('accomAgencyEmail', lang)}>
                <TextInput style={s.input} value={agencyEmail} onChangeText={setAgencyEmail}
                  placeholder="agency@example.com" placeholderTextColor={colors.textSecondary}
                  keyboardType="email-address" autoCapitalize="none" />
              </Field>
              <Field label={t('accomAgencyWebsite', lang)}>
                <TextInput style={s.input} value={agencyWeb} onChangeText={setAgencyWeb}
                  placeholder="https://youragency.com" placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none" />
              </Field>
              <Field label={t('accomAgencyDesc', lang)}>
                <TextInput style={[s.input, { minHeight: 88 }]} value={agencyDesc} onChangeText={setAgencyDesc}
                  placeholder="Tell clients about your agency…" placeholderTextColor={colors.textSecondary}
                  multiline textAlignVertical="top" />
              </Field>
              <Field label={t('accomUploadLogo', lang)}>
                <TouchableOpacity style={s.imageUploadBtn} onPress={() => pickAndUploadPhoto('agency-logo')} disabled={uploading}>
                  {logoUrl
                    ? <Image source={{ uri: logoUrl }} style={s.thumbSquare} resizeMode="contain" />
                    : <View style={s.imageUploadInner}>
                        <Ionicons name="image-outline" size={28} color={colors.primary} />
                        <Text style={s.imageUploadText}>Agency logo</Text>
                      </View>
                  }
                </TouchableOpacity>
              </Field>
            </>
          )}

          {error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, (saving || uploading) && s.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving || uploading}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.primaryBtnText}>{t('accomSubmitAgent', lang)}</Text>
            }
          </TouchableOpacity>

          <Text style={s.reviewNote}>
            Your application will be reviewed by our team. You'll receive a notification once approved.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ label, children }) {
  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  scrollContent:   { paddingHorizontal: 20, paddingBottom: 60 },

  sectionLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, marginTop: 4 },
  sectionDivider:  { height: 1, backgroundColor: colors.border, marginVertical: 24 },

  typeRow:         { flexDirection: 'row', gap: 10, marginBottom: 24 },
  typeBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  typeBtnActive:   { backgroundColor: colors.primary, borderColor: colors.primary },
  typeBtnText:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textAlign: 'center', flex: 1 },
  typeBtnTextActive: { color: '#fff' },

  fieldGroup:      { marginBottom: 16 },
  fieldLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:           { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, fontSize: 15, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },

  imageUploadBtn:  { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', height: 100, backgroundColor: colors.surface },
  imageUploadInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imageUploadText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  thumbSquare:     { width: '100%', height: '100%' },

  errorText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginBottom: 14, textAlign: 'center' },
  primaryBtn:      { backgroundColor: colors.primary, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 8, marginBottom: 12 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  ghostBtn:        { paddingVertical: 12, alignItems: 'center' },
  ghostBtnText:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  closeBtn:        { marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border },
  closeBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  reviewNote:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  // state screens
  stateWrap:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  stateTitle:      { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  stateSub:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 4, marginBottom: 12 },
  reasonBox:       { backgroundColor: colors.dangerLight, borderRadius: 12, padding: 14, marginTop: 8, marginBottom: 16, width: '100%' },
  reasonLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.danger, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  reasonText:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.danger },
})
