import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { GARAGE_CATEGORIES } from './GaragesScreen'

// ─── State screens ────────────────────────────────────────────────────────────

function PendingState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>⏳</Text>
      <Text style={s.stateTitle}>{t('garageRegisterPending', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterPendingSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

function DeclinedState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>❌</Text>
      <Text style={s.stateTitle}>{t('garageRegisterDeclined', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterDeclinedSub', lang)}</Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
        <Text style={s.ghostBtnText}>{t('back', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// Slice 1: no booking/availability management yet (that arrives in Slice 2).
function ActiveState({ lang, onClose }) {
  return (
    <View style={s.stateWrap}>
      <Text style={s.stateEmoji}>✅</Text>
      <Text style={s.stateTitle}>{t('garageRegisterActive', lang)}</Text>
      <Text style={s.stateSub}>{t('garageRegisterActiveSub', lang)}</Text>
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

export default function GarageOnboardingScreen({ session, lang, onClose, onSubmitted }) {
  const [existing, setExisting] = useState(undefined)
  const [checking, setChecking] = useState(true)

  const [name,        setName]        = useState('')
  const [services,    setServices]    = useState([]) // multi-select category keys
  const [area,        setArea]        = useState('')
  const [phone,       setPhone]       = useState('')
  const [hours,       setHours]       = useState('')
  const [description, setDescription] = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  useEffect(() => {
    async function checkExisting() {
      const { data } = await supabase
        .from('facilities')
        .select('id, status, provider_id')
        .eq('provider_id', session.user.id)
        .eq('type', 'garage')
        .maybeSingle()
      setExisting(data)
      setChecking(false)
    }
    checkExisting()
  }, [session.user.id])

  function toggleService(key) {
    setServices(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim())       { setError(t('garageErrorName', lang)); return }
    if (services.length === 0) { setError(t('garageErrorServices', lang)); return }

    setSaving(true)
    try {
      const { error: err } = await supabase.rpc('create_garage_facility', {
        p_name:          name.trim(),
        p_service_types: services,
        p_address:       area.trim() || null,
        p_phone:         phone.trim() || null,
        p_opening_hours: hours.trim() || null,
        p_description:   description.trim() || null,
      })
      if (err) throw err
      onSubmitted?.()
    } catch (err) {
      setError(err.message || t('garageErrorGeneric', lang))
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

  if (existing?.status === 'pending') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <PendingState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'active') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <ActiveState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  if (existing?.status === 'suspended') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <DeclinedState lang={lang} onClose={onClose} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAwareForm>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('garageRegisterTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.intro}>{t('garageRegisterIntro', lang)}</Text>

          {/* Business name */}
          <Field label={t('garageRegisterName', lang)}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={t('garageRegisterNamePlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Services (multi-select, required) */}
          <Field label={t('garageRegisterServices', lang)}>
            <View style={s.chipRow}>
              {GARAGE_CATEGORIES.map(c => {
                const selected = services.includes(c.key)
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.selChip, selected && s.selChipActive]}
                    onPress={() => toggleService(c.key)}
                  >
                    <Ionicons
                      name={c.icon}
                      size={14}
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

          {/* Area / city */}
          <Field label={t('garageRegisterArea', lang)}>
            <TextInput
              style={s.input}
              value={area}
              onChangeText={setArea}
              placeholder={t('garageRegisterAreaPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Phone */}
          <Field label={t('garageRegisterPhone', lang)}>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+90 548 000 0000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
          </Field>

          {/* Opening hours (display text) */}
          <Field label={t('garageRegisterHours', lang)}>
            <TextInput
              style={s.input}
              value={hours}
              onChangeText={setHours}
              placeholder={t('garageRegisterHoursPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>

          {/* Description */}
          <Field label={t('garageRegisterDesc', lang)}>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('garageRegisterDescPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
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
              : <Text style={s.submitBtnText}>{t('garageRegisterSubmit', lang)}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAwareForm>
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
  intro:            { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      lineHeight: 21, marginBottom: 20 },

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
  stateWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateEmoji:       { fontSize: 52, marginBottom: 4 },
  stateTitle:       { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary,
                      textAlign: 'center' },
  stateSub:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                      textAlign: 'center', lineHeight: 21 },
  ghostBtn:         { paddingVertical: 12, paddingHorizontal: 24 },
  ghostBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})
