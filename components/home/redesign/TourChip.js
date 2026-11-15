import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../../../constants/i18n'
import { colors, radii, space, type, elevation, press, TAP } from '../../../constants/theme'

// ─── Home: "Tura başla" (Onboarding v2) ─────────────────────────────────────
// Offered once, after Screen 2 (@trnc_tour_chip). App.js decides visibility and clears the key on
// either tap; the tour itself stays in Profile and the menu. A chip that hugs its label, with the ×
// as its own 44pt target so a dismiss can never start the tour.
export default function TourChip({ lang, onStart, onDismiss }) {
  const label = t('tourChip', lang)
  return (
    <View style={[s.chip, elevation.card]}>
      <TouchableOpacity style={s.start} onPress={onStart} activeOpacity={press.small}
        accessibilityRole="button" accessibilityLabel={label}>
        <View style={s.icon}>
          <Ionicons name="compass-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.close} onPress={onDismiss} activeOpacity={press.small}
        accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  chip:  { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center',
           backgroundColor: colors.card, borderRadius: radii.pill, paddingLeft: space[4] },
  start: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space[8], minHeight: TAP,
           paddingLeft: space[4], paddingRight: space[4] },
  icon:  { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.primaryLight,
           alignItems: 'center', justifyContent: 'center' },
  label: { ...type.rowTitle, color: colors.primaryDark, flexShrink: 1 },
  close: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
})
