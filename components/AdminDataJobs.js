import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet, Switch, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, BottomSheet, ConfirmDialog } from './ui'
import useKeyboardTop from '../utils/useKeyboardTop'
import { t, dateLocale } from '../constants/i18n'
import { isUsableJobs, isValidJob, groupJobs, ageParts, formatFamagusta, switchErrorKey } from '../utils/dataJobs'

// One read for both the admin-home row and the tab. null = could not be read (RPC error, or an
// empty/odd result: the registry cannot legitimately be empty), never a silent zero.
export async function loadDataJobs() {
  try {
    const { data, error } = await supabase.rpc('admin_data_jobs')
    if (error || !Array.isArray(data)) return null
    const jobs = data.filter(j => j && typeof j === 'object')
    return isUsableJobs(jobs) && jobs.every(isValidJob) ? jobs : null
  } catch {
    return null
  }
}

const RUNNER_LABEL = { github: 'GitHub', cron_http: 'Supabase cron', cron_sql: 'Supabase cron' }

const STATE_KEY = {
  failed: 'adminJobsStateFailed', stale: 'adminJobsStateStale', inactive: 'adminJobsStateInactive',
  paused: 'adminJobsStatePaused', no_record: 'adminJobsStateNoRecord', ok: 'adminJobsStateOk',
}

// Tint + ink pairs (>= 4.5:1). no_record and unknown are neutral on purpose (outlined, grey): nothing has
// reported yet, so neither green nor red. Inactive is red only when the server says attention.
const NEUTRAL = { bg: colors.soft, fg: colors.textSecondary }
const OUTLINED = { bg: 'transparent', fg: colors.textSecondary, border: colors.textSecondary }
const STATE_STYLE = {
  failed:    { bg: colors.dangerLight, fg: colors.dangerInk },
  stale:     { bg: colors.accentLight, fg: colors.tintLifestyleFg },
  inactive:  NEUTRAL,
  paused:    NEUTRAL,
  no_record: OUTLINED,
  ok:        { bg: colors.successLight, fg: colors.successInk },
}

const NOTE_MAX = 200
// Pausing this one stops a push that reaches every user, so its sheet carries one extra line.
const CAUTION_KEYS = ['duty-push']

const GROUP_KEY = {
  attention: 'adminJobsGroupAttention', paused: 'adminJobsGroupPaused',
  noRecord: 'adminJobsGroupNoRecord', ok: 'adminJobsGroupOk',
}

function ageText(iso, lang) {
  const p = ageParts(iso)
  if (!p) return ''
  return t(`adminJobs${p.key}`, lang).replace('{n}', String(p.n ?? ''))
}

function timeLine(labelKey, iso, lang) {
  const time = formatFamagusta(iso, dateLocale(lang))
  if (!time) return null
  return t(labelKey, lang).replace('{time}', time).replace('{age}', ageText(iso, lang))
}

