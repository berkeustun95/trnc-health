import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuizStore } from '@/lib/quiz/store'
import { getT } from '@/data/quiz/translations'
import { colors, shadow } from '../../constants/theme'

export default function QuizScreen() {
  const { answers, language, nextStep, prevStep, setAnswer, toggleMultiAnswer, getProgress, canProceed, getCurrentQuestion } = useQuizStore()
  const question = getCurrentQuestion()
  const progress = getProgress()
  const ui = getT(language).ui.quiz

  if (!question) return null

  const currentAnswer = answers[question.id]
  const isMulti = question.type === 'multi'

  const hasAnswer = currentAnswer != null && (Array.isArray(currentAnswer) ? currentAnswer.length > 0 : currentAnswer !== '')
  const btnLabel = !question.required && !hasAnswer ? ui.skip : ui.continue

  const isSelected = (optionId: string) => {
    if (!currentAnswer) return false
    if (Array.isArray(currentAnswer)) return currentAnswer.includes(optionId)
    return currentAnswer === optionId
  }

  const handleSelect = (optionId: string) => {
    if (isMulti) {
      toggleMultiAnswer(question.id, optionId)
    } else {
      setAnswer(question.id, optionId)
    }
  }

  const proceed = canProceed()

  const grouped = question.options.reduce<{ group: string | null; options: typeof question.options }[]>((acc, opt) => {
    const group = opt.group ?? null
    const existing = acc.find(g => g.group === group)
    if (existing) existing.options.push(opt)
    else acc.push({ group, options: [opt] })
    return acc
  }, [])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${progress}%` }]} />
        </View>

        <View style={s.sectionRow}>
          <Text style={s.sectionEmoji}>{question.sectionEmoji}</Text>
          <Text style={s.sectionLabel}>{question.section}</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          <Text style={s.questionText}>{question.question}</Text>
          {question.subtitle ? (
            <Text style={s.subtitle}>{question.subtitle}</Text>
          ) : null}
          {isMulti && (
            <Text style={s.selectAll}>{ui.selectAll}</Text>
          )}

          {grouped.map(({ group, options }) => (
            <View key={group ?? 'ungrouped'}>
              {group ? <Text style={s.groupLabel}>{group}</Text> : null}
              {options.map(opt => {
                const selected = isSelected(opt.id)
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[s.option, selected && s.optionSelected]}
                    onPress={() => handleSelect(opt.id)}
                    activeOpacity={0.7}
                  >
                    <View style={s.optionLeft}>
                      {opt.emoji ? <Text style={s.optionEmoji}>{opt.emoji}</Text> : null}
                      <View style={s.optionText}>
                        <Text style={[s.optionLabel, selected && s.optionLabelSelected]}>
                          {opt.label}
                        </Text>
                        {opt.description ? (
                          <Text style={s.optionDesc}>{opt.description}</Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={[s.check, selected && s.checkSelected]}>
                      {selected && <Text style={s.checkMark}>{isMulti ? '✓' : '●'}</Text>}
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity style={s.backBtn} onPress={prevStep}>
            <Text style={s.backText}>{ui.back}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.nextBtn, !proceed && s.nextBtnDisabled]}
            onPress={proceed ? nextStep : undefined}
            disabled={!proceed}
          >
            <Text style={[s.nextText, !proceed && s.nextTextDisabled]}>
              {btnLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  container:        { flex: 1, paddingHorizontal: 16 },
  progressBar:      { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 12, marginBottom: 16, overflow: 'hidden' },
  progressFill:     { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
  sectionRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionEmoji:     { fontSize: 16 },
  sectionLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  scroll:           { paddingBottom: 24 },
  questionText:     { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 30, marginBottom: 8 },
  subtitle:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  selectAll:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 16, fontStyle: 'italic' },
  groupLabel:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  option:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardBg, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  optionSelected:   { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionLeft:       { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  optionEmoji:      { fontSize: 22 },
  optionText:       { flex: 1 },
  optionLabel:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  optionLabelSelected: { color: colors.primary },
  optionDesc:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  check:            { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkSelected:    { borderColor: colors.primary, backgroundColor: colors.primary },
  checkMark:        { fontSize: 12, color: '#fff', fontFamily: 'Inter_700Bold' },
  footer:           { flexDirection: 'row', gap: 10, paddingTop: 12, paddingBottom: 24 },
  backBtn:          { paddingVertical: 16, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border },
  backText:         { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  nextBtn:          { flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', ...shadow },
  nextBtnDisabled:  { backgroundColor: colors.border },
  nextText:         { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  nextTextDisabled: { color: colors.textSecondary },
})
