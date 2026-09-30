import { View, StyleSheet } from 'react-native'
import { Skeleton as Bone } from '../Skeleton'
import { colors, radii, elevation } from '../../constants/theme'

// Re-uses the pulse from components/Skeleton.js (one animation, not two) and adds presets
// shaped like the new components, so a loading screen has the same geometry as the loaded
// one and nothing jumps.
export { Bone }

export function CardSkeleton({ height = 120, style }) {
  return (
    <View style={[s.card, elevation.card, style]}>
      <Bone width="55%" height={14} />
      <Bone width="80%" height={12} style={{ marginTop: 10 }} />
      <Bone width="40%" height={12} style={{ marginTop: 8 }} />
      <View style={{ height: Math.max(0, height - 80) }} />
    </View>
  )
}

export function RowSkeleton({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => (
    <View key={i} style={s.row}>
      <Bone width={36} height={36} borderRadius={radii.sm} />
      <View style={{ flex: 1, gap: 6 }}>
        <Bone width="60%" height={13} />
        <Bone width="35%" height={11} />
      </View>
    </View>
  ))
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 16 },
  row:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
})
