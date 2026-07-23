import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORIES = [
  { key: 'health', icon: 'heart-outline',    labelKey: 'insTypeHealth' },
  { key: 'car',    icon: 'car-outline',      labelKey: 'insTypeCar' },
  { key: 'home',   icon: 'home-outline',     labelKey: 'insTypeHome' },
  { key: 'travel', icon: 'airplane-outline', labelKey: 'insTypeTravel' },
]

const DISTRICTS     = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
const DISTRICT_KEYS = {
  nicosia: 'blDistrictNicosia', kyrenia: 'blDistrictKyrenia',
  famagusta: 'blDistrictFamagusta', morphou: 'blDistrictMorphou',
  iskele: 'blDistrictIskele', lefke: 'blDistrictLefke', karpaz: 'blDistrictKarpaz',
}
const CONTACT_PREFS = [
  { key: 'whatsapp', labelKey: 'insContactPrefWA',   icon: 'logo-whatsapp' },
  { key: 'call',     labelKey: 'insContactPrefCall',  icon: 'call-outline' },
  { key: 'both',     labelKey: 'insContactPrefBoth',  icon: 'chatbubbles-outline' },
]

// ─── State screens ────────────────────────────────────────────────────────────

function PendingState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>⏳</Text>
      <Text style={s.stateTitle}>{t('insRegisterPending', lang)}</Text>
      <Text style={s.stateSub}>{t('insRegisterPendingSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function RejectedState({ reason, lang, onReapply, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>❌</Text>
      <Text style={s.stateTitle}>{t('insRegisterRejected', lang)}</Text>
      <View style={s.reasonBox}>
        <Text style={s.reasonLabel}>{t('insRegisterRejectedSub', lang)}</Text>
        <Text style={s.reasonText}>{reason}</Text>
      </View>
      <TouchableOpacity style={s.primaryBtn} onPress={onReapply}>
        <Text style={s.primaryBtnText}>{t('insRegisterReapply', lang)}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function ActiveState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>✅</Text>
      <Text style={s.stateTitle}>{t('insRegisterActive', lang)}</Text>
      <Text style={s.stateSub}>{t('insRegisterActiveSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function InsuranceOnboardingScreen({ session, lang, onClose, onSubmitted }) {
  const [existing,       setExisting]       = useState(undefined)
  const [checking,       setChecking]       = useState(true)
  const [reapplying,     setReapplying]     = useState(false)

  const [name,           setName]           = useState('')
  const [phone,          setPhone]          = useState('')
  const [whatsapp,       setWhatsapp]       = useState('')
  const [email,          setEmail]          = useState('')
  const [contactPref,    setContactPref]    = useState('whatsapp')
  const [district,       setDistrict]       = useState(null)
  const [insuranceTypes, setInsuranceTypes] = useState([])
  const [description,    setDescription]    = useState('')

  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    async function checkExisting() {
      const { data } = await supabase
        .from('insurance_companies')
        .select('id, status, rejection_reason, name, phone, whatsapp, email, contact_pref, district, insurance_types, description')
        .eq('owner_id', session.user.id)
        .maybeSingle()
      setExisting(data)
      setChecking(false)
    }
    checkExisting()
  }, [session.user.id])

  function toggleType(key) {
    setInsuranceTypes(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  function populateFromExisting() {
    if (!existing) return
    setName(existing.name || '')
    setPhone(existing.phone || '')
    setWhatsapp(existing.whatsapp || '')
    setEmail(existing.email || '')
    setContactPref(existing.contact_pref || 'whatsapp')
    setDistrict(existing.district || null)
    setInsuranceTypes(existing.insurance_types || [])
    setDescription(existing.description || '')
  }

  function handleReapply() {
    populateFromExisting()
    setReapplying(true)
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim())          { setError(t('insErrorName', lang)); return }
    if (!phone.trim())         { setError(t('insErrorPhone', lang)); return }
    if (!district)             { setError(t('insErrorDistrict', lang)); return }
    if (insuranceTypes.length === 0) { setError(t('insErrorTypes', lang)); return }

    setSaving(true)
    try {
      const payload = {
        owner_id:         session.user.id,
        name:             name.trim(),
        phone:            phone.trim(),
        whatsapp:         whatsapp.trim() || null,
        email:            email.trim() || null,
        contact_pref:     contactPref,
        district,
        insurance_types:  insuranceTypes,
        description:      description.trim() || null,
        status:           'pending',
        rejection_reason: null,
      }

      if (reapplying && existing?.id) {
        const { error: err } = await supabase
          .from('insurance_companies')
          .update(payload)
          .eq('id', existing.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase
          .from('insurance_companies')
          .insert(payload)
        if (err) throw err
      }

      onSubmitted?.()
    } catch (err) {
      setError(err.message || t('insErrorGeneric', lang))
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'pending' && !reapplying) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <PendingState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'rejected' && !reapplying) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <RejectedState
          reason={existing.rejection_reason || t('insNoReasonGiven', lang)}
          lang={lang}
          onReapply={handleReapply}
          onClose={onClose}
        />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'active' && !reapplying) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActiveState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('insRegisterTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Company name */}
          <Field label={t('insRegisterName', lang)}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={t('insRegisterNamePlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Phone */}
          <Field label={t('insRegisterPhone', lang)}>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          {/* WhatsApp */}
          <Field label={t('insRegisterWhatsApp', lang)}>
            <TextInput
              style={s.input}
              value={whatsapp}
              onChangeText={setWhatsapp}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          {/* Email (optional) */}
          <Field label={t('insRegisterEmail', lang)}>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="info@example.com"
              placeholderTextColor={colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          {/* Contact preference */}
          <Field label={t('insRegisterContactPref', lang)}>
            <View style={s.chipRow}>
              {CONTACT_PREFS.map(p => (
                <TouchableOpacity
                  key={p.key}
                  style={[s.selChip, contactPref === p.key && s.selChipActive]}
                  onPress={() => setContactPref(p.key)}
                >
                  <Ionicons
                    name={p.icon}
                    size={14}
                    color={contactPref === p.key ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[s.selChipText, contactPref === p.key && s.selChipTextActive]}>
                    {t(p.labelKey, lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          {/* District */}
          <Field label={t('insRegisterDistrict', lang)}>
            <View style={s.chipRow}>
              {DISTRICTS.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[s.selChip, district === d && s.selChipActive]}
                  onPress={() => setDistrict(d)}
                >
                  <Text style={[s.selChipText, district === d && s.selChipTextActive]}>
                    {t(DISTRICT_KEYS[d], lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          {/* Insurance types (multi-select) */}
          <Field label={t('insRegisterTypes', lang)}>
            <View style={s.chipRow}>
              {CATEGORIES.map(c => {
                const selected = insuranceTypes.includes(c.key)
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.selChip, selected && s.selChipActive]}
                    onPress={() => toggleType(c.key)}
                  >
                    <Ionicons
                      name={c.icon}
                      size={13}
                      color={selected ? colors.primary : colors.textSecondary}
                    />
                    <Text style={[s.selChipText, selected && s.selChipTextActive]}>
                      {t(c.labelKey, lang)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </Field>

          {/* Description */}
          <Field label={t('insRegisterDesc', lang)}>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('insRegisterDescPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </Field>

          {!!error && (
            <Text style={s.errorText}>{error}</Text>
          )}

          <TouchableOpacity
            style={[s.submitBtn, saving && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.submitBtnText}>{t('insRegisterSubmit', lang)}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },

  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.cardBg,
                      borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:      { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  scrollContent:    { padding: 20, paddingBottom: 48 },

  field:            { marginBottom: 20 },
  fieldLabel:       { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                      marginBottom: 8 },
  input:            { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                      borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
                      fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  inputMulti:       { minHeight: 100, paddingTop: 12 },

  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selChip:          { flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                      borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  selChipActive:    { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  selChipText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  selChipTextActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },

  errorText:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
                      marginBottom: 16, textAlign: 'center' },
  submitBtn:        { backgroundColor: colors.primary, borderRadius: radius.md,
                      paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled:{ opacity: 0.6 },
  submitBtnText:    { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  // State screens
  stateWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center',
                      padding: 32, gap: 12 },
  stateEmoji:       { fontSize: 52, marginBottom: 4 },
  stateTitle:       { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                      textAlign: 'center' },
  stateSub:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      textAlign: 'center', lineHeight: 21 },
  reasonBox:        { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 14,
                      width: '100%', marginVertical: 8 },
  reasonLabel:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.danger,
                      marginBottom: 4 },
  reasonText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
                      lineHeight: 20 },
  primaryBtn:       { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14,
                      paddingHorizontal: 32, marginTop: 8 },
  primaryBtnText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  ghostBtn:         { paddingVertical: 12, paddingHorizontal: 24 },
  ghostBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})
