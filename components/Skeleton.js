import { useEffect, useRef } from 'react'
import { View, Animated, StyleSheet } from 'react-native'
import { colors, shadow } from '../constants/theme'

export function Skeleton({ width, height, borderRadius = 8, style }) {
  const opacity = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start()
  }, [])
  return <Animated.View style={[{ width, height, borderRadius, backgroundColor: colors.border }, style, { opacity }]} />
}

export function FacilityCardSkeleton() {
  return (
    <View style={s.card}>
      <View style={s.cardBody}>
        <View style={s.row}>
          <Skeleton width={46} height={46} borderRadius={14} style={{ marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <View style={s.topRow}>
              <Skeleton width="62%" height={15} borderRadius={6} />
              <Skeleton width={40} height={13} borderRadius={6} />
            </View>
            <View style={s.badgeRow}>
              <Skeleton width={62} height={22} borderRadius={10} />
              <Skeleton width={46} height={22} borderRadius={10} />
            </View>
            <Skeleton width="46%" height={11} borderRadius={6} style={{ marginTop: 7 }} />
          </View>
        </View>
      </View>
    </View>
  )
}

export function ReviewSkeleton() {
  return (
    <View style={s.reviewCard}>
      <View style={s.reviewTop}>
        <Skeleton width={80} height={13} borderRadius={6} />
        <Skeleton width={58} height={11} borderRadius={6} />
      </View>
      <Skeleton width="88%" height={12} borderRadius={6} style={{ marginBottom: 5 }} />
      <Skeleton width="65%" height={12} borderRadius={6} />
    </View>
  )
}

export function SlotGridSkeleton() {
  return (
    <View style={s.slotGrid}>
      {Array.from({ length: 9 }).map((_, i) => (
        <Skeleton key={i} width={72} height={40} borderRadius={10} />
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  card:       { backgroundColor: colors.cardBg, borderRadius: 16, overflow: 'hidden', marginBottom: 10, ...shadow },
  cardBody:   { padding: 16 },
  row:        { flexDirection: 'row', alignItems: 'center' },
  topRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badgeRow:   { flexDirection: 'row', gap: 6 },
  reviewCard: { backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  reviewTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  slotGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
})
