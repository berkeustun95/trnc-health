import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useReviewStore } from './reviewStore'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import { colors } from '../../constants/theme'

export default function AwaitingReviewScreen({ onClose }: { onClose?: () => void }) {
  const submissionId     = useReviewStore(s => s.submissionId)
  const selectedFacility = useReviewStore(s => s.selectedFacility)
  const timeoutAt        = useReviewStore(s => s.timeoutAt)
  const onApproved       = useReviewStore(s => s.onApproved)
  const handleTimeout    = useReviewStore(s => s.handleTimeout)
  const language         = useQuizStore(s => s.language)
  const ui               = getT(language).ui.awaiting

  const [timeLeft, setTimeLeft] = useState('')
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    ).start()
  }, [])

  useEffect(() => {
    if (!timeoutAt) return
    const tick = () => {
      const diff = timeoutAt.getTime() - Date.now()
      if (diff <= 0) { handleTimeout(); return }
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [timeoutAt])

  // Check status on mount — handles case where pharmacist approved while screen was unmounted
  useEffect(() => {
    if (!submissionId) return
    supabase
      .from('quiz_submissions')
      .select('status, final_result, reviewed_at')
      .eq('id', submissionId)
      .single()
      .then(({ data }) => {
        if (!data) return
        if (data.status === 'approved')   onApproved(data.final_result, data.reviewed_at)
        else if (data.status === 'timed_out') handleTimeout()
      })
  }, [submissionId])

  useEffect(() => {
    if (!submissionId) return
    const channel = supabase
      .channel(`submission_${submissionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quiz_submissions', filter: `id=eq.${submissionId}` },
        (payload) => {
          if (payload.new.status === 'approved') {
            onApproved(payload.new.final_result, payload.new.reviewed_at)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [submissionId])

  const handleClose = () => {
    onClose?.()
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        {onClose && (
          <TouchableOpacity style={s.closeBtn} onPress={handleClose}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        )}
        <Animated.Text style={[s.emoji, { transform: [{ scale: pulseAnim }] }]}>💊</Animated.Text>

        <Text style={s.title}>{ui.title}</Text>
        <Text style={s.subtitle}>{ui.subtitle(selectedFacility?.name ?? '')}</Text>

        <View style={s.timerCard}>
          <Text style={s.timerLabel}>{ui.timerLabel}</Text>
          <Text style={s.timerValue}>{timeLeft}</Text>
        </View>

        <View style={s.infoCard}>
          <Text style={s.infoText}>{ui.infoText}</Text>
        </View>

        <TouchableOpacity style={s.cancelBtn} onPress={handleTimeout}>
          <Text style={s.cancelText}>{ui.cancelBtn}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  container:     { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  emoji:         { fontSize: 64, marginBottom: 28 },
  title:         { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  subtitle:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  pharmacyName:  { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  timerCard:     { backgroundColor: colors.primaryLight, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 40, alignItems: 'center', marginBottom: 20, width: '100%' },
  timerLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.5, marginBottom: 8 },
  timerValue:    { fontSize: 36, fontFamily: 'Inter_700Bold', color: colors.primary },
  infoCard:      { backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 32, width: '100%' },
  infoText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  closeBtn:      { alignSelf: 'flex-end', padding: 8, marginBottom: 8 },
  closeText:     { fontSize: 18, color: colors.textSecondary },
  cancelBtn:     { paddingVertical: 14, paddingHorizontal: 24 },
  cancelText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textDecorationLine: 'underline' },
})
