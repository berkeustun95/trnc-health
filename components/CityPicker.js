import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, radii } from '../constants/theme'
import { REDESIGN } from '../constants/redesign'
import { t } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'

// The 7 canonical regions as a tap grid. Shared by the home-city question and
// the Settings modal.
//
// `value` is the CURRENTLY SAVED home city, not a suggestion. Nothing is ever
// selected by default — see HomeCitySheet for why pre-selecting the detected
// city is a trap.
export default function CityPicker({ value, onSelect, lang }) {
  return (
    <View style={s.grid}>
      {REGIONS.map(r => {
        const active = value === r
        return (
          <TouchableOpacity
            key={r}
            style={[s.chip, active && s.chipActive]}
            onPress={() => onSelect(r)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.chipText, active && s.chipTextActive]}>
              {t(REGION_LABEL_KEY[r], lang)}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const legacyS = StyleSheet.create({
  grid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
})

// Redesign: 44pt chips with a 3.66:1 boundary (colors.border was 1.18:1).
const redesignS = StyleSheet.create({
  chip:           { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: radii.pill,
                    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.fieldBorder },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 2 },
  chipText:       { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.textPrimary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primaryDark },
})
const s = REDESIGN ? { ...legacyS, ...redesignS } : legacyS
