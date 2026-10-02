import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, press } from '../../constants/theme'

// One fact on a detail screen (S4): icon in the category ink, a small label, the value.
// Tappable rows (phone, address, website) are 48pt and say so with a chevron.
export default function InfoRow({ icon, label, value, onPress, category = 'city', divider = true, accessibilityLabel }) {
  const c = CAT[category] || CAT.city
  if (!value) return null
  const body = (
    <View style={[s.row, divider && s.divider]}>
      <View style={[s.icon, { backgroundColor: c.bg }]}><Ionicons name={icon} size={17} color={c.ink} /></View>
      <View style={{ flex: 1 }}>
        {!!label && <Text style={s.label}>{label}</Text>}
        <Text style={s.value}>{value}</Text>
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
    </View>
  )
  if (!onPress) return body
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={press.small} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || [label, value].filter(Boolean).join(', ')}>{body}</TouchableOpacity>
  )
}

const s = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  icon:    { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  label:   { ...type.meta, color: colors.textSecondary },
  value:   { ...type.body, color: colors.textPrimary },
})
