import { useState, useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'

async function sendPushNotification(token, title, body) {
  try {
    await fetch('https://exp.host/--/expo-push-notification-service/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    })
  } catch { /* non-critical */ }
}

export default function ProviderScreen({ session }) {
  const [tab, setTab] = useState('requests')
  const [appointments, setAppointments] = useState([])
  const [facilityName, setFacilityName] = useState(null)
  const [facilityId, setFacilityId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [noFacility, setNoFacility] = useState(false)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(false)
  const [replyTexts, setReplyTexts] = useState({})
  const [submittingReply, setSubmittingReply] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: facility } = await supabase
        .from('facilities')
        .select('id, name')
        .eq('provider_id', session.user.id)
        .maybeSingle()

      if (!facility) {
        setNoFacility(true)
        setLoading(false)
        return
      }

      setFacilityName(facility.name)
      setFacilityId(facility.id)

      const { data, error } = await supabase
        .from('appointments')
        .select('id, requested_time, customer_id')
        .eq('facility_id', facility.id)
        .eq('status', 'pending')
        .order('requested_time')

      if (!error) setAppointments(data)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!facilityId) return
    loadQuestions()
  }, [facilityId])

  async function loadQuestions() {
    setLoadingQ(true)
    const { data } = await supabase
      .from('questions')
      .select('id, body, created_at, answers(id, body, created_at)')
      .eq('facility_id', facilityId)
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
    const { error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)
    if (!error) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', customerId)
        .maybeSingle()
      if (profile?.push_token) {
        const confirmed = status === 'confirmed'
        await sendPushNotification(
          profile.push_token,
          confirmed ? 'Appointment confirmed' : 'Appointment declined',
          confirmed
            ? `${facilityName} confirmed your appointment.`
            : `${facilityName} declined your appointment request.`
        )
      }
      setAppointments(prev => prev.filter(a => a.id !== id))
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  if (noFacility) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No facility linked</Text>
          <Text style={styles.emptySub}>Contact the admin to link your account to a facility.</Text>
          <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.wordmark}>TRNC Health</Text>
            <Text style={styles.facilityTag}>{facilityName}</Text>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'requests' && styles.tabBtnActive]}
            onPress={() => setTab('requests')}
          >
            <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>Requests</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'qa' && styles.tabBtnActive]}
            onPress={() => setTab('qa')}
          >
            <Text style={[styles.tabText, tab === 'qa' && styles.tabTextActive]}>Q&A</Text>
          </TouchableOpacity>
        </View>

        {tab === 'requests' ? (
          appointments.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>All clear</Text>
              <Text style={styles.emptySub}>No pending appointment requests.</Text>
            </View>
          ) : (
            <FlatList
              data={appointments}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Text style={styles.timeLabel}>Requested for</Text>
                  <Text style={styles.timeValue}>
                    {new Date(item.requested_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </Text>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.confirmBtn}
                      onPress={() => updateStatus(item.id, 'confirmed', item.customer_id)}
                    >
                      <Text style={styles.confirmText}>Confirm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={() => updateStatus(item.id, 'cancelled', item.customer_id)}
                    >
                      <Text style={styles.declineText}>Decline</Text>
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
                  <Text style={styles.emptyTitle}>No questions yet</Text>
                  <Text style={styles.emptySub}>Questions from customers will appear here.</Text>
                </View>
              ) : (
                questions.map(q => (
                  <View key={q.id} style={styles.card}>
                    <Text style={styles.qBody}>{q.body}</Text>
                    {q.answers && q.answers.length > 0 ? (
                      <View style={styles.answerBlock}>
                        <Text style={styles.answerLabel}>Your answer</Text>
                        <Text style={styles.answerBody}>{q.answers[0].body}</Text>
                      </View>
                    ) : (
                      <View style={styles.replyRow}>
                        <TextInput
                          style={styles.replyInput}
                          value={replyTexts[q.id] ?? ''}
                          onChangeText={val => setReplyTexts(prev => ({ ...prev, [q.id]: val }))}
                          placeholder="Write your answer…"
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
                            : <Text style={styles.replyBtnText}>Send</Text>
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
  safe:         { flex: 1, backgroundColor: colors.bg },
  container:    { flex: 1, paddingHorizontal: 16 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 16, paddingBottom: 20 },
  wordmark:     { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5 },
  facilityTag:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 3 },
  signOutBtn:   { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },
  sectionTitle: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  listContent:  { paddingBottom: 32 },
  card:         { backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 10, ...shadow },
  timeLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  timeValue:    { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 14 },
  actions:      { flexDirection: 'row', gap: 10 },
  confirmBtn:   { flex: 1, backgroundColor: colors.successLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.success },
  declineBtn:   { flex: 1, backgroundColor: colors.dangerLight, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  declineText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.danger },
  tabs:         { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, marginBottom: 16 },
  tabBtn:       { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.surface, ...shadow },
  tabText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  qBody:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, marginBottom: 12, lineHeight: 20 },
  answerBlock:  { backgroundColor: colors.primaryLight, borderRadius: 8, padding: 10 },
  answerLabel:  { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  answerBody:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  replyRow:     { gap: 8 },
  replyInput:   { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, maxHeight: 80 },
  replyBtn:     { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  replyBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle:   { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  emptySub:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
})
