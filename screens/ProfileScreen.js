import { useState, useEffect } from 'react'
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, FlatList, ActivityIndicator, Platform,
  Modal, LayoutAnimation, UIManager, Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { Feather, Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { colors, shadow, radius } from '../constants/theme'
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
  RESIDENT_STATUS_LABEL_KEY, STUDENT_LEVEL_LABEL_KEY,
  DISPLAY_NAME_MAX, STUDY_YEAR_MIN, STUDY_END_YEAR_IN_FUTURE,
} from '../constants/profileGate'
// affiliationPatch is deliberately NOT imported any more. It writes the five profiles
// columns 20261027 drops, and this screen is the last thing that was still calling it.
import {
  EDUCATION_SELECT, LEVELS, splitEnrolments, findSameEnrolment, enrolmentError,
  enrolmentRow, isInstitutionCouplingBlock, profilesAffiliationClear,
} from '../utils/education'
import { subjectOptions, studyYearOptions, studyYearCeiling } from '../utils/studyFields'
import LegalScreen from './LegalScreen'
import { TERMS_CHECKBOX_LIVE, MODULE_FLAGS } from '../constants/flags'
import { PRESET_AVATARS } from '../constants/avatars'
import Avatar, { prefetchAvatars, invalidateAvatar } from '../components/Avatar'
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
// ─── One enrolment ──────────────────────────────────────────────────────────
//
// Defined at module scope, not inside ProfileScreen: a component declared in its parent is
// a NEW type on every render, so React unmounts and remounts the whole subtree — the
// remount bug this repo's conventions call out by name.
//
// Renders the same for a current and a past enrolment; the only difference is the years
// line, and "still studying" is what study_end_year IS NULL means to a reader.
function EnrolmentRow({ row, lang, institutions, subjects, onEdit, onRemove, disabled }) {
  const inst = institutions.find(i => i.id === row.institution_id)
  const instLabel = inst ? (inst.short_name ? `${inst.name} (${inst.short_name})` : inst.name) : '—'
  const subject = subjectOptions(subjects, lang).find(o => o.value === row.subject_id)
  const years = row.study_start_year == null
    ? (row.study_end_year == null ? '' : String(row.study_end_year))
    : `${row.study_start_year} – ${row.study_end_year ?? t('pgStillStudying', lang)}`
  return (
    <View style={s.eduRow}>
      <View style={s.eduRowBody}>
        <Text style={s.eduRowTitle} numberOfLines={2}>{instLabel}</Text>
        <Text style={s.eduRowMeta} numberOfLines={2}>
          {[t(STUDENT_LEVEL_LABEL_KEY[row.level], lang), subject?.label, years].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <TouchableOpacity onPress={onEdit} disabled={disabled} style={s.eduRowAction} accessibilityRole="button">
        <Feather name="edit-2" size={16} color={disabled ? colors.textSecondary : colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onRemove} disabled={disabled} style={s.eduRowAction} accessibilityRole="button">
        <Feather name="trash-2" size={16} color={disabled ? colors.textSecondary : colors.danger ?? '#C2410C'} />
      </TouchableOpacity>
    </View>
  )
}

// A stored row → the shape the draft editor edits. Kept next to the row that produces it
// so the two cannot drift; `id` is what makes saveEnrolment update rather than insert.
function draftFromRow(row) {
  return {
    id: row.id,
    institutionId: row.institution_id,
    level: row.level,
    startYear: row.study_start_year,
    endYear: row.study_end_year,
    subjectId: row.subject_id,
  }
}

export default function ProfileScreen({ session, lang, onBack, onLangChange, onAvatarChange }) {
  const [profile, setProfile]               = useState(null)
  const [form, setForm]                     = useState({
    first_name: '', last_name: '', display_name: '',
    dobY: null, dobM: null, dobD: null,
    phone: '', nationality: '', region: null, resident_status: null,
    // student_level STAYS: it is a profiles column 20261027 does not drop, it covers
    // high_school / language_course / vocational which have no institution at all, and
    // profiles_student_level_coupling_check still ties it to resident_status.
    //
    // institution_id, study_start_year, study_end_year and subject_id are GONE from the
    // form. They live in student_education now, one row per enrolment, and this screen
    // neither reads nor writes the profiles copies — see the note above the save.
    student_level: null, preferred_language: 'English',
  })
  const [institutions, setInstitutions]     = useState([])
  const [picker, setPicker]                 = useState(null)  // 'day'|'month'|'year'|'nat'|'cc'|'inst'|'region'|'status'|'level'|'pastInst'|'subject'|'startYear'|'endYear'
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
  // Mirrors the column, not a form field: it is written the moment it is switched, with
  // no Save button between the decision and the record. Withdrawing a consent must be at
  // least as easy as giving it, and a withdrawal that waits for a second tap is not.
  const [marketingOn, setMarketingOn]           = useState(false)
  const [marketingBusy, setMarketingBusy]       = useState(false)
  // Same shape as marketing, for the same reason: being LISTED is a visibility choice, and
  // switching it off must not wait for a Save tap somebody may never make.
  const [listingOn, setListingOn]               = useState(false)
  const [listingBusy, setListingBusy]           = useState(false)
  const [subjects, setSubjects]                 = useState([])
  // ─── Education (20261026) ───────────────────────────────────────────────────
  // rows: every enrolment, newest-closed first. draft: the one being added or edited,
  // or null when the editor is closed. The split into "currently studying" / "previously"
  // is DERIVED from study_end_year IS NULL and never stored — see utils/education.js.
  const [enrolments, setEnrolments]             = useState(null)   // null = still loading
  const [draft, setDraft]                       = useState(null)
  const [eduBusy, setEduBusy]                   = useState(false)
  const [eduError, setEduError]                 = useState(null)
  const [removing, setRemoving]                 = useState(null)   // the row awaiting confirmation
  // The reciprocity gate, asked of the database rather than derived here: an enrolment
  // with listing_opt_in is NOT sufficient on its own (a display name and no UGC ban are
  // also required), and only can_see_student_lists() knows the whole rule.
  const [canSee, setCanSee]                     = useState(null)

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
                  'student_level, full_name, phone, nationality, nationality_code, ' +
                  'preferred_language, role, avatar_url, profile_completed_at, ' +
                  // Hand-written list, NOT App.js's PROFILE_COLUMNS — this screen has
                  // always had its own. Both now name marketing_opt_in_at and both
                  // therefore depend on 20261016 being applied before the OTA.
                  'marketing_opt_in_at')
          // ► THE FIVE AFFILIATION COLUMNS ARE NOT SELECTED, and that is what lets this
          //   one release span 20261027. institution_id, study_start_year, study_end_year,
          //   subject_id and student_listing_opt_in are dropped AFTER this build has
          //   soaked, and this build is what is installed when that happens — naming a
          //   dropped column in a select is a 42703 through PostgREST for every profile
          //   open. The editor reads student_education instead, and the only place any of
          //   the five is named at all is the recovery path in the save, which cannot run
          //   once they are gone.)
          .eq('id', session.user.id)
          .single()
        if (error) { setLoadError(true); return }
        if (data) {
          setProfile(data)
          setAvatarUrl(data.avatar_url ?? null)
          setMarketingOn(data.marketing_opt_in_at != null)
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
    loadEnrolments()
    refreshCanSee()
    supabase.from('institutions')
      .select('id, name, short_name')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setInstitutions(data ?? []))
    if (MODULE_FLAGS.studentHub) {
      supabase.from('subjects')
        .select('id, sort_order, subject_i18n(lang, name)')
        .eq('is_active', true)
        .order('sort_order')
        .then(({ data }) => setSubjects(data ?? []))
    }
  }, [])

  // ► DELIBERATELY NO NAMES, AND SLICE 6 MADE THAT A REQUIREMENT RATHER THAN A CHOICE.
  //   It was already right for reviews: those are anonymous, so "you blocked Ahmet K."
  //   would reveal who wrote the review somebody blocked from. Now block_user() puts
  //   PERSON-blocks in this same list, and those names are no secret — the blocker was
  //   looking at the profile when they tapped it.
  //   Naming those and not the others is exactly what must not happen: the rows that
  //   stayed nameless would then be identifiable as the review ones, which is the
  //   anonymity leak the original rule exists to prevent. All rows or none, so none.
  // ─── The blocked list ──────────────────────────────────────────────────────
  //
  // Through list_my_blocks() (20261032), which is a DEFINER function for a reason that is
  // not stylistic: profiles RLS does not let one customer read another's row, so a join
  // from here returns nothing at all. It hands back a display_name ONLY for a person-block
  // — a review-block's author stays anonymous server-side, because the blocker may know
  // them only as an anonymous reviewer.
  //
  // ► THE FALLBACK IS WHAT LETS THIS SHIP BEFORE THE MIGRATION IS APPLIED. Without it the
  //   RPC 404s, the list renders empty, and an empty blocked list is not a neutral
  //   failure — it says "you have blocked nobody", which would stop somebody looking for
  //   the unblock button they came here for. Degrading to the dated rows is the old
  //   behaviour, which is merely unhelpful rather than untrue.
  async function loadBlocks() {
    const { data, error } = await supabase.rpc('list_my_blocks')
    if (!error && data) {
      // One signing round trip for the whole blocked list, not one per row.
      await prefetchAvatars(data.map(b => b.avatar_url))
      setBlocks(data); return
    }
    const { data: rows } = await supabase.from('blocks')
      .select('blocked_id, created_at')
      .order('created_at', { ascending: false })
    setBlocks((rows ?? []).map(r => ({ ...r, origin: 'content', display_name: null, avatar_url: null })))
  }

  async function unblock(blockedId) {
    const { error } = await supabase.from('blocks').delete()
      .eq('blocker_id', session.user.id)
      .eq('blocked_id', blockedId)
    if (!error) setBlocks(prev => prev.filter(b => b.blocked_id !== blockedId))
  }

  // ⚠ THE CLIENT SENDS THE INTENT, THE SERVER SUPPLIES THE TIME. A non-NULL value is read
  //   by branch (h) of check_profile_name_content as "opted in" and replaced with now();
  //   NULL is a withdrawal and is honoured exactly. The ISO string below is a placeholder
  //   that never reaches the row, which is why it does not matter that it comes from a
  //   device clock.
  //
  // ⚠ error === null IS NOT PROOF THE WRITE LANDED — an update RLS filters to zero rows
  //   returns no error. The row is read back and the switch follows what the DATABASE
  //   says, not what was sent, so a write that silently did nothing shows as unchanged
  //   rather than as success.
  async function toggleMarketing(next) {
    if (marketingBusy) return
    setMarketingBusy(true)
    setMarketingOn(next)                       // optimistic; reconciled below either way
    const { data, error } = await supabase.from('profiles')
      .update({ marketing_opt_in_at: next ? new Date().toISOString() : null })
      .eq('id', session.user.id)
      .select('marketing_opt_in_at')
      .single()
    setMarketingOn(error ? !next : data?.marketing_opt_in_at != null)
    setMarketingBusy(false)
  }

  // ─── Education: load ────────────────────────────────────────────────────────
  //
  // RLS does the scoping (student_education owner read, USING user_id = auth.uid()), so
  // the .eq() here is belt-and-braces rather than the boundary. Ordered nulls-first so the
  // open enrolment leads; splitEnrolments() still derives which one that is.
  async function loadEnrolments() {
    const { data, error } = await supabase
      .from('student_education')
      .select(EDUCATION_SELECT)
      .eq('user_id', session.user.id)
      .order('study_end_year', { ascending: false, nullsFirst: true })
    if (error) { setEnrolments([]); setEduError('eduLoadError'); return }
    setEnrolments(data ?? [])
    // The switch reflects the ROWS, because that is what it writes. It is not the same
    // question as canSee — a listed enrolment with no display_name still cannot see lists.
    setListingOn((data ?? []).some(r => r.listing_opt_in))
  }

  // Asked of the database, never derived here. can_see_student_lists() requires an
  // opted-in enrolment AND a display name AND no UGC ban, and only it knows all three.
  async function refreshCanSee() {
    const { data, error } = await supabase.rpc('can_see_student_lists')
    setCanSee(error ? null : data === true)
  }

  // ─── Education: the single opt-in switch ───────────────────────────────────
  //
  // ► THE SCHEMA KEEPS OPT-IN PER ROW; THE UI IS ONE SWITCH. On writes true to every
  //   enrolment, off writes false to every enrolment. So somebody cannot yet be listed at
  //   their current university but not their old one — the schema can express that, this
  //   UI will not, and that direction is deliberate: a schema more capable than its UI
  //   gains the granularity later with no migration, the reverse needs one.
  //
  // mirror_owned goes to false in the same write, per the rule that every row this app
  // touches becomes app-owned — otherwise 20261026's transition trigger is still entitled
  // to unlist it behind the user's back.
  async function toggleListing(next) {
    if (listingBusy || !enrolments?.length) return
    setListingBusy(true)
    setListingOn(next)
    const { error } = await supabase
      .from('student_education')
      .update({ listing_opt_in: next, mirror_owned: false })
      .eq('user_id', session.user.id)
    if (error) setListingOn(!next)
    await loadEnrolments()
    await refreshCanSee()
    setListingBusy(false)
  }

  // A database refusal → an i18n key. Never a raw message: a constraint name on screen is
  // not copy, and every one of these is a rule the form already checked, reaching here only
  // because two clients raced or the form's mirror of a CHECK drifted from the CHECK.
  function eduErrorKey(error) {
    const msg = error?.message ?? ''
    if (msg.includes(STUDY_END_YEAR_IN_FUTURE)) return 'eduErrEndFuture'
    if (error?.code === '23505') return 'eduErrDuplicate'
    if (error?.code === '23514') return 'eduErrRejected'
    return 'eduSaveFailed'
  }

  // ─── Education: add or edit ────────────────────────────────────────────────
  //
  // ► THE TWO-REQUEST WRITE, AND WHY IT IS NOT ONE.
  //   student_education_one_open_per_user is a partial unique index over (user_id) WHERE
  //   study_end_year IS NULL, so a second OPEN enrolment cannot exist. Starting somewhere
  //   new therefore means closing the current one with a graduation year FIRST, then
  //   inserting — and 20261026 says so in its own header: "adding a second university
  //   forces the user to close the first one with a graduation year… in the same write".
  //
  //   It is NOT the same write. There is no write RPC for this table (slice 6 added ten
  //   functions, none of them for education), PostgREST sends these as two requests, and a
  //   bulk upsert cannot mix an UPDATE of a known id with an INSERT of a new one without
  //   the client minting a uuid. So the ordering is chosen for its failure mode rather
  //   than its elegance: close, then insert. If the insert fails the user is left with
  //   their previous university CLOSED and no current one — visible on screen, fixable by
  //   adding again, and stated in eduErrHalfClosed rather than left to be noticed.
  //   The reverse order cannot even be attempted: the index rejects the second open row.
  async function saveEnrolment() {
    if (eduBusy || !draft) return
    const ceiling = studyYearCeiling()
    const key = enrolmentError(draft, { yearCeiling: ceiling, minYear: STUDY_YEAR_MIN })
    if (key) { setEduError(key); return }
    // Routed to an edit rather than an insert: UNIQUE (user_id, institution_id, level)
    // makes the same degree at the same place impossible, and a raw insert would 23505.
    if (findSameEnrolment(enrolments ?? [], draft, draft.id)) { setEduError('eduErrDuplicate'); return }

    const { current } = splitEnrolments(enrolments ?? [])
    const mustClose = draft.endYear == null && current && current.id !== draft.id
    if (mustClose && draft.closeYear == null) { setEduError('eduErrCloseCurrent'); return }
    if (mustClose && current.study_start_year != null && draft.closeYear < current.study_start_year) {
      setEduError('eduErrYearsOrder'); return
    }
    if (mustClose && draft.closeYear > ceiling) { setEduError('eduErrEndFuture'); return }

    setEduBusy(true); setEduError(null)
    if (mustClose) {
      const { error } = await supabase.from('student_education')
        .update({ study_end_year: draft.closeYear, mirror_owned: false })
        .eq('id', current.id)
      if (error) { setEduError(eduErrorKey(error)); setEduBusy(false); return }
    }
    const row = enrolmentRow(draft, { userId: session.user.id, listingOptIn: listingOn })
    const { error } = draft.id
      ? await supabase.from('student_education').update(row).eq('id', draft.id)
      : await supabase.from('student_education').insert(row)
    if (error) {
      // The window above landed and this did not. Say so plainly — the user's history now
      // reads differently from what they intended and no other screen will mention it.
      setEduError(mustClose ? 'eduErrHalfClosed' : eduErrorKey(error))
      await loadEnrolments()
      setEduBusy(false)
      return
    }
    setDraft(null)
    await loadEnrolments()
    await refreshCanSee()
    setEduBusy(false)
  }

  // ─── Education: remove ─────────────────────────────────────────────────────
  //
  // Confirmation copy is chosen in the RENDER, not here, because what removal costs
  // depends on whether this is the last LISTED enrolment: is_listed_student() is what
  // start_conversation and send_message consult, and losing the last opted-in row makes
  // send_message raise CONVERSATION_CLOSED for everyone already talking to this person.
  async function removeEnrolment(row) {
    if (eduBusy) return
    setEduBusy(true); setEduError(null)
    const { error } = await supabase.from('student_education').delete().eq('id', row.id)
    if (error) setEduError('eduRemoveFailed')
    setRemoving(null)
    await loadEnrolments()
    await refreshCanSee()
    setEduBusy(false)
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
      // ─── THE UID STAYS A FOLDER SEGMENT; THE FILENAME GAINS A RANDOM SUFFIX ───
      // The uid prefix is what 20261040's RLS pins on — `(storage.foldername(name))[1] =
      // auth.uid()` — so it is load-bearing, not cosmetic. The random suffix is
      // defence-in-depth for REPLACEMENT: the old object is deleted below, so any signed
      // URL still circulating for it 404s instead of resolving to a photo the user
      // believes they removed. A fixed `avatar.jpg` would be re-uploaded to the same path
      // and an old URL would keep serving the NEW image.
      //
      // Math.random is adequate BECAUSE the bucket is private — the secrecy of this
      // string is not what protects the object, the RLS policy is. expo-crypto's
      // randomUUID() is the upgrade and it is a NATIVE dep, so it waits for the eSIM
      // build rather than breaking the OTA-only rule for a defence-in-depth nicety.
      const rand = Math.random().toString(36).slice(2, 10)
      const path = `${session.user.id}/avatar-${rand}.${ext}`
      const previous = avatarUrl   // a PATH on current rows, an https URL on legacy ones
      const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      // upsert:false — every upload is a NEW path now, so an upsert could only ever mask
      // a collision, and a collision here would mean the random suffix repeated.
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType, upsert: false })
      if (uploadError) throw uploadError
      // The COLUMN HOLDS THE PATH, never a URL. A stored URL would be a credential with
      // an expiry, and it would be dead the moment the bucket went private.
      await supabase.from('profiles').update({ avatar_url: path }).eq('id', session.user.id)
      setAvatarUrl(path)
      onAvatarChange?.(path)
      // Delete the old object AFTER the row points at the new one. The other order leaves
      // a window where the row references a deleted object and the avatar is a blank.
      // Fire-and-forget: a failed cleanup is an orphaned object, not a broken profile.
      if (previous && !previous.startsWith('http') && !previous.startsWith('preset:') && previous !== path) {
        invalidateAvatar(previous)
        supabase.storage.from('avatars').remove([previous]).catch(() => {})
      }
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
    // ─── THE FIVE AFFILIATION COLUMNS ARE NOT IN THIS PATCH ───────────────────
    //
    // affiliationPatch() used to spread institution_id, study_start_year, study_end_year,
    // subject_id and student_listing_opt_in into every save. It is gone from this screen.
    // The affiliation lives in student_education, and naming a column 20261027 drops would
    // 42703 every profile save the moment it runs.
    //
    // student_level STAYS — it is not one of the five, it covers high_school /
    // language_course / vocational which have no institution, and
    // profiles_student_level_coupling_check still requires it to be NULL for anyone whose
    // resident_status is not 'student'. That single rule is the whole reason the recovery
    // path below has to exist.
    // ► THE PAYLOAD STAYS INLINE IN .update({ … }) ON PURPOSE.
    //   scripts/check-profile-gate.mjs parses .update() payload LITERALS and asserts
    //   full_name is never among them — full_name is derived by check_profile_name_content()
    //   and writing it would fight the trigger. Its control is that first_name and
    //   display_name ARE present, so that an absence check cannot pass on a parse that
    //   found nothing. Hoisting this into `const patch = {…}` defeated that parse and the
    //   guard said so, correctly: the columns were still written, but nothing could verify
    //   it any more. A thunk keeps the literal where the guard can see it AND lets the
    //   recovery path below re-send it without a second copy to drift.
    const writeProfile = () => supabase
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
        // profiles_student_level_coupling_check: a level without student status is a 23514,
        // so this must go NULL in the same write that moves resident_status away.
        student_level: form.resident_status === 'student' ? form.student_level : null,
        preferred_language: form.preferred_language,
        // full_name is DERIVED by check_profile_name_content() from the two fields above.
        // resident_status_updated_at is stamped by the same trigger. Neither is sent.
      })
      .eq('id', session.user.id)

    let { error: err } = await writeProfile()

    // ─── CLAIM, CLEAR, THEN RETRY. The only path that names the five, and it ─────
    // ─── cannot run once they are gone. ─────────────────────────────────────────
    //
    // Two CHECKs pull against each other for exactly one person: someone whose profiles row
    // still carries a stale institution with NO end year, moving their status away from
    // 'student'. The write above must null student_level (profiles_student_level_coupling_check),
    // and profiles_institution_coupling_check then rejects the stale institution, because
    // its third arm — a graduation year — is the only thing that would have saved it and a
    // CURRENT student has none. Graduates and already-clear rows never reach here.
    //
    // ► THE ORDER IS THE SAFETY PROPERTY, NOT A PREFERENCE.
    //   1. CLAIM every enrolment row. 20261026's unlist branch is
    //      `UPDATE student_education SET listing_opt_in = false WHERE user_id = NEW.id AND
    //      mirror_owned`, so nulling institution_id silently de-lists every row the
    //      transition trigger still owns — the person drops off the student list and is
    //      told nothing. Claiming first makes that branch a no-op. One statement, so it
    //      lands for all of the user's rows or none.
    //   2. CLEAR the five ALONE. Legal on its own: institution_id IS NULL satisfies the
    //      coupling check outright, the study fields go with it, and student_level is
    //      untouched at this point so its own coupling still holds.
    //   3. RETRY the same write, which now passes because the stale institution is gone.
    //
    // Detected from the REFUSAL, never predicted from a read: reading those columns to
    // decide in advance would 42703 after 20261027, and this build is what is installed
    // then. Once they are dropped the CHECK goes with them, step 1 never runs, and the
    // only statement that names them is unreachable.
    if (isInstitutionCouplingBlock(err)) {
      await supabase.from('student_education')
        .update({ mirror_owned: false }).eq('user_id', session.user.id)
      await supabase.from('profiles')
        .update(profilesAffiliationClear()).eq('id', session.user.id)
      ;({ error: err } = await writeProfile())
      await loadEnrolments()
    }
    if (err) {
      const nameErr = await displayNameSaveError(err, form.display_name.trim())
      if (nameErr) setNameState(nameErr)
      else if (err.message?.includes('UNDERAGE')) setError(t('pgDobInvalid', lang))
      else if (err.message?.includes(STUDY_END_YEAR_IN_FUTURE)) setError(t('pgStudyEndFuture', lang))
      else setError(err.message)
    } else {
      // The form is brought to what was WRITTEN. Only student_level can differ from what
      // the user typed, and only in the one direction the coupling CHECK forces.
      const written = { ...form, student_level: form.resident_status === 'student' ? form.student_level : null }
      setForm(written)
      setSaved(true)
      setSavedForm(written)
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
  // ⚠ THIS LIST IS THE CLIENT'S COPY OF profiles_completion_requires_fields_check AND
  //   MUST MATCH IT EXACTLY. Require more than the constraint and the Save button is dead
  //   with nothing on screen to say why; require less and the write returns a raw 23514.
  //   The same set is duplicated in ProfileSetupScreen.js's step1Ok/step2Ok — two screens
  //   write these columns, so both have to move together.
  //
  //   phone is NOT in it: removed from the constraint on 2026-09-12 and from both clients
  //   in the same change. Line 295 already persisted NULL for an empty phone, so rows
  //   written by this screen were ALREADY legal under the loosened constraint — it was
  //   only this check that kept the button disabled.
  const missingRequired =
    !form.first_name.trim() || !form.last_name.trim() || !form.display_name.trim() ||
    !form.dobY || !form.dobM || !form.dobD || !form.region || !form.resident_status ||
    !form.nationality.trim() ||
    (form.resident_status === 'student' && !form.student_level)
  // ► THE INSTITUTION CLAUSE IS GONE, and it had to go in the same change as the editor.
  //   It read `INSTITUTION_REQUIRED_LEVELS.includes(studentLevel) && !form.institution_id`
  //   — the client's copy of profiles_completion_requires_fields_check's last arm.
  //   20261030 removed that arm, because the fact it guarded now lives in
  //   student_education and a CHECK cannot see across tables. Keeping it here would leave
  //   Save permanently disabled for a university student, since nothing writes
  //   profiles.institution_id any more and the form no longer holds it.
  //
  //   What is given up is stated plainly in 20261030: nothing in the DATABASE now stops a
  //   completed profile claiming university-level student status with no enrolment. This
  //   screen is the only thing that ever asks, and it asks by showing the education
  //   section rather than by blocking Save — an incomplete profile is not a corrupt one.

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

  // ─── Study fields (Slice 2, behind MODULE_FLAGS.studentHub) ───────────────
  // Two shapes over the same four columns:
  //   • a university-level STUDENT edits their current studies under the institution the
  //     gate already requires; the end year may be blank ("still studying").
  //   • ANYONE ELSE may add a PAST university — the alumni case. student_level stays NULL
  //     for a non-student (profiles_student_level_coupling_check), and the institution is
  //     held by the end year alone (the third arm), so all three of university, start and
  //     graduation year are required together. Not offered in the wizard: signup does not
  //     ask a non-student about university.
  // A uni student who changes status keeps their institution in the form, so it reappears
  // here as a past university to complete or remove — never silently dropped on Save.
  // ─── Education, derived ────────────────────────────────────────────────────
  //
  // "Currently studying" holds AT MOST ONE row, and that is not a UI convention:
  // student_education_one_open_per_user is a partial unique index over (user_id) WHERE
  // study_end_year IS NULL. The section mirrors the constraint rather than inventing its
  // own rule, which is why `current` is a single row and not a list.
  //
  // The old shape — one institution on `profiles`, shown as "current studies" for a
  // university student and "past university" for everyone else — is gone. An enrolment is
  // no longer a property of the person's CURRENT status: a graduate who now works keeps
  // their degrees, and a working person can add one. So this section is shown to every
  // completed profile, not only to students.
  const { current: currentEnrol, past: pastEnrol } = splitEnrolments(enrolments ?? [])
  // ─── ONE CONDITION, BOTH SURFACES, AND `isComplete` IS NOT IT ──────────────
  //
  // This read `MODULE_FLAGS.studentHub && isComplete` until 2026-09-20, while the opt-in
  // switch below read the flag alone. They disagree for exactly one value —
  // profiles.profile_completed_at — and that is reachable: App.js's gate only fires for
  // `profile.role === 'customer'` and never for a guest, so a provider, organizer or
  // estate_agent with a null profile_completed_at lands on this screen with the switch
  // live and the education section GONE. They could turn listing on and off and never
  // see, edit or remove the enrolment behind it.
  //
  // Fixed in this direction on purpose. Gating the SWITCH on isComplete instead would
  // strand anyone already listed with no way to turn it off, which is worse than the bug:
  // a consent control you cannot withdraw is not a consent control.
  //
  // isComplete was presumably here to keep education UI out of a half-finished profile —
  // but ProfileSetupScreen owns that, and the profiles that actually reach THIS screen
  // incomplete are precisely the ones that need the section.
  const showEducation = MODULE_FLAGS.studentHub

  // ─── THE LIST SHOWS YOUR DISPLAY NAME, SO IT IS A PREREQUISITE ─────────────
  //
  // is_listed_student() requires `p.display_name IS NOT NULL`. Without one, writing
  // listing_opt_in = true succeeds, changes nothing, and leaves the switch reading ON
  // for somebody who is not on any list — a consent control reporting a state that is
  // not real. Read from savedForm, never from `form`: savedForm is what is IN the
  // database (set on load, and again on a successful save), so a name typed but not yet
  // saved does not unlock a switch whose effect depends on the saved row.
  const hasDisplayName = !!(savedForm?.display_name ?? '').trim()
  // Adding a new CURRENT enrolment while one is open requires closing that one in the same
  // form — the index leaves no other order. See saveEnrolment.
  const draftNeedsClose = draft != null && draft.endYear == null &&
    currentEnrol != null && currentEnrol.id !== draft.id
  const listedCount = (enrolments ?? []).filter(r => r.listing_opt_in).length
  const studyYearMax = studyYearCeiling()
  const subjectOpts = [{ value: null, label: '—' }, ...subjectOptions(subjects, lang)]
  // A student may clear either year; a past university may not, so its lists carry no blank.
  const startYearOptions = [
    ...[{ value: null, label: '—' }],
    ...studyYearOptions(studyYearMax, STUDY_YEAR_MIN),
  ]
  const endYearOptions = [
    ...[{ value: null, label: t('pgStillStudying', lang) }],
    ...studyYearOptions(studyYearMax, draft?.startYear ?? STUDY_YEAR_MIN),
  ]

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
    // ► edges INCLUDES 'bottom' FOR THE FOOTER. Without it the save button renders under
    //   the Android three-button navigation bar and cannot be tapped — the same failure
    //   the message composer had. ProfileSetupScreen's footer is the pattern this copies.
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAwareForm>
        <ScrollView
          contentContainerStyle={s.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.header}>
            <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
            <Text style={s.title}>{t('profile', lang)}</Text>
            {/* Counterweight for the back button so the title stays centred. Save used to
                live here as a text link; it is a full-width footer button now. */}
            <View style={s.headerSpacer} />
          </View>

          <View style={s.avatarSection}>
            <TouchableOpacity style={s.avatarWrap} onPress={() => { setAvatarError(null); setShowAvatarPicker(true) }} activeOpacity={0.8}>
              <Avatar avatarUrl={avatarUrl} initials={initials} size={80} textSize={28} />
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

              {showEducation && (
                <View style={s.eduSection}>
                  {/* ─── CURRENTLY STUDYING — at most one, and the DATABASE says so ───
                      student_education_one_open_per_user is a partial unique index over
                      (user_id) WHERE study_end_year IS NULL. This renders one row or none
                      because a second is impossible, not because the design prefers it. */}
                  <Text style={s.eduGroupLabel}>{t('eduCurrentTitle', lang)}</Text>
                  {enrolments === null ? (
                    <ActivityIndicator color={colors.primary} style={s.eduLoading} />
                  ) : currentEnrol ? (
                    <EnrolmentRow
                      row={currentEnrol} lang={lang} institutions={institutions} subjects={subjects}
                      onEdit={() => { setEduError(null); setDraft(draftFromRow(currentEnrol)) }}
                      onRemove={() => { setEduError(null); setRemoving(currentEnrol) }}
                      disabled={eduBusy || draft != null}
                    />
                  ) : (
                    <Text style={s.eduEmpty}>{t('eduNoCurrent', lang)}</Text>
                  )}

                  <Text style={[s.eduGroupLabel, s.eduGroupLabelSpaced]}>{t('eduPastTitle', lang)}</Text>
                  {enrolments !== null && pastEnrol.length === 0 && (
                    <Text style={s.eduEmpty}>{t('eduNoPast', lang)}</Text>
                  )}
                  {pastEnrol.map(row => (
                    <EnrolmentRow
                      key={row.id} row={row} lang={lang} institutions={institutions} subjects={subjects}
                      onEdit={() => { setEduError(null); setDraft(draftFromRow(row)) }}
                      onRemove={() => { setEduError(null); setRemoving(row) }}
                      disabled={eduBusy || draft != null}
                    />
                  ))}

                  {/* ─── REMOVE, WITH THE COST STATED BEFORE THE TAP ───────────────
                      Removing the last LISTED enrolment is not a tidy-up: is_listed_student()
                      is what start_conversation and send_message consult, so the threads
                      this person is already in stop accepting messages. They stay readable.
                      That has to be on screen before the confirm, not discovered after. */}
                  {removing && (
                    <View style={s.eduConfirm}>
                      <Text style={s.eduConfirmText}>
                        {removing.listing_opt_in && listedCount === 1
                          ? t('eduRemoveWarnLastListed', lang)
                          : t('eduRemoveWarn', lang)}
                      </Text>
                      <View style={s.eduConfirmRow}>
                        <TouchableOpacity style={s.eduCancelBtn} onPress={() => setRemoving(null)} disabled={eduBusy}>
                          <Text style={s.eduCancelText}>{t('cancel', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.eduRemoveBtn} onPress={() => removeEnrolment(removing)} disabled={eduBusy}>
                          <Text style={s.eduRemoveText}>{t('eduRemoveConfirm', lang)}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {!draft && !removing && (
                    <TouchableOpacity
                      style={s.eduAddBtn}
                      onPress={() => { setEduError(null); setDraft({ level: 'university', startYear: null, endYear: null, subjectId: null, institutionId: null }) }}
                      activeOpacity={0.7}
                    >
                      <Feather name="plus" size={16} color={colors.primary} />
                      <Text style={s.eduAddText}>{t('eduAdd', lang)}</Text>
                    </TouchableOpacity>
                  )}

                  {draft && (
                    <View style={s.eduDraft}>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>{t('pgInstitution', lang)}</Text>
                        <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('inst')} activeOpacity={0.7}>
                          <Text style={[s.pickerBtnText, !draft.institutionId && s.pickerBtnPlaceholder]} numberOfLines={1}>
                            {instOptions.find(o => o.value === draft.institutionId)?.label || t('pgInstitutionSearch', lang)}
                          </Text>
                          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>{t('pgStudentLevel', lang)}</Text>
                        <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('eduLevel')} activeOpacity={0.7}>
                          <Text style={s.pickerBtnText}>{t(STUDENT_LEVEL_LABEL_KEY[draft.level], lang)}</Text>
                          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>{t('pgStudyStart', lang)}</Text>
                        <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('startYear')} activeOpacity={0.7}>
                          <Text style={[s.pickerBtnText, !draft.startYear && s.pickerBtnPlaceholder]}>
                            {draft.startYear ? String(draft.startYear) : '—'}
                          </Text>
                          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      {/* study_end_year IS NULL is the whole definition of "current", so this
                          one field is what decides which section the row lands in. The picker
                          is disabled without a start year because
                          student_education_years_order_check requires one under any end. */}
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>{t('pgStudyEnd', lang)}</Text>
                        <TouchableOpacity
                          style={[s.pickerBtn, !draft.startYear && { opacity: 0.45 }]}
                          onPress={() => setPicker('endYear')} disabled={!draft.startYear} activeOpacity={0.7}
                        >
                          <Text style={s.pickerBtnText}>
                            {draft.endYear ? String(draft.endYear) : t('pgStillStudying', lang)}
                          </Text>
                          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>{t('pgPastSubject', lang)}</Text>
                        <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('subject')} activeOpacity={0.7}>
                          <Text style={[s.pickerBtnText, !draft.subjectId && s.pickerBtnPlaceholder]} numberOfLines={1}>
                            {subjectOpts.find(o => o.value === draft.subjectId && o.value)?.label || t('pgSubjectSearch', lang)}
                          </Text>
                          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>

                      {/* ► THE INDEX LEAVES NO OTHER ORDER. Starting somewhere new while an
                          enrolment is still open means closing that one first, so the year
                          is collected HERE rather than discovered as a failed write. */}
                      {draftNeedsClose && (
                        <View style={s.fieldGroup}>
                          <Text style={s.fieldLabel}>
                            {t('eduCloseCurrentLabel', lang).replace('{uni}',
                              instOptions.find(o => o.value === currentEnrol.institution_id)?.label ?? '')}
                          </Text>
                          <TouchableOpacity style={s.pickerBtn} onPress={() => setPicker('closeYear')} activeOpacity={0.7}>
                            <Text style={[s.pickerBtnText, !draft.closeYear && s.pickerBtnPlaceholder]}>
                              {draft.closeYear ? String(draft.closeYear) : '—'}
                            </Text>
                            <Feather name="chevron-down" size={16} color={colors.textSecondary} />
                          </TouchableOpacity>
                          <Text style={s.fieldHint}>{t('eduCloseCurrentHint', lang)}</Text>
                        </View>
                      )}

                      <View style={s.eduConfirmRow}>
                        <TouchableOpacity style={s.eduCancelBtn} onPress={() => { setDraft(null); setEduError(null) }} disabled={eduBusy}>
                          <Text style={s.eduCancelText}>{t('cancel', lang)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.eduSaveBtn} onPress={saveEnrolment} disabled={eduBusy}>
                          {eduBusy ? <ActivityIndicator color={colors.surface} />
                                   : <Text style={s.eduSaveText}>{t('eduSave', lang)}</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {eduError && <Text style={s.errorText}>{t(eduError, lang)}</Text>}
                </View>
              )}

              {error && <Text style={s.errorText}>{error}</Text>}
            </View>
          )}

          {MODULE_FLAGS.studentHub && (
            <View style={s.marketingSection}>
              <Text style={s.sectionTitle}>{t('menuStudentHub', lang)}</Text>
              <View style={s.marketingRow}>
                <Text style={s.marketingLabel}>{t('pgListingOptIn', lang)}</Text>
                <Switch
                  value={listingOn}
                  onValueChange={toggleListing}
                  // Nothing to write to until an enrolment exists — the opt-in is a column
                  // on student_education, one per row, not a property of the person.
                  disabled={listingBusy || !enrolments?.length || !hasDisplayName}
                  trackColor={{ true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              {/* ► "NO ENROLMENTS" AND "OPT-IN OFF" ARE THE SAME STATE TO THE DATABASE.
                  can_see_student_lists() requires at least one row with listing_opt_in, so
                  a person with no enrolments and a person with the switch off are equally
                  locked out — and telling them apart on screen would be inventing a
                  distinction the gate does not make. The hint explains what to DO, which is
                  the only part that actually differs. */}
              {/* ► DISPLAY NAME FIRST, because it is the prerequisite the person is least
                     likely to guess and because it is the one case where the switch can
                     read ON while the answer is no: listing_opt_in may already be true on
                     the row, and is_listed_student() still returns false without a name.
                     This sentence is what makes that ON non-deceptive — it says plainly
                     that they do not appear and what to do about it. */}
              {!hasDisplayName ? (
                <Text style={s.fieldHint}>{t('eduListingNeedsDisplayName', lang)}</Text>
              ) : !enrolments?.length ? (
                <Text style={s.fieldHint}>{t('eduListingNeedsEnrolment', lang)}</Text>
              ) : !listingOn ? (
                <Text style={s.fieldHint}>{t('eduListingOffHint', lang)}</Text>
              ) : null}
              {/* ► WHAT TURNING IT ON ACTUALLY DOES, IN BOTH STATES.
                  Until 2026-09-20 the ON state rendered NOTHING and toggleListing writes
                  immediately with no confirmation, so the only thing a person saw at the
                  moment of becoming visible was the label — "Show me in my university's
                  student list" — which names a list and none of what is on it.
                  The privacy policy discloses it; a policy is not where consent happens.
                  This is, so it is shown BEFORE the decision as well as after: a sentence
                  that only appears once you have already flipped the switch is a receipt,
                  not a disclosure.
                  The list is the union of what get_student_list (6 columns) and
                  get_student_profile (8) return — the profile page is one tap from the
                  list and adds university and study level, which is exactly the pair the
                  policy itself got wrong before this. If either RETURNS TABLE changes,
                  this sentence is the other half of that edit. */}
              {hasDisplayName && enrolments?.length ? (
                <Text style={s.fieldHint}>{t('eduListingDisclosure', lang)}</Text>
              ) : null}
            </View>
          )}

          {blocks.length > 0 && (
            <View style={s.blockedSection}>
              {/* "Blocked reviewers" until 20261029 — this list now also holds people
                  blocked from a profile page or a conversation, so the heading had to
                  stop naming one of the two ways in. */}
              <Text style={s.sectionTitle}>{t('blockedPeople', lang)}</Text>
              {/* ► AN UNNAMED ROW SAYS WHY IT IS UNNAMED. A bare date reads as a bug —
                      three identical rows and no way to tell them apart. The reason is
                      real and the user will accept it once told: reviews carry no name,
                      so we have none to show. Saying so turns a broken-looking row into
                      an honest one, and it is the only thing that makes the remaining
                      ambiguity tolerable rather than mysterious. */}
              {blocks.map(b => {
                const named = b.origin === 'person' && !!b.display_name
                return (
                  <View key={b.blocked_id} style={s.blockedRow}>
                    {named ? (
                      <View style={s.blockedWho}>
                        <Avatar avatarUrl={b.avatar_url} initials={(b.display_name[0] ?? '?').toUpperCase()} size={32} textSize={13} />
                        <View style={s.blockedWhoBody}>
                          <Text style={s.blockedName} numberOfLines={1}>{b.display_name}</Text>
                          <Text style={s.blockedLabel}>
                            {t('blockedOn', lang).replace('{d}', new Date(b.created_at).toLocaleDateString([], { dateStyle: 'medium' }))}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={s.blockedWhoBody}>
                        <Text style={s.blockedName} numberOfLines={2}>{t('blockedReviewerTitle', lang)}</Text>
                        <Text style={s.blockedLabel}>
                          {t('blockedOn', lang).replace('{d}', new Date(b.created_at).toLocaleDateString([], { dateStyle: 'medium' }))}
                        </Text>
                        <Text style={s.blockedHint}>{t('blockedReviewerHint', lang)}</Text>
                      </View>
                    )}
                    <TouchableOpacity style={s.unblockBtn} onPress={() => unblock(b.blocked_id)}>
                      <Text style={s.unblockText}>{t('unblock', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
            </View>
          )}

          {/* Optional and withdrawable, in the one place a user goes looking for a
              setting. It ships WITH the opt-in rather than after it: an opt-in whose
              off switch is scheduled for a later release is not a consent, and the
              wizard's hint already promises this row exists. */}
          {TERMS_CHECKBOX_LIVE && (
            <View style={s.marketingSection}>
              <Text style={s.sectionTitle}>{t('marketingSectionTitle', lang)}</Text>
              <View style={s.marketingRow}>
                <Text style={s.marketingLabel}>{t('pgMarketingOptIn', lang)}</Text>
                <Switch
                  value={marketingOn}
                  onValueChange={toggleMarketing}
                  disabled={marketingBusy}
                  trackColor={{ true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
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
              resident status other than 'student' clears the level in the SAME setForm
              call. Education has its own pickers further down, writing to the DRAFT — the
              institution is no longer a field on this form at all. */}
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
                // The institution is not touched here: it lives on the enrolment rows, and
                // changing status no longer implies anything about where somebody studied.
                // graduate's end year keeps it through a status change.
              }))
              setPicker(null)
            }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'level'} title={t('pgStudentLevel', lang)} options={levelOptions}
            value={form.student_level}
            onSelect={v => {
              setForm(f => ({ ...f, student_level: v }))
              setPicker(null)
            }}
            onClose={() => setPicker(null)} />
          {/* Every education picker writes to the DRAFT, never to the profile form — the
              five columns those fields used to feed are not written by this screen any
              more. `pastInst` is gone with the past-university shape it belonged to. */}
          <SearchModal visible={picker === 'inst'} searchable title={t('pgInstitution', lang)}
            searchPlaceholder={t('pgInstitutionSearch', lang)} options={instOptions}
            value={draft?.institutionId ?? null}
            onSelect={v => { setDraft(d => ({ ...d, institutionId: v })); setPicker(null) }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'eduLevel'} title={t('pgStudentLevel', lang)}
            options={levelOptions.filter(o => LEVELS.includes(o.value))}
            value={draft?.level ?? null}
            onSelect={v => { setDraft(d => ({ ...d, level: v })); setPicker(null) }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'subject'} searchable title={t('pgSubject', lang)}
            searchPlaceholder={t('pgSubjectSearch', lang)} options={subjectOpts}
            value={draft?.subjectId ?? null}
            onSelect={v => { setDraft(d => ({ ...d, subjectId: v })); setPicker(null) }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'startYear'} title={t('pgStudyStart', lang)} options={startYearOptions}
            value={draft?.startYear ?? null}
            onSelect={v => {
              // student_education_years_order_check: no end without a start, and no end
              // before it. Clearing the end year here rather than letting the write fail.
              setDraft(d => ({
                ...d,
                startYear: v,
                endYear: v == null || (d.endYear != null && d.endYear < v) ? null : d.endYear,
              }))
              setPicker(null)
            }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'endYear'} title={t('pgStudyEnd', lang)} options={endYearOptions}
            value={draft?.endYear ?? null}
            onSelect={v => { setDraft(d => ({ ...d, endYear: v })); setPicker(null) }}
            onClose={() => setPicker(null)} />
          <SearchModal visible={picker === 'closeYear'} title={t('pgStudyEnd', lang)}
            options={studyYearOptions(studyYearMax, currentEnrol?.study_start_year ?? STUDY_YEAR_MIN)}
            value={draft?.closeYear ?? null}
            onSelect={v => { setDraft(d => ({ ...d, closeYear: v })); setPicker(null) }}
            onClose={() => setPicker(null)} />
        </ScrollView>

        {/* ► THE PRIMARY ACTION IS A FULL-WIDTH BUTTON AT THE BOTTOM, as it is everywhere
            else in ADA. A text link in the top corner is easy to miss and hard to reach
            one-handed on a tall phone, and it was the only primary action in the app
            shaped that way. Style and structure copied from ProfileSetupScreen's footer —
            a flex sibling of the ScrollView inside KeyboardAwareForm, so the keyboard
            lifts it instead of covering it. */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.footerBtn, (!hasChanges || saving) && s.footerBtnOff]}
            onPress={save}
            disabled={saving || !hasChanges}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.footerBtnText}>
                  {saved ? t('saved', lang) : t('save', lang)}
                </Text>}
          </TouchableOpacity>
        </View>
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
  headerSpacer:     { width: 52 },
  footer: {
    flexShrink: 0, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  footerBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  footerBtnOff:     { backgroundColor: colors.border, shadowOpacity: 0, elevation: 0 },
  footerBtnText:    { color: '#fff', fontSize: 15.5, fontFamily: 'Inter_700Bold' },

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
  blockedRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 },
  blockedWho:       { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  blockedWhoBody:   { flex: 1, minWidth: 0 },
  blockedName:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  blockedHint:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17, marginTop: 3 },
  blockedLabel:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  unblockBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primaryLight },
  unblockText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  errorText:        { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12 },
  marketingSection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, marginTop: 8, marginBottom: 16 },
  marketingRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  marketingLabel:   { flex: 1, fontSize: 13.5, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 19 },
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

  // Past university

  // ─── Education ─────────────────────────────────────────────────────────────
  eduSection:        { marginTop: 4 },
  eduGroupLabel:     { fontSize: 12, fontWeight: '700', color: colors.textSecondary,
                       textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  eduGroupLabelSpaced: { marginTop: 20 },
  eduLoading:        { alignSelf: 'flex-start', marginBottom: 8 },
  eduEmpty:          { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 4 },
  eduRow:            { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
                       borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eduRowBody:        { flex: 1, gap: 2 },
  eduRowTitle:       { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  eduRowMeta:        { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  eduRowAction:      { padding: 8 },
  eduAddBtn:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
                       borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
                       paddingVertical: 10, justifyContent: 'center' },
  eduAddText:        { fontSize: 14, fontWeight: '700', color: colors.primary },
  eduDraft:          { marginTop: 12, paddingTop: 12,
                       borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eduConfirm:        { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.cardBg,
                       borderWidth: 1, borderColor: colors.border },
  eduConfirmText:    { fontSize: 13, color: colors.textPrimary, lineHeight: 19, marginBottom: 12 },
  eduConfirmRow:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  eduCancelBtn:      { flex: 1, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
                       paddingVertical: 11, alignItems: 'center' },
  eduCancelText:     { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  eduRemoveBtn:      { flex: 1, borderRadius: radius.md, backgroundColor: colors.danger ?? '#C2410C',
                       paddingVertical: 11, alignItems: 'center' },
  eduRemoveText:     { fontSize: 14, fontWeight: '700', color: '#fff' },
  eduSaveBtn:        { flex: 1, borderRadius: radius.md, backgroundColor: colors.primary,
                       paddingVertical: 11, alignItems: 'center' },
  eduSaveText:       { fontSize: 14, fontWeight: '700', color: colors.surface },

})
