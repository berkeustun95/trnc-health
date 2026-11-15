import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t, dateLocale } from '../constants/i18n'
import { isUsableJobs, sortJobs, countAttention, ageParts, formatFamagusta } from '../utils/dataJobs'

// One read for both the admin-home row and the tab. null = could not be read (RPC error, or an
// empty/odd result: the registry cannot legitimately be empty), never a silent zero.
export async function loadDataJobs() {
  try {
    const { data, error } = await supabase.rpc('admin_data_jobs')
    if (error || !isUsableJobs(data)) return null
    return data
  } catch {
    return null
  }
}

const RUNNER_LABEL = { github: 'GitHub', cron_http: 'Supabase cron', cron_sql: 'Supabase cron' }

const STATE_KEY = {
  failed: 'adminJobsStateFailed', stale: 'adminJobsStateStale', inactive: 'adminJobsStateInactive',
  paused: 'adminJobsStatePaused', no_record: 'adminJobsStateNoRecord', ok: 'adminJobsStateOk',
}

// no_record is neutral on purpose (outlined, grey): nothing has reported yet, so it is neither green nor red.
const STATE_STYLE = {
  failed:    { bg: colors.danger, fg: '#fff' },
  stale:     { bg: colors.accent, fg: '#fff' },
  inactive:  { bg: colors.accent, fg: '#fff' },
  paused:    { bg: colors.textSecondary, fg: '#fff' },
  no_record: { bg: 'transparent', fg: colors.textSecondary, border: colors.textSecondary },
  ok:        { bg: colors.success, fg: '#fff' },
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
  const st = STATE_STYLE[job.state] || STATE_STYLE.no_record
  const run = job.last_run
  const lastOk = job.state === 'no_record' || run?.outcome === 'ok' ? null : job.last_ok_at
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.key} numberOfLines={2}>{job.key}</Text>
        <View style={[styles.pill, { backgroundColor: st.bg }, st.border && { borderWidth: 1, borderColor: st.border }]}>
          <Text style={[styles.pillText, { color: st.fg }]}>{t(STATE_KEY[job.state] || 'adminJobsStateNoRecord', lang)}</Text>
        </View>
      </View>
      <Text style={styles.sub}>{[RUNNER_LABEL[job.runner], job.schedule].filter(Boolean).join(' · ')}</Text>
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
        <Text style={[styles.sub, { color: colors.danger }]}>{t('adminJobsError', lang).replace('{error}', run.error_class)}</Text>
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
        <TouchableOpacity onPress={() => { setJobs(undefined); load() }} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('adminJobsRetry', lang)}>
          <Text style={styles.retry}>{t('adminJobsRetry', lang)}</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  const sorted = sortJobs(jobs)
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <Text style={styles.intro}>{t('adminJobsIntro', lang)}</Text>
      <Text style={styles.count}>{t('adminJobsAttention', lang).replace('{count}', String(countAttention(jobs)))}</Text>
      {sorted.map(j => <JobRow key={j.key} job={j} lang={lang} />)}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content:   { paddingBottom: 40 },
  intro:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 6 },
  count:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12 },
  card:      { backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  head:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  key:       { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  pill:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexShrink: 1, maxWidth: '55%' },
  pillText:  { fontSize: 11, fontFamily: 'Inter_700Bold' },
  sub:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  errorBox:  { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 20 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
  retry:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
})
