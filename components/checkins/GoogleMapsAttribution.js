// Places API policies: wherever Google place data is shown outside a Google map, "Google Maps"
// in Roboto (or the platform sans-serif), weight 400, 12–16 sp, never translated, never split,
// ≥ 4.5:1 contrast (textSecondary on white ≈ 5.9:1). fontFamily: Android's 'sans-serif' is
// Roboto; iOS falls back to the system sans-serif, which the policy allows.
import { Text, StyleSheet, Platform } from 'react-native'
import { colors } from '../../constants/theme'

export default function GoogleMapsAttribution({ style }) {
  return (
    <Text style={[s.text, style]} maxFontSizeMultiplier={1.3} numberOfLines={1}>Google Maps</Text>
  )
}

const s = StyleSheet.create({
  text: { fontSize: 12, fontWeight: '400', color: colors.textSecondary,
          fontFamily: Platform.OS === 'android' ? 'sans-serif' : undefined },
})
