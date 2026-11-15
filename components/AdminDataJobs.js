import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { Button } from './ui'
import { t, dateLocale } from '../constants/i18n'
import { isUsableJobs, groupJobs, ageParts, formatFamagusta } from '../utils/dataJobs'

// One read for both the admin-home row and the tab. null = could not be read (RPC error, or an
// empty/odd result: the registry cannot legitimately be empty), never a silent zero.
export async function loadDataJobs() {
  try {
    const { data, error } = await supabase.rpc('admin_data_jobs')
    if (error || !Array.isArray(data)) return null
    const jobs = data.filter(j => j && typeof j === 'object')
    return isUsableJobs(jobs) ? jobs : null
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

function JobRow({ job, lang }) {
  const known = !!STATE_KEY[job.state]
  const st = job.state === 'inactive' && job.attention === true ? STATE_STYLE.failed : STATE_STYLE[job.state] || OUTLINED
  const run = job.last_run
  const lastOk = job.state === 'no_record' || run?.outcome === 'ok' ? null : job.last_ok_at
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
          {lastOk !== null && (
            <Text style={styles.sub}>{(lastOk && timeLine('adminJobsLastOk', lastOk, lang)) || t('adminJobsNoOk', lang)}</Text>
          )}
        </>
      )}
      {job.state === 'failed' && !!run?.error_class && (
        <Text style={[styles.sub, { color: colors.dangerInk }]}>{t('adminJobsError', lang).replace('{error}', run.error_class)}</Text>
      )}
      {job.state === 'paused' && !!job.paused_note && (
        <Text style={styles.sub}>{t('adminJobsPaused', lang).replace('{note}', job.paused_note)}</Text>
      )}
    </View>
  )
}

export default function DataJobsTab({ lang }) {
  const [jobs, setJobs] = useState(undefined)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => { setJobs(await loadDataJobs()) }, [])
  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
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
          {g.jobs.map((j, i) => <JobRow key={`${j.key}-${i}`} job={j} lang={lang} />)}
        </View>
      ))}
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
  sub:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  errorBox:  { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 20 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.dangerInk, textAlign: 'center' },
})
