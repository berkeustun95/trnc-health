import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, type, press } from '../../constants/theme'

// 18/700, sentence case — replaces the 41 UPPERCASE 11–13pt micro-label styles. An
// optional text action sits on the right with a 44pt hit area.
export default function SectionHeader({ title, action, onLongPress, style }) {
  return (
    <View style={[s.row, style]}>
      <Text style={s.title} accessibilityRole="header" onLongPress={onLongPress}>{title}</Text>
      {!!action && (
        <TouchableOpacity
          onPress={action.onPress}
          activeOpacity={press.small}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel || action.label}
        >
          <Text style={s.action}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 24, marginBottom: 12, gap: 12 },
  title:  { ...type.sectionHeading, color: colors.textPrimary, flexShrink: 1 },
  action: { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark },
})
