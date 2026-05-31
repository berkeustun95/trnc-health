import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import type { RecommendedSupplement, TimingSlot } from '@/lib/quiz/engine'
import type { Interaction } from '@/data/quiz/interactions'
import { colors, shadow } from '../../constants/theme'

const PRIORITY_COLORS = {
  essential:   { bg: '#FAEAEC', text: '#D1495B', border: '#D1495B' },
  recommended: { bg: colors.primaryLight, text: colors.primary, border: colors.primary },
  optional:    { bg: '#F4F6F8', text: '#64748B', border: '#E2E8F0' },
}

const SEVERITY_COLORS = {
  high:     { bg: '#FAEAEC', text: '#D1495B' },
  moderate: { bg: '#FFF7ED', text: '#C2730A' },
  low:      { bg: colors.primaryLight, text: colors.primary },
}

function SupplementCard({ item, ui }: { item: RecommendedSupplement; ui: ReturnType<typeof getT>['ui']['results'] }) {
  const pc = PRIORITY_COLORS[item.priority]
  const s = item.supplement

  return (
    <View style={[card.root, { borderColor: pc.border }]}>
      <View style={card.header}>
        <View style={[card.pill, { backgroundColor: pc.bg }]}>
          <Text style={[card.pillText, { color: pc.text }]}>{ui.priority[item.priority]}</Text>
        </View>
        <View style={[card.evidence, { backgroundColor: colors.cardBg }]}>
          <Text style={card.evidenceText}>{ui.evidenceLabel} {s.evidenceGrade}</Text>
        </View>
      </View>
      <Text style={card.name}>{s.name}</Text>
      <Text style={card.reason}>{item.reason}</Text>
      <View style={card.details}>
        <View style={card.detail}>
          <Text style={card.detailLabel}>{ui.dose}</Text>
          <Text style={card.detailValue}>{item.doseAdjustment ?? s.standardDose}</Text>
        </View>
        <View style={card.detail}>
          <Text style={card.detailLabel}>{ui.timing}</Text>
          <Text style={card.detailValue}>{s.timing}</Text>
        </View>
        <View style={card.detail}>
          <Text style={card.detailLabel}>{ui.withFood}</Text>
          <Text style={card.detailValue}>
            {s.takeWithFood === true ? ui.withFoodYes : s.takeWithFood === false ? ui.withFoodNo : ui.withFoodOptional}
          </Text>
        </View>
        <View style={card.detail}>
          <Text style={card.detailLabel}>{ui.bestForm}</Text>
          <Text style={card.detailValue}>{s.bestForm}</Text>
        </View>
      </View>
      <View style={card.tip}>
        <Text style={card.tipLabel}>{ui.pharmacistTip}</Text>
        <Text style={card.tipText}>{s.pharmacistNote}</Text>
      </View>
    </View>
  )
}

