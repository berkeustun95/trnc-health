import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CATEGORIES = [
  { key: 'hospitality',       icon: 'restaurant-outline',          labelKey: 'jobCatHospitality' },
  { key: 'construction',      icon: 'construct-outline',           labelKey: 'jobCatConstruction' },
  { key: 'retail',            icon: 'cart-outline',                labelKey: 'jobCatRetail' },
  { key: 'healthcare',        icon: 'medical-outline',             labelKey: 'jobCatHealthcare' },
  { key: 'admin_office',      icon: 'business-outline',            labelKey: 'jobCatAdminOffice' },
  { key: 'education',         icon: 'school-outline',              labelKey: 'jobCatEducation' },
  { key: 'driving_logistics', icon: 'car-outline',                 labelKey: 'jobCatDrivingLogistics' },
  { key: 'beauty_wellness',   icon: 'cut-outline',                 labelKey: 'jobCatBeautyWellness' },
  { key: 'agriculture',       icon: 'leaf-outline',                labelKey: 'jobCatAgriculture' },
  { key: 'domestic',          icon: 'home-outline',                labelKey: 'jobCatDomestic' },
  { key: 'other',             icon: 'ellipsis-horizontal-outline', labelKey: 'jobCatOther' },
]

const EMPLOYMENT_TYPES = [
  { key: 'full_time', labelKey: 'jobTypeFullTime' },
  { key: 'part_time', labelKey: 'jobTypePartTime' },
  { key: 'seasonal',  labelKey: 'jobTypeSeasonal' },
  { key: 'temporary', labelKey: 'jobTypeTemporary' },
]

const DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
const DISTRICT_KEYS = {
  nicosia: 'jobDistrictNicosia', kyrenia: 'jobDistrictKyrenia',
  famagusta: 'jobDistrictFamagusta', morphou: 'jobDistrictMorphou',
  iskele: 'jobDistrictIskele', lefke: 'jobDistrictLefke', karpaz: 'jobDistrictKarpaz',
}

// Declaring individual vs business is allowed in the consumer app — it is not
// payment UI. Businesses are told about payment off-app; nothing here, on the
// success state, or on the dashboard may mention pricing or bank transfer.
const POSTER_TYPES = [
  { key: 'individual', labelKey: 'jobPosterIndividual', icon: 'person-outline' },
  { key: 'business',   labelKey: 'jobPosterBusiness',   icon: 'business-outline' },
]

const CONTACT_PREFS = [
  { key: 'whatsapp', labelKey: 'jobContactPrefWA',   icon: 'logo-whatsapp' },
  { key: 'call',     labelKey: 'jobContactPrefCall',  icon: 'call-outline' },
  { key: 'both',     labelKey: 'jobContactPrefBoth',  icon: 'chatbubbles-outline' },
]

