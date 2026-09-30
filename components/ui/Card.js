import { View, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, radii, elevation, press } from '../../constants/theme'

// White, radius 20, elevation.card, and never a border AND a shadow together (the audit
// found both on Towing and Ev Hizmetleri cards). Pass onPress to make the whole card a
// target; pass `flat` for a card sitting inside another surface.
export default function Card({
  children, onPress, padding = 16, radius = radii.card, flat = false,
  tone, style, accessibilityLabel, accessibilityHint,
}) {
  const box = [
    s.card,
    { padding, borderRadius: radius, backgroundColor: tone ?? colors.card },
    !flat && elevation.card,
    style,
  ]
  if (!onPress) return <View style={box}>{children}</View>
  return (
    <TouchableOpacity
      style={box}
      onPress={onPress}
      activeOpacity={press.card}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card: { overflow: 'visible' },
})