function JobRow({ job, lang, busy, error, onSwitch }) {
  const known = !!STATE_KEY[job.state]
  const st = job.state === 'inactive' && job.attention === true ? STATE_STYLE.failed : STATE_STYLE[job.state] || OUTLINED
  const run = job.last_run
  const showLastOk = job.state !== 'no_record' && run?.outcome !== 'ok'
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.key}>{job.key}</Text>
        <View style={[styles.pill, { backgroundColor: st.bg }, st.border && { borderWidth: 1, borderColor: st.border }]}>
          <Text style={[styles.pillText, { color: st.fg }]}>{t(known ? STATE_KEY[job.state] : 'adminJobsStateUnknown', lang)}</Text>
        </View>
      </View>
      {!!RUNNER_LABEL[job.runner] && <Text style={styles.sub}>{RUNNER_LABEL[job.runner]}</Text>}
      {!!job.schedule && <Text style={styles.sub}>{job.schedule}</Text>}
      {job.state === 'no_record' ? (
        <Text style={styles.sub}>{t('adminJobsNoRecordNote', lang)}</Text>
      ) : (
        <>
          <Text style={styles.sub}>{(run?.started_at && timeLine('adminJobsLastRun', run.started_at, lang)) || t('adminJobsNoRun', lang)}</Text>
          {run?.outcome === 'running' && <Text style={styles.sub}>{t('adminJobsRunning', lang)}</Text>}
          {showLastOk && (
            <Text style={styles.sub}>{(job.last_ok_at && timeLine('adminJobsLastOk', job.last_ok_at, lang)) || t('adminJobsNoOk', lang)}</Text>
          )}
        </>
      )}
      {job.state === 'failed' && !!run?.error_class && (
        <Text style={[styles.sub, { color: colors.dangerInk }]}>{t('adminJobsError', lang).replace('{error}', () => run.error_class)}</Text>
      )}
      {(job.state === 'paused' || job.paused === true) && !!job.paused_note && (
        <Text style={styles.sub}>{t('adminJobsPaused', lang).replace('{note}', () => job.paused_note)}</Text>
      )}
      {job.paused === true && !!formatFamagusta(job.paused_at, dateLocale(lang)) && (
        <Text style={styles.sub}>{t('adminJobsPausedSince', lang).replace('{time}', formatFamagusta(job.paused_at, dateLocale(lang)))}</Text>
      )}
      {job.switchable === true && (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('adminJobsSwitchRow', lang)}</Text>
          <Switch
            value={job.paused !== true}
            disabled={busy}
            onValueChange={on => onSwitch(job, on)}
            trackColor={{ true: colors.primary, false: colors.fieldBorder }}
            thumbColor="#FFFFFF"
            accessibilityLabel={t('adminJobsSwitchLabel', lang).replace('{job}', job.key)}
          />
        </View>
      )}
      {!!error && <Text style={[styles.sub, { color: colors.dangerInk }]} accessibilityRole="alert">{t(error, lang)}</Text>}
    </View>
  )
}

// The reason field lives in its own component so typing never re-renders the list behind the sheet.
// `job` is the last job shown (kept through the sheet's exit animation); only `visible` opens and closes it.
function PauseSheet({ job, visible, lang, onCancel, onConfirm }) {
  const [note, setNote] = useState('')
  const trimmed = note.trim()
  useEffect(() => { if (visible) setNote('') }, [visible])
  // Android: KeyboardAvoidingView does nothing and the sheet is absolute-bottom in a translucent Modal, so the keyboard
  // would cover the field and buttons. Measure where the body ends against the keyboard's top edge (as Sepetim does).
  const insets = useSafeAreaInsets()
  const kbTop = useKeyboardTop()
  const bodyRef = useRef(null)
  const [lift, setLift] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'android' || kbTop == null) { setLift(0); return }
    const measure = () => {
      const el = bodyRef.current
      if (!el || typeof el.measureInWindow !== 'function') return
      el.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h + Math.max(insets.bottom, 16) - kbTop))))
    }
    measure()
    const id = setTimeout(measure, 250)   // the keyboard can open during the sheet's 280 ms entrance
    return () => clearTimeout(id)
  }, [kbTop])
  return (
    <BottomSheet visible={visible === true} onClose={onCancel} lang={lang} title={t('adminJobsPauseTitle', lang).replace('{job}', job?.key ?? '')}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View ref={bodyRef} collapsable={false} style={lift > 0 && { paddingBottom: lift }}>
        {CAUTION_KEYS.includes(job?.key) && <Text style={styles.caution}>{t('adminJobsDutyWarn', lang)}</Text>}
        <Text style={styles.fieldLabel}>{t('adminJobsPauseReason', lang)}</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          maxLength={NOTE_MAX}
          multiline
          placeholder={t('adminJobsPausePlaceholder', lang)}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('adminJobsPauseReason', lang)}
        />
        <Text style={styles.counter}>{note.length}/{NOTE_MAX}</Text>
        <View style={styles.sheetActions}>
          <Button variant="secondary" title={t('cancel', lang)} onPress={onCancel} style={styles.flex} fullWidth />
          <Button variant="danger" title={t('adminJobsPauseConfirm', lang)} onPress={() => onConfirm(trimmed)} disabled={trimmed.length === 0} style={styles.flex} fullWidth />
        </View>
      </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  )
}

