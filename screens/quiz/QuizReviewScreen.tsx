import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getVisibleQuestions } from '@/data/quiz/questions'
import { colors, shadow } from '../../constants/theme'

type SupplementItem = {
  supplement: { id: string; name: string; standardDose: string }
  reason: string
  priority: 'essential' | 'recommended' | 'optional'
  doseAdjustment?: string
}

type GeneratedResult = {
  stack: SupplementItem[]
  summary: string
  timingSchedule: any[]
  interactions: any[]
  disclaimers: string[]
}

export type Submission = {
  id: string
  customer_id?: string
  answers: Record<string, any>
  generated_result: GeneratedResult
  final_result?: GeneratedResult | null
  created_at: string
}

const PRIORITY_COLOR: Record<string, string> = {
  essential:   colors.danger,
  recommended: colors.primary,
  optional:    colors.textSecondary,
}

export default function QuizReviewScreen({
  submission,
  onApproved,
  onBack,
  readOnly,
}: {
  submission: Submission
  onApproved?: () => void
  onBack: () => void
  readOnly?: boolean
}) {
  const [overrides, setOverrides] = useState<Record<string, { included: boolean; dose: string }>>(() =>
    Object.fromEntries(
      submission.generated_result.stack.map(item => [
        item.supplement.id,
        { included: true, dose: item.doseAdjustment ?? item.supplement.standardDose },
      ])
    )
  )
  const [note, setNote]             = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab]   = useState<'answers' | 'edit'>('answers')

  const questions = getVisibleQuestions(submission.answers, 'tr')

  const getAnswerLabel = (q: ReturnType<typeof getVisibleQuestions>[0]): string => {
    const ans = submission.answers[q.id]
    if (!ans) return '—'
    if (Array.isArray(ans)) return ans.map(id => q.options.find(o => o.id === id)?.label ?? id).join(', ')
    return q.options.find(o => o.id === ans)?.label ?? String(ans)
  }

  const handleApprove = async () => {
    setSubmitting(true)
    const filteredStack = submission.generated_result.stack
      .filter(item => overrides[item.supplement.id]?.included)
      .map(item => ({ ...item, doseAdjustment: overrides[item.supplement.id]?.dose }))

    const finalResult: GeneratedResult = {
      ...submission.generated_result,
      stack: filteredStack,
      summary: note.trim()
        ? `${submission.generated_result.summary}\n\n💊 Eczacı notu: ${note.trim()}`
        : submission.generated_result.summary,
    }

    const { error } = await supabase
      .from('quiz_submissions')
      .update({ status: 'approved', final_result: finalResult })
      .eq('id', submission.id)

    setSubmitting(false)
    if (!error) onApproved?.()
  }

  const editTabLabel = readOnly ? 'Results' : 'Review & Edit'
  const stackToShow  = readOnly ? (submission.final_result?.stack ?? []) : submission.generated_result.stack

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>{readOnly ? 'Approved Review' : 'Quiz Review'}</Text>
          {submission.customer_id && (
            <Text style={s.memberId}>#{submission.customer_id.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
          )}
          <Text style={s.meta}>
            {new Date(submission.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
          </Text>
        </View>

        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, activeTab === 'answers' && s.tabActive]}
            onPress={() => setActiveTab('answers')}
          >
            <Text style={[s.tabText, activeTab === 'answers' && s.tabTextActive]}>Answers</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, activeTab === 'edit' && s.tabActive]}
            onPress={() => setActiveTab('edit')}
          >
            <Text style={[s.tabText, activeTab === 'edit' && s.tabTextActive]}>{editTabLabel}</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'answers' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            {questions.map(q => (
              <View key={q.id} style={s.qaRow}>
                <Text style={s.qaQ}>{q.question}</Text>
                <Text style={s.qaA}>{getAnswerLabel(q)}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            <Text style={s.sectionLabel}>SUPPLEMENT STACK</Text>

            {readOnly ? (
              stackToShow.map(item => {
                const priorityColor = PRIORITY_COLOR[item.priority]
                const dose = item.doseAdjustment ?? item.supplement.standardDose
                return (
                  <View key={item.supplement.id} style={s.suppCard}>
                    <View style={s.suppHeader}>
                      <View style={s.suppInfo}>
                        <Text style={s.suppName}>{item.supplement.name}</Text>
                        <Text style={[s.suppPriority, { color: priorityColor }]}>{item.priority}</Text>
                      </View>
                    </View>
                    <View style={s.doseRow}>
                      <Text style={s.doseLabel}>DOSE</Text>
                      <Text style={s.doseValue}>{dose}</Text>
                    </View>
                  </View>
                )
              })
            ) : (
              submission.generated_result.stack.map(item => {
                const ov = overrides[item.supplement.id]
                const priorityColor = PRIORITY_COLOR[item.priority]
                return (
                  <View key={item.supplement.id} style={[s.suppCard, !ov?.included && s.suppCardOff]}>
                    <View style={s.suppHeader}>
                      <View style={s.suppInfo}>
                        <Text style={[s.suppName, !ov?.included && { color: colors.textSecondary }]}>
                          {item.supplement.name}
                        </Text>
                        <Text style={[s.suppPriority, { color: priorityColor }]}>{item.priority}</Text>
                      </View>
                      <Switch
                        value={ov?.included ?? true}
                        onValueChange={val =>
                          setOverrides(prev => ({ ...prev, [item.supplement.id]: { ...prev[item.supplement.id], included: val } }))
                        }
                        trackColor={{ false: colors.border, true: colors.primaryLight }}
                        thumbColor={ov?.included ? colors.primary : '#ccc'}
                      />
                    </View>
                    {ov?.included && (
                      <View style={s.doseRow}>
                        <Text style={s.doseLabel}>DOSE</Text>
                        <TextInput
                          style={s.doseInput}
                          value={ov.dose}
                          onChangeText={val =>
                            setOverrides(prev => ({ ...prev, [item.supplement.id]: { ...prev[item.supplement.id], dose: val } }))
                          }
                          placeholderTextColor={colors.textSecondary}
                        />
                      </View>
                    )}
                  </View>
                )
              })
            )}

            {!readOnly && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 24 }]}>PHARMACIST NOTE (optional)</Text>
                <TextInput
                  style={s.noteInput}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add a personal note for the patient…"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
                <TouchableOpacity
                  style={[s.approveBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleApprove}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.approveText}>✓ Approve & Send Results</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  container:     { flex: 1, paddingHorizontal: 16 },
  header:        { paddingTop: 16, paddingBottom: 12 },
  backBtn:       { marginBottom: 8 },
  backText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  title:         { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  memberId:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, marginTop: 4 },
  meta:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  tabs:          { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, marginBottom: 16 },
  tab:           { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabActive:     { backgroundColor: colors.surface, ...shadow },
  tabText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  scroll:        { paddingBottom: 40 },
  sectionLabel:  { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  qaRow:         { backgroundColor: colors.cardBg, borderRadius: 10, padding: 14, marginBottom: 8 },
  qaQ:           { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 4 },
  qaA:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },
  suppCard:      { backgroundColor: colors.cardBg, borderRadius: 12, padding: 14, marginBottom: 8, ...shadow },
  suppCardOff:   { opacity: 0.45 },
  suppHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  suppInfo:      { flex: 1 },
  suppName:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  suppPriority:  { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  doseRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  doseLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, letterSpacing: 0.4, width: 40 },
  doseValue:     { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  doseInput:     { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface },
  noteInput:     { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, backgroundColor: colors.surface, minHeight: 80, textAlignVertical: 'top', marginBottom: 24 },
  approveBtn:    { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', ...shadow },
  approveText:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
})
