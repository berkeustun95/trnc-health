// Profile completion gate — the wizard. Rendered ONLY from App.js's gateActive block,
// which is a five-line allow-list of what a gated user may reach; nothing here routes
// anywhere except through the props it is given.
//
// ─── THREE THINGS THAT ARE NOT NEGOTIABLE HERE ──────────────────────────────
//
// 1. NO SKIP, NO DISMISS. There is no close button, no "later", and the caller passes no
//    onBack. Android's hardware back moves between steps and, on the first step, is left
//    to close the app — see App.js. A back button that does nothing reads as a frozen
//    screen; closing the app is honest and leaves the gate in place next launch.
//
// 2. THE EMERGENCY BUTTON IS ON EVERY STEP, INCLUDING THE INTRO. It is a HEADER button,
//    not a footer bar: on Android the keyboard is up for most of Steps 1 and 2, and a
//    bottom bar is covered at exactly the moment somebody would need it. It is AMBER,
//    never red — red reads as an error or a destructive action to anyone scanning the
//    screen, and this is neither.
//
// 3. EVERY STEP PERSISTS ON ADVANCE. A force-quit resumes where it left off. Only the
//    final advance writes profile_completed_at + profile_schema_version, and
//    profiles_completion_requires_fields_check (20261001) makes that write FAIL LOUDLY
//    if any required field is somehow absent, rather than marking an empty profile done.

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Modal, FlatList, Linking, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { NATIONALITIES, NATIONALITY_CODES, getNatLabel } from '../constants/nationalityTranslations'
import { COUNTRY_CODES } from '../constants/countryCodes'
import { monthNames } from '../constants/months'
import {
  MIN_SIGNUP_AGE, MAX_SIGNUP_AGE, CURRENT_PROFILE_SCHEMA_VERSION,
  RESIDENT_STATUSES, STUDENT_LEVELS, INSTITUTION_REQUIRED_LEVELS,
  RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY,
  DISPLAY_NAME_MIN, DISPLAY_NAME_MAX, DEBOUNCE_MS, SUPPORT_EMAIL,
  STEP_TITLE_KEY, HELP_ROW_LABEL_KEY,
} from '../constants/profileGate'
import { isReservedDisplayName } from '../utils/reservedNames'
import { containsBlockedTerm } from '../utils/profanity'

const TOTAL_STEPS = 3

// ─── Presentational pieces, defined OUTSIDE the screen ──────────────────────
// A component declared inside its parent is a new type on every render, so React
// unmounts and remounts it — which blurs a TextInput mid-typing. House rule.

function Dots({ step }) {
  return (
    <View style={s.dots}>
      {[1, 2, 3].map(i => (
        <View key={i} style={[s.dot, i === step && s.dotOn, i < step && s.dotDone]} />
      ))}
    </View>
  )
}

function Field({ label, hint, children }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  )
}

