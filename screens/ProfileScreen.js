import { useState, useEffect } from 'react'
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, FlatList, ActivityIndicator, Platform,
  Modal, LayoutAnimation, UIManager,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { getNatLabel, NATIONALITIES, NATIONALITY_CODES } from '../constants/nationalityTranslations'
import { COUNTRY_CODES } from '../constants/countryCodes'
import { monthNames } from '../constants/months'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import SearchModal from '../components/SearchModal'
import { pad, ageOn, daysInMonth } from '../utils/profileFields'
import { useDisplayNameCheck, displayNameSaveError, NameFeedback } from '../components/DisplayNameCheck'
import {
  MIN_SIGNUP_AGE, MAX_SIGNUP_AGE, RESIDENT_STATUSES, STUDENT_LEVELS,
  INSTITUTION_REQUIRED_LEVELS, RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY,
  DISPLAY_NAME_MAX,
} from '../constants/profileGate'
import LegalScreen from './LegalScreen'
import { PRESET_AVATARS, getPreset } from '../constants/avatars'
import BackButton from '../components/BackButton'



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


// ─── Slice 3a: the wizard's ten fields become reviewable and editable ───────
//
// Before this, the completion gate collected first name, last name, display name, date
// of birth, nationality, phone, region, resident status, student level and institution —
// and this screen showed NONE of it. A mandatory form you cannot afterwards read back is
// not a profile, it is an interrogation.
//
// ⚠ full_name IS NO LONGER WRITTEN HERE, AND MUST NOT BE. Since 20261001 the
//   check_profile_name_content() trigger DERIVES it from first_name + last_name on any
//   update that moves either. That migration's own comment names this screen as the one
//   remaining direct writer and this slice as the moment it stops — two writers on one
//   column with disagreeing semantics was the drift Slice 1 deferred to here. Grepped at
//   build time: this was the only client write to profiles.full_name in the app (every
//   AdminScreen hit is a read; EstateAgentOnboardingScreen writes estate_agents.full_name,
//   a different table), so the column now has exactly one writer — the trigger.
//
// Every field below is bounded by a CHECK constraint in 20261001, and
// `npm run profile:check` fails if the vocabularies here and in the database disagree.
// The requiredness rule mirrors profiles_completion_requires_fields_check exactly: it
// bites only on a row whose profile_completed_at is set, which is why it is derived from
// that column rather than from the role or from this screen's own opinion.
const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
export default function ProfileScreen({ session, lang, onBack, onLangChange, onAvatarChange }) {
  const [profile, setProfile]               = useState(null)
  const [form, setForm]                     = useState({
    first_name: '', last_name: '', display_name: '',
    dobY: null, dobM: null, dobD: null,
    phone: '', nationality: '', region: null, resident_status: null,
    student_level: null, institution_id: null, preferred_language: 'English',
  })
  const [institutions, setInstitutions]     = useState([])
  const [picker, setPicker]                 = useState(null)  // 'day'|'month'|'year'|'nat'|'cc'|'inst'|'region'|'status'|'level'
  const [nameState, setNameState]           = useDisplayNameCheck(form.display_name)
  const [savedForm, setSavedForm]           = useState(null)
  const [savedCC, setSavedCC]               = useState('+90')
  const [loading, setLoading]               = useState(true)
  const [loadError, setLoadError]           = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [error, setError]                   = useState(null)
  const [legalTab, setLegalTab]             = useState(null)
  const [blocks, setBlocks]                 = useState([])
  const [avatarUrl, setAvatarUrl]           = useState(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [avatarUploading, setAvatarUploading]   = useState(false)
  const [avatarError, setAvatarError]           = useState(null)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [deleting, setDeleting]                 = useState(false)
  const [deleteError, setDeleteError]           = useState(null)
  const [selectedCC, setSelectedCC]             = useState('+90')
  const [personalOpen, setPersonalOpen]         = useState(false)

  function toggleSection(setter) {
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true)
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setter(v => !v)
  }

  useEffect(() => {
    async function loadProfile() {
      try {
        // full_name is READ (for the legacy-row fallback below) but never written back.
        const { data, error } = await supabase.from('profiles')
          .select('first_name, last_name, display_name, date_of_birth, region, resident_status, ' +
                  'student_level, institution_id, full_name, phone, nationality, nationality_code, ' +
                  'preferred_language, role, avatar_url, profile_completed_at')
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
          const dob = data.date_of_birth ? data.date_of_birth.split('-') : null
          // A row that predates the gate has full_name but no first/last. 20261001's
          // backfill split those, so this only catches a row written between the backfill
          // and now — but showing an empty name field to somebody who HAS a name reads as
          // data loss, and the first save then derives full_name from what is shown.
          const legacy = (data.full_name ?? '').trim()
          const spaceAt = legacy.lastIndexOf(' ')
          const initialForm = {
            first_name: data.first_name ?? (spaceAt > 0 ? legacy.slice(0, spaceAt) : legacy),
            last_name: data.last_name ?? (spaceAt > 0 ? legacy.slice(spaceAt + 1) : ''),
            display_name: data.display_name ?? '',
            dobY: dob ? Number(dob[0]) : null,
            dobM: dob ? Number(dob[1]) : null,
            dobD: dob ? Number(dob[2]) : null,
            phone: matched ? stored.slice(matched.code.length).trim() : stored,
            nationality: data.nationality ?? '',
            region: data.region ?? null,
            resident_status: data.resident_status ?? null,
            student_level: data.student_level ?? null,
            institution_id: data.institution_id ?? null,
            preferred_language: data.preferred_language ?? 'English',
          }
          setForm(initialForm)
          setSavedForm(initialForm)
        }
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
    loadBlocks()
    supabase.from('institutions')
      .select('id, name, short_name')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setInstitutions(data ?? []))
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
    setError(null)
    if (form.phone.trim() && !/^\d{4,15}$/.test(form.phone.trim())) {
      setError(t('pgPhoneInvalid', lang))
      return
    }
    // A partially-entered date is never a valid date, complete profile or not.
    const dobParts = [form.dobY, form.dobM, form.dobD].filter(Boolean).length
    if (dobParts > 0 && dobParts < 3) { setError(t('pgDobInvalid', lang)); return }
    // The age rule is the TRIGGER's, and it raises UNDERAGE on any date it rejects. This
    // client check exists so the user gets a field-level message instead of a server
    // error — it NEVER writes age_ineligible. That flag belongs to the wizard's one-way
    // age screen; setting it from here would sign a legitimate user out of their own
    // account over a typo they were still editing.
    if (dobParts === 3 && ageOn(form.dobY, form.dobM, form.dobD) < MIN_SIGNUP_AGE) {
      setError(t('pgDobInvalid', lang)); return
    }
    // Mirrors profiles_completion_requires_fields_check. Blanking any of these on a
    // COMPLETED row is rejected by the database, and a raw constraint error names the
    // constraint and nothing a user can act on — so it is caught here, by name.
    if (isComplete && missingRequired) { setError(t('pgRequired', lang)); return }
    // ⚠ ONLY WHEN THE NAME ACTUALLY CHANGED, and that condition is the whole point.
    // useDisplayNameCheck runs on mount against the STORED name, and containsBlockedTerm
    // reads blocked_terms live — a table admins edit at runtime. Gate this unconditionally
    // and an admin adding a term that matches an existing user's stored display name locks
    // that user out of editing ANYTHING on this screen, including their language, with the
    // only explanation inside a collapsed accordion. It would present as a dead Save
    // button and point nowhere near here.
    //
    // The database would have accepted that write: check_profile_name_content() checks
    // display_name only when NEW IS DISTINCT FROM OLD, and 20261001's header explains at
    // length why that guard exists. This mirrors it rather than re-inventing the trap it
    // was written to close.
    const nameChanged = form.display_name.trim() !== (savedForm?.display_name ?? '').trim()
    if (nameChanged && form.display_name.trim() && nameState &&
        !['available', 'checking'].includes(nameState.status)) return

    setSaving(true)
    const level = form.resident_status === 'student' ? form.student_level : null
    const { error: err } = await supabase
      .from('profiles')
      .update({
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        display_name: form.display_name.trim() || null,
        date_of_birth: dobParts === 3 ? `${form.dobY}-${pad(form.dobM)}-${pad(form.dobD)}` : null,
        phone: form.phone.trim() ? (selectedCC + form.phone.trim()) : null,
        nationality: form.nationality.trim() || null,
        nationality_code: NATIONALITY_CODES[form.nationality] ?? null,
        region: form.region,
        resident_status: form.resident_status,
        // The coupling CHECKs reject a student_level without a student status and an
        // institution without a university-level one, so the clears must ride in the SAME
        // patch as the change that causes them. Two sequential writes fail on the first.
        student_level: level,
        institution_id: INSTITUTION_REQUIRED_LEVELS.includes(level) ? form.institution_id : null,
        preferred_language: form.preferred_language,
        // full_name is DERIVED by check_profile_name_content() from the two fields above.
        // resident_status_updated_at is stamped by the same trigger. Neither is sent.
      })
      .eq('id', session.user.id)
    if (err) {
      const nameErr = await displayNameSaveError(err, form.display_name.trim())
      if (nameErr) setNameState(nameErr)
      else if (err.message?.includes('UNDERAGE')) setError(t('pgDobInvalid', lang))
      else setError(err.message)
    } else {
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

  // Derived from the form's own keys rather than a hand-written list — a field added
  // above and forgotten here would silently never enable Save, which reads as the button
  // being broken rather than as a missing comparison.
  const hasChanges = savedForm != null && (
    Object.keys(form).some(k => form[k] !== savedForm[k]) || selectedCC !== savedCC
  )

  const isComplete = profile?.profile_completed_at != null
  const studentLevel = form.resident_status === 'student' ? form.student_level : null
  const missingRequired =
    !form.first_name.trim() || !form.last_name.trim() || !form.display_name.trim() ||
    !form.dobY || !form.dobM || !form.dobD || !form.region || !form.resident_status ||
    !form.nationality.trim() || !form.phone.trim() ||
    (form.resident_status === 'student' && !form.student_level) ||
    (INSTITUTION_REQUIRED_LEVELS.includes(studentLevel) && !form.institution_id)

  const initials = (form.first_name.trim() || form.last_name.trim())
    ? [form.first_name.trim()[0], form.last_name.trim()[0]].filter(Boolean).join('').toUpperCase()
    : (session.user.email?.[0] ?? t('guestLabel', lang)[0]).toUpperCase()

  const memberId = session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()

  // Every list below is derived from the constants that mirror a CHECK constraint, never
  // written out here — profile:check fails if this screen inlines one of them.
  const months = monthNames(lang)
  const natOptions = NATIONALITIES.map(v => ({ value: v, label: getNatLabel(v, lang) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const ccOptions = COUNTRY_CODES.map(c => ({ value: c.code, label: `${c.code}  ${c.label}` }))
  const regionOptions = REGIONS.map(v => ({ value: v, label: t(REGION_LABEL_KEY[v], lang) }))
  const statusOptions = RESIDENT_STATUSES.map(v => ({ value: v, label: t(RESIDENT_STATUS_LABEL_KEY[v], lang) }))
  const levelOptions = STUDENT_LEVELS.map(v => ({ value: v, label: t(STUDENT_LEVEL_LABEL_KEY[v], lang) }))
  const instOptions = institutions.map(i => ({ value: i.id, label: i.short_name ? `${i.name} (${i.short_name})` : i.name }))
  const dayOptions = Array.from({ length: daysInMonth(form.dobY, form.dobM) }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
  const monthOptions = months.map((m, i) => ({ value: i + 1, label: m }))
  const thisYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: MAX_SIGNUP_AGE - MIN_SIGNUP_AGE + 1 },
    (_, i) => thisYear - MIN_SIGNUP_AGE - i).map(y => ({ value: y, label: String(y) }))

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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAwareForm>
        <ScrollView
          contentContainerStyle={s.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.header}>
            <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
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

          <TouchableOpacity style={s.accordionHeader} onPress={() => toggleSection(setPersonalOpen)} activeOpacity={0.7}>
            <Text style={s.accordionTitle}>{t('personalInfo', lang)}</Text>
            <Ionicons name={personalOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {personalOpen && (
            <View>
              <Text style={s.sectionHint}>{t('profileDetailsHint', lang)}</Text>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgFirstName', lang)}</Text>
                <TextInput
                  style={s.input}
                  value={form.first_name}
                  onChangeText={set('first_name')}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgLastName', lang)}</Text>
                <TextInput
                  style={s.input}
                  value={form.last_name}
                  onChangeText={set('last_name')}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              {/* Same availability UX as the wizard, from the same module — debounced
                  check, three suggestions, the reserved message with its support link.
                  A bare rejection is worse here than in the wizard: this is not a
                  first-run screen, so the user already HAS a name and is being told it
                  cannot be what they just typed. */}
              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgDisplayName', lang)}</Text>
                <TextInput
                  style={s.input}
                  value={form.display_name}
                  onChangeText={set('display_name')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={DISPLAY_NAME_MAX}
                  placeholderTextColor={colors.textSecondary}
                />
                <NameFeedback state={nameState} lang={lang} onPick={n => set('display_name')(n)} />
                <Text style={s.fieldHint}>{t('pgDisplayNameHint', lang)}</Text>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgDob', lang)}</Text>
                <View style={s.dobRow}>
                  <TouchableOpacity style={[s.pickerBtn, { flex: 1 }]} onPress={() => setPicker('day')} activeOpacity={0.7}>
                    <Text style={[s.pickerBtnText, !form.dobD && s.pickerBtnPlaceholder]} numberOfLines={1}>
                      {form.dobD ? String(form.dobD) : t('pgDay', lang)}
                    </Text>
                    <Feather name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.pickerBtn, { flex: 1 }]} onPress={() => setPicker('month')} activeOpacity={0.7}>
                    <Text style={[s.pickerBtnText, !form.dobM && s.pickerBtnPlaceholder]} numberOfLines={1}>
                      {form.dobM ? months[form.dobM - 1] : t('pgMonth', lang)}
                    </Text>
                    <Feather name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.pickerBtn, { flex: 1 }]} onPress={() => setPicker('year')} activeOpacity={0.7}>
                    <Text style={[s.pickerBtnText, !form.dobY && s.pickerBtnPlaceholder]} numberOfLines={1}>
                      {form.dobY ? String(form.dobY) : t('pgYear', lang)}
                    </Text>
                    <Feather name="chevron-down" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgNationality', lang)}</Text>
                <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('nat')} activeOpacity={0.7}>
                  <Text style={[s.pickerBtnText, !form.nationality && s.pickerBtnPlaceholder]}>
                    {form.nationality ? getNatLabel(form.nationality, lang) : t('selectNationality', lang)}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgPhone', lang)}</Text>
                <View style={s.phoneRow}>
                  <TouchableOpacity style={s.ccBtn} onPress={() => setPicker('cc')}>
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
                    maxLength={15}
                  />
                </View>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgRegion', lang)}</Text>
                <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('region')} activeOpacity={0.7}>
                  <Text style={[s.pickerBtnText, !form.region && s.pickerBtnPlaceholder]}>
                    {form.region ? t(REGION_LABEL_KEY[form.region], lang) : '—'}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('pgResidentStatus', lang)}</Text>
                <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('status')} activeOpacity={0.7}>
                  <Text style={[s.pickerBtnText, !form.resident_status && s.pickerBtnPlaceholder]}>
                    {form.resident_status ? t(RESIDENT_STATUS_LABEL_KEY[form.resident_status], lang) : '—'}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {form.resident_status === 'student' && (
                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>{t('pgStudentLevel', lang)}</Text>
                  <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('level')} activeOpacity={0.7}>
                    <Text style={[s.pickerBtnText, !form.student_level && s.pickerBtnPlaceholder]}>
                      {form.student_level ? t(STUDENT_LEVEL_LABEL_KEY[form.student_level], lang) : '—'}
                    </Text>
                    <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}

              {form.resident_status === 'student' && INSTITUTION_REQUIRED_LEVELS.includes(form.student_level) && (
                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>{t('pgInstitution', lang)}</Text>
                  <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('inst')} activeOpacity={0.7}>
                    <Text style={[s.pickerBtnText, !form.institution_id && s.pickerBtnPlaceholder]}>
                      {instOptions.find(o => o.value === form.institution_id)?.label || t('pgInstitutionSearch', lang)}
                    </Text>
                    <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}

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

          {/* One shared SearchModal per field, replacing the two bespoke Modal+FlatList
              pickers this screen used to carry. The wizard already renders seven of these
              over the same vocabularies; a second implementation on the screen that edits
              the same columns is the drift class this repo keeps paying for. Selecting a
              resident status other than 'student' clears the level and institution in the
              SAME setForm call — the coupling CHECKs reject them as a later write. */}
          <SearchModal visible={picker === 'day'} title={t('pgDay', lang)} options={dayOptions}
            value={form.dobD} onSelect={v => { set('dobD')(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'month'} title={t('pgMonth', lang)} options={monthOptions}
            value={form.dobM} onSelect={v => { set('dobM')(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'year'} title={t('pgYear', lang)} options={yearOptions}
            value={form.dobY} onSelect={v => { set('dobY')(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'nat'} searchable title={t('pgNationality', lang)}
            searchPlaceholder={t('pgNationalitySearch', lang)} options={natOptions}
            value={form.nationality} onSelect={v => { set('nationality')(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'cc'} searchable title={t('pgPhoneCountry', lang)}
            searchPlaceholder={t('pgNationalitySearch', lang)} options={ccOptions}
            value={selectedCC} onSelect={v => { setSelectedCC(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'region'} title={t('pgRegion', lang)} options={regionOptions}
            value={form.region} onSelect={v => { set('region')(v); setPicker(null) }} onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'status'} title={t('pgResidentStatus', lang)} options={statusOptions}
            value={form.resident_status}
            onSelect={v => {
              setForm(f => ({
                ...f,
                resident_status: v,
                student_level: v === 'student' ? f.student_level : null,
                institution_id: v === 'student' ? f.institution_id : null,
              }))
              setPicker(null)
            }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'level'} title={t('pgStudentLevel', lang)} options={levelOptions}
            value={form.student_level}
            onSelect={v => {
              setForm(f => ({
                ...f,
                student_level: v,
                institution_id: INSTITUTION_REQUIRED_LEVELS.includes(v) ? f.institution_id : null,
              }))
              setPicker(null)
            }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'inst'} searchable title={t('pgInstitution', lang)}
            searchPlaceholder={t('pgInstitutionSearch', lang)} options={instOptions}
            value={form.institution_id} onSelect={v => { set('institution_id')(v); setPicker(null) }} onClose={() => setPicker(null)} />
        </ScrollView>
      </KeyboardAwareForm>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container:        { paddingHorizontal: 20, paddingBottom: 48 },
  sectionHint:      { fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18, marginBottom: 14 },
  fieldHint:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17, marginTop: 6 },
  dobRow:           { flexDirection: 'row', gap: 8 },

  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 20 },
  title:            { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  backBtn:          { flexDirection: 'row', alignItems: 'center', gap: 2 },
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

})
