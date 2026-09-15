// Profile completion gate — the wizard. Rendered ONLY from App.js's gateActive block,
// which is a five-line allow-list of what a gated user may reach; nothing here routes
// anywhere except through the props it is given.
//
// ─── THREE THINGS THAT ARE NOT NEGOTIABLE HERE ──────────────────────────────
//
// 1. NO SKIP, NO DISMISS. There is no close button, no "later", and the caller passes no
//    onBack. (Steps 3–4 DO carry a Skip: they exist only after step 2 has written
//    profile_completed_at, and every field on them is optional by decision.) Android's
//    hardware back moves between steps and, on the first step, is left to close the app — see App.js. A back button that does nothing reads as a frozen
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
  ActivityIndicator, Modal, Platform, BackHandler, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import SearchModal from '../components/SearchModal'
import { pad, ageOn, daysInMonth } from '../utils/profileFields'
import { useDisplayNameCheck, displayNameSaveError, NameFeedback } from '../components/DisplayNameCheck'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
import { SHOW_WIZARD_HEADINGS, TERMS_CHECKBOX_LIVE, MODULE_FLAGS } from '../constants/flags'
import LegalScreen from './LegalScreen'
import LegalLinkedText from '../components/LegalLinkedText'
import { t, LANGUAGES, LANG_CODES } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { NATIONALITIES, NATIONALITY_CODES, getNatLabel } from '../constants/nationalityTranslations'
import { COUNTRY_CODES } from '../constants/countryCodes'
import { monthNames } from '../constants/months'
import {
  MIN_SIGNUP_AGE, MAX_SIGNUP_AGE, CURRENT_PROFILE_SCHEMA_VERSION,
  RESIDENT_STATUSES, STUDENT_LEVELS, INSTITUTION_REQUIRED_LEVELS, RESIDENT_STATUS_STUDENT,
  RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY,
  DISPLAY_NAME_MAX, STEP_TITLE_KEY, HELP_ROW_LABEL_KEY,
  affiliationPatch, STUDY_YEAR_MIN, STUDY_END_YEAR_IN_FUTURE,
} from '../constants/profileGate'
import { subjectOptions, studyYearOptions, studyYearCeiling } from '../utils/studyFields'

// TWO steps. What used to be Steps 1 and 2 — the six required identity fields — is now
// one screen; the old Step 3 (region, status, the student conditional) became Step 2.
// Persistence is unchanged in shape but not in size: Step 1 now writes SIX columns in
// ONE atomic patch, so a name race aborts the date of birth with it and the retry is
// clean. There is no half-saved state between the two former steps any more, which is
// why resumeStep() no longer has a landing place between them.
const TOTAL_STEPS = 2

// ─── STEPS 3–4: SUBJECT, THEN STUDY YEARS (Slice 2, behind MODULE_FLAGS.studentHub) ───
// Only for a university/postgraduate student, and only AFTER step 2's completion write
// has succeeded, so nothing on them can block completion — the gate's own constraint
// does not know these columns exist. Each is skippable; a force-quit on either leaves a
// completed profile, and the fields stay editable in ProfileScreen.
const STUDY_STEPS = 2

// ─── Presentational pieces, defined OUTSIDE the screen ──────────────────────
// A component declared inside its parent is a new type on every render, so React
// unmounts and remounts it — which blurs a TextInput mid-typing. House rule.

