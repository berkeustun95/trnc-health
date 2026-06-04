import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import { colors, shadow } from '../../constants/theme'

const STAT_ICONS: Array<{ name: string; lib: 'Ionicons' | 'Feather' }> = [
  { name: 'time-outline', lib: 'Ionicons' },
  { name: 'help-circle-outline', lib: 'Ionicons' },
  { name: 'gift-outline', lib: 'Ionicons' },
]

const FEATURE_ICONS: Array<{ name: string; lib: 'Ionicons' | 'Feather' }> = [
  { name: 'checkmark-circle-outline', lib: 'Ionicons' },
  { name: 'shield-checkmark-outline', lib: 'Ionicons' },
  { name: 'notifications-outline', lib: 'Ionicons' },
]

function StatIcon({ icon }: { icon: typeof STAT_ICONS[0] }) {
  if (icon.lib === 'Ionicons') return <Ionicons name={icon.name as any} size={24} color={colors.primary} />
  return <Feather name={icon.name as any} size={24} color={colors.primary} />
}

function FeatureIcon({ icon }: { icon: typeof FEATURE_ICONS[0] }) {
  if (icon.lib === 'Ionicons') return <Ionicons name={icon.name as any} size={26} color={colors.primary} />
  return <Feather name={icon.name as any} size={26} color={colors.primary} />
}

export default function LandingScreen({ onClose }: { onClose?: () => void }) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const lang = useQuizStore(s => s.language)
  const ui = getT(lang).ui.landing

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {onClose && (
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Feather name="x" size={20} color={colors.textSecondary} />
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
              <View style={s.trustCheck}>
                <Feather name="check" size={11} color={colors.success} />
              </View>
              <Text style={s.trustText}>{item}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={s.ctaBtn} onPress={startQuiz}>
          <Text style={s.ctaText}>{ui.cta}</Text>
        </TouchableOpacity>

        <View style={s.statsRow}>
          {[
            { label: ui.minutes, icon: STAT_ICONS[0] },
            { label: ui.questions, icon: STAT_ICONS[1] },
            { label: ui.free, icon: STAT_ICONS[2] },
          ].map((stat, i) => (
            <View key={i} style={s.stat}>
              <StatIcon icon={stat.icon} />
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionTitle}>{ui.whatYouGetTitle}</Text>
        {[
          { title: ui.feature1Title, desc: ui.feature1Desc, icon: FEATURE_ICONS[0] },
          { title: ui.feature2Title, desc: ui.feature2Desc, icon: FEATURE_ICONS[1] },
          { title: ui.feature3Title, desc: ui.feature3Desc, icon: FEATURE_ICONS[2] },
        ].map((f, i) => (
          <View key={i} style={s.featureCard}>
            <View style={s.featureIconWrap}>
              <FeatureIcon icon={f.icon} />
            </View>
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
  trustItem:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  trustCheck:       { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.successLight, justifyContent: 'center', alignItems: 'center' },
  trustText:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  ctaBtn:           { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 20, ...shadow },
  ctaBtnSecondary:  { marginTop: 8 },
  ctaText:          { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.2 },
  statsRow:         { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.cardBg, borderRadius: 16, paddingVertical: 18, marginBottom: 32, ...shadow },
  stat:             { alignItems: 'center', gap: 6 },
  statLabel:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textAlign: 'center' },
  sectionTitle:     { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 16 },
  featureCard:      { flexDirection: 'row', backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, gap: 14, alignItems: 'flex-start', ...shadow },
  featureIconWrap:  { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  featureText:      { flex: 1 },
  featureTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  featureDesc:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },
  readyCTA:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginTop: 24, marginBottom: 12 },
  closeBtn:         { alignSelf: 'flex-end', width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 8, ...shadow },
})
