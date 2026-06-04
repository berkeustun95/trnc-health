import { useState, useEffect } from 'react'
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, ScrollView, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import QuizReviewScreen from './quiz/QuizReviewScreen'

async function sendPushNotification(token, title, body) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    })
  } catch { /* non-critical */ }
}

async function recordNotification(userId, title, body) {
  try {
    await supabase.from('notifications').insert({ user_id: userId, title, body })
  } catch { /* non-critical */ }
}

export default function ProviderScreen({ session, lang = 'English', facility, trialDaysLeft }) {
  const isPharmacy   = facility.type === 'pharmacy'
  const showQuizTabs = isPharmacy && (facility.membership_tier === 'pro' || facility.is_quiz_partner)

  const [tab, setTab] = useState(isPharmacy ? 'qa' : 'requests')
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(false)
  const [replyTexts, setReplyTexts] = useState({})
  const [submittingReply, setSubmittingReply] = useState(null)
  const [quizReviews, setQuizReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [activeReview, setActiveReview] = useState(null)
  const [archivedReviews, setArchivedReviews] = useState([])
  const [loadingArchive, setLoadingArchive] = useState(false)
  const [activeArchive, setActiveArchive] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function load() {
      if (!isPharmacy) {
        const { data, error } = await supabase
          .from('appointments')
          .select('id, requested_time, customer_id')
          .eq('facility_id', facility.id)
          .eq('status', 'pending')
          .order('requested_time')
        if (!error) setAppointments(data)
      }
      setLoading(false)
    }
    load()
    loadQuestions()
    loadStats()
    if (showQuizTabs) { loadQuizReviews(); loadArchivedReviews() }
  }, [])

  async function loadStats() {
    const [{ data: apptData }, { data: quizData }] = await Promise.all([
      supabase.from('appointments').select('status').eq('facility_id', facility.id),
      supabase.from('quiz_submissions').select('status').eq('assigned_facility_id', facility.id),
    ])
    setStats({
      appt: {
        pending:   apptData?.filter(a => a.status === 'pending').length   ?? 0,
        confirmed: apptData?.filter(a => a.status === 'confirmed').length ?? 0,
        cancelled: apptData?.filter(a => a.status === 'cancelled').length ?? 0,
      },
      quiz: {
        pending:  quizData?.filter(q => q.status === 'pending').length  ?? 0,
        approved: quizData?.filter(q => q.status === 'approved').length ?? 0,
        rejected: quizData?.filter(q => q.status === 'rejected').length ?? 0,
      },
    })
  }

  async function loadArchivedReviews() {
    setLoadingArchive(true)
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, answers, generated_result, final_result, reviewed_at, created_at')
      .eq('assigned_facility_id', facility.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
    if (data) setArchivedReviews(data)
    setLoadingArchive(false)
  }

  async function loadQuizReviews() {
    setLoadingReviews(true)
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, customer_id, answers, generated_result, created_at')
      .eq('assigned_facility_id', facility.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (data) setQuizReviews(data)
    setLoadingReviews(false)
  }

  async function loadQuestions() {
    setLoadingQ(true)
    const { data } = await supabase
      .from('questions')
      .select('id, body, created_at, answers(id, body, created_at)')
      .eq('facility_id', facility.id)
      .order('created_at', { ascending: false })
    if (data) setQuestions(data)
    setLoadingQ(false)
  }

  async function submitReply(questionId) {
    const body = replyTexts[questionId]?.trim()
    if (!body) return
    setSubmittingReply(questionId)
    const { error } = await supabase.from('answers').insert({
      question_id: questionId,
      provider_id: session.user.id,
      body,
    })
    if (!error) {
      setReplyTexts(prev => ({ ...prev, [questionId]: '' }))
      await loadQuestions()
    }
    setSubmittingReply(null)
  }

  async function updateStatus(id, status, customerId) {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id)
    if (!error) {
      const { data: profile } = await supabase
        .from('profiles').select('push_token, preferred_language').eq('id', customerId).maybeSingle()
      if (profile) {
        const confirmed = status === 'confirmed'
        const cLang = profile.preferred_language || 'English'
        const title = confirmed ? t('notifApptConfirmedTitle', cLang) : t('notifApptDeclinedTitle', cLang)
        const body = confirmed
          ? t('notifApptConfirmedBody', cLang).replace('{name}', facility.name)
          : t('notifApptDeclinedBody', cLang).replace('{name}', facility.name)
        if (profile.push_token) await sendPushNotification(profile.push_token, title, body)
        await recordNotification(customerId, title, body)
      }
      setAppointments(prev => prev.filter(a => a.id !== id))
    }
  }

  if (activeReview) {
    return (
      <QuizReviewScreen
        submission={activeReview}
        onApproved={async () => {
          const customerId = activeReview.customer_id
          if (customerId) {
            const { data: customerProfile } = await supabase
              .from('profiles').select('push_token, preferred_language').eq('id', customerId).maybeSingle()
            if (customerProfile) {
              const cLang = customerProfile.preferred_language || 'English'
              const title = t('notifQuizTitle', cLang)
              const body = t('notifQuizBody', cLang).replace('{name}', facility.name)
              if (customerProfile.push_token) await sendPushNotification(customerProfile.push_token, title, body)
              await recordNotification(customerId, title, body)
            }
          }
          setActiveReview(null)
          loadQuizReviews()
          loadArchivedReviews()
        }}
        onBack={() => setActiveReview(null)}
      />
    )
  }

  if (activeArchive) {
    return (
      <QuizReviewScreen submission={activeArchive} onBack={() => setActiveArchive(null)} readOnly />
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('../assets/ADAicon.png')} style={styles.headerIcon} resizeMode="contain" />
            <View>
              <Text style={styles.facilityTag} numberOfLines={1}>{facility.name}</Text>
              {facility.membership_tier === 'pro' && (
                <View style={styles.proBadge}><Text style={styles.proBadgeText}>PRO</Text></View>
              )}
            </View>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
        </View>

        {trialDaysLeft !== null && trialDaysLeft !== undefined && (
          <TouchableOpacity
            style={styles.trialBanner}
            onPress={() => Linking.openURL('mailto:berke.ustun95@gmail.com?subject=ADA%20Provider%20Activation')}
            activeOpacity={0.8}
          >
            <Text style={styles.trialText}>
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left in your free trial — tap to contact us
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.tabs}>
          {!isPharmacy && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'requests' && styles.tabBtnActive]}
              onPress={() => setTab('requests')}
            >
              <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>{t('tabRequests', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'qa' && styles.tabBtnActive]}
            onPress={() => setTab('qa')}
          >
            <Text style={[styles.tabText, tab === 'qa' && styles.tabTextActive]}>{t('tabQA', lang)}</Text>
          </TouchableOpacity>
          {showQuizTabs && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'quiz' && styles.tabBtnActive]}
              onPress={() => setTab('quiz')}
            >
              <View style={styles.tabWithBadge}>
                <Text style={[styles.tabText, tab === 'quiz' && styles.tabTextActive]}>{t('tabReviews', lang)}</Text>
                {quizReviews.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{quizReviews.length}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
          {showQuizTabs && (
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'archive' && styles.tabBtnActive]}
              onPress={() => setTab('archive')}
            >
              <Text style={[styles.tabText, tab === 'archive' && styles.tabTextActive]}>{t('tabArchive', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'stats' && styles.tabBtnActive]}
            onPress={() => setTab('stats')}
          >
            <Text style={[styles.tabText, tab === 'stats' && styles.tabTextActive]}>{t('tabStats', lang)}</Text>
          </TouchableOpacity>
        </View>

        {tab === 'archive' ? (
          loadingArchive ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : archivedReviews.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Feather name="archive" size={28} color={colors.textSecondary} /></View>
              <Text style={styles.emptyTitle}>{t('noApprovedReviews', lang)}</Text>
              <Text style={styles.emptySub}>{t('approvedReviewsHere', lang)}</Text>
            </View>
          ) : (
            <FlatList
              data={archivedReviews}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, styles.reviewCard]} onPress={() => setActiveArchive(item)} activeOpacity={0.7}>
                  <View style={styles.reviewCardLeft}>
                    <View style={[styles.reviewIcon, { backgroundColor: colors.successLight }]}>
                      <Feather name="check" size={16} color={colors.success} />
                    </View>
                    <View>
                      <Text style={styles.reviewTitle}>{t('approvedReview', lang)}</Text>
                      <Text style={styles.reviewTime}>{new Date(item.reviewed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                      <Text style={[styles.reviewCount, { color: colors.success }]}>
                        {t('supplementsApproved', lang).replace('{n}', item.final_result?.stack?.length ?? 0)}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
            />
          )
        ) : tab === 'quiz' ? (
          loadingReviews ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : quizReviews.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Ionicons name="flask-outline" size={28} color={colors.textSecondary} /></View>
              <Text style={styles.emptyTitle}>{t('noPendingReviews', lang)}</Text>
              <Text style={styles.emptySub}>{t('quizRequestsHere', lang)}</Text>
            </View>
          ) : (
            <FlatList
              data={quizReviews}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.card, styles.reviewCard]} onPress={() => setActiveReview(item)} activeOpacity={0.7}>
                  <View style={styles.reviewCardLeft}>
                    <View style={styles.reviewIcon}>
                      <Ionicons name="flask-outline" size={20} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={styles.reviewTitle}>{t('quizReview', lang)}</Text>
                      <Text style={styles.reviewTime}>{new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</Text>
                      <Text style={styles.reviewCount}>{t('supplementsRecommended', lang).replace('{n}', item.generated_result?.stack?.length ?? 0)}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
            />
          )
        ) : tab === 'stats' ? (
          !stats ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {!isPharmacy && (
                <>
                  <Text style={styles.sectionTitle}>{t('statAppointments', lang)}</Text>
                  <View style={styles.statRow}>
                    <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                      <Text style={[styles.statNum, { color: colors.accent }]}>{stats.appt.pending}</Text>
                      <Text style={styles.statLabel}>{t('statusPending', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                      <Text style={[styles.statNum, { color: colors.success }]}>{stats.appt.confirmed}</Text>
                      <Text style={styles.statLabel}>{t('statusConfirmed', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.dangerLight }]}>
                      <Text style={[styles.statNum, { color: colors.danger }]}>{stats.appt.cancelled}</Text>
                      <Text style={styles.statLabel}>{t('statusCancelled', lang)}</Text>
                    </View>
                  </View>
                </>
              )}

              <Text style={[styles.sectionTitle, !isPharmacy && { marginTop: 24 }]}>{t('tabQA', lang)}</Text>
              <View style={styles.statRow}>
                <View style={[styles.statTile, { backgroundColor: colors.cardBg }]}>
                  <Text style={[styles.statNum, { color: colors.textPrimary }]}>{questions.length}</Text>
                  <Text style={styles.statLabel}>{t('statTotal', lang)}</Text>
                </View>
                <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                  <Text style={[styles.statNum, { color: colors.success }]}>{questions.filter(q => q.answers?.length > 0).length}</Text>
                  <Text style={styles.statLabel}>{t('statAnswered', lang)}</Text>
                </View>
                <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                  <Text style={[styles.statNum, { color: colors.accent }]}>{questions.filter(q => !q.answers?.length).length}</Text>
                  <Text style={styles.statLabel}>{t('statUnanswered', lang)}</Text>
                </View>
              </View>

              {showQuizTabs && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('statQuizReviews', lang)}</Text>
                  <View style={styles.statRow}>
                    <View style={[styles.statTile, { backgroundColor: colors.accentLight }]}>
                      <Text style={[styles.statNum, { color: colors.accent }]}>{stats.quiz.pending}</Text>
                      <Text style={styles.statLabel}>{t('statusPending', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.successLight }]}>
                      <Text style={[styles.statNum, { color: colors.success }]}>{stats.quiz.approved}</Text>
                      <Text style={styles.statLabel}>{t('statApproved', lang)}</Text>
                    </View>
                    <View style={[styles.statTile, { backgroundColor: colors.dangerLight }]}>
                      <Text style={[styles.statNum, { color: colors.danger }]}>{stats.quiz.rejected}</Text>
                      <Text style={styles.statLabel}>{t('statRejected', lang)}</Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          )
        ) : tab === 'requests' ? (
          appointments.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}><Feather name="check-circle" size={28} color={colors.success} /></View>
              <Text style={styles.emptyTitle}>{t('allClear', lang)}</Text>
              <Text style={styles.emptySub}>{t('noPendingRequests', lang)}</Text>
            </View>
          ) : (
            <FlatList
              data={appointments}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Text style={styles.timeLabel}>{t('requestedTime', lang)}</Text>
                  <Text style={styles.timeValue}>
                    {new Date(item.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.confirmBtn} onPress={() => updateStatus(item.id, 'confirmed', item.customer_id)}>
                      <Text style={styles.confirmText}>{t('confirm', lang)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineBtn} onPress={() => updateStatus(item.id, 'cancelled', item.customer_id)}>
                      <Text style={styles.declineText}>{t('decline', lang)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          )
        ) : (
          loadingQ ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {questions.length === 0 ? (
                <View style={styles.empty}>
                  <View style={styles.emptyIconWrap}><Ionicons name="chatbubble-outline" size={28} color={colors.textSecondary} /></View>
                  <Text style={styles.emptyTitle}>{t('noQuestions', lang)}</Text>
                  <Text style={styles.emptySub}>{t('questionsFromCustomers', lang)}</Text>
                </View>
              ) : (
                questions.map(q => (
                  <View key={q.id} style={styles.card}>
                    <Text style={styles.qBody}>{q.body}</Text>
                    {q.answers && q.answers.length > 0 ? (
                      <View style={styles.answerBlock}>
                        <Text style={styles.answerLabel}>{t('yourAnswer', lang)}</Text>
                        <Text style={styles.answerBody}>{q.answers[0].body}</Text>
                      </View>
                    ) : (
                      <View style={styles.replyRow}>
                        <TextInput
                          style={styles.replyInput}
                          value={replyTexts[q.id] ?? ''}
                          onChangeText={val => setReplyTexts(prev => ({ ...prev, [q.id]: val }))}
                          placeholder={t('writeYourAnswer', lang)}
                          placeholderTextColor={colors.textSecondary}
                          multiline
                        />
                        <TouchableOpacity
                          style={[styles.replyBtn, (!replyTexts[q.id]?.trim() || submittingReply === q.id) && { opacity: 0.4 }]}
                          onPress={() => submitReply(q.id)}
                          disabled={!replyTexts[q.id]?.trim() || submittingReply === q.id}
                        >
                          {submittingReply === q.id
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.replyBtnText}>{t('send', lang)}</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          )
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg },
  container:      { flex: 1, paddingHorizontal: 16 },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 12 },
  headerLeft:     { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 10 },
  headerIcon:     { width: 36, height: 36, borderRadius: 8, flexShrink: 0 },
  facilityTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  facilityTag:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  proBadge:       { backgroundColor: colors.primary, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText:   { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
  signOutBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  trialBanner:    { backgroundColor: '#FEF3C7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 12 },
  trialText:      { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#92400E', textAlign: 'center' },
  sectionTitle:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  listContent:    { paddingBottom: 32 },
  card:           { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, ...shadow },
  timeLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  timeValue:      { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 14 },
  actions:        { flexDirection: 'row', gap: 10 },
  confirmBtn:     { flex: 1, backgroundColor: colors.successLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.success },
  declineBtn:     { flex: 1, backgroundColor: colors.dangerLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  declineText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.danger },
  tabs:           { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, marginBottom: 16 },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive:   { backgroundColor: colors.surface, ...shadow },
  tabText:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  tabWithBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabBadge:       { backgroundColor: colors.danger, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  tabBadgeText:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  reviewCard:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  reviewIconText: { fontSize: 20 },
  reviewTitle:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  reviewTime:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  reviewCount:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 2 },
  reviewArrow:    { fontSize: 18, color: colors.primary, fontFamily: 'Inter_700Bold' },
  qBody:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 12, lineHeight: 20 },
  answerBlock:    { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10 },
  answerLabel:    { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  answerBody:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  replyRow:       { gap: 8 },
  replyInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  replyBtn:       { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  replyBtnText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  statRow:        { flexDirection: 'row', gap: 10, marginBottom: 4 },
  statTile:       { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  statNum:        { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  statLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyIconWrap:  { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...shadow },
  emptyTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
})
