// Poster-facing status list for a user's own job postings.
//
// CRITICAL: this screen must NEVER surface payment state. A business post that
// is awaiting payment has status='pending' and renders as "Under review" —
// identical to a post awaiting content review. payment_status is not selected
// here on purpose, so the anti-steering rule (iOS 3.1.1) holds structurally
// rather than by remembering to omit a label. Do not add pricing, payment or
// bank-transfer copy to this file.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator, AppState, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// An active row whose expiry has passed but which the hourly cron has not swept
// yet should read as expired, not active.
function effectiveStatus(job) {
  if (job.status === 'active' && job.expires_at && new Date(job.expires_at) <= new Date()) {
    return 'expired'
  }
  return job.status
}

const STATUS_META = {
  pending:  { labelKey: 'jobMyStatusReview',   color: colors.accent,        icon: 'time-outline' },
  active:   { labelKey: 'jobMyStatusActive',   color: colors.success,       icon: 'checkmark-circle-outline' },
  rejected: { labelKey: 'jobMyStatusRejected', color: colors.danger,        icon: 'close-circle-outline' },
  filled:   { labelKey: 'jobMyStatusFilled',   color: '#7C3AED',            icon: 'people-outline' },
  expired:  { labelKey: 'jobMyStatusExpired',  color: colors.textSecondary, icon: 'hourglass-outline' },
}

function PostingCard({ job, lang }) {
  const status = effectiveStatus(job)
  const meta   = STATUS_META[status] ?? STATUS_META.pending

  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle} numberOfLines={2}>{job.job_title}</Text>
          <Text style={s.cardSub} numberOfLines={1}>{job.employer_name}</Text>
        </View>
        <View style={[s.pill, { backgroundColor: meta.color + '1A' }]}>
          <Ionicons name={meta.icon} size={13} color={meta.color} />
          <Text style={[s.pillText, { color: meta.color }]}>{t(meta.labelKey, lang)}</Text>
        </View>
      </View>

      {status === 'active' && job.expires_at && (
        <Text style={s.cardMeta}>
          {t('jobMyExpires', lang).replace('{date}', new Date(job.expires_at).toLocaleDateString('en-GB'))}
        </Text>
      )}

      {status === 'rejected' && !!job.rejection_reason && (
        <Text style={[s.cardMeta, { color: colors.danger }]}>{job.rejection_reason}</Text>
      )}
    </View>
  )
}

export default function MyJobPostingsScreen({ session, lang, onBack }) {
  const [jobs,       setJobs]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const appState = useRef(AppState.currentState)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('job_postings')
      .select('id, job_title, employer_name, status, rejection_reason, expires_at, created_at')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })
    setJobs(data ?? [])
    if (!silent) setLoading(false)
  }, [session.user.id])

  // Admin activation happens off-app, so refresh on foreground to pick it up.
  useEffect(() => {
    load()
    const sub = AppState.addEventListener('change', next => {
      if (appState.current.match(/inactive|background/) && next === 'active') load(true)
      appState.current = next
    })
    return () => sub.remove()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="home_services" />
      <ScreenHeader onBack={onBack} backLabel={t('back', lang)} title={t('jobMyTitle', lang)} lang={lang} />

      {loading
        ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 48 }} />
        : (
          <FlatList
            data={jobs}
            keyExtractor={j => j.id}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <View style={s.emptyCard}>
                <Ionicons name="briefcase-outline" size={44} color={colors.border} style={{ marginBottom: 10 }} />
                <Text style={s.emptyTitle}>{t('jobMyEmptyTitle', lang)}</Text>
                <Text style={s.emptySub}>{t('jobMyEmptySub', lang)}</Text>
              </View>
            }
            renderItem={({ item }) => <PostingCard job={item} lang={lang} />}
          />
        )
      }
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

  card:      { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
               borderWidth: 1, borderColor: colors.border, ...shadow },
  cardTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  cardSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardMeta:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
               marginTop: 10, lineHeight: 18 },

  // Wraps rather than truncates — TR/RU/EL status labels run long.
  pill:      { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '45%',
               paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
               backgroundColor: 'transparent' },
  pillText:  { fontSize: 12, fontFamily: 'Inter_700Bold', flexShrink: 1 },

  emptyCard:  { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 28,
                alignItems: 'center', marginTop: 24, ...shadow,
                borderWidth: 1, borderColor: colors.border },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                textAlign: 'center', lineHeight: 19 },
})
