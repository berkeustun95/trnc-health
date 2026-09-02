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
//    not a footer bar: on Android the keyboard is up for most of Step 1, and a bottom
//    bar is covered at exactly the moment somebody would need it. It is AMBER, never
//    red — red reads as an error or a destructive action to anyone scanning the screen,
//    and this is neither.
//
//    It is NOT part of what SHOW_WIZARD_HEADINGS hides. That flag removes heading TEXT;
//    the row it sits in, and the progress dots beside it, stay at either value.
//
//    THE LANGUAGE PILL SITS BESIDE IT, FOR THE SAME REASON AND ON EVERY STEP INCLUDING
//    THE INTRO. This gate cannot be skipped, so a user whose app opened in a language
//    they cannot read had no way out at all — not back, not past, not to a menu, because
//    App.js's global language modal lives inside the tab-shell return and a gated user
//    never reaches it. That is the worst place in the app to have no language control
//    and it was the only screen without one. NEUTRAL styling, not amber: amber is the
//    emergency pill's, and two amber pills in one row make neither of them mean urgent.
//
// 3. EVERY STEP PERSISTS ON ADVANCE. A force-quit resumes where it left off. Only the
//    final advance writes profile_completed_at + profile_schema_version, and
//    profiles_completion_requires_fields_check (20261001) makes that write FAIL LOUDLY
//    if any required field is somehow absent, rather than marking an empty profile done.

import { useState, useEffect, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Modal, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import SearchModal from '../components/SearchModal'
import { pad, ageOn, daysInMonth } from '../utils/profileFields'
import { useDisplayNameCheck, displayNameSaveError, NameFeedback } from '../components/DisplayNameCheck'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { SHOW_WIZARD_HEADINGS } from '../constants/flags'
import { t, LANGUAGES, LANG_CODES } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { NATIONALITIES, NATIONALITY_CODES, getNatLabel } from '../constants/nationalityTranslations'
import { COUNTRY_CODES } from '../constants/countryCodes'
import { monthNames } from '../constants/months'
import {
  MIN_SIGNUP_AGE, MAX_SIGNUP_AGE, CURRENT_PROFILE_SCHEMA_VERSION,
  RESIDENT_STATUSES, STUDENT_LEVELS, INSTITUTION_REQUIRED_LEVELS,
  RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY,
  DISPLAY_NAME_MAX, STEP_TITLE_KEY, HELP_ROW_LABEL_KEY,
} from '../constants/profileGate'

// TWO steps. What used to be Steps 1 and 2 — the six required identity fields — is now
// one screen; the old Step 3 (region, status, the student conditional) became Step 2.
// Persistence is unchanged in shape but not in size: Step 1 now writes SIX columns in
// ONE atomic patch, so a name race aborts the date of birth with it and the retry is
// clean. There is no half-saved state between the two former steps any more, which is
// why resumeStep() no longer has a landing place between them.
const TOTAL_STEPS = 2

// ─── Presentational pieces, defined OUTSIDE the screen ──────────────────────
// A component declared inside its parent is a new type on every render, so React
// unmounts and remounts it — which blurs a TextInput mid-typing. House rule.

// Derived from TOTAL_STEPS, never a literal — a hardcoded dot count is a decoration
// that disagrees with the wizard the day the step count moves, and it moved today.
const STEP_NUMBERS = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1)

