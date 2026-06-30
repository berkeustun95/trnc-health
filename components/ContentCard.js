import { View, StyleSheet } from 'react-native'
import { colors, shadow, radius } from '../constants/theme'

export default function ContentCard({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    ...shadow,
  },
})
