import { View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { category as CATEGORY, colors, radii } from '../../constants/theme'

// A tinted icon well in a module's category colour — the app-wide identity for health,
// explore, homeLife and city. `brand` ({ bg, ink }) overrides the category: a partner's
// own colours always win (partner rule, redesign plan §5).
export default function CategoryIcon({ icon, category, brand, size = 52, iconSize, style }) {
  const tone = brand || CATEGORY[category] || { bg: colors.soft, ink: colors.textPrimary }
  return (
    <View
      style={[s.well, { width: size, height: size, borderRadius: size >= 48 ? radii.tile : radii.sm,
        backgroundColor: tone.bg }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.46)} color={tone.ink} />
    </View>
  )
}

const s = StyleSheet.create({
  well: { justifyContent: 'center', alignItems: 'center' },
})
