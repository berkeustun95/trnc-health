import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator,
  Alert, BackHandler, Linking, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import MascotIntroCard from '../components/MascotIntroCard'
import ContentReportMenu from '../components/ContentReportMenu'
import StudentProfileScreen from './StudentProfileScreen'
import ConversationsScreen from './ConversationsScreen'
import ConversationScreen from './ConversationScreen'
import { MODULE_FLAGS } from '../constants/flags'
import { getPreset } from '../constants/avatars'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import { normalize } from '../constants/oliIntents'
import { readCachedTasks, fetchTasks, loadProgress, saveProgress } from '../utils/studentTasks'
import {
  pickContent, linkOf, stepsOf, documentsOf, countDone, isTicked, toggleStep, resetTask,
} from '../utils/studentTaskRules'

// The profile wizard's escape hatch for students at an unlisted institution
// (20261001 seed, sort_order 999). It is not a place, so it has no row in a directory.
const OTHER_INSTITUTION_ID = '00000000-0000-4000-b000-0000000000ff'

function SectionTitle({ text }) {
  return <Text style={s.sectionTitle}>{text}</Text>
}

const uniMeta = (uni, lang) =>
  [uni.short_name, uni.city && t(REGION_LABEL_KEY[uni.city], lang)].filter(Boolean).join(' · ')

