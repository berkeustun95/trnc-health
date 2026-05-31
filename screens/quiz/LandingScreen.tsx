import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import { colors, shadow } from '../../constants/theme'

export default function LandingScreen({ onClose }: { onClose?: () => void }) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const lang = useQuizStore(s => s.language)
  const ui = getT(lang).ui.landing

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {onClose && (
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        )}
        <View style={s.badge}>
          <Text style={s.badgeText}>{ui.badge}</Text>
        </View>

        <Text style={s.title}>{ui.titleLine1}</Text>
        <Text style={[s.title, s.titleAccent]}>{ui.titleLine2}</Text>
        <Text style={s.subtitle}>{ui.subtitle}</Text>

        <View style={s.trustRow}>
          {[ui.trustPharmacist, ui.trustInteraction, ui.trustEvidence].map((item, i) => (
            <View key={i} style={s.trustItem}>
              <Text style={s.trustDot}>✓</Text>
              <Text style={s.trustText}>{item}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={s.ctaBtn} onPress={startQuiz}>
          <Text style={s.ctaText}>{ui.cta}</Text>
        </TouchableOpacity>

        <View style={s.statsRow}>
          {[
            { label: ui.minutes, emoji: '⏱' },
            { label: ui.questions, emoji: '❓' },
            { label: ui.free, emoji: '🎁' },
          ].map((stat, i) => (
            <View key={i} style={s.stat}>
              <Text style={s.statEmoji}>{stat.emoji}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>{ui.whatYouGetTitle}</Text>
        {[
          { title: ui.feature1Title, desc: ui.feature1Desc, emoji: '🎯' },
          { title: ui.feature2Title, desc: ui.feature2Desc, emoji: '🛡️' },
          { title: ui.feature3Title, desc: ui.feature3Desc, emoji: '⏰' },
        ].map((f, i) => (
          <View key={i} style={s.featureCard}>
            <Text style={s.featureEmoji}>{f.emoji}</Text>
            <View style={s.featureText}>
              <Text style={s.featureTitle}>{f.title}</Text>
              <Text style={s.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}

        <Text style={s.readyCTA}>{ui.readyCTA}</Text>
        <TouchableOpacity style={[s.ctaBtn, s.ctaBtnSecondary]} onPress={startQuiz}>
          <Text style={s.ctaText}>{ui.startCTA}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  container:        { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 24 },
  badge:            { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 18 },
  badgeText:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.3 },
  title:            { fontSize: 32, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 38, letterSpacing: -0.5 },
  titleAccent:      { color: colors.primary, marginBottom: 16 },
  subtitle:         { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22, marginBottom: 24 },
  trustRow:         { marginBottom: 28 },
  trustItem:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  trustDot:         { fontSize: 14, color: colors.success, fontFamily: 'Inter_700Bold' },
  trustText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  ctaBtn:           { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 20, ...shadow },
  ctaBtnSecondary:  { marginTop: 8 },
  ctaText:          { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.2 },
  statsRow:         { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.cardBg, borderRadius: 12, paddingVertical: 16, marginBottom: 32 },
  stat:             { alignItems: 'center', gap: 4 },
  statEmoji:        { fontSize: 22 },
  statLabel:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textAlign: 'center' },
  sectionTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 16 },
  featureCard:      { flexDirection: 'row', backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 10, gap: 14, alignItems: 'flex-start' },
  featureEmoji:     { fontSize: 26 },
  featureText:      { flex: 1 },
  featureTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  featureDesc:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },
  readyCTA:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginTop: 24, marginBottom: 12 },
  closeBtn:         { alignSelf: 'flex-end', padding: 8, marginBottom: 8 },
  closeText:        { fontSize: 18, color: colors.textSecondary },
})
