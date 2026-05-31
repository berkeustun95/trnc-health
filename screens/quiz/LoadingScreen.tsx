import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import { colors } from '../../constants/theme'

export default function LoadingScreen() {
  const language = useQuizStore(s => s.language)
  const ui = getT(language).ui.loading
  const [stepIndex, setStepIndex] = useState(0)
  const spin = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, useNativeDriver: true })
    ).start()
  }, [])

  useEffect(() => {
    if (stepIndex >= ui.steps.length - 1) return
    const timer = setTimeout(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
      setStepIndex(i => i + 1)
    }, 500)
    return () => clearTimeout(timer)
  }, [stepIndex])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const step = ui.steps[stepIndex]

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Animated.View style={[s.spinner, { transform: [{ rotate }] }]}>
          <Text style={s.spinnerInner}>💊</Text>
        </Animated.View>
        <Text style={s.title}>{ui.title}</Text>
        <Text style={s.subtitle}>{ui.subtitle}</Text>
        <Animated.View style={[s.stepRow, { opacity: fade }]}>
          <Text style={s.stepEmoji}>{step.emoji}</Text>
          <Text style={s.stepText}>{step.text}</Text>
        </Animated.View>
        <View style={s.dotsRow}>
          {ui.steps.map((_, i) => (
            <View key={i} style={[s.dot, i === stepIndex && s.dotActive]} />
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  spinner:   { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  spinnerInner: { fontSize: 36 },
  title:     { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  subtitle:  { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginBottom: 40 },
  stepRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 32 },
  stepEmoji: { fontSize: 22 },
  stepText:  { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  dotsRow:   { flexDirection: 'row', gap: 6 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 20, borderRadius: 4 },
})
