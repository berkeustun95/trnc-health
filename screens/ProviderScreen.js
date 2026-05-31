import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
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
  const [appointments, setAppointments] = useState([])
  const [facilityName, setFacilityName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [noFacility, setNoFacility] = useState(false)

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

        <Text style={styles.sectionTitle}>Pending requests</Text>

        {appointments.length === 0 ? (
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
  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle:   { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  emptySub:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
})