// Derived from the step count, never a literal — a hardcoded dot count is a decoration
// that disagrees with the wizard the day the step count moves. `total` is 2, or 4 once a
// university-level student is on step 2 and the study steps will follow.
function Dots({ step, total }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: total }, (_, i) => i + 1).map(i => (
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

// ─── EVERY ROW RENDERS THE CHECK, SELECTED OR NOT ───────────────────────────
//
// ⚠ THIS IS HALF A BUG FIX, NOT A STYLE PREFERENCE. On a Xiaomi Redmi Note 14 Pro 5G
//   (Android, EN) two of the four resident-status labels rendered as a single capital
//   "A" — "A student" and "A tourist" — while "Living here" rendered in full. The one
//   that worked was the SELECTED row, and the only structural difference was that the
//   selected row rendered a SECOND child: this icon.
//
//   That asymmetry is what rules out every width explanation. The row with MORE content
//   and BOLDER text (rowTextOn adds fontWeight 600) laid out correctly; the rows with
//   less content failed. Font scale, long labels and narrow screens all predict the
//   opposite.
//
//   The mechanism, and it is Android-specific: with one child under
//   justifyContent:'space-between', Yoga measures the Text at max-content width — one
//   line — then shrinks it. Android's TextView then draws TWO lines into a box measured
//   for one, and an Android View CLIPS ITS CHILDREN TO ITS BOUNDS BY DEFAULT where iOS
//   does not. Line two is drawn and thrown away. s.row carries no height and no
//   overflow, so nothing in the style sheet suggests clipping — the clip is the platform
//   default.
//
//   Rendering the icon unconditionally gives all four rows ONE child count and one
//   layout path, so selected and unselected can no longer measure differently.
//   'transparent' rather than a grey tick: an unselected row must not look half-chosen.
//   Hidden from accessibility because it is a spacer in that state, and the row's own
//   selected state is what a screen reader should hear.
//
// Shipped together with the flex:1 change on rowText, knowingly: either alone might be
// sufficient and we will not learn which. A mandatory gate where half the options are
// one letter is not the place to run a clean experiment.
function RowGroup({ options, value, onSelect }) {
  return (
    <View>
      {options.map(o => {
        const on = value === o.value
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.row, on && s.rowOn]}
            onPress={() => onSelect(o.value)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.rowText, on && s.rowTextOn]}>{o.label}</Text>
            <Feather
              name="check"
              size={16}
              color={on ? colors.primary : 'transparent'}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function SelectField({ value, placeholder, onPress, flex, disabled }) {
  return (
    <TouchableOpacity style={[s.select, flex && { flex: 1 }, disabled && { opacity: 0.45 }]}
      onPress={onPress} disabled={disabled} activeOpacity={0.7}>
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
  // ⚠ phone is NOT here. It became optional on 2026-09-12, and this line is the one that
  // would have TRAPPED existing accounts: a row completed before that change with no
  // phone would be sent back to Step 1 on every open, and Step 1 would then refuse to
  // advance because step1Ok also required it. The two together are a closed loop with no
  // error message — the user sees the wizard reopen forever. Keep this list identical to
  // the columns profiles_completion_requires_fields_check actually demands.
  if (!p.date_of_birth || !p.nationality_code) return 1
  return 2
}

// ─── Turning a 23514 into a sentence ────────────────────────────────────────
//
// profiles_completion_requires_fields_check is the SOLE server-side guard on completeness
// (no RPC and no trigger touches it), so a client whose required set drifts from it gets a
// raw Postgres error inside a mandatory gate — a dead end with no way forward.
const completionViolation = err =>
  err?.code === '23514' && String(err?.message ?? '').includes('profiles_completion_requires_fields_check')

export default function ProfileSetupScreen({
  session, lang, profile, prefillRegion, onDone, onAgeIneligible,
  onEmergencyNumbers, onDutyList, onHealthDirectory, onLangChange,
}) {
  const [step, setStep] = useState(() => resumeStep(profile))
  const [saving, setSaving] = useState(false)
  // An i18n KEY or null, not a boolean. 'Check your connection' is the wrong sentence
  // for a 23514 — the write was received and REJECTED, so retrying does nothing, and
  // telling someone to check their signal sends them to fix the one thing that is fine.
  const [saveError, setSaveError] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [legalTab, setLegalTab] = useState(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  // Optional, separate, and unticked. NEVER pre-filled from the row: the wizard re-runs
  // on any future profile_schema_version bump, and a box that arrives already ticked
  // because of a decision made months ago is not a decision made now.
  const [marketingOk, setMarketingOk] = useState(false)

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

  // Steps 3–4. Pre-filled from the row so a re-gated user sees what they already stored.
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState(profile?.subject_id ?? null)
  const [startYear, setStartYear] = useState(profile?.study_start_year ?? null)
  const [endYear, setEndYear] = useState(profile?.study_end_year ?? null)

  const [picker, setPicker] = useState(null)  // 'day' | 'month' | 'year' | 'nat' | 'cc' | 'inst' | 'subject' | 'startYear' | 'endYear'

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

  useEffect(() => {
    if (!MODULE_FLAGS.studentHub) return
    supabase.from('subjects')
      .select('id, sort_order, subject_i18n(lang, name)')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setSubjects(data ?? []))
  }, [])

  // ─── Validity per step ────────────────────────────────────────────────────
  const nameOk = nameState?.status === 'available'
  // PHONE IS OPTIONAL. Empty passes; non-empty must still be 4-15 digits, so a typo is
  // caught rather than silently stored. `cc` is not required either — a dial code with no
  // number is not a phone number, and the write below turns that pair into NULL.
  //
  // This set must equal what profiles_completion_requires_fields_check demands. If the
  // client requires MORE, the user is blocked by a button with no explanation; if it
  // requires LESS, the final write fails with a raw 23514. Both were live bugs.
  const phoneOk = !phone.trim() || /^\d{4,15}$/.test(phone.trim())
  const step1Ok = firstName.trim() && lastName.trim() && nameOk &&
    dobY && dobM && dobD && nationality && phoneOk
  const step2Ok = region && status &&
    (status !== 'student' || level) &&
    (!INSTITUTION_REQUIRED_LEVELS.includes(level) || institution)

  const studyStepsOn = MODULE_FLAGS.studentHub && status === RESIDENT_STATUS_STUDENT &&
    INSTITUTION_REQUIRED_LEVELS.includes(level) && !!institution
  const lastStep = studyStepsOn ? TOTAL_STEPS + STUDY_STEPS : TOTAL_STEPS
  const subjectOpts = useMemo(() => subjectOptions(subjects, lang), [subjects, lang])

  async function save(patch) {
    setSaving(true)
    setSaveError(false)
    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
    setSaving(false)
    return error
  }

  // Names the first field the constraint would reject, from the values in hand.
  //
  // ⚠ IT REFUSES TO GUESS. If the client believes every required field is filled and the
  //   server rejected the row anyway, the client's list is the thing that is wrong — and
  //   naming a field at random would send the user to correct something that is already
  //   correct. That case returns the honest message instead, which is also the signal to
  //   whoever reads the report that COMPLETION_FIELDS has drifted from the constraint.
  function missingFieldMessage() {
    // ⚠ THIS ORDER AND THIS SET MUST AGREE WITH THE CONSTRAINT. Written from it as it
    //   stands after the 2026-09-12 change: phone was removed there and is absent here.
    //
    //   The value sits beside its label rather than in a lookup keyed by column name —
    //   partly so the two cannot drift, and partly because the column IS the vocabulary:
    //   'display_name' is also a DISPLAY_PREFERENCES value, so a bare column-name literal
    //   in this file trips scripts/check-profile-gate.mjs's inlined-vocabulary check. It
    //   caught exactly that on the first draft, which is the check working.
    // Conditional in the constraint too: a level is demanded only for a student, and an
    // institution only for the two levels that have one. Both are computed OUT HERE and
    // not inside the array below, because check-profile-gate.mjs forbids a vocabulary
    // value inside an array literal — that is how it catches somebody pasting
    // ['student','working',…] in place of the imported list, and the check is right to
    // be blunt about it. `true` means "not demanded", never "supplied".
    const levelDemanded = status === RESIDENT_STATUS_STUDENT
    const instDemanded  = INSTITUTION_REQUIRED_LEVELS.includes(level)
    const checks = [
      [firstName.trim(),                        'pgFirstName'],
      [lastName.trim(),                         'pgLastName'],
      [displayName.trim(),                      'pgDisplayName'],
      [dobY && dobM && dobD,                    'pgDob'],
      [nationality,                             'pgNationality'],
      [region,                                  'pgRegion'],
      [status,                                  'pgResidentStatus'],
      [levelDemanded ? level : true,            'pgStudentLevel'],
      [instDemanded ? institution : true,       'pgInstitution'],
    ]
    const hit = checks.find(([v]) => !v)
    return hit ? { key: 'pgIncompleteField', field: hit[1] } : 'pgIncompleteUnknown'
  }

  // ─── THE WAY OUT ──────────────────────────────────────────────────────────
  //
  // Added 2026-09-13. Until then a new account that reached this wizard had NO exit at
  // all — no back, no close, no sign out — and the only ways to leave were finishing it
  // or uninstalling. Two problems with that, and the second is the expensive one: a user
  // who decides not to hand over a date of birth is trapped in the app, and mandatory
  // registration with no escape is the shape App Store guideline 5.1.1 is written about.
  //
  // ⚠ THIS IS AN EXIT, NOT A BYPASS. It signs the account out; it does not skip the gate.
  //   Nothing here makes the wizard optional, and the gate is waiting at the next sign-in.
  //
  // ⚠ AND error === null WOULD NOT MEAN IT WORKED. supabase.auth.signOut() returns before
  //   clearing the local session on a network failure — see lib/supabase.js — so offline
  //   this button would otherwise do nothing at all, silently, on the screen somebody is
  //   trying to get out of. The error is caught and shown.
  async function confirmSignOut() {
    if (signingOut) return
    // Empty title is this app's confirm convention (FacilityProfileScreen's delete flows).
    // The body says progress is SAVED, which is both true — Step 1 persists on advance —
    // and the thing that stops somebody hesitating over an exit they are entitled to.
    Alert.alert('', t('pgSignOutConfirm', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      { text: t('signOut', lang), style: 'destructive', onPress: async () => {
        setSigningOut(true)
        setSignOutError(false)
        const { error } = await supabase.auth.signOut()
        // On success App.js unmounts this screen on SIGNED_OUT, so there is nothing to
        // reset. pendingConsent is deliberately NOT cleared: if one is still on the
        // device the flush failed, and dropping it would discard an acceptance that was
        // never recorded. Its email match and 7-day expiry already make it safe to leave.
        if (error) { setSignOutError(true); setSigningOut(false) }
      } },
    ])
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
        // ⚠ THE ERROR IS CHECKED NOW, AND IT WAS NOT BEFORE. The old code awaited this
        //   write, ignored whatever came back and set a local `ageBlocked` boolean — so
        //   a write that FAILED still produced the block, for this session only, and the
        //   next launch let the account straight in with no flag on the row at all. The
        //   block has to follow the flag landing, not the attempt being made.
        const error = await save({ age_ineligible: true })
        if (error) { setSaveError('pgSaveError'); return }
        onAgeIneligible()
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
        // NULL, never a bare '+90'. A dial code alone is not a phone number: it is
        // unusable, it is indistinguishable from a real value to every future reader, and
        // it would make `!p.phone` false — quietly re-arming the resume trap above.
        // Same expression ProfileScreen.js already uses; the two write one column.
        phone: phone.trim() ? cc + phone.trim() : null,
      })
      if (!error) { setStep(2); return }
      if (completionViolation(error)) { setSaveError(missingFieldMessage()); return }
      // The race this whole inline check exists to avoid, arriving anyway: somebody took
      // the name between the check and the write. displayNameSaveError re-asks and
      // returns fresh suggestions rather than surfacing a raw Postgres error inside a
      // mandatory gate; a null back from it means the failure was not about the name.
      const nameErr = await displayNameSaveError(error, displayName.trim())
      if (nameErr) { setNameState(nameErr); return }
      setSaveError('pgSaveError')
      return
    }

    if (step > TOTAL_STEPS) {
      // Only what this step owns. endYear is passed as the STORED value on step 3 because
      // it decides whether the institution survives, not because step 3 edits it.
      const base = { status, level, institutionId: institution, endYear: profile?.study_end_year ?? null }
      const patch = step === 3
        ? (subjectId !== (profile?.subject_id ?? null) ? affiliationPatch({ ...base, subjectId }) : null)
        : (startYear !== (profile?.study_start_year ?? null) || endYear !== (profile?.study_end_year ?? null)
            ? affiliationPatch({ ...base, startYear, endYear }) : null)
      if (patch) {
        const error = await save(patch)
        if (error) {
          setSaveError(String(error.message ?? '').includes(STUDY_END_YEAR_IN_FUTURE) ? 'pgStudyEndFuture' : 'pgSaveError')
          return
        }
      }
      if (step === 3) { setStep(4); return }
      onDone()
      return
    }

    const error = await save({
      region,
      resident_status: status,
      // student_level, institution_id and — only when the institution goes — the four
      // study columns. The stored end year is what keeps a graduate's institution.
      ...affiliationPatch({ status, level, institutionId: institution, endYear: profile?.study_end_year ?? null }),
      profile_completed_at: new Date().toISOString(),
      profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
      // ⚠ THE COLUMN IS SENT ONLY WHEN TICKED, AND OMITTING IT IS NOT THE SAME AS
      //   SENDING NULL. Branch (h) of check_profile_name_content reads a NULL as a
      //   WITHDRAWAL, and this wizard re-runs for everybody on any future
      //   profile_schema_version bump — with the box correctly unticked. Sending
      //   `null` here would therefore silently withdraw the marketing consent of every
      //   user who had opted in, on a screen that never mentions marketing.
      //   Omitted, NEW carries OLD through the trigger's ELSE arm and nothing moves.
      //   Withdrawal is an explicit act and lives on ProfileScreen alone.
      //
      // The value is a placeholder the server replaces: the client says WHETHER, the
      // trigger says WHEN.
      ...(TERMS_CHECKBOX_LIVE && marketingOk ? { marketing_opt_in_at: new Date().toISOString() } : {}),
    })
    if (error) {
      // The final write is the ONE that can trip the completion constraint, because it is
      // the write that sets profile_completed_at. Everything before it is a partial row
      // the constraint deliberately ignores.
      setSaveError(completionViolation(error) ? missingFieldMessage() : 'pgSaveError')
      return
    }
    // Completion is written. The study steps come after it, never before. Step 3 even if
    // the subject list has not arrived: Skip is there, and a jump to 4 on a slow network
    // would drop the subject question without anyone deciding to.
    if (studyStepsOn) { setStep(3); return }
    onDone()
  }

  function skipStudyStep() {
    if (saving) return
    setSaveError(null)
    if (step === 3) setStep(4)
    else onDone()
  }

  // Registered only while the legal sheet is open so it runs before App.js's handler
  // (RN fires listeners newest-first). Without it, back on the sheet falls through to
  // App.js, matches nothing on the wizard, and CLOSES THE APP with the sheet still up.
  useEffect(() => {
    if (!legalTab) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setLegalTab(null); return true })
    return () => sub.remove()
  }, [legalTab])

  // Same component instance, different render — every value already typed into the form
  // survives opening a document and coming back.
  if (legalTab) {
    return <LegalScreen lang={lang} initialTab={legalTab} onBack={() => setLegalTab(null)} />
  }

  // ─── The age screen USED TO BE HERE ───────────────────────────────────────
  // It is screens/AgeIneligibleScreen.js now, rendered by App.js from
  // profiles.age_ineligible. Do not bring it back: a copy inside this component can only
  // be driven by session state, and session state is exactly what made the flag
  // escapable by force-quitting. Nothing before the under-13 branch above states or
  // hints at a minimum age — the Google Play neutral-age-screen rule — and that is
  // unchanged by the move.

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
  // Capped at the UTC year: check_profile_study_years() rejects a future end year.
  const studyYearMax = studyYearCeiling()
  const startYearOptions = studyYearOptions(studyYearMax, STUDY_YEAR_MIN)
  const endYearOptions = [
    { value: null, label: t('pgStillStudying', lang) },
    ...studyYearOptions(studyYearMax, startYear ?? STUDY_YEAR_MIN),
  ]

  const canAdvance = step === 0 || (step === 1 && step1Ok) || (step === 2 && step2Ok) ||
    (step === 3 && !!subjectId) || (step === 4 && !!startYear)
  const title = step === 0 ? '' : t(STEP_TITLE_KEY[step], lang)

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAwareForm>
        {/* flexShrink: 0 — a fixed-height row above a scrollable list in a flex:1 column
            gets vertically compressed the moment the list overflows, cropping its text.
            It only reproduces once the form is long enough to scroll, which Turkish
            reaches before English does. House rule. */}
        <View style={s.header}>
          {step > 0 ? <Dots step={step} total={lastStep} /> : <View style={s.dots} />}
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
            <Text style={s.stepLabel}>{t('pgStep', lang).replace('{n}', step).replace('{total}', lastStep)}</Text>
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
                {/* The institution is NOT cleared here or on a level change: the write's
                    affiliationPatch() decides, because a graduate's end year keeps it. */}
                <RowGroup options={statusOptions} value={status}
                  onSelect={v => { setStatus(v); if (v !== 'student') setLevel(null) }} />
              </Field>
              {status === 'student' && (
                <Field label={t('pgStudentLevel', lang)}>
                  <RowGroup options={levelOptions} value={level} onSelect={setLevel} />
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

              {/* ─── THE LAST STEP CARRIES A POINTER AND AN OFFER, NOT A CONSENT ───
                  NO CHECKBOX FOR THE DOCUMENTS, DELIBERATELY, AND DO NOT ADD ONE. The
                  wizard collects the fields ADA needs in order to function on a CONTRACT
                  basis, not on consent — the acceptance already happened at signup, and
                  a second tick here would manufacture a second acceptance event on a
                  flow whose legal basis is not consent at all. The footer POINTS at the
                  documents; it does not ask for anything, and its wording must stay that
                  way ("how this is used is set out in…", never "by continuing you
                  agree…").

                  The marketing opt-in below is the opposite and that is why it looks
                  different: genuinely optional, genuinely consent, and therefore an
                  unticked box on its own tinted surface rather than a line of small
                  grey text. Two things that are legally unalike must not look alike. */}
              {TERMS_CHECKBOX_LIVE && (
                <>
                  <TouchableOpacity
                    style={s.optIn}
                    onPress={() => setMarketingOk(v => !v)}
                    activeOpacity={0.75}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: marketingOk }}
                  >
                    <View style={[s.optInBox, marketingOk && s.optInBoxOn]}>
                      {marketingOk && <Feather name="check" size={13} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.optInText}>{t('pgMarketingOptIn', lang)}</Text>
                      <Text style={s.optInHint}>{t('pgMarketingHint', lang)}</Text>
                    </View>
                  </TouchableOpacity>

                  <LegalLinkedText templateKey="pgLegalFooter" lang={lang}
                    style={s.legalFooter} linkStyle={s.legalFooterLink} onOpen={setLegalTab} />
                </>
              )}
            </>
          )}

          {step === 3 && (
            <Field label={t('pgSubject', lang)} hint={t('pgStudyOptionalHint', lang)}>
              <SelectField
                value={subjectOpts.find(o => o.value === subjectId)?.label || ''}
                placeholder={t('pgSubjectSearch', lang)}
                onPress={() => setPicker('subject')}
              />
            </Field>
          )}

          {step === 4 && (
            <>
              <Field label={t('pgStudyStart', lang)}>
                <SelectField value={startYear ? String(startYear) : ''} placeholder={t('pgYear', lang)}
                  onPress={() => setPicker('startYear')} />
              </Field>
              <Field label={t('pgStudyEnd', lang)} hint={t('pgStudyOptionalHint', lang)}>
                <SelectField value={endYear ? String(endYear) : ''} placeholder={t('pgStillStudying', lang)}
                  onPress={() => setPicker('endYear')} disabled={!startYear} />
              </Field>
            </>
          )}

          {saveError && <Text style={s.err}>{t(saveError.key ?? saveError, lang).replace('{field}', saveError.field ? t(saveError.field, lang) : '')}</Text>}

          {/* ⚠ BOTTOM OF THE SCROLL, NOT THE HEADER — AND THAT WAS MEASURED, not chosen.
              The header already carries the progress dots, the language pill and the
              emergency pill, and at 320dp those two pills alone occupy 212pt of the 236pt
              available IN GREEK. Adding a third item overflowed in 5 of 9 locales —
              Greek by 63pt, Spanish 36, French 29, Arabic 17, and English by 2 — while
              fitting comfortably at 393dp, so it would have looked correct on the test
              phone and broken on a small device in five languages. Full width here means
              no locale can overflow at all. Measured with the TTF parser from
              scripts/check-tile-labels.mjs; the figures are in the journal entry.

              Every step, including the intro: someone deciding not to continue does it
              at the first screen as often as the last. */}
          <TouchableOpacity style={s.exitRow} onPress={confirmSignOut}
            disabled={signingOut} activeOpacity={0.6}>
            {signingOut
              ? <ActivityIndicator color={colors.textSecondary} />
              : <Text style={s.exitText}>{t('signOut', lang)}</Text>}
          </TouchableOpacity>
          {signOutError && <Text style={[s.err, { textAlign: 'center' }]}>{t('signOutFailed', lang)}</Text>}
        </ScrollView>

        <View style={s.footer}>
          {step === TOTAL_STEPS && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)} activeOpacity={0.8}>
              <Text style={s.backBtnText}>{t('pgBack', lang)}</Text>
            </TouchableOpacity>
          )}
          {/* No Back past completion: going back to step 2 would re-run the completion
              write. Skip is the way on. */}
          {step > TOTAL_STEPS && (
            <TouchableOpacity style={s.backBtn} onPress={skipStudyStep} disabled={saving} activeOpacity={0.8}>
              <Text style={s.backBtnText}>{t('pgSkip', lang)}</Text>
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
                  {step === 0 ? t('pgIntroStart', lang) : step === lastStep ? t('pgFinish', lang) : t('pgContinue', lang)}
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
      <SearchModal visible={picker === 'subject'} searchable title={t('pgSubject', lang)}
        searchPlaceholder={t('pgSubjectSearch', lang)} options={subjectOpts}
        value={subjectId} onSelect={v => { setSubjectId(v); setPicker(null) }} onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'startYear'} title={t('pgStudyStart', lang)} options={startYearOptions}
        value={startYear}
        onSelect={v => { setStartYear(v); if (endYear != null && endYear < v) setEndYear(null); setPicker(null) }}
        onClose={() => setPicker(null)} />
      <SearchModal visible={picker === 'endYear'} title={t('pgStudyEnd', lang)} options={endYearOptions}
        value={endYear} onSelect={v => { setEndYear(v); setPicker(null) }} onClose={() => setPicker(null)} />
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
  // flex:1, NOT flexShrink:1 — see the note on RowGroup. flexShrink alone lets Yoga
  // measure the Text at max-content width and then squeeze it, so the HEIGHT is computed
  // for a line count the final width does not produce. flex:1 is grow 1 / shrink 1 /
  // basis 0%, which hands the Text its final width BEFORE measurement, so the height it
  // reports is the height it needs. s.row has no height and no maxHeight, so once the
  // measurement is right the row grows and a wrapped label is fully visible.
  rowText: { fontSize: 14.5, color: colors.textPrimary, flex: 1, paddingRight: 8 },
  rowTextOn: { color: colors.primaryDark, fontWeight: '600' },

  err: { color: colors.danger, fontSize: 13, marginTop: 7, lineHeight: 19 },

  // Plain secondary text, centred, underlined. Deliberately NOT a button: it must be
  // findable by somebody looking for a way out and invisible to everybody else, so it
  // competes with Continue for nothing.
  exitRow:  { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 24, marginTop: 20 },
  exitText: { color: colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },

  // Its own tinted surface, because it is the one OPTIONAL thing on a mandatory screen
  // and it must not read as another field to fill in.
  optIn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 6, padding: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
  },
  optInBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  optInBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optInText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  optInHint: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  legalFooter: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 19, marginTop: 16 },
  legalFooterLink: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },

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

})
