import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category, type, radii } from '../../constants/theme'

// A failure said where it happened: dangerInk on the health tint (4.63:1), announced to screen
// readers (role alert + live region). For form and sign-in errors; a failed LIST uses ErrorState.
export default function InlineAlert({ message, style }) {
  if (!message) return null
  return (
    <View style={[s.box, style]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={18} color={colors.dangerInk} style={{ marginTop: 1 }} />
      <Text style={s.text}>{message}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  box:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: category.health.bg,
          borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10 },
  text: { ...type.small, fontFamily: 'Inter_500Medium', color: colors.dangerInk, flex: 1 },
})