function ChipGroup({ options, value, onSelect }) {
  return (
    <View style={s.chips}>
      {options.map(o => (
        <TouchableOpacity
          key={o.value}
          style={[s.chip, value === o.value && s.chipOn]}
          onPress={() => onSelect(o.value)}
          activeOpacity={0.8}
        >
          <Text style={[s.chipText, value === o.value && s.chipTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function RowGroup({ options, value, onSelect }) {
  return (
    <View>
      {options.map(o => (
        <TouchableOpacity
          key={o.value}
          style={[s.row, value === o.value && s.rowOn]}
          onPress={() => onSelect(o.value)}
          activeOpacity={0.8}
        >
          <Text style={[s.rowText, value === o.value && s.rowTextOn]}>{o.label}</Text>
          {value === o.value && <Feather name="check" size={16} color={colors.primary} />}
        </TouchableOpacity>
      ))}
    </View>
  )
}

function SelectField({ value, placeholder, onPress, flex }) {
  return (
    <TouchableOpacity style={[s.select, flex && { flex: 1 }]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.selectText, !value && s.selectPlaceholder]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

// One searchable modal serves nationality, institutions, country codes and the date
// parts. options = [{ value, label }].
function SearchModal({ visible, title, searchPlaceholder, options, value, searchable, onSelect, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    if (!searchable || !q.trim()) return options
    const needle = q.trim().toLocaleLowerCase()
    return options.filter(o => o.label.toLocaleLowerCase().includes(needle))
  }, [options, q, searchable])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {searchable && (
            <TextInput
              style={s.search}
              value={q}
              onChangeText={setQ}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              autoCorrect={false}
            />
          )}
          <FlatList
            data={list}
            keyExtractor={o => String(o.value)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.modalItem, value === item.value && s.modalItemOn]}
                onPress={() => { setQ(''); onSelect(item.value) }}
              >
                <Text style={[s.modalItemText, value === item.value && s.modalItemTextOn]}>{item.label}</Text>
                {value === item.value && <Feather name="check" size={15} color={colors.primary} />}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')

// Age at a given date, in whole years. Mirrors the trigger's
// `date_of_birth > current_date - interval '13 years'`.
function ageOn(y, m, d, now = new Date()) {
  let age = now.getFullYear() - y
  const beforeBirthday =
    now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

function daysInMonth(y, m) {
  if (!y || !m) return 31
  return new Date(y, m, 0).getDate()
}

// Where to resume. display_name is the marker that Step 1 completed, so a force-quit
// mid-wizard comes back to the right place instead of starting over.
function resumeStep(p) {
  if (!p || !p.display_name) return 0                       // intro, then Step 1
  if (!p.date_of_birth || !p.nationality_code || !p.phone) return 2
  return 3
}

export default function ProfileSetupScreen({
  session, lang, profile, prefillRegion, onDone,
  onEmergencyNumbers, onDutyList, onHealthDirectory,
}) {
  const [step, setStep] = useState(() => resumeStep(profile))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [ageBlocked, setAgeBlocked] = useState(false)

  // Step 1
  const [firstName, setFirstName] = useState(profile?.first_name ?? '')
  const [lastName, setLastName] = useState(profile?.last_name ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [nameState, setNameState] = useState(null)   // {status, suggestions?}

  // Step 2
  const dob = profile?.date_of_birth ? profile.date_of_birth.split('-') : null
  const [dobY, setDobY] = useState(dob ? Number(dob[0]) : null)
  const [dobM, setDobM] = useState(dob ? Number(dob[1]) : null)
  const [dobD, setDobD] = useState(dob ? Number(dob[2]) : null)
  const [nationality, setNationality] = useState(profile?.nationality ?? null)
  const [cc, setCc] = useState(null)
  const [phone, setPhone] = useState('')

  // Step 3
  const [region, setRegion] = useState(profile?.region ?? prefillRegion ?? null)
  const [status, setStatus] = useState(profile?.resident_status ?? null)
  const [level, setLevel] = useState(profile?.student_level ?? null)
  const [institution, setInstitution] = useState(profile?.institution_id ?? null)
  const [institutions, setInstitutions] = useState([])

  const [picker, setPicker] = useState(null)  // 'day' | 'month' | 'year' | 'nat' | 'cc' | 'inst'

  const months = useMemo(() => monthNames(lang), [lang])
  const thisYear = new Date().getFullYear()

  // Split a stored phone back into code + number, so a resumed Step 2 is pre-filled.
  useEffect(() => {
    const stored = profile?.phone ?? ''
    if (!stored) return
    const match = COUNTRY_CODES.find(c => stored.startsWith(c.code))
    if (match) { setCc(match.code); setPhone(stored.slice(match.code.length).trim()) }
    else setPhone(stored)
  }, [profile?.phone])

  useEffect(() => {
    supabase.from('institutions')
      .select('id, name, short_name')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setInstitutions(data ?? []))
  }, [])

  // ─── Display-name availability ────────────────────────────────────────────
  // The two client mirrors run FIRST because they are free and instant: a reserved or
  // profane name never costs a round trip. The RPC is the authority on "taken", which
  // no client can answer — profiles has three SELECT policies and none of them lets a
  // customer see another row, so a client-side lookup would report "available" for every
  // name in the database. See 20261002's header.
  const nameReqId = useRef(0)
  useEffect(() => {
    const name = displayName.trim()
    const id = ++nameReqId.current
    if (!name) { setNameState(null); return }
    if (name.length < DISPLAY_NAME_MIN) { setNameState({ status: 'short' }); return }
    if (name.length > DISPLAY_NAME_MAX) { setNameState({ status: 'long' }); return }
    if (isReservedDisplayName(name)) { setNameState({ status: 'reserved' }); return }

    setNameState({ status: 'checking' })
    const handle = setTimeout(async () => {
      if (await containsBlockedTerm(name)) {
        if (nameReqId.current === id) setNameState({ status: 'blocked' })
        return
      }
      const { data, error } = await supabase.rpc('display_name_available', { p_name: name })
      if (nameReqId.current !== id) return
      // Fail OPEN on a network error: the unique index is the real boundary, so the worst
      // case is a 23505 on advance, which is handled. Blocking Continue on a flaky
      // connection would strand the user inside a gate they cannot skip.
      if (error || !data) { setNameState(null); return }
      setNameState({ status: data.status, suggestions: data.suggestions ?? [] })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [displayName])

  // ─── Validity per step ────────────────────────────────────────────────────
  const nameOk = nameState?.status === 'available'
  const step1Ok = firstName.trim() && lastName.trim() && nameOk
  const step2Ok = dobY && dobM && dobD && nationality && cc && /^\d{4,15}$/.test(phone.trim())
  const step3Ok = region && status &&
    (status !== 'student' || level) &&
    (!INSTITUTION_REQUIRED_LEVELS.includes(level) || institution)

  async function save(patch) {
    setSaving(true)
    setSaveError(false)
    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
    setSaving(false)
    return error
  }

  async function advance() {
    if (saving) return
    if (step === 0) { setStep(1); return }

    if (step === 1) {
      const error = await save({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName.trim(),
      })
      if (!error) { setStep(2); return }
      // The race this whole inline check exists to avoid, arriving anyway: somebody took
      // the name between the check and the write. Re-ask and show fresh suggestions
      // rather than surfacing a raw Postgres error inside a mandatory gate.
      if (error.code === '23505') {
        const { data } = await supabase.rpc('display_name_available', { p_name: displayName.trim() })
        setNameState({ status: 'race', suggestions: data?.suggestions ?? [] })
        return
      }
      if (error.message?.includes('DISPLAY_NAME_RESERVED')) { setNameState({ status: 'reserved' }); return }
      if (error.message?.includes('BLOCKED_TERM')) { setNameState({ status: 'blocked' }); return }
      setSaveError(true)
      return
    }

    if (step === 2) {
      // AGE. Checked before anything is written, and a disqualifying date is NEVER
      // stored — only the flag is. The trigger backstops a client that sends it anyway,
      // and profiles_age_ineligible_no_dob_check backstops both.
      if (ageOn(dobY, dobM, dobD) < MIN_SIGNUP_AGE) {
        await save({ age_ineligible: true })
        setAgeBlocked(true)
        return
      }
      const error = await save({
        date_of_birth: `${dobY}-${pad(dobM)}-${pad(dobD)}`,
        nationality,                                   // legacy English label
        nationality_code: NATIONALITY_CODES[nationality] ?? null,
        phone: cc + phone.trim(),
      })
      if (error) { setSaveError(true); return }
      setStep(3)
      return
    }

    const error = await save({
      region,
      resident_status: status,
      student_level: status === 'student' ? level : null,
      institution_id: INSTITUTION_REQUIRED_LEVELS.includes(level) ? institution : null,
      profile_completed_at: new Date().toISOString(),
      profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
    })
    if (error) { setSaveError(true); return }
    onDone()
  }

  async function signOutIneligible() {
    await supabase.auth.signOut()
  }

  // ─── The age screen ───────────────────────────────────────────────────────
  // Reached only AFTER a disqualifying date was submitted. Nothing before this point
  // states or hints at a minimum age — that is the Google Play neutral-age-screen rule,
  // and it is why the message lives here and not beside the field.
  if (ageBlocked) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.ageWrap}>
          <View style={s.ageIcon}><Ionicons name="information-circle-outline" size={30} color={colors.textSecondary} /></View>
          <Text style={s.ageTitle}>{t('pgAgeTitle', lang)}</Text>
          <Text style={s.ageBody}>{t('pgAgeMessage', lang)}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={signOutIneligible} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>{t('pgAgeSignOut', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const statusOptions = RESIDENT_STATUSES.map(v => ({ value: v, label: t(RESIDENT_STATUS_LABEL_KEY[v], lang) }))
  const levelOptions = STUDENT_LEVELS.map(v => ({ value: v, label: t(STUDENT_LEVEL_LABEL_KEY[v], lang) }))
  const regionOptions = REGIONS.map(v => ({ value: v, label: t(REGION_LABEL_KEY[v], lang) }))
  const natOptions = NATIONALITIES.map(v => ({ value: v, label: getNatLabel(v, lang) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const instOptions = institutions.map(i => ({ value: i.id, label: i.short_name ? `${i.name} (${i.short_name})` : i.name }))
  const ccOptions = COUNTRY_CODES.map(c => ({ value: c.code, label: `${c.code}  ${c.label}` }))
  const dayOptions = Array.from({ length: daysInMonth(dobY, dobM) }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
  const monthOptions = months.map((m, i) => ({ value: i + 1, label: m }))
  // currentYear-100 … currentYear-MIN_SIGNUP_AGE, newest first.
  const yearOptions = Array.from({ length: MAX_SIGNUP_AGE - MIN_SIGNUP_AGE + 1 },
    (_, i) => thisYear - MIN_SIGNUP_AGE - i).map(y => ({ value: y, label: String(y) }))

  const canAdvance = step === 0 || (step === 1 && step1Ok) || (step === 2 && step2Ok) || (step === 3 && step3Ok)
  const title = step === 0 ? '' : t(STEP_TITLE_KEY[step], lang)

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAwareForm>
        {/* flexShrink: 0 — a fixed-height row above a scrollable list in a flex:1 column
            gets vertically compressed the moment the list overflows, cropping its text.
            It only reproduces once the form is long enough to scroll, which Turkish
            reaches before English does. House rule. */}
        <View style={s.header}>
          {step > 0 ? <Dots step={step} /> : <View style={s.dots} />}
          <TouchableOpacity style={s.helpBtn} onPress={() => setHelpOpen(true)} activeOpacity={0.8}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.tintLifestyleFg} />
            <Text style={s.helpBtnText}>{t('pgHelpButton', lang)}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step > 0 && <Text style={s.stepLabel}>{t('pgStep', lang).replace('{n}', step).replace('{total}', TOTAL_STEPS)}</Text>}
          {step > 0 && <Text style={s.title}>{title}</Text>}

          {step === 0 && (
            <View style={s.intro}>
              <Text style={s.introTitle}>{t('pgIntroTitle', lang)}</Text>
              <Text style={s.introBody}>{t('pgIntroBody', lang)}</Text>
              {/* The data line matters more than the reason: for a returning user the
                  question is not "why do you want this" but "what will you do with it". */}
              <View style={s.introData}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.primaryDark} />
                <Text style={s.introDataText}>{t('pgIntroData', lang)}</Text>
              </View>
              <Text style={s.introTime}>{t('pgIntroTime', lang)}</Text>
            </View>
          )}

          {step === 1 && (
            <>
              <Field label={t('pgFirstName', lang)}>
                <TextInput style={s.input} value={firstName} onChangeText={setFirstName}
                  autoCapitalize="words" autoCorrect={false} />
              </Field>
              <Field label={t('pgLastName', lang)}>
                <TextInput style={s.input} value={lastName} onChangeText={setLastName}
                  autoCapitalize="words" autoCorrect={false} />
              </Field>
              <Field label={t('pgDisplayName', lang)} hint={t('pgDisplayNameHint', lang)}>
                <TextInput style={s.input} value={displayName} onChangeText={setDisplayName}
                  autoCapitalize="none" autoCorrect={false} maxLength={DISPLAY_NAME_MAX} />
                <NameFeedback state={nameState} lang={lang} onPick={n => setDisplayName(n)} />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              {/* NEUTRAL AGE SCREEN. No minimum stated, no default date, free entry.
                  Nothing on this step may hint at the threshold. */}
              <Field label={t('pgDob', lang)}>
                <View style={s.dobRow}>
                  <SelectField flex value={dobD ? String(dobD) : ''} placeholder={t('pgDay', lang)} onPress={() => setPicker('day')} />
                  <SelectField flex value={dobM ? months[dobM - 1] : ''} placeholder={t('pgMonth', lang)} onPress={() => setPicker('month')} />
                  <SelectField flex value={dobY ? String(dobY) : ''} placeholder={t('pgYear', lang)} onPress={() => setPicker('year')} />
                </View>
              </Field>
              <Field label={t('pgNationality', lang)}>
                <SelectField value={nationality ? getNatLabel(nationality, lang) : ''}
                  placeholder={t('pgNationalitySearch', lang)} onPress={() => setPicker('nat')} />
              </Field>
              <Field label={t('pgPhone', lang)}>
                <View style={s.phoneRow}>
                  <SelectField value={cc || ''} placeholder={t('pgPhoneCountry', lang)} onPress={() => setPicker('cc')} />
                  <TextInput style={[s.input, { flex: 1 }]} value={phone} onChangeText={setPhone}
                    keyboardType="phone-pad" maxLength={15} />
                </View>
                {phone.trim() && !/^\d{4,15}$/.test(phone.trim())
                  ? <Text style={s.err}>{t('pgPhoneInvalid', lang)}</Text> : null}
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field label={t('pgRegion', lang)}>
                <ChipGroup options={regionOptions} value={region} onSelect={setRegion} />
              </Field>
              <Field label={t('pgResidentStatus', lang)} hint={t('pgResidentHelper', lang)}>
                <RowGroup options={statusOptions} value={status}
                  onSelect={v => { setStatus(v); if (v !== 'student') { setLevel(null); setInstitution(null) } }} />
              </Field>
              {status === 'student' && (
                <Field label={t('pgStudentLevel', lang)}>
                  <RowGroup options={levelOptions} value={level}
                    onSelect={v => { setLevel(v); if (!INSTITUTION_REQUIRED_LEVELS.includes(v)) setInstitution(null) }} />
                </Field>
              )}
              {status === 'student' && INSTITUTION_REQUIRED_LEVELS.includes(level) && (
                <Field label={t('pgInstitution', lang)}>
                  <SelectField
                    value={instOptions.find(o => o.value === institution)?.label || ''}
                    placeholder={t('pgInstitutionSearch', lang)}
                    onPress={() => setPicker('inst')}
                  />
                </Field>
              )}
            </>
          )}

          {saveError && <Text style={s.err}>{t('pgSaveError', lang)}</Text>}
        </ScrollView>

        <View style={s.footer}>
          {step > 1 && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)} activeOpacity={0.8}>
              <Text style={s.backBtnText}>{t('pgBack', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.primaryBtn, { flex: 1 }, !canAdvance && s.primaryBtnOff]}
            onPress={advance}
            disabled={!canAdvance || saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.primaryBtnText}>
                  {step === 0 ? t('pgIntroStart', lang) : step === TOTAL_STEPS ? t('pgFinish', lang) : t('pgContinue', lang)}
                </Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAwareForm>

      <SearchModal visible={picker === 'day'} title={t('pgDay', lang)} options={dayOptions}
        value={dobD} onSelect={v => { setDobD(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'month'} title={t('pgMonth', lang)} options={monthOptions}
        value={dobM} onSelect={v => { setDobM(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'year'} title={t('pgYear', lang)} options={yearOptions}
        value={dobY} onSelect={v => { setDobY(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'nat'} searchable title={t('pgNationality', lang)}
        searchPlaceholder={t('pgNationalitySearch', lang)} options={natOptions}
        value={nationality} onSelect={v => { setNationality(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'cc'} searchable title={t('pgPhoneCountry', lang)}
        searchPlaceholder={t('pgNationalitySearch', lang)} options={ccOptions}
        value={cc} onSelect={v => { setCc(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'inst'} searchable title={t('pgInstitution', lang)}
        searchPlaceholder={t('pgInstitutionSearch', lang)} options={instOptions}
        value={institution} onSelect={v => { setInstitution(v); setPicker(null) }} onClose={() => setPicker(null)} />

      <Modal visible={helpOpen} animationType="slide" transparent onRequestClose={() => setHelpOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.helpCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{t('pgHelpTitle', lang)}</Text>
              <TouchableOpacity onPress={() => setHelpOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {[
              { key: HELP_ROW_LABEL_KEY.numbers, icon: 'call-outline', run: onEmergencyNumbers },
              { key: HELP_ROW_LABEL_KEY.duty, icon: 'medkit-outline', run: onDutyList },
              { key: HELP_ROW_LABEL_KEY.directory, icon: 'business-outline', run: onHealthDirectory },
            ].map(row => (
              <TouchableOpacity key={row.key} style={s.helpRow}
                onPress={() => { setHelpOpen(false); row.run?.() }} activeOpacity={0.8}>
                <Ionicons name={row.icon} size={19} color={colors.tintLifestyleFg} />
                <Text style={s.helpRowText}>{t(row.key, lang)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
            <Text style={s.helpNote}>{t('pgReadOnlyNotice', lang)}</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// Five states, five distinct messages. A RESERVED name is not an obscenity and must not
// be told it is one — "Ada" is a common Turkish woman's name, so that false positive is
// predictable rather than hypothetical, and the message offers a way out.
function NameFeedback({ state, lang, onPick }) {
  if (!state) return null
  const { status, suggestions = [] } = state

  if (status === 'checking') return <Text style={s.muted}>{t('pgChecking', lang)}</Text>
  if (status === 'short') return <Text style={s.err}>{t('pgTooShort', lang)}</Text>
  if (status === 'long' || status === 'invalid') return <Text style={s.err}>{t('pgTooLong', lang)}</Text>
  if (status === 'blocked') return <Text style={s.err}>{t('contentBlockedTerm', lang)}</Text>
  if (status === 'available') {
    return (
      <View style={s.okRow}>
        <Feather name="check-circle" size={14} color={colors.success} />
        <Text style={s.ok}>{t('pgAvailable', lang)}</Text>
      </View>
    )
  }
  if (status === 'reserved') {
    return (
      <View>
        <Text style={s.err}>{t('pgReserved', lang)}</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ADA – display name')}`)}
          activeOpacity={0.7}
        >
          <Text style={s.link}>{t('pgReservedEmail', lang)}</Text>
        </TouchableOpacity>
      </View>
    )
  }
  // taken | race
  return (
    <View>
      {/* Two separate lookups rather than one ternary INSIDE the call. The i18n guard
          finds keys by scanning for a literal single-quoted argument, so passing it a
          conditional hides BOTH keys from coverage.
          NB: do not write the example out in this comment — the scanner reads comments
          too, and the first version of it registered a phantom key called "key". */}
      <Text style={s.err}>{status === 'race' ? t('pgNameRace', lang) : t('pgTaken', lang)}</Text>
      {suggestions.length > 0 && (
        <>
          {status !== 'race' && <Text style={s.muted}>{t('pgTakenSuggest', lang)}</Text>}
          <View style={s.chips}>
            {suggestions.map(n => (
              <TouchableOpacity key={n} style={s.suggest} onPress={() => onPick(n)} activeOpacity={0.8}>
                <Text style={s.suggestText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.primary },
  dotDone: { backgroundColor: colors.primary },
  // AMBER, not red. Red reads as an error or a destructive action to anyone scanning
  // the screen; this is a way to get help, not a warning that something went wrong.
  helpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentLight, borderColor: '#F5C9B4', borderWidth: 1,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
  },
  helpBtnText: { color: colors.tintLifestyleFg, fontSize: 12.5, fontWeight: '700' },

  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  stepLabel: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600', marginBottom: 4 },
  title: { color: colors.textPrimary, fontSize: 23, fontWeight: '700', marginBottom: 18 },

  intro: { paddingTop: 8 },
  introTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  introBody: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  introData: {
    flexDirection: 'row', gap: 10, backgroundColor: colors.primaryLight,
    padding: 14, borderRadius: radius.md, marginBottom: 14,
  },
  introDataText: { flex: 1, color: colors.primaryDark, fontSize: 13.5, lineHeight: 20 },
  introTime: { color: colors.textSecondary, fontSize: 13 },

  field: { marginBottom: 18 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 7 },
  hint: { color: colors.textSecondary, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15, color: colors.textPrimary,
  },
  select: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  },
  selectText: { fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
  selectPlaceholder: { color: colors.textSecondary },
  dobRow: { flexDirection: 'row', gap: 8 },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: 13.5, color: colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: colors.primaryDark },
  suggest: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary,
  },
  suggestText: { fontSize: 13.5, color: colors.primaryDark, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  rowText: { fontSize: 14.5, color: colors.textPrimary, flexShrink: 1, paddingRight: 8 },
  rowTextOn: { color: colors.primaryDark, fontWeight: '600' },

  okRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  ok: { color: colors.success, fontSize: 13, fontWeight: '600' },
  err: { color: colors.danger, fontSize: 13, marginTop: 7, lineHeight: 19 },
  muted: { color: colors.textSecondary, fontSize: 13, marginTop: 7 },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 6 },

  footer: {
    flexShrink: 0, flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  primaryBtnOff: { backgroundColor: colors.border, shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  backBtn: {
    paddingHorizontal: 20, paddingVertical: 15, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(26,43,51,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 24, maxHeight: '75%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, paddingRight: 10 },
  search: {
    backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8, fontSize: 15, marginBottom: 10,
    color: colors.textPrimary,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalItemOn: {},
  modalItemText: { fontSize: 15, color: colors.textPrimary, flexShrink: 1, paddingRight: 10 },
  modalItemTextOn: { color: colors.primary, fontWeight: '700' },

  helpCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 26,
  },
  helpRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  helpRowText: { flex: 1, fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
  helpNote: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 14 },

  ageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  ageIcon: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  ageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  ageBody: { fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 26 },
})