function SuccessState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Ionicons name="checkmark-circle" size={64} color={colors.success} />
      <Text style={s.stateTitle}>{t('jobFormSuccess', lang)}</Text>
      <Text style={s.stateSub}>{t('jobFormSuccessSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function Field({ label, children }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

export default function JobPostOnboardingScreen({ session, lang, onClose }) {
  const [submitted,   setSubmitted]   = useState(false)

  const [posterType,  setPosterType]  = useState('individual')
  const [jobTitle,    setJobTitle]    = useState('')
  const [employer,    setEmployer]    = useState('')
  const [category,    setCategory]    = useState(null)
  const [empType,     setEmpType]     = useState(null)
  const [district,    setDistrict]    = useState(null)
  const [salary,      setSalary]      = useState('')
  const [description, setDescription] = useState('')
  const [phone,       setPhone]       = useState('')
  const [whatsapp,    setWhatsapp]    = useState('')
  const [contactPref, setContactPref] = useState('whatsapp')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  async function handleSubmit() {
    setError(null)
    if (!jobTitle.trim()) { setError(t('jobFormErrTitle',    lang)); return }
    if (!employer.trim()) { setError(t('jobFormErrEmployer', lang)); return }
    if (!category)        { setError(t('jobFormErrCategory', lang)); return }
    if (!empType)         { setError(t('jobFormErrType',     lang)); return }
    if (!district)        { setError(t('jobFormErrDistrict', lang)); return }
    if (!phone.trim())    { setError(t('jobFormErrPhone',    lang)); return }

    setSaving(true)
    try {
      const { error: err } = await supabase.from('job_postings').insert({
        owner_id:        session.user.id,
        poster_type:     posterType,
        job_title:       jobTitle.trim(),
        employer_name:   employer.trim(),
        category,
        employment_type: empType,
        district,
        salary:          salary.trim() || null,
        description:     description.trim() || null,
        phone:           phone.trim(),
        whatsapp:        whatsapp.trim() || null,
        contact_pref:    contactPref,
        status:          'pending',
      })
      if (err) throw err
      setSubmitted(true)
    } catch (err) {
      setError(err.message || t('jobFormErrGeneric', lang))
    } finally {
      setSaving(false)
    }
  }

  if (submitted) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <SuccessState lang={lang} onClose={onClose} />
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
          <Text style={s.headerTitle}>{t('jobFormTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Field label={t('jobFormPosterType', lang)}>
            <View style={s.chipRow}>
              {POSTER_TYPES.map(p => (
                <TouchableOpacity
                  key={p.key}
                  style={[s.selChip, posterType === p.key && s.selChipActive]}
                  onPress={() => setPosterType(p.key)}
                >
                  <Ionicons
                    name={p.icon}
                    size={13}
                    color={posterType === p.key ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[s.selChipText, posterType === p.key && s.selChipTextActive]}>
                    {t(p.labelKey, lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label={t('jobFormJobTitle', lang)}>
            <TextInput
              style={s.input}
              value={jobTitle}
              onChangeText={setJobTitle}
              placeholder={t('jobFormJobTitlePlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          <Field label={t('jobFormEmployer', lang)}>
            <TextInput
              style={s.input}
              value={employer}
              onChangeText={setEmployer}
              placeholder={t('jobFormEmployerPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          <Field label={t('jobFormCategory', lang)}>
            <View style={s.chipRow}>
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c.key}
                  style={[s.selChip, category === c.key && s.selChipActive]}
                  onPress={() => setCategory(c.key)}
                >
                  <Ionicons
                    name={c.icon}
                    size={13}
                    color={category === c.key ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[s.selChipText, category === c.key && s.selChipTextActive]}>
                    {t(c.labelKey, lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label={t('jobFormType', lang)}>
            <View style={s.chipRow}>
              {EMPLOYMENT_TYPES.map(et => (
                <TouchableOpacity
                  key={et.key}
                  style={[s.selChip, empType === et.key && s.selChipActive]}
                  onPress={() => setEmpType(et.key)}
                >
                  <Text style={[s.selChipText, empType === et.key && s.selChipTextActive]}>
                    {t(et.labelKey, lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label={t('jobFormDistrict', lang)}>
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

          <Field label={t('jobFormSalary', lang)}>
            <TextInput
              style={s.input}
              value={salary}
              onChangeText={setSalary}
              placeholder={t('jobFormSalaryPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          <Field label={t('jobFormDescription', lang)}>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('jobFormDescPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </Field>

          <Field label={t('jobFormPhone', lang)}>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label={t('jobFormWhatsApp', lang)}>
            <TextInput
              style={s.input}
              value={whatsapp}
              onChangeText={setWhatsapp}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label={t('jobFormContactPref', lang)}>
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

          {!!error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.submitBtn, saving && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.submitBtnText}>{t('jobFormSubmit', lang)}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },

  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                       paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.cardBg,
                       borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  scrollContent:     { padding: 20, paddingBottom: 48 },

  field:             { marginBottom: 20 },
  fieldLabel:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                       marginBottom: 8 },
  input:             { backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                       borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
                       fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  inputMulti:        { minHeight: 100, paddingTop: 12 },

  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selChip:           { flexDirection: 'row', alignItems: 'center', gap: 5,
                       paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                       borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  selChipActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  selChipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  selChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  errorText:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
                       marginBottom: 16, textAlign: 'center' },
  submitBtn:         { backgroundColor: colors.primary, borderRadius: radius.md,
                       paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  stateWrap:         { flex: 1, alignItems: 'center', justifyContent: 'center',
                       padding: 32, gap: 12 },
  stateTitle:        { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                       textAlign: 'center' },
  stateSub:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                       textAlign: 'center', lineHeight: 21 },
  ghostBtn:          { paddingVertical: 12, paddingHorizontal: 24 },
  ghostBtnText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})
