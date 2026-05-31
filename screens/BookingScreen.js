import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase } from '../lib/supabase'
import { colors, typeColors, shadow } from '../constants/theme'

export default function BookingScreen({ facility, session, onBack }) {
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d
  })
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.from('appointments').insert({
      customer_id: session.user.id,
      facility_id: facility.id,
      requested_time: date.toISOString(),
    })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  const tc = typeColors[facility.type] || typeColors.clinic

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.successRing}>
            <Text style={styles.successCheck}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Request sent</Text>
          <Text style={styles.successSub}>
            We'll notify you when {facility.name} confirms your appointment.
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>Back to list</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.facilityCard}>
          <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
            <Text style={[styles.typeBadgeText, { color: tc.text }]}>{facility.type}</Text>
          </View>
          <Text style={styles.facilityName}>{facility.name}</Text>
          <Text style={styles.facilityAddress}>{facility.address}</Text>
        </View>

        <Text style={styles.sectionLabel}>Requested time</Text>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.dateBtnText}>
            {date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
          <Text style={styles.dateBtnChevron}>›</Text>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={date}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={new Date()}
            onChange={(_, selected) => {
              if (Platform.OS !== 'ios') setShowPicker(false)
              if (selected) setDate(selected)
            }}
          />
        )}

        {showPicker && Platform.OS === 'ios' && (
          <TouchableOpacity style={styles.doneBtn} onPress={() => setShowPicker(false)}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>Request appointment</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },
  container:       { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, flexGrow: 1 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  backRow:         { marginBottom: 20 },
  backText:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },
  facilityCard:    { backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 28, ...shadow },
  typeBadge:       { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 10 },
  typeBadgeText:   { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  facilityName:    { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  facilityAddress: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  sectionLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  dateBtn:         { backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 16, ...shadow, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateBtnText:     { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  dateBtnChevron:  { fontSize: 22, color: colors.textSecondary, lineHeight: 24 },
  doneBtn:         { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 8 },
  doneBtnText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.primary },
  error:           { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 10 },
  submit:          { backgroundColor: colors.accent, borderRadius: 12, padding: 17, alignItems: 'center', marginTop: 8 },
  submitText:      { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  successRing:     { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successLight, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successCheck:    { fontSize: 30, fontFamily: 'Inter_700Bold', color: colors.success },
  successTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  successSub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  backBtn:         { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 40 },
  backBtnText:     { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
})
