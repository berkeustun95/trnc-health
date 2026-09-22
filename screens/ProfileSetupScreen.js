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

import { useState, useEffect, useMemo, useRef } from 'react'
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
import { socialProvider, hasGoogleIdentity, revokeGoogle, hasAppleIdentity, revokeApple } from '../utils/socialAuth'
import { LEGAL_VERSION, legalLocaleFor, isLegalFallback } from '../constants/legal'
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
  STUDY_YEAR_MIN, STUDY_END_YEAR_IN_FUTURE,
} from '../constants/profileGate'
import { subjectOptions, studyYearOptions, studyYearCeiling } from '../utils/studyFields'
// The wizard writes ENROLMENTS now, not the five profiles columns. Same module and the
// same rules ProfileScreen uses, so the two writers cannot drift apart.
import { enrolmentRow, isInstitutionCouplingBlock, profilesAffiliationClear } from '../utils/education'

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
function RowGroup({ options, value, onSelect, disabled }) {
  return (
    <View>
      {options.map(o => {
        const on = value === o.value
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.row, on && s.rowOn, disabled && { opacity: 0.45 }]}
            onPress={() => onSelect(o.value)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!disabled }}
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
// ─── Names the sign-in provider already gave us ──────────────────────────────
// Google's arrive in the id token and GoTrue copies the claims into user_metadata. Apple's
// arrive once, and utils/socialAuth.js writes them to the profile and the metadata the moment
// they do. Fallback split matches 20261001's backfill: a single-token name is a first name.
function providerNames(profile, meta) {
  const full = String(meta?.full_name || meta?.name || '').trim()
  const [head = '', ...rest] = full ? full.split(/\s+/) : []
  return {
    first: profile?.first_name || String(meta?.given_name || '').trim() || head,
    last: profile?.last_name || String(meta?.family_name || '').trim() || rest.join(' '),
  }
}

const completionViolation = err =>
  err?.code === '23514' && String(err?.message ?? '').includes('profiles_completion_requires_fields_check')

export default function ProfileSetupScreen({
  session, lang, profile, prefillRegion, onDone, onAgeIneligible, onAgeIneligibleDeleted,
  onEmergencyNumbers, onDutyList, onHealthDirectory, onLangChange,
}) {
  const provider = socialProvider(session)
  const provided = provider ? providerNames(profile, session.user.user_metadata) : { first: '', last: '' }
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
  const [firstName, setFirstName] = useState(profile?.first_name ?? provided.first)
  const [lastName, setLastName] = useState(profile?.last_name ?? provided.last)

  // ─── A NAME THE PROVIDER GAVE IS NOT ASKED FOR AGAIN (App Store 4.0) ───────
  // Each field is hidden only while it still holds exactly what the provider supplied, so
  // one that is missing — Apple with the name withheld, a single-name Google account — is
  // shown and asked, which is the only way to a row the completion CHECK accepts. Apple's
  // name can land AFTER this mounts (USER_UPDATED reloads the profile), so a late value
  // fills a field that is still empty; it never overwrites typing.
  // revealNames: a BLOCKED_TERM on save cannot say whether the name or the display name
  // tripped it, and a hidden field would leave the user nothing to fix.
  const [revealNames, setRevealNames] = useState(false)
  useEffect(() => { if (provided.first) setFirstName(v => v || provided.first) }, [provided.first])
  useEffect(() => { if (provided.last) setLastName(v => v || provided.last) }, [provided.last])
  const hideFirst = !!provider && !revealNames && !!provided.first && firstName === provided.first
  const hideLast = !!provider && !revealNames && !!provided.last && lastName === provided.last

  // ─── CONSENT FOR A SOCIAL ACCOUNT THAT NEVER SAW THE SIGNUP BOX (D2) ───────
  // Email signups tick it on AuthScreen. A new Google/Apple account can be created from the
  // Login tab with no consent moment at all, so it is asked HERE — only for those accounts
  // and only while nothing is recorded. A tick carried across from the signup tab has
  // already been flushed by App.js, and terms_version is then set.
  // Unticked, always, never pre-filled, for the reason AuthScreen gives.
  const [termsOk, setTermsOk] = useState(false)
  const [termsRecorded, setTermsRecorded] = useState(false)
  const needsTerms = TERMS_CHECKBOX_LIVE && !!provider && profile?.terms_version == null && !termsRecorded
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
  const [institution, setInstitution] = useState(null)
  const [institutions, setInstitutions] = useState([])

  // Steps 3–4.
  //
  // ► SEEDED FROM THE ENROLMENT, NOT FROM `profile`. These four used to read
  //   profile.institution_id / subject_id / study_start_year / study_end_year, and those
  //   keys are gone from PROFILE_COLUMNS — after 20261027 they do not exist at all. A
  //   re-gated user must still see what they already stored, so the open enrolment is
  //   loaded once below and seeded in.
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState(null)
  const [startYear, setStartYear] = useState(null)
  const [endYear, setEndYear] = useState(null)
  // One-shot. An async seed that could land after the user has started typing would
  // overwrite their answer with the stored one — the seed is a starting point, not a
  // correction, so it runs once and never again.
  const seeded = useRef(false)
  // The id of the OPEN enrolment this user already has, if any. Its presence is what makes
  // the institution and level fields read-only — see the note on the Field below.
  const [openEnrolment, setOpenEnrolment] = useState(null)

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
  const step1Ok = (!needsTerms || termsOk) && firstName.trim() && lastName.trim() && nameOk &&
    dobY && dobM && dobD && nationality && phoneOk
  const step2Ok = region && status &&
    (status !== 'student' || level) &&
    (!INSTITUTION_REQUIRED_LEVELS.includes(level) || institution)

  const studyStepsOn = MODULE_FLAGS.studentHub && status === RESIDENT_STATUS_STUDENT &&
    INSTITUTION_REQUIRED_LEVELS.includes(level) && !!institution
  const lastStep = studyStepsOn ? TOTAL_STEPS + STUDY_STEPS : TOTAL_STEPS
  const subjectOpts = useMemo(() => subjectOptions(subjects, lang), [subjects, lang])

  // ► NO PATH THROUGH THIS WIZARD MAY END IN AN ERROR THE USER CANNOT ACT ON.
  //
  // The institution and level fields are locked once an open enrolment is known, which is
  // what actually prevents the collision. This is the BACKSTOP for the case where that
  // knowledge is missing: the seed query failed, or the user was offline when it ran, so
  // the lock was never applied and the write can still target a second open row.
  //
  // A generic "couldn't save" there is a dead end — the gate has no back button, no skip
  // and no route to ProfileScreen. So the one collision this can produce gets a message
  // that names the way out, and the years error keeps the specific copy it already had.
  function enrolmentErrorKey(error) {
    const msg = String(error?.message ?? '')
    if (msg.includes(STUDY_END_YEAR_IN_FUTURE)) return 'pgStudyEndFuture'
    if (error?.code === '23505' || /one_open_per_user|user_inst_level_key/.test(msg)) {
      return 'pgEnrolmentConflict'
    }
    return 'pgSaveError'
  }

  // The user's OPEN enrolment, if they have one — the only row this wizard can be editing,
  // because student_education_one_open_per_user permits no second. A closed one is history
  // and belongs on ProfileScreen, not in a signup gate.
  useEffect(() => {
    if (seeded.current || !profile?.profile_completed_at) return
    let cancelled = false
    supabase
      .from('student_education')
      .select('id, institution_id, level, subject_id, study_start_year, study_end_year')
      .eq('user_id', session.user.id)
      .is('study_end_year', null)
      .maybeSingle()
      .then(({ data }) => {
        // maybeSingle returns {data: null, error: null} on zero rows — it does NOT throw,
        // so "no enrolment yet" lands here as a plain null and seeds nothing.
        if (cancelled || !data) { seeded.current = true; return }
        setOpenEnrolment(data)
        setInstitution(data.institution_id ?? null)
        setSubjectId(data.subject_id ?? null)
        setStartYear(data.study_start_year ?? null)
        setEndYear(data.study_end_year ?? null)
        seeded.current = true
      })
    return () => { cancelled = true }
  }, [profile?.profile_completed_at, session.user.id])

  async function save(patch) {
    setSaving(true)
    setSaveError(false)
    const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
    setSaving(false)
    return error
  }

  // ─── The wizard's ONE enrolment ────────────────────────────────────────────
  //
  // ► UPSERT, NOT INSERT, AND THAT IS MANDATORY RATHER THAN DEFENSIVE.
  //   This wizard re-runs for EVERY user on a profile_schema_version bump, and steps 3 and
  //   4 each write again within a single run. An insert would 23505 on
  //   student_education_user_inst_level_key the second time any of those happens — which,
  //   for the re-run case, means the gate refusing to let an existing student back out of
  //   it. The conflict target is that UNIQUE key exactly: (user_id, institution_id, level).
  //
  // ► ONE OPEN ROW IS ALL THE WIZARD EVER WRITES. It asks about university only when
  //   studyStepsOn — a CURRENT student at university level — so a graduate signing up
  //   answers 'working' or 'resident', is never asked, and adds their degree afterwards on
  //   ProfileScreen. There is no "previously studied" concept here and there should not be:
  //   signup is not the place to collect a history.
  //
  // ► A CLOSED ENROLMENT FROM THIS WIZARD IS LEGAL AND IS NOT A BUG. Step 4's end year is
  //   optional, so a student graduating this year can enter one — and then their profile
  //   says resident_status = 'student' while "Currently studying" on ProfileScreen is
  //   empty, because study_end_year IS NULL is the sole definition of current. Nothing
  //   enforces agreement between the two: it is a cross-table invariant a CHECK cannot
  //   express, and 20261030 removed the last arm that came close.
  //
  //   Both alternatives are worse. Forbidding an end year here is wrong for exactly the
  //   person most likely to use it. Deriving resident_status from enrolments makes a
  //   status answer the user gave subordinate to a date they may not have entered. So the
  //   disagreement is allowed, deliberately, and written down here rather than left for
  //   the next reader to file as a defect.
  //
  // mirror_owned = false comes from enrolmentRow() — every row this app writes is
  // app-owned, or 20261026's transition trigger is still entitled to unlist it.
  async function writeEnrolment({ subjectId: subj, startYear: sy, endYear: ey }) {
    if (!institution || !INSTITUTION_REQUIRED_LEVELS.includes(level)) return null
    setSaving(true)
    setSaveError(false)
    const row = enrolmentRow(
      { institutionId: institution, level, startYear: sy ?? null, endYear: ey ?? null, subjectId: subj ?? null },
      // listing_opt_in is NOT set here. It defaults to false, the wizard never asks, and
      // consent to appear on a student list is not something to infer from signing up.
      { userId: session.user.id, listingOptIn: false },
    )
    const { error } = await supabase
      .from('student_education')
      .upsert(row, { onConflict: 'user_id,institution_id,level' })
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

  // ─── UNDER 13 ON A GOOGLE OR APPLE ACCOUNT: DELETE, DO NOT FLAG ─────────────
  // The flag path's only way out is "sign out and sign up again with a truthful date" — but a
  // Google or Apple identity links straight back to this same auth user, so a flagged row
  // would lock that identity out for good, and we would be keeping a child's provider name,
  // email and photo. So the account goes. Email signups keep the flag path.
  // Nothing about the date is written, exactly as on the flag path.
  // ORDER: Google and Apple access are revoked FIRST — SIGNED_OUT signs Google out (after
  // which revokeAccess() is a silent no-op) and the RPC cascades the Apple token away —
  // then the RPC, then sign-out. The notice is raised
  // before sign-out so App.js shows it instead of the welcome screen.
  async function deleteUnderageAccount() {
    setSaving(true)
    setSaveError(false)
    if (hasGoogleIdentity(session)) await revokeGoogle()
    // Apple too, from the stored token only: no second Apple prompt in a child's flow.
    if (hasAppleIdentity(session)) await revokeApple()
    const { error } = await supabase.rpc('delete_own_account')
    if (error) { setSaving(false); setSaveError('pgSaveError'); return }
    onAgeIneligibleDeleted()
    await supabase.auth.signOut()
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
      if (ageOn(dobY, dobM, dobD) < MIN_SIGNUP_AGE && provider) {
        await deleteUnderageAccount()
        return
      }
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
      // Consent BEFORE the profile data it covers, and proven by reading it back: an update
      // RLS filters to zero rows returns no error (flushPendingConsent in App.js, same rule).
      if (needsTerms) {
        setSaving(true)
        setSaveError(false)
        const { data, error: termsErr } = await supabase.from('profiles')
          .update({ terms_version: LEGAL_VERSION, terms_locale: legalLocaleFor('terms', lang) })
          .eq('id', session.user.id)
          .select('terms_version')
          .single()
        setSaving(false)
        if (termsErr || data?.terms_version !== LEGAL_VERSION) { setSaveError('pgSaveError'); return }
        setTermsRecorded(true)
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
      if (nameErr?.status === 'blocked' && (hideFirst || hideLast)) setRevealNames(true)
      if (nameErr) { setNameState(nameErr); return }
      setSaveError('pgSaveError')
      return
    }

    if (step > TOTAL_STEPS) {
      // ─── THE STUDY STEPS EDIT THE ENROLMENT, NOT THE PROFILE ─────────────────
      //
      // Step 2 has already written the row (see writeEnrolment below), so these two steps
      // only ever UPDATE it. Each sends only what it owns: step 3 the subject, step 4 the
      // years. The whole row is re-sent through the same upsert so there is one writer and
      // one place where mirror_owned is set, rather than a second shape to keep in step.
      // Both steps send the whole row. Step 3 has not collected years yet and step 4 has
      // not changed the subject, but the values in hand ARE the current answers either way
      // — so one upsert with one shape beats two partial patches that must each remember
      // which columns they are allowed to leave alone.
      const error = await writeEnrolment({ subjectId, startYear, endYear })
      if (error) { setSaveError(enrolmentErrorKey(error)); return }
      if (step === 3) { setStep(4); return }
      onDone()
      return
    }

    const error = await save({
      region,
      resident_status: status,
      // ► student_level ONLY. The five affiliation columns are not written by this wizard
      //   any more — the institution goes to student_education below, and naming a column
      //   20261027 drops would 42703 the mandatory signup gate for every new user.
      //   profiles_student_level_coupling_check still requires this to be NULL for anyone
      //   whose resident_status is not 'student'.
      student_level: status === RESIDENT_STATUS_STUDENT ? (level ?? null) : null,
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
    let completionError = error

    // ─── CLAIM, CLEAR, RETRY — the same recovery ProfileScreen carries, reached ──
    // ─── through a different door. ──────────────────────────────────────────────
    //
    // A NEW signup never gets here: their institution_id is NULL, so
    // profiles_institution_coupling_check passes outright. But THIS WIZARD RE-RUNS FOR
    // EVERY USER on a profile_schema_version bump, and an existing CURRENT student with a
    // stale institution_id who answers anything other than 'student' on that re-run sends
    // student_level to NULL above and trips the same 23514 — inside a MANDATORY gate they
    // cannot leave. Same narrow population as ProfileScreen, different door.
    //
    // The order is the safety property, not a preference. CLAIM first: 20261026's unlist
    // branch is scoped `WHERE user_id = NEW.id AND mirror_owned`, so clearing
    // institution_id while a row is still trigger-owned silently de-lists that person and
    // tells them nothing. Then CLEAR the five alone — legal on its own, since institution_id
    // IS NULL satisfies the coupling check outright and student_level is untouched at that
    // moment. Then RETRY.
    //
    // Detected from the refusal, never predicted from a read: reading those columns to
    // decide in advance would 42703 after 20261027, and this build is what is installed
    // then. Once they are dropped the CHECK goes with them and this branch is unreachable —
    // which is why the go-live checklist requires exercising it BEFORE the drop.
    if (isInstitutionCouplingBlock(completionError)) {
      await supabase.from('student_education')
        .update({ mirror_owned: false }).eq('user_id', session.user.id)
      await supabase.from('profiles')
        .update(profilesAffiliationClear()).eq('id', session.user.id)
      completionError = await save({
        region,
        resident_status: status,
        student_level: status === RESIDENT_STATUS_STUDENT ? (level ?? null) : null,
        profile_completed_at: new Date().toISOString(),
        profile_schema_version: CURRENT_PROFILE_SCHEMA_VERSION,
        ...(TERMS_CHECKBOX_LIVE && marketingOk ? { marketing_opt_in_at: new Date().toISOString() } : {}),
      })
    }

    if (completionError) {
      // The final write is the ONE that can trip the completion constraint, because it is
      // the write that sets profile_completed_at. Everything before it is a partial row
      // the constraint deliberately ignores.
      setSaveError(completionViolation(completionError) ? missingFieldMessage() : 'pgSaveError')
      return
    }

    // ► COMPLETION FIRST, ENROLMENT SECOND, and the order is chosen for its failure mode.
    //   If this write fails, the user has a COMPLETED profile and no enrolment — which is
    //   exactly the state 20261030 legitimised, and which ProfileScreen's education section
    //   is built to fill in. The reverse order leaves an orphan enrolment under an
    //   incomplete profile: invisible to everything (listing_opt_in is false, so
    //   can_see_student_lists stays false), but a row nobody asked for.
    //
    //   It also matches the rule this file already states below: the study steps come after
    //   completion, never before.
    const enrolError = await writeEnrolment({ subjectId, startYear, endYear })
    if (enrolError) { setSaveError(enrolmentErrorKey(enrolError)); return }

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
              {!hideFirst && (
                <Field label={t('pgFirstName', lang)}>
                  <TextInput style={s.input} value={firstName} onChangeText={setFirstName}
                    autoCapitalize="words" autoCorrect={false} />
                </Field>
              )}
              {!hideLast && (
                <Field label={t('pgLastName', lang)}>
                  <TextInput style={s.input} value={lastName} onChangeText={setLastName}
                    autoCapitalize="words" autoCorrect={false} />
                </Field>
              )}
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
              {/* The same box and the same words as AuthScreen's signup tick — one
                  acceptance, whichever door the account came through. Continue stays
                  disabled until it is ticked. The whole row toggles; the two document
                  links keep their own taps. */}
              {needsTerms && (
                <>
                  <TouchableOpacity style={s.termsRow} onPress={() => setTermsOk(v => !v)} activeOpacity={0.7}
                    accessibilityRole="checkbox" accessibilityState={{ checked: termsOk }}>
                    <View style={[s.checkbox, termsOk && s.checkboxOn]}>
                      {termsOk && <Feather name="check" size={14} color="#fff" />}
                    </View>
                    <LegalLinkedText templateKey="signupTermsCheckbox" lang={lang}
                      style={s.termsText} linkStyle={s.legalFooterLink} onOpen={setLegalTab} />
                  </TouchableOpacity>
                  {isLegalFallback('terms', lang) && (
                    <Text style={s.legalFallback}>{t('legalAvailableInEnTr', lang)}</Text>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Field label={t('pgRegion', lang)}>
                <ChipGroup options={regionOptions} value={region} onSelect={setRegion} />
              </Field>
              <Field label={t('pgResidentStatus', lang)} hint={t('pgResidentHelper', lang)}>
                {/* The institution is NOT cleared here or on a level change: the write's
                    the enrolment row keeps it, independently of resident_status. */}
                <RowGroup options={statusOptions} value={status}
                  onSelect={v => { setStatus(v); if (v !== 'student') setLevel(null) }} />
              </Field>
              {/* Locked for the same reason as the institution below, and it is the SAME
                  key: (user_id, institution_id, level). university -> postgraduate targets
                  a different row just as surely as changing university does, and dead-ends
                  in exactly the same place. */}
              {status === 'student' && (
                <Field
                  label={t('pgStudentLevel', lang)}
                  hint={openEnrolment ? t('pgInstitutionLockedHint', lang) : undefined}
                >
                  <RowGroup options={levelOptions} value={level} onSelect={setLevel}
                    disabled={!!openEnrolment} />
                </Field>
              )}
              {/* ► READ-ONLY ONCE AN ENROLMENT EXISTS, AND THAT IS A LOCKOUT FIX.
                      The upsert key is (user_id, institution_id, level). Changing EITHER
                      during a re-gate targets a different key, so the write inserts a
                      SECOND open row — which student_education_one_open_per_user rejects.
                      That surfaced as a generic save error inside a gate with no back
                      button, no skip and no route to ProfileScreen: a dead end at signup.

                      Editing the existing row in place instead was considered and refused.
                      It removes the dead end, but a forced re-gate would then be able to
                      overwrite an enrolment the user built on ProfileScreen — rewriting
                      EMU into NEU and losing the years and subject attached to it. A gate
                      nobody chose to enter must not be able to destroy history; deferring
                      the edit costs one trip to the profile screen and loses nothing.

                      So the field shows what they have and says where to change it. */}
              {status === 'student' && INSTITUTION_REQUIRED_LEVELS.includes(level) && (
                <Field
                  label={t('pgInstitution', lang)}
                  hint={openEnrolment ? t('pgInstitutionLockedHint', lang) : undefined}
                >
                  <SelectField
                    value={instOptions.find(o => o.value === institution)?.label || ''}
                    placeholder={t('pgInstitutionSearch', lang)}
                    onPress={() => { if (!openEnrolment) setPicker('inst') }}
                    disabled={!!openEnrolment}
                  />
                </Field>
              )}

              {/* ─── THE LAST STEP CARRIES A POINTER AND AN OFFER, NOT A CONSENT ───
                  NO CHECKBOX FOR THE DOCUMENTS HERE, DELIBERATELY, AND DO NOT ADD ONE. The
                  wizard collects the fields ADA needs in order to function on a CONTRACT
                  basis, not on consent — the acceptance already happened at signup, and
                  a second tick here would manufacture a second acceptance event on a
                  flow whose legal basis is not consent at all. The footer POINTS at the
                  documents; it does not ask for anything, and its wording must stay that
                  way ("how this is used is set out in…", never "by continuing you
                  agree…").

                  The ONE exception lives on step 1, not here: a Google/Apple account with
                  no recorded acceptance never saw the signup box, so for it there is no
                  "already happened" — see needsTerms. It is the first acceptance, not a
                  second one.

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

  // The REQUIRED terms box for a social account (step 1). Copied from AuthScreen's measured
  // checkbox — 2pt textSecondary border (4.76:1 / 4.21:1), 24pt, opaque white — and NOT the
  // tinted opt-in surface above: a required acceptance must not look optional.
  termsRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4,
                paddingHorizontal: 2, paddingVertical: 8 },
  checkbox:   { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.textSecondary,
                backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  termsText:  { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  legalFallback: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 4, opacity: 0.85 },
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