function TimingCard({ slot }: { slot: TimingSlot }) {
  return (
    <View style={timing.root}>
      <View style={timing.header}>
        <Text style={timing.emoji}>{slot.emoji}</Text>
        <Text style={timing.time}>{slot.time}</Text>
      </View>
      {slot.supplements.map((item, i) => (
        <View key={i} style={timing.row}>
          <Text style={timing.dot}>•</Text>
          <View style={timing.text}>
            <Text style={timing.name}>{item.name}</Text>
            <Text style={timing.dose}>{item.dose}</Text>
            {item.note ? <Text style={timing.note}>{item.note}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

function InteractionCard({ item }: { item: Interaction }) {
  const sc = SEVERITY_COLORS[item.severity]
  return (
    <View style={[interaction.root, { borderLeftColor: sc.text }]}>
      <View style={[interaction.pill, { backgroundColor: sc.bg }]}>
        <Text style={[interaction.pillText, { color: sc.text }]}>{item.severity.toUpperCase()}</Text>
      </View>
      <Text style={interaction.substances}>{item.substanceA} ↔ {item.substanceB}</Text>
      <Text style={interaction.mechanism}>{item.mechanism}</Text>
      <Text style={interaction.action}>{item.action}</Text>
    </View>
  )
}

export default function ResultsScreen({ onClose }: { onClose?: () => void }) {
  const result = useQuizStore(s => s.result)
  const language = useQuizStore(s => s.language)
  const resetQuiz = useQuizStore(s => s.resetQuiz)
  const ui = getT(language).ui.results

  if (!result) return null

  const priorities: Array<'essential' | 'recommended' | 'optional'> = ['essential', 'recommended', 'optional']

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <View style={s.badge}>
          <Text style={s.badgeText}>{ui.badge}</Text>
        </View>
        <Text style={s.title}>{ui.title}</Text>
        <Text style={s.summary}>{result.summary}</Text>

        <Text style={s.sectionTitle}>{ui.recommendedTitle}</Text>
        {priorities.map(priority => {
          const group = result.stack.filter(item => item.priority === priority)
          if (!group.length) return null
          return group.map(item => (
            <SupplementCard key={item.supplement.id} item={item} ui={ui} />
          ))
        })}

        {result.timingSchedule.length > 0 && (
          <>
            <Text style={s.sectionTitle}>{ui.scheduleTitle}</Text>
            <View style={s.scheduleNote}>
              <Text style={s.scheduleNoteText}>{ui.scheduleNote}</Text>
            </View>
            {result.timingSchedule.map((slot, i) => (
              <TimingCard key={i} slot={slot} />
            ))}
          </>
        )}

        {result.interactions.length > 0 && (
          <>
            <Text style={s.sectionTitle}>{ui.interactionTitle}</Text>
            {result.interactions.map(item => (
              <InteractionCard key={item.id} item={item} />
            ))}
          </>
        )}

        <Text style={s.sectionTitle}>{ui.notesTitle}</Text>
        {result.disclaimers.map((d, i) => (
          <View key={i} style={s.disclaimer}>
            <Text style={s.disclaimerDot}>⚠️</Text>
            <Text style={s.disclaimerText}>{d}</Text>
          </View>
        ))}

        <TouchableOpacity style={s.retakeBtn} onPress={resetQuiz}>
          <Text style={s.retakeText}>{ui.retake}</Text>
        </TouchableOpacity>
        {onClose && (
          <TouchableOpacity style={[s.retakeBtn, { marginTop: 10, borderColor: colors.border }]} onPress={onClose}>
            <Text style={[s.retakeText, { color: colors.textSecondary }]}>← Back to app</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  container:        { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 48 },
  badge:            { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12 },
  badgeText:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.3 },
  title:            { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12 },
  summary:          { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22, marginBottom: 28, backgroundColor: colors.cardBg, borderRadius: 12, padding: 14 },
  sectionTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12, marginTop: 24 },
  scheduleNote:     { backgroundColor: colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 12 },
  scheduleNoteText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.primary, lineHeight: 18 },
  disclaimer:       { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-start' },
  disclaimerDot:    { fontSize: 16 },
  disclaimerText:   { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },
  retakeBtn:        { marginTop: 28, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  retakeText:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
})

const card = StyleSheet.create({
  root:        { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1.5, ...shadow },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pill:        { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillText:    { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  evidence:    { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  evidenceText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  name:        { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  reason:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18, marginBottom: 14 },
  details:     { gap: 8, marginBottom: 14 },
  detail:      { flexDirection: 'row', gap: 8 },
  detailLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, width: 70 },
  detailValue: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  tip:         { backgroundColor: colors.primaryLight, borderRadius: 10, padding: 12 },
  tipLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 4 },
  tipText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
})

const timing = StyleSheet.create({
  root:   { backgroundColor: colors.cardBg, borderRadius: 12, padding: 14, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  emoji:  { fontSize: 20 },
  time:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  row:    { flexDirection: 'row', gap: 8, marginBottom: 6 },
  dot:    { fontSize: 14, color: colors.textSecondary, marginTop: 1 },
  text:   { flex: 1 },
  name:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dose:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  note:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.primary, marginTop: 2 },
})

const interaction = StyleSheet.create({
  root:        { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, ...shadow },
  pill:        { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  pillText:    { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  substances:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6, lineHeight: 20 },
  mechanism:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18, marginBottom: 6 },
  action:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 18 },
})
