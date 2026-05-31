import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform
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

export default function ProfileScreen({ session, lang, onBack, onLangChange }) {
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ full_name: '', phone: '', nationality: '', preferred_language: 'English' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

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
  }, [])

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

  errorText:        { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12 },
  signOutBtn:       { borderWidth: 1.5, borderColor: colors.danger, borderRadius: 12, padding: 15, alignItems: 'center' },
  signOutText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.danger },
})
