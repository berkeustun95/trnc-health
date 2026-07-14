import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../constants/theme'
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

const s = StyleSheet.create({
  grid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  chipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
})