function Dots({ step }) {
  return (
    <View style={s.dots}>
      {STEP_NUMBERS.map(i => (
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Where to resume. display_name is the marker that Step 1 completed, so a force-quit
// mid-wizard comes back to the right place instead of starting over.
//
// The middle branch is now UNREACHABLE THROUGH THIS WIZARD — Step 1 writes the name and
// the date of birth in one patch, so display_name can no longer exist without them. It
// stays because a row written by the THREE-step version still can be in that state, and
// this screen has been on a test device. Sending such a row back to Step 1 refills every
// field from the profile and costs one extra Continue; the alternative is advancing past
// fields the completion CHECK requires, which fails at the very end with nothing to say
// why. Delete it only once no row can predate the merge.
function resumeStep(p) {
  if (!p || !p.display_name) return 0                       // intro, then Step 1
  if (!p.date_of_birth || !p.nationality_code || !p.phone) return 1
  return 2
}

export default function ProfileSetupScreen({
  session, lang, profile, prefillRegion, onDone,
  onEmergencyNumbers, onDutyList, onHealthDirectory, onLangChange,
}) {
  const [step, setStep] = useState(() => resumeStep(profile))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [ageBlocked, setAgeBlocked] = useState(false)

  // Step 1 — name half
  const [firstName, setFirstName] = useState(profile?.first_name ?? '')
  const [lastName, setLastName] = useState(profile?.last_name ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [nameState, setNameState] = useDisplayNameCheck(displayName)

  // Step 1 — date / nationality / phone half
  const dob = profile?.date_of_birth ? profile.date_of_birth.split('-') : null
  const [dobY, setDobY] = useState(dob ? Number(dob[0]) : null)
  const [dobM, setDobM] = useState(dob ? Number(dob[1]) : null)
  const [dobD, setDobD] = useState(dob ? Number(dob[2]) : null)
  const [nationality, setNationality] = useState(profile?.nationality ?? null)
  const [cc, setCc] = useState(null)
  const [phone, setPhone] = useState('')

  // Step 2
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

  // ─── Validity per step ────────────────────────────────────────────────────
  const nameOk = nameState?.status === 'available'
  const step1Ok = firstName.trim() && lastName.trim() && nameOk &&
    dobY && dobM && dobD && nationality && cc && /^\d{4,15}$/.test(phone.trim())
  const step2Ok = region && status &&
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
      // AGE FIRST, and before anything at all is written. A disqualifying date is NEVER
      // stored — only the flag is, and the flag write carries nothing else, so a name
      // and a date of birth do not reach the row on the way past. The trigger backstops
      // a client that sends it anyway, and profiles_age_ineligible_no_dob_check
      // backstops both.
      if (ageOn(dobY, dobM, dobD) < MIN_SIGNUP_AGE) {
        await save({ age_ineligible: true })
        setAgeBlocked(true)
        return
      }
      // ONE patch for all six fields. The merge makes this atomic rather than two
      // sequential writes, which is strictly better: the failure that actually happens
      // here is the display-name race below, and under two writes it would land AFTER
      // the date of birth was already committed — leaving a row that is half of Step 1
      // and a retry that re-writes fields it did not need to touch.
      const error = await save({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName.trim(),
        date_of_birth: `${dobY}-${pad(dobM)}-${pad(dobD)}`,
        nationality,                                   // legacy English label
        nationality_code: NATIONALITY_CODES[nationality] ?? null,
        phone: cc + phone.trim(),
      })
      if (!error) { setStep(2); return }
      // The race this whole inline check exists to avoid, arriving anyway: somebody took
      // the name between the check and the write. displayNameSaveError re-asks and
      // returns fresh suggestions rather than surfacing a raw Postgres error inside a
      // mandatory gate; a null back from it means the failure was not about the name.
      const nameErr = await displayNameSaveError(error, displayName.trim())
      if (nameErr) { setNameState(nameErr); return }
      setSaveError(true)
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
  // NATIVE names, never translated ones: somebody who cannot read the current language
  // has to be able to find their own in this list.
  const langOptions = LANGUAGES.map(l => ({ value: l.key, label: l.label }))
  const dayOptions = Array.from({ length: daysInMonth(dobY, dobM) }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
  const monthOptions = months.map((m, i) => ({ value: i + 1, label: m }))
  // currentYear-100 … currentYear-MIN_SIGNUP_AGE, newest first.
  const yearOptions = Array.from({ length: MAX_SIGNUP_AGE - MIN_SIGNUP_AGE + 1 },
    (_, i) => thisYear - MIN_SIGNUP_AGE - i).map(y => ({ value: y, label: String(y) }))

  const canAdvance = step === 0 || (step === 1 && step1Ok) || (step === 2 && step2Ok)
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
          <View style={s.headerActions}>
            <TouchableOpacity style={s.langBtn} onPress={() => setPicker('lang')} activeOpacity={0.8}>
              <Ionicons name="globe-outline" size={14} color={colors.textSecondary} />
              <Text style={s.langBtnText}>{(LANG_CODES[lang] ?? 'en').toUpperCase()}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.helpBtn} onPress={() => setHelpOpen(true)} activeOpacity={0.8}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.tintLifestyleFg} />
              <Text style={s.helpBtnText}>{t('pgHelpButton', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* SHOW_WIZARD_HEADINGS gates HEADING TEXT ONLY, in three places: the
              "Step n of N" label, the step title, and the intro title below. Field
              labels, hints, the progress dots, the emergency button and every modal
              title are unaffected. Kept as a flag rather than deleted because which of
              the two screens reads better is a device judgement, and the flag makes it
              a one-line revert instead of an unpick. */}
          {step > 0 && SHOW_WIZARD_HEADINGS && (
            <Text style={s.stepLabel}>{t('pgStep', lang).replace('{n}', step).replace('{total}', TOTAL_STEPS)}</Text>
          )}
          {step > 0 && SHOW_WIZARD_HEADINGS && <Text style={s.title}>{title}</Text>}

          {step === 0 && (
            <View style={s.intro}>
              {SHOW_WIZARD_HEADINGS && <Text style={s.introTitle}>{t('pgIntroTitle', lang)}</Text>}
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
              {/* NEUTRAL AGE SCREEN. No minimum stated, no default date, free entry.
                  Nothing on this step may hint at the threshold — and merging the date
                  of birth in beside the name fields changes nothing about that rule.
                  NO SECTION HEADER between the name fields and these: the request was to
                  remove headings, so a "About you" divider must not reappear here under
                  another name. */}
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

          {step === 2 && (
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
      {/* Nothing here is re-read from `profile` on a language change, so every value the
          user has typed survives it: the fields are component state, the screen is not
          remounted (same type, same slot in App.js's content chain), and the one effect
          that repopulates from the row keys on profile?.phone — a value a language write
          does not touch. */}
      <SearchModal visible={picker === 'lang'} title={t('menuLanguage', lang)} options={langOptions}
        value={lang} onSelect={v => { setPicker(null); onLangChange?.(v) }} onClose={() => setPicker(null)} />

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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  langBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  langBtnText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4 },

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

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  rowText: { fontSize: 14.5, color: colors.textPrimary, flexShrink: 1, paddingRight: 8 },
  rowTextOn: { color: colors.primaryDark, fontWeight: '600' },

  err: { color: colors.danger, fontSize: 13, marginTop: 7, lineHeight: 19 },

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

  // Backs the emergency-help sheet below. The searchable-list styles that used to sit
  // beside it moved to components/SearchModal.js; this one stayed because this screen
  // still renders a sheet of its own.
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(26,43,51,0.45)', justifyContent: 'flex-end' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, paddingRight: 10 },

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
