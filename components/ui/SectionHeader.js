import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, type, press, radii } from '../../constants/theme'
import { useOnPhoto } from './onPhoto'

// 18/700, sentence case — replaces the 41 UPPERCASE 11–13pt micro-label styles. An
// optional text action sits on the right with a 44pt hit area.
// On a module photo (ModuleScreen) the title and the action sit on dark pills (white 7.3:1 bound).
export default function SectionHeader({ title, action, onLongPress, style }) {
  const onPhoto = useOnPhoto()
  return (
    <View style={[s.row, style]}>
      <View style={onPhoto && s.pill}>
        <Text style={[s.title, onPhoto && s.onPhoto]} accessibilityRole="header" onLongPress={onLongPress}>{title}</Text>
      </View>
      {!!action && (
        <TouchableOpacity
          onPress={action.onPress}
          activeOpacity={press.small}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel || action.label}
        >
          <View style={onPhoto && s.pill}><Text style={[s.action, onPhoto && s.onPhoto]}>{action.label}</Text></View>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 24, marginBottom: 12, gap: 12 },
  title:  { ...type.sectionHeading, color: colors.textPrimary, flexShrink: 1 },
  pill:   { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 4, flexShrink: 1 },   // ModuleScreen PILL_ALPHA
  onPhoto:{ color: '#FFFFFF' },
  action: { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark },
})
