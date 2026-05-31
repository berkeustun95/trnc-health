import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useQuizStore } from '@/lib/quiz/store'
import { useReviewStore, ReviewFacility } from './reviewStore'
import { colors, shadow } from '../../constants/theme'

type FacilityRow = {
  id: string
  name: string
  address: string | null
  pharmacist_scores: { total_points: number; avg_response_mins: number; total_reviews: number } | null
}

function getBadge(points: number) {
  if (points >= 100) return { label: '🥇 Expert', color: '#B8860B' }
  if (points >= 50)  return { label: '🥈 Pro',    color: '#607D8B' }
  if (points >= 20)  return { label: '🥉 Active', color: '#8D6748' }
  return               { label: 'New',            color: colors.textSecondary }
}

export default function PharmacistPickerScreen() {
  const [pharmacies, setPharmacies] = useState<FacilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)

  const answers = useQuizStore(s => s.answers)
  const result  = useQuizStore(s => s.result)
  const submitForReview = useReviewStore(s => s.submitForReview)

  useEffect(() => {
    supabase
      .from('facilities')
      .select('id, name, address, pharmacist_scores(total_points, avg_response_mins, total_reviews)')
      .eq('is_quiz_partner', true)
      .eq('type', 'pharmacy')
      .then(({ data }) => {
        const sorted = (data ?? []).sort((a, b) =>
          (b.pharmacist_scores?.total_points ?? 0) - (a.pharmacist_scores?.total_points ?? 0)
        )
        setPharmacies(sorted)
        setLoading(false)
      })
  }, [])

  const handleSelect = async (item: FacilityRow) => {
    if (!result) return
    setSubmitting(item.id)
    const facility: ReviewFacility = {
      id: item.id,
      name: item.name,
      total_points:      item.pharmacist_scores?.total_points ?? 0,
      avg_response_mins: item.pharmacist_scores?.avg_response_mins ?? 0,
      total_reviews:     item.pharmacist_scores?.total_reviews ?? 0,
    }
    await submitForReview(answers, result, facility)
    setSubmitting(null)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <View style={s.badge}>
            <Text style={s.badgeText}>ALMOST THERE</Text>
          </View>
          <Text style={s.title}>Choose your pharmacist</Text>
          <Text style={s.subtitle}>
            A partner pharmacist will review your results before you see them. Better communicators are shown first.
          </Text>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : pharmacies.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyTitle}>No partner pharmacists yet</Text>
            <Text style={s.emptySub}>Check back soon as we on-board pharmacy partners.</Text>
          </View>
        ) : (
          <FlatList
            data={pharmacies}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.list}
            renderItem={({ item, index }) => {
              const sc = item.pharmacist_scores
              const badge = getBadge(sc?.total_points ?? 0)
              const isSubmitting = submitting === item.id
              return (
                <TouchableOpacity
                  style={s.card}
                  onPress={() => handleSelect(item)}
                  disabled={!!submitting}
                  activeOpacity={0.7}
                >
                  <View style={s.cardLeft}>
                    <View style={s.rankBubble}>
                      <Text style={s.rankText}>#{index + 1}</Text>
                    </View>
                    <View style={s.cardInfo}>
                      <Text style={s.pharmacyName}>{item.name}</Text>
                      {item.address ? (
                        <Text style={s.address} numberOfLines={1}>{item.address}</Text>
                      ) : null}
                      <View style={s.metaRow}>
                        <Text style={[s.badgePill, { color: badge.color }]}>{badge.label}</Text>
                        {sc?.total_reviews ? (
                          <Text style={s.meta}>
                            ⚡ avg {sc.avg_response_mins < 1 ? '<1 min' : `${Math.round(sc.avg_response_mins)} min`}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  {isSubmitting
                    ? <ActivityIndicator color={colors.primary} />
                    : <Text style={s.arrow}>→</Text>
                  }
                </TouchableOpacity>
              )
            }}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  container:    { flex: 1, paddingHorizontal: 16 },
  header:       { paddingTop: 24, paddingBottom: 16 },
  badge:        { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12 },
  badgeText:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.3 },
  title:        { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  subtitle:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  emptySub:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list:         { paddingBottom: 32 },
  card:         { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 14, padding: 16, marginBottom: 10, ...shadow },
  cardLeft:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rankBubble:   { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  rankText:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  cardInfo:     { flex: 1 },
  pharmacyName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  address:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badgePill:    { fontSize: 12, fontFamily: 'Inter_700Bold' },
  meta:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  arrow:        { fontSize: 18, color: colors.primary, fontFamily: 'Inter_700Bold' },
})
