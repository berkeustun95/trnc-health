import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const PAGE = 20

function StarBar({ count, total, star }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <View style={s.starBarRow}>
      <Text style={s.starBarLabel}>{star}★</Text>
      <View style={s.starBarTrack}>
        <View style={[s.starBarFill, { width: `${pct}%` }]} />
      </View>
      <Text style={s.starBarCount}>{count}</Text>
    </View>
  )
}

function ReviewCard({ item }) {
  const date = new Date(item.created_at).toLocaleDateString([], { dateStyle: 'medium' })
  return (
    <View style={s.reviewCard}>
      <View style={s.reviewTop}>
        <Text style={s.stars}>
          {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}
        </Text>
        <Text style={s.reviewDate}>{date}</Text>
      </View>
      {item.comment ? <Text style={s.comment}>{item.comment}</Text> : null}
      <Text style={s.verifiedTag}>Verified visit</Text>
    </View>
  )
}

export default function ReviewsScreen({ facility, lang = 'English', onBack }) {
  const [reviews, setReviews]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [done, setDone]           = useState(false)

  const dist = [0, 0, 0, 0, 0]
  for (const r of reviews) dist[r.rating - 1]++
  const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null

  const load = useCallback(async (pageNum = 0) => {
    if (pageNum === 0) setLoading(true); else setLoadingMore(true)
    const from = pageNum * PAGE
    const to = from + PAGE - 1
    const { data, count } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at', { count: 'exact' })
      .eq('facility_id', facility.id)
      .order('created_at', { ascending: false })
      .range(from, to)
    if (data) {
      setReviews(prev => pageNum === 0 ? data : [...prev, ...data])
      setTotal(count ?? 0)
      if (data.length < PAGE) setDone(true)
    }
    if (pageNum === 0) setLoading(false); else setLoadingMore(false)
  }, [facility.id])

  useEffect(() => { load(0) }, [load])

  function loadMore() {
    if (loadingMore || done) return
    const next = page + 1
    setPage(next)
    load(next)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          <Text style={s.backText}>{t('back', lang)}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={r => r.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <View>
              <Text style={s.facilityName} numberOfLines={2}>{facility.name}</Text>
              <Text style={s.subtitle}>{t('tabReviews', lang)}</Text>

              {avg && (
                <View style={s.summaryCard}>
                  <View style={s.summaryLeft}>
                    <Text style={s.avgNum}>{avg}</Text>
                    <Text style={s.avgStars}>{'★'.repeat(Math.round(parseFloat(avg)))}{'☆'.repeat(5 - Math.round(parseFloat(avg)))}</Text>
                    <Text style={s.totalCount}>{total} review{total !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={s.summaryRight}>
                    {[5, 4, 3, 2, 1].map(star => (
                      <StarBar key={star} star={star} count={dist[star - 1]} total={reviews.length} />
                    ))}
                  </View>
                </View>
              )}

              {reviews.length === 0 && (
                <Text style={s.empty}>No reviews yet.</Text>
              )}
            </View>
          }
          renderItem={({ item }) => <ReviewCard item={item} />}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
              : null
          }
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  backBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:          { paddingHorizontal: 16, paddingBottom: 40 },
  facilityName:  { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5, marginBottom: 2 },
  subtitle:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 20 },
  summaryCard:   { backgroundColor: colors.cardBg, borderRadius: 16, padding: 18, flexDirection: 'row', gap: 16, marginBottom: 24, ...shadow },
  summaryLeft:   { alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  avgNum:        { fontSize: 40, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 44 },
  avgStars:      { fontSize: 13, color: '#F5A623', letterSpacing: 1, marginTop: 2 },
  totalCount:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 4 },
  summaryRight:  { flex: 1, justifyContent: 'center', gap: 5 },
  starBarRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  starBarLabel:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, width: 20, textAlign: 'right' },
  starBarTrack:  { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  starBarFill:   { height: '100%', backgroundColor: '#F5A623', borderRadius: 3 },
  starBarCount:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, width: 22 },
  reviewCard:    { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
  reviewTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  stars:         { fontSize: 15, color: '#F5A623', letterSpacing: 1 },
  reviewDate:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  comment:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20, marginBottom: 8 },
  verifiedTag:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
})