function UniversityRow({ uni, lang, onOpen }) {
  const meta = uniMeta(uni, lang)
  return (
    <TouchableOpacity style={[s.uniCard, s.uniRow]} onPress={onOpen} activeOpacity={0.75} accessibilityRole="button">
      <View style={s.uniRowBody}>
        <Text style={s.uniName}>{uni.name}</Text>
        {meta ? <Text style={s.uniMeta}>{meta}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

// ─── One entry in the student list (slice 4) ────────────────────────────────
// Renders ONLY what get_student_list returns. There is no more to render: the RPC hands
// back six columns and the row has no other source.
//
// "Current" vs "graduate" is DERIVED from study_end_year rather than stored — an end year
// means graduated (20261024's third arm, and the trigger that rejects future end years is
// what keeps that true).
function StudentRow({ row, lang, isMe, onOpen }) {
  const preset  = getPreset(row.avatar_url)
  const alumni  = row.study_end_year != null
  const years   = row.study_start_year
    ? `${row.study_start_year} – ${row.study_end_year ?? t('studentListPresent', lang)}`
    : null
  const meta    = [row.subject_name, years].filter(Boolean).join(' · ')

  // The AVATAR AND BODY are the tap target, not the whole row: the report menu is a
  // TouchableOpacity of its own sitting inside it, and nesting one touchable in another
  // leaves which gesture wins to the responder system. Keeping the menu outside the
  // touchable makes the answer structural rather than something to reason about.
  return (
    <View style={s.studentRow}>
      <TouchableOpacity
        style={s.studentTap}
        onPress={() => onOpen?.(row.user_id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={row.display_name}
      >
      {preset ? (
        <View style={[s.studentAvatar, { backgroundColor: preset.bg }]}>
          <Text style={s.studentAvatarEmoji}>{preset.emoji}</Text>
        </View>
      ) : row.avatar_url?.startsWith('http') ? (
        <Image source={{ uri: row.avatar_url }} style={s.studentAvatar} />
      ) : (
        <View style={[s.studentAvatar, s.studentAvatarBlank]}>
          <Text style={s.studentAvatarInitial}>{row.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}

      <View style={s.studentBody}>
        <View style={s.studentNameRow}>
          <Text style={s.studentName} numberOfLines={1}>{row.display_name}</Text>
          {isMe ? <View style={s.studentYouPill}><Text style={s.studentYouText}>{t('studentListYou', lang)}</Text></View> : null}
        </View>
        {meta ? <Text style={s.studentMeta} numberOfLines={1}>{meta}</Text> : null}
        <Text style={[s.studentStatus, alumni && s.studentStatusAlumni]}>
          {t(alumni ? 'studentListAlumni' : 'studentListCurrent', lang)}
        </Text>
      </View>
      </TouchableOpacity>

      {/* Reporting your own entry is meaningless, so the menu is hidden on it. */}
      {isMe ? null : (
        <ContentReportMenu contentType="profile" contentId={row.user_id} lang={lang} />
      )}
    </View>
  )
}

// ─── The student list ───────────────────────────────────────────────────────
// THREE STATES, NEVER COLLAPSED INTO ONE. Every university is empty at launch, so empty
// is this feature's DEFAULT state and must not read as broken:
//
//   guest            → nothing at all. Not a heading, not a hint that a list exists.
//   not opted in     → the reciprocity explanation and a route to the toggle. NOTHING
//                      NUMERIC: telling a non-member "3 students here" would disclose the
//                      count to somebody who has given nothing, which is the exact trade
//                      the opt-in exists to prevent.
//   opted in, empty  → an invitation, and confirmation that their own opt-in worked.
//
// The RPC enforces all of this server-side too; this is the copy, not the boundary.
// listingOptIn is a TRI-STATE — true / false / null for "not read yet" — and the null
// matters. Collapsing it into false shows the reciprocity card for the length of one
// round trip to every user who IS opted in: "turn this on" flashing at the person who
// already did, which is the same "broken at the moment it worked" failure the profile
// round-trip was designed to avoid, just moved earlier.
function StudentList({ uni, lang, isGuest, listingOptIn, meFailed, myId, onGoToProfile, onOpenStudent }) {
  const [rows, setRows]     = useState(null)
  const [failed, setFailed] = useState(false)

  const eligible = !isGuest && listingOptIn === true

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    setFailed(false)
    setRows(null)
    supabase
      .rpc('get_student_list', { p_institution_id: uni.id, p_lang: lang })
      .then(({ data, error }) => {
        if (cancelled) return
        // AUTH_REQUIRED / NOT_LISTED are the server saying what the client already
        // decided; anything else is a real failure. Either way the raw message never
        // reaches the user.
        if (error) { setFailed(true); return }
        setRows(data ?? [])
      })
    return () => { cancelled = true }
  }, [uni.id, lang, eligible])

  if (isGuest) return null

  // The own-row read failed: say so rather than showing the reciprocity card, which would
  // tell an opted-in user they are not opted in.
  if (meFailed) {
    return (
      <View style={s.secondCard}>
        <ContentCard>
          <SectionTitle text={t('studentListTitle', lang)} />
          <Text style={s.studentEmpty}>{t('studentLoadError', lang)}</Text>
        </ContentCard>
      </View>
    )
  }

  if (listingOptIn === null) {
    return (
      <View style={s.secondCard}>
        <ContentCard>
          <SectionTitle text={t('studentListTitle', lang)} />
          <ActivityIndicator color={colors.primary} />
        </ContentCard>
      </View>
    )
  }

  if (listingOptIn === false) {
    return (
      <ContentCard style={s.secondCard}>
        <Text style={s.studentLockedTitle}>{t('studentListLockedTitle', lang)}</Text>
        <Text style={s.studentLockedBody}>{t('studentListLockedBody', lang)}</Text>
        <TouchableOpacity style={s.studentLockedBtn} onPress={onGoToProfile} activeOpacity={0.85} accessibilityRole="button">
          <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
          <Text style={s.studentLockedBtnText}>{t('studentListLockedCta', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    )
  }

  return (
    // ► THE HEADING IS INSIDE THE CARD, NOT ABOVE IT. PageBackground paints a photo under
    //   a 0.30 black scrim; textSecondary grey sitting straight on that is barely legible,
    //   which is what "EĞİTİM" on the profile page showed. Every section label in ADA that
    //   reads correctly is inside a ContentCard — NewcomerEssentialsScreen is the pattern —
    //   so all four states below share ONE card with the title as its first child.
    <View style={s.secondCard}>
      <ContentCard>
        <SectionTitle text={t('studentListTitle', lang)} />
        {failed ? (
          <Text style={s.studentEmpty}>{t('studentLoadError', lang)}</Text>
        ) : rows === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : rows.length === 0 ? (
          <Text style={s.studentEmpty}>{t('studentListEmpty', lang).replace('{name}', uni.name)}</Text>
        ) : (
          rows.map((row, i) => (
            <View key={row.user_id} style={i ? s.studentDivider : null}>
              <StudentRow row={row} lang={lang} isMe={row.user_id === myId} onOpen={onOpenStudent} />
            </View>
          ))
        )}
      </ContentCard>
    </View>
  )
}

// ─── The university page (Student Hub affiliation, slice 3) ─────────────────
// Carries ONLY what institutions holds: name, short name, city, and the link when one is
// set (20261025). No address, logo or accreditation line — each would need a column and
// content nobody has supplied. Slice 4 adds the student list below the website button.
function UniversityDetail({ uni, lang, isGuest, listingOptIn, meFailed, myId, onGoToProfile, onOpenStudent, onBack }) {
  const meta = uniMeta(uni, lang)
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('studentTabUniversities', lang)} />

      <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        <ContentCard>
          <Text style={s.uniDetailName}>{uni.name}</Text>
          {meta ? <Text style={s.uniMeta}>{meta}</Text> : null}
        </ContentCard>

        {uni.website_url ? (
          <TouchableOpacity
            style={[s.linkBtn, s.secondCard]}
            onPress={() => Linking.openURL(uni.website_url).catch(() => {})}
            activeOpacity={0.8}
            accessibilityRole="link"
          >
            <Ionicons name="open-outline" size={18} color={colors.surface} />
            <Text style={s.linkBtnText}>{t('studentUniWebsite', lang)}</Text>
          </TouchableOpacity>
        ) : null}

        {MODULE_FLAGS.studentHub ? (
          <StudentList
            uni={uni}
            lang={lang}
            isGuest={isGuest}
            listingOptIn={listingOptIn}
            meFailed={meFailed}
            myId={myId}
            onGoToProfile={onGoToProfile}
            onOpenStudent={onOpenStudent}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function LoadError({ lang, onRetry }) {
  return (
    <View style={s.errorWrap}>
      <View style={s.errorIcon}>
        <Ionicons name="alert-circle-outline" size={28} color={colors.danger} />
      </View>
      <Text style={s.errorText}>{t('studentLoadError', lang)}</Text>
      <TouchableOpacity style={s.retryBtn} onPress={onRetry} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="refresh" size={17} color={colors.surface} />
        <Text style={s.retryText}>{t('tryAgain', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// The search text and region chip are the SCREEN's state, not this tab's: opening a
// university replaces the whole screen, which unmounts this tab, and a filter that resets
// on every back is a filter nobody can use to compare two universities.
function UniversitiesTab({ lang, universities, failed, onRetry, onOpen, query, setQuery, region, setRegion }) {

  const regions = useMemo(
    () => ['all', ...REGIONS.filter(r => universities?.some(u => u.city === r))],
    [universities],
  )

  const results = useMemo(() => {
    if (!universities) return []
    const q = normalize(query)
    return universities.filter(u => {
      if (region !== 'all' && u.city !== region) return false
      if (!q) return true
      const blob = normalize([u.name, u.short_name].filter(Boolean).join(' '))
      return q.split(' ').every(tok => blob.includes(tok))
    })
  }, [universities, query, region])

  if (failed) {
    return (
      <View style={s.tabContent}>
        <LoadError lang={lang} onRetry={onRetry} />
      </View>
    )
  }

  if (!universities) {
    return <ActivityIndicator size="large" color={colors.primary} style={s.loading} />
  }

  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('studentSearchPlaceholder', lang)}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {regions.map(r => {
          const active = r === region
          return (
            <TouchableOpacity
              key={r}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setRegion(r)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {t(r === 'all' ? 'filterAll' : REGION_LABEL_KEY[r], lang)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {results.length === 0 ? (
        <View style={s.emptyWrap}>
          <Ionicons name="school-outline" size={28} color={colors.textSecondary} />
          <Text style={s.emptyText}>{t('studentNoResults', lang)}</Text>
        </View>
      ) : (
        results.map(u => <UniversityRow key={u.id} uni={u} lang={lang} onOpen={() => onOpen(u.id)} />)
      )}
    </ScrollView>
  )
}

function BasicsTab({ lang, tasks, tasksFailed, offline, progress, onRetryTasks, onOpenTask, onShowEsim, onShowNewcomerEssentials }) {
  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      {/* One opaque card, not five floating ones: the heading and the offline notice
          would otherwise sit straight on the PageBackground photo. */}
      {tasks === null && tasksFailed ? (
        <LoadError lang={lang} onRetry={onRetryTasks} />
      ) : (
        <ContentCard>
          <SectionTitle text={t('studentArrivalTitle', lang)} />
          {offline ? <OfflineNotice lang={lang} /> : null}
          {tasks === null
            ? <ActivityIndicator color={colors.primary} style={s.tasksLoading} />
            : tasks.map((task, i) => (
                <TaskRow key={task.slug} task={task} lang={lang} progress={progress} first={i === 0} onOpen={() => onOpenTask(task.slug)} />
              ))}
        </ContentCard>
      )}

      <ContentCard style={s.secondCard}>
        <SectionTitle text={t('studentNewcomerTitle', lang)} />
        <Text style={s.crossText}>{t('studentNewcomerBody', lang)}</Text>
        <TouchableOpacity style={s.linkBtnGhost} onPress={onShowNewcomerEssentials} activeOpacity={0.8}>
          <Ionicons name="compass-outline" size={18} color={colors.primary} />
          <Text style={s.linkBtnGhostText}>{t('studentNewcomerBtn', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.linkBtnGhost, s.linkBtnStacked]} onPress={onShowEsim} activeOpacity={0.8}>
          <Ionicons name="cellular-outline" size={18} color={colors.primary} />
          <Text style={s.linkBtnGhostText}>{t('studentSimBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    </ScrollView>
  )
}

// Task content comes from the database, so its icon name can be anything; an unknown
// glyph renders as '?' rather than failing, which is worse than a neutral dot.
const taskIcon = name => (name && Ionicons.glyphMap?.[name] !== undefined ? name : 'ellipse-outline')

function OfflineNotice({ lang }) {
  return (
    <View style={s.offline}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
      <Text style={s.offlineText}>{t('studentTasksOffline', lang)}</Text>
    </View>
  )
}

function TaskRow({ task, lang, progress, first, onOpen }) {
  const content = pickContent(task, lang)

  // No row in this language or in English yet: say so, and offer nothing to open.
  if (!content) {
    return (
      <View style={[s.taskRow, !first && s.taskRowDivider]}>
        <View style={s.taskIcon}>
          <Ionicons name={taskIcon(task.icon)} size={22} color={colors.textSecondary} />
        </View>
        <Text style={s.taskPendingText}>{t('studentTaskPending', lang)}</Text>
      </View>
    )
  }

  const steps = stepsOf(content)
  const done = countDone(progress, task.slug, steps)
  const complete = steps.length > 0 && done === steps.length

  return (
    <TouchableOpacity style={[s.taskRow, !first && s.taskRowDivider]} onPress={onOpen} activeOpacity={0.7} accessibilityRole="button">
      <View style={[s.taskIcon, complete && s.taskIconDone]}>
        <Ionicons name={complete ? 'checkmark' : taskIcon(task.icon)} size={22} color={complete ? colors.success : colors.primary} />
      </View>
      <View style={s.taskBody}>
        <Text style={s.taskTitle}>{content.title}</Text>
        {content.summary ? <Text style={s.taskSummary} numberOfLines={2}>{content.summary}</Text> : null}
      </View>
      {steps.length > 0 ? <Text style={[s.taskCount, complete && s.taskCountDone]}>{done}/{steps.length}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

function TaskDetail({ task, lang, progress, offline, onToggle, onReset, onBack }) {
  const content = pickContent(task, lang)
  const steps = stepsOf(content)
  const documents = documentsOf(content)
  const link = linkOf(task, content)
  const done = countDone(progress, task.slug, steps)

  const confirmReset = () => Alert.alert(t('studentTaskReset', lang), undefined, [
    { text: t('cancel', lang), style: 'cancel' },
    { text: t('studentTaskReset', lang), style: 'destructive', onPress: onReset },
  ])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={content?.title ?? t('menuStudentHub', lang)} />

      <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
        {offline ? <OfflineNotice lang={lang} /> : null}

        {!content ? (
          <ContentCard>
            <Text style={s.taskPendingText}>{t('studentTaskPending', lang)}</Text>
          </ContentCard>
        ) : (
          <>
            {content.summary || content.note ? (
              <ContentCard>
                {content.summary ? <Text style={s.crossText}>{content.summary}</Text> : null}
                {content.note ? (
                  <View style={s.noteRow}>
                    <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                    <Text style={s.noteText}>{content.note}</Text>
                  </View>
                ) : null}
              </ContentCard>
            ) : null}

            {steps.length > 0 ? (
              <ContentCard style={s.secondCard}>
                <View style={s.sectionHead}>
                  <SectionTitle text={t('studentTaskSteps', lang)} />
                  <Text style={s.sectionCount}>{done}/{steps.length}</Text>
                </View>
                {steps.map((step, i) => {
                  const ticked = isTicked(progress, task.slug, step.id)
                  return (
                    <TouchableOpacity
                      key={step.id}
                      style={s.stepRow}
                      onPress={() => onToggle(step.id)}
                      disabled={!progress}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: ticked, disabled: !progress }}
                    >
                      <Ionicons name={ticked ? 'checkbox' : 'square-outline'} size={22} color={ticked ? colors.success : colors.textSecondary} />
                      <Text style={[s.stepText, ticked && s.stepTextDone]}>{i + 1}. {step.text}</Text>
                    </TouchableOpacity>
                  )
                })}
                {done > 0 ? (
                  <TouchableOpacity style={s.resetBtn} onPress={confirmReset} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="refresh" size={15} color={colors.textSecondary} />
                    <Text style={s.resetText}>{t('studentTaskReset', lang)}</Text>
                  </TouchableOpacity>
                ) : null}
              </ContentCard>
            ) : null}

            {documents.length > 0 ? (
              <ContentCard style={s.secondCard}>
                <SectionTitle text={t('studentTaskDocuments', lang)} />
                {documents.map((doc, i) => (
                  <View key={i} style={s.docRow}>
                    <Ionicons name="document-text-outline" size={17} color={colors.primary} />
                    <Text style={s.docText}>{doc}</Text>
                  </View>
                ))}
              </ContentCard>
            ) : null}

            {content.hours ? (
              <ContentCard style={s.secondCard}>
                <SectionTitle text={t('studentTaskHours', lang)} />
                <View style={s.docRow}>
                  <Ionicons name="time-outline" size={17} color={colors.primary} />
                  <Text style={s.docText}>{content.hours}</Text>
                </View>
              </ContentCard>
            ) : null}

            {link ? (
              <TouchableOpacity
                style={[s.linkBtn, s.secondCard]}
                onPress={() => Linking.openURL(link).catch(() => {})}
                activeOpacity={0.8}
                accessibilityRole="link"
              >
                <Ionicons name="open-outline" size={18} color={colors.surface} />
                <Text style={s.linkBtnText}>{t('studentTaskOpenLink', lang)}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default function StudentHubScreen({
  lang, onBack, onShowEsim, onShowNewcomerEssentials, isGuest = false, onGoToProfile,
  initialConversationId = null,   // set by a tapped push notification
  onConversationOpened,
}) {
  const [tab, setTab] = useState('universities')
  const [universities, setUniversities] = useState(null)
  const [failed, setFailed] = useState(false)
  // The viewer's OWN row, read here rather than passed down from App.js. App.js caches the
  // profile and has no callback for the listing toggle, so a prop would be stale exactly
  // once — right after the user turns the setting on and comes back, which is the moment
  // the feature has to be right. Opening the profile closes this screen, so re-entering
  // re-mounts and re-reads.
  const [me, setMe] = useState(null)
  const [meFailed, setMeFailed] = useState(false)

  const [tasks, setTasks] = useState(null)
  const [tasksFailed, setTasksFailed] = useState(false)
  // null until read from the device — nothing is written back before that, or an early
  // save would overwrite the stored ticks with an empty object.
  const [progress, setProgress] = useState(null)
  const [openSlug, setOpenSlug] = useState(null)
  const [openUniId, setOpenUniId] = useState(null)
  const [openStudentId, setOpenStudentId] = useState(null)
  // Slice 6. `openConv` is a row from list_conversations(); `composeWith` is a person with
  // no thread yet. They are mutually exclusive and both sit ABOVE the profile page in the
  // stack, because you reach a conversation THROUGH a profile.
  const [openConv, setOpenConv] = useState(null)
  const [composeWith, setComposeWith] = useState(null)
  const [convKey, setConvKey] = useState(0)
  const [uniQuery, setUniQuery] = useState('')
  const [uniRegion, setUniRegion] = useState('all')

  // Cache first, then the network. A student with no data yet sees the last copy
  // immediately; a failed refresh keeps it on screen and says it is offline.
  const loadTasks = useCallback(async () => {
    setTasksFailed(false)
    const cached = await readCachedTasks()
    if (cached) setTasks(prev => prev ?? cached.tasks)
    try {
      setTasks(await fetchTasks())
    } catch {
      setTasksFailed(true)
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadProgress().then(setProgress) }, [])
  useEffect(() => { if (progress) saveProgress(progress) }, [progress])

  // ONE LEVEL AT A TIME. The profile page opens ON TOP of a university page, so a back
  // press there must close the profile and leave the university page standing — clearing
  // both would drop the user two levels for one gesture, which reads as the app losing
  // its place. Ordered innermost-first for the same reason.
  useEffect(() => {
    if (!openSlug && !openUniId && !openStudentId && !openConv && !composeWith) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // INNERMOST FIRST. A conversation sits on top of the profile that opened it, so it
      // has to be closed before the page underneath it.
      if (openConv || composeWith) { setOpenConv(null); setComposeWith(null); return true }
      if (openStudentId) { setOpenStudentId(null); return true }
      setOpenSlug(null); setOpenUniId(null); return true
    })
    return () => sub.remove()
  }, [openSlug, openUniId, openStudentId, openConv, composeWith])

  // Loaded here rather than in the tab so switching tabs does not refetch.
  const load = useCallback(() => {
    setFailed(false)
    setUniversities(null)
    supabase.from('institutions')
      .select('id, name, short_name, city, website_url')
      .eq('is_active', true)
      .neq('id', OTHER_INSTITUTION_ID)
      .order('name')
      .then(({ data, error }) => {
        // Zero rows is a fault, not an empty directory: the table is seeded and cannot
        // legitimately be empty, and a session RLS refuses gets [] with no error.
        if (error || !data?.length) { setFailed(true); return }
        setUniversities(data)
      })
  }, [])

  useEffect(() => { load() }, [load])

  // ─── THE RECIPROCITY GATE IS THE DATABASE'S, NOT THIS SCREEN'S ─────────────
  //
  // This used to read `profiles.student_listing_opt_in` and compare it to true. That was
  // correct while a person had ONE affiliation and one switch. It stops being correct the
  // moment 20261026's student_education exists, because the opt-in became PER ENROLMENT:
  // somebody listed at one university and not another is `true` here and `false` there,
  // and a single boolean on `profiles` cannot say which.
  //
  // `can_see_student_lists()` is the one rule, it lives in the database, and it is what
  // get_student_list, get_student_profile, start_conversation and send_message all gate
  // on. Asking it directly means this screen and the server can never disagree — and the
  // copy that drifts is always the one that lets somebody lurk.
  //
  // It also removes a `profiles` read entirely: the only other thing this needed was the
  // caller's own id, and the session already has that.
  useEffect(() => {
    if (!MODULE_FLAGS.studentHub || isGuest) return
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (!session?.user) { setMeFailed(true); return }
      supabase.rpc('can_see_student_lists').then(({ data, error }) => {
        if (cancelled) return
        // A boolean RPC returns `false` legitimately, so `!data` is not a failure test —
        // only `error` is, and a null body from a function that always returns a boolean
        // means something went wrong rather than "no".
        if (error || data == null) { setMeFailed(true); return }
        setMe({ id: session.user.id, canSee: data === true })
      })
    })
    return () => { cancelled = true }
  }, [isGuest])

  // ─── A TAPPED PUSH NOTIFICATION LANDS HERE ────────────────────────────────
  //
  // The payload carries only `conversation_id` (20261031), so the row has to be resolved
  // the same way openThreadWith does — through list_conversations(), the one sanctioned
  // read path. A push is the ONLY way into a thread that does not pass through a profile
  // page, which is why this cannot reuse that route.
  //
  // Cleared through onConversationOpened whatever the outcome, INCLUDING when the row is
  // not found. A thread can legitimately be gone by the time somebody taps — declined,
  // left, blocked, or the other account deleted — and leaving the id pending would retry
  // forever and re-hijack the screen every time the hub re-renders. The messages tab is
  // opened regardless, because that is where a missing thread should leave somebody.
  useEffect(() => {
    if (!initialConversationId || isGuest || !MODULE_FLAGS.studentHub) return
    let cancelled = false
    supabase.rpc('list_conversations').then(({ data }) => {
      if (cancelled) return
      const row = (data ?? []).find(r => r.conversation_id === initialConversationId)
      setTab('messages')
      if (row) { setComposeWith(null); setOpenConv(row) }
      onConversationOpened?.()
    })
    return () => { cancelled = true }
  }, [initialConversationId, isGuest, onConversationOpened])

  // A conversation opened from a profile has to be resolved to a real row before it can
  // be rendered, because start_conversation returns only a status. One extra RPC on a rare
  // path, rather than threading the inbox's rows back up through two components.
  async function openThreadWith(userId) {
    const { data } = await supabase.rpc('list_conversations')
    const row = (data ?? []).find(r => r.other_user_id === userId)
    setComposeWith(null)
    setOpenConv(row ?? null)
    setConvKey(k => k + 1)
  }

  // TOP OF THE STACK: a conversation sits above the profile page that opened it.
  if (openConv || composeWith) {
    return (
      <ConversationScreen
        conversation={openConv}
        composeWith={composeWith}
        myId={me?.id ?? null}
        lang={lang}
        onBack={() => { setOpenConv(null); setComposeWith(null); setConvKey(k => k + 1) }}
        onChanged={result => {
          if (result?.openWith) { openThreadWith(result.openWith); return }
          setConvKey(k => k + 1)
        }}
      />
    )
  }

  // BEFORE the university page: this is the page on top of the stack.
  if (openStudentId) {
    return (
      <StudentProfileScreen
        userId={openStudentId}
        lang={lang}
        isMe={openStudentId === me?.id}
        onBack={() => setOpenStudentId(null)}
        onMessage={person => setComposeWith(person)}
      />
    )
  }

  const openUni = openUniId ? universities?.find(u => u.id === openUniId) : null
  if (openUni) {
    return (
      <UniversityDetail
        uni={openUni}
        lang={lang}
        isGuest={isGuest}
        listingOptIn={me ? me.canSee : null}
        meFailed={meFailed}
        myId={me?.id ?? null}
        onGoToProfile={onGoToProfile}
        onOpenStudent={setOpenStudentId}
        onBack={() => setOpenUniId(null)}
      />
    )
  }

  const openTask = openSlug ? tasks?.find(task => task.slug === openSlug) : null
  if (openTask) {
    return (
      <TaskDetail
        task={openTask}
        lang={lang}
        progress={progress}
        offline={tasksFailed}
        onToggle={stepId => setProgress(prev => toggleStep(prev, openTask.slug, stepId))}
        onReset={() => setProgress(prev => resetTask(prev, openTask.slug))}
        onBack={() => setOpenSlug(null)}
      />
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('menuStudentHub', lang)} />

      <View style={s.introWrap}>
        <MascotIntroCard
          module="welcome_guide"
          title={t('studentHubTitle', lang)}
          subtitle={t('studentHubSubtitle', lang)}
        />
      </View>

      <View style={s.segment}>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'universities' && s.segmentBtnActive]}
          onPress={() => setTab('universities')}
          activeOpacity={0.9}
        >
          <Text numberOfLines={2} style={[s.segmentText, tab === 'universities' && s.segmentTextActive]}>{t('studentTabUniversities', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'basics' && s.segmentBtnActive]}
          onPress={() => setTab('basics')}
          activeOpacity={0.9}
        >
          <Text numberOfLines={2} style={[s.segmentText, tab === 'basics' && s.segmentTextActive]}>{t('studentTabBasics', lang)}</Text>
        </TouchableOpacity>
        {/* Messaging is a member-only surface, so a GUEST is not shown the tab at all —
            the same rule the student list applies. Showing it and then explaining would
            advertise a feature to somebody who cannot have an account yet. */}
        {isGuest ? null : (
          <TouchableOpacity
            style={[s.segmentBtn, tab === 'messages' && s.segmentBtnActive]}
            onPress={() => setTab('messages')}
            activeOpacity={0.9}
          >
            <Text numberOfLines={2} style={[s.segmentText, tab === 'messages' && s.segmentTextActive]}>{t('studentTabMessages', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>

      {tab === 'universities'
        ? (
          <UniversitiesTab
            lang={lang}
            universities={universities}
            failed={failed}
            onRetry={load}
            onOpen={setOpenUniId}
            query={uniQuery}
            setQuery={setUniQuery}
            region={uniRegion}
            setRegion={setUniRegion}
          />
        )
        : tab === 'messages'
        ? (
          <ConversationsScreen
            lang={lang}
            canSee={me ? me.canSee : (meFailed ? false : null)}
            refreshKey={convKey}
            onOpen={setOpenConv}
            onGoToProfile={onGoToProfile}
          />
        )
        : (
          <BasicsTab
            lang={lang}
            tasks={tasks}
            tasksFailed={tasksFailed}
            offline={tasksFailed && tasks !== null}
            progress={progress}
            onRetryTasks={loadTasks}
            onOpenTask={setOpenSlug}
            onShowEsim={onShowEsim}
            onShowNewcomerEssentials={onShowNewcomerEssentials}
          />
        )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  introWrap: { paddingHorizontal: 16, marginBottom: 16 },

  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.surface, ...shadow },
  // ► TWO TABS BECAME THREE, WHICH CUT EACH ONE FROM ~156dp TO ~104dp ON A 360dp PHONE.
  //   The middle label is 17-25 characters in every language except English ("Öğrenci
  //   temelleri", "Βασικά για νέους φοιτητές", "أساسيات الطالب الجديد"), so at 14pt on one
  //   line it no longer fits and the third tab is what made that true.
  //
  //   Wrapping to a second line, capped at two by numberOfLines on the call sites. NOT
  //   adjustsFontSizeToFit — ExchangeRatesScreen already rejected that as unreliable — and
  //   NOT AdminScreen's horizontally scrolling pills, which are right for its dozen tabs
  //   and wrong here: a brand-new feature must not be hidden behind a swipe.
  //   textAlign matters once there are two lines; alignItems centres the block, not the text.
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  segmentTextActive: { color: colors.primary },

  tabScroll: { flex: 1 },
  tabContent: { paddingHorizontal: 16, paddingBottom: 40 },
  loading: { marginTop: 48 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    ...shadow,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  chipRow: { gap: 8, paddingRight: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.surface },

  uniCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  uniRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  uniRowBody: { flex: 1 },
  uniName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, lineHeight: 21 },
  uniDetailName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, lineHeight: 26 },
  uniMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },

  errorWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 24,
    marginTop: 12,
    alignItems: 'center',
    ...shadow,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  errorText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    marginTop: 18,
  },
  retryText: { fontSize: 15, fontWeight: '600', color: colors.surface },

  secondCard: { marginTop: 16 },

  // ─── Student list (slice 4) ───────────────────────────────────────────────
  studentRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  // The tap target inside the row. flex:1 so it takes everything the report menu does
  // not, and the same row layout it replaced — the menu is a sibling, not a child.
  studentTap:          { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  studentDivider:      { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  studentAvatar:       { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  studentAvatarEmoji:  { fontSize: 22 },
  studentAvatarBlank:  { backgroundColor: colors.cardBg },
  studentAvatarInitial:{ fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  studentBody:         { flex: 1, minWidth: 0 },
  studentNameRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  studentName:         { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  studentYouPill:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  studentYouText:      { fontSize: 11, fontWeight: '700', color: colors.primary },
  studentMeta:         { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  studentStatus:       { fontSize: 12, color: colors.primary, marginTop: 3, fontWeight: '600' },
  studentStatusAlumni: { color: colors.textSecondary },
  studentEmpty:        { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

  studentLockedTitle:  { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  studentLockedBody:   { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  studentLockedBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  studentLockedBtnText:{ fontSize: 15, fontWeight: '700', color: colors.primary },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },

  tasksLoading: { marginVertical: 24 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  taskRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  taskIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  taskIconDone: { backgroundColor: colors.successLight },
  taskBody: { flex: 1 },
  taskTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  taskSummary: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
  taskCount: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, flexShrink: 0 },
  taskCountDone: { color: colors.success },
  taskPendingText: { flex: 1, fontSize: 14, fontStyle: 'italic', color: colors.textSecondary },

  // Opaque, because the detail view shows it directly over the PageBackground photo.
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  offlineText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sectionCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  stepText: { flex: 1, fontSize: 15, color: colors.textPrimary, lineHeight: 22 },
  stepTextDone: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10 },
  resetText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  docRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 },
  docText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 21 },

  crossText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21, marginBottom: 14 },

  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    marginTop: 8,
    gap: 8,
  },
  linkBtnText: { fontSize: 15, fontWeight: '600', color: colors.surface },
  linkBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    gap: 8,
  },
  linkBtnGhostText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  linkBtnStacked: { marginTop: 10 },
})
