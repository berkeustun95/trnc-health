import { View, StyleSheet } from 'react-native'
import { colors, shadow, radius } from '../constants/theme'
import { OnSafeSurface } from './SurfaceContext'

export default function ContentCard({ children, style }) {
  // The provider marks everything inside as sitting on an opaque surface. It is what the
  // dev contrast audit uses to tell "grey label on a white card" (correct, and the whole
  // reason this component exists) from "grey label on a photo" (the 2026-09-17 bug).
  // Renders nothing and costs nothing; see components/SurfaceContext.js.
  return (
    <OnSafeSurface.Provider value={true}>
      <View style={[s.card, style]}>{children}</View>
    </OnSafeSurface.Provider>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    ...shadow,
  },
})
