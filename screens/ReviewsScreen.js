import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { ReviewSkeleton } from '../components/Skeleton'
import ContentReportMenu from '../components/ContentReportMenu'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow, type, radii, elevation } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import { REDESIGN } from '../constants/redesign'
import { ScreenHeader, ErrorState, EmptyState, CardSkeleton } from '../components/ui'

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

function ReviewCard({ item, lang, onBlocked, onRequireAccount }) {
  const date = new Date(item.created_at).toLocaleDateString([], { dateStyle: 'medium' })
  return (
    <View style={s.reviewCard}>
      <View style={s.reviewTop}>
        <Text style={s.stars}>
          {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}
        </Text>
        <View style={s.reviewTopRight}>
          <Text style={s.reviewDate}>{date}</Text>
          <ContentReportMenu contentType="review" contentId={item.id} lang={lang} onBlocked={onBlocked} onRequireAccount={onRequireAccount} />
        </View>
      </View>
      {item.comment ? <Text style={s.comment}>{item.comment}</Text> : null}
      <Text style={s.verifiedTag}>Verified visit</Text>
    </View>
  )
}

// Redesign card. No "Verified visit" line: since 20261004 a review needs no appointment,
// so nothing about a visit is verified — the claim was false.
function ReviewCardRedesign({ item, lang, onBlocked, onRequireAccount }) {
  const date = new Date(item.created_at).toLocaleDateString([], { dateStyle: 'medium' })
  return (
    <View style={r.card}>
      <View style={r.top}>
        <Text style={r.stars} accessibilityLabel={`${item.rating}/5`}>
          {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}
        </Text>
        <View style={r.topRight}>
          <Text style={r.date}>{date}</Text>
          <ContentReportMenu contentType="review" contentId={item.id} lang={lang} onBlocked={onBlocked} onRequireAccount={onRequireAccount} />
        </View>
      </View>
      {item.comment ? <Text style={r.comment}>{item.comment}</Text> : null}
    </View>
  )
}

// `average` is the profile's all-ratings average. The redesign shows that one number rather
// than re-deriving one from the loaded page, which disagrees with the profile past PAGE reviews.
export default function ReviewsScreen({ facility, lang = 'English', onBack, onRequireAccount, average = null }) {
  const [reviews, setReviews]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [done, setDone]           = useState(false)
  const [loadError, setLoadError] = useState(false)

  const dist = [0, 0, 0, 0, 0]
  for (const r of reviews) dist[r.rating - 1]++
  const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null

  const load = useCallback(async (pageNum = 0) => {
    if (pageNum === 0) setLoading(true); else setLoadingMore(true)
    const from = pageNum * PAGE
    const to = from + PAGE - 1
    const { data, count, error } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at', { count: 'exact' })
      .eq('facility_id', facility.id)
      .order('created_at', { ascending: false })
      .range(from, to)
    if (pageNum === 0) setLoadError(!!error)
    if (data) {
      setReviews(prev => pageNum === 0 ? data : [...prev, ...data])
      setTotal(count ?? 0)
      if (data.length < PAGE) setDone(true)
    }
    if (pageNum === 0) setLoading(false); else setLoadingMore(false)
  }, [facility.id])

  useEffect(() => { load(0) }, [load])

  // The block is enforced in the reviews SELECT policy, so simply refetching
  // makes the blocked author's reviews vanish — no client-side filtering.
  function handleBlocked() {
    setPage(0)
    setDone(false)
    load(0)
  }

  function retry() {
    setPage(0)
    setDone(false)
    load(0)
  }

  function loadMore() {
    if (loadingMore || done) return
    const next = page + 1
    setPage(next)
    load(next)
  }

  if (REDESIGN) {
    // Distribution bars only once every review is loaded: bars over a partial page describe
    // the newest 20, not the facility.
    const complete = reviews.length >= total
    return (
      <SafeAreaView style={r.safe} edges={['top', 'bottom']}>
        <ScreenHeader onBack={onBack} title={facility.name} subtitle={t('tabReviews', lang)} lang={lang} />
        {loading ? (
          <View style={r.list}>
            {[0, 1, 2].map(i => <CardSkeleton key={i} height={96} style={{ marginBottom: 10 }} />)}
          </View>
        ) : loadError ? (
          <ErrorState onRetry={retry} lang={lang} />
        ) : (
          <FlatList
            data={reviews}
            keyExtractor={x => x.id}
            contentContainerStyle={r.list}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={reviews.length > 0 ? (
              <View style={r.summary}>
                {average != null && (
                  <View style={r.summaryLeft}>
                    <Text style={r.avgNum}>{average}</Text>
                    <Text style={r.avgStars}>{'★'.repeat(Math.round(parseFloat(average)))}{'☆'.repeat(5 - Math.round(parseFloat(average)))}</Text>
                  </View>
                )}
                <View style={r.summaryRight}>
                  <Text style={r.count}>{t('reviewCountLabel', lang).replace('{n}', total)}</Text>
                  {complete && [5, 4, 3, 2, 1].map(star => (
                    <StarBar key={star} star={star} count={dist[star - 1]} total={reviews.length} />
                  ))}
                </View>
              </View>
            ) : null}
            ListEmptyComponent={(
              <EmptyState icon="star-outline" category="health" title={t('noReviews', lang)} message={t('firstReviewPrompt', lang)} />
            )}
            renderItem={({ item }) => <ReviewCardRedesign item={item} lang={lang} onBlocked={handleBlocked} onRequireAccount={onRequireAccount} />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null}
          />
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.list}>
          {[0, 1, 2, 3].map(i => <ReviewSkeleton key={i} />)}
        </View>
      ) : loadError ? (
        <ErrorState onRetry={retry} lang={lang} />
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
                <View style={s.emptyWrap}>
                  <Ionicons name="star-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
                  <Text style={s.emptyTitle}>No reviews yet</Text>
                  <Text style={s.empty}>Be the first to share your experience after your visit</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => <ReviewCard item={item} lang={lang} onBlocked={handleBlocked} onRequireAccount={onRequireAccount} />}
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
  reviewTopRight:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  stars:         { fontSize: 15, color: '#F5A623', letterSpacing: 1 },
  reviewDate:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  comment:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20, marginBottom: 8 },
  verifiedTag:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyWrap:     { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyTitle:    { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  empty:         { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})

const r = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.canvas },
  list:        { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  summary:     { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, flexDirection: 'row', gap: 16, marginBottom: 16, ...elevation.card },
  summaryLeft: { alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  avgNum:      { ...type.display, color: colors.textPrimary },
  avgStars:    { fontSize: 13, color: '#F5A623', letterSpacing: 1, marginTop: 2 },
  summaryRight:{ flex: 1, justifyContent: 'center', gap: 5 },
  count:       { ...type.meta, color: colors.textSecondary },
  card:        { backgroundColor: colors.card, borderRadius: radii.card, padding: 14, marginBottom: 10, ...elevation.card },
  top:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  topRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stars:       { fontSize: 15, color: '#F5A623', letterSpacing: 1 },
  date:        { ...type.meta, color: colors.textSecondary },
  comment:     { ...type.body, color: colors.textPrimary },
})