export default function DataJobsTab({ lang }) {
  const [jobs, setJobs] = useState(undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [pending, setPending] = useState(null)      // { job, pause } while a confirm is open
  const [saving, setSaving] = useState({})          // key -> true while its write is in flight
  const [errors, setErrors] = useState({})          // key -> i18n key of the last failed write

  const load = useCallback(async () => { setJobs(await loadDataJobs()) }, [])
  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // The sheet and dialog stay mounted for their exit animation after `pending` clears: keep what they last showed.
  const lastPending = useRef(null)
  if (pending) lastPending.current = pending
  const shown = pending || lastPending.current

  const askSwitch = (job, on) => setPending({ job, pause: !on })

  const save = async (job, pause, note) => {
    setPending(null)
    setErrors(e => ({ ...e, [job.key]: null }))
    setSaving(x => ({ ...x, [job.key]: true }))
    try {
      const { data, error } = await supabase.rpc('admin_set_data_job_paused', { p_job: job.key, p_paused: pause, p_note: pause ? note : null })
      if (error) throw error
      if (isValidJob(data) && data.key === job.key) setJobs(js => (Array.isArray(js) ? js.map(j => (j.key === job.key ? data : j)) : js))
      else load()
    } catch (e) {
      setErrors(x => ({ ...x, [job.key]: switchErrorKey(e) }))
    } finally {
      setSaving(x => ({ ...x, [job.key]: false }))
    }
  }

  if (jobs === undefined) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>

  if (jobs === null) {
    return (
      <ScrollView contentContainerStyle={styles.errorBox} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        <Text style={styles.errorText}>{t('adminJobsLoadError', lang)}</Text>
        <Button title={t('adminJobsRetry', lang)} variant="secondary" onPress={() => { setJobs(undefined); load() }} />
      </ScrollView>
    )
  }

  const groups = groupJobs(jobs)
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <Text style={styles.intro}>{t('adminJobsIntro', lang)}</Text>
      {groups.map(g => (
        <View key={g.id}>
          <Text style={styles.groupHead} accessibilityRole="header">{t(GROUP_KEY[g.id], lang).replace('{count}', String(g.jobs.length))}</Text>
          {g.jobs.map((j, i) => <JobRow key={`${j.key}-${i}`} job={j} lang={lang} busy={saving[j.key] === true} error={errors[j.key]} onSwitch={askSwitch} />)}
        </View>
      ))}
      <PauseSheet job={shown?.job} visible={pending?.pause === true} lang={lang}
        onCancel={() => setPending(null)} onConfirm={note => save(pending.job, true, note)} />
      <ConfirmDialog
        visible={pending?.pause === false}
        title={t('adminJobsResumeTitle', lang).replace('{job}', shown?.job?.key ?? '')}
        confirmLabel={t('adminJobsResumeConfirm', lang)}
        onConfirm={() => save(pending.job, false, null)}
        onCancel={() => setPending(null)}
        lang={lang}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content:   { paddingBottom: 40 },
  intro:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  groupHead: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 10, marginBottom: 8 },
  card:      { backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  head:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  key:       { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  pill:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexShrink: 1, maxWidth: '55%' },
  pillText:  { fontSize: 11, fontFamily: 'Inter_700Bold' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, minHeight: 44 },
  switchLabel: { flex: 1, flexShrink: 1, fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  caution:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.dangerInk, lineHeight: 18, marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  input:     { minHeight: 72, maxHeight: 140, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, textAlignVertical: 'top', backgroundColor: 'transparent' },
  counter:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'right', marginTop: 4 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  flex:      { flex: 1 },
  sub:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  errorBox:  { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 20 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.dangerInk, textAlign: 'center' },
})
