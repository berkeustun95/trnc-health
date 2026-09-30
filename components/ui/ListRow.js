import { isValidElement } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, press, TAP } from '../../constants/theme'
import CategoryIcon from './CategoryIcon'

// Leading icon well · title / subtitle · trailing value or chevron. 52pt minimum row.
// `leading` accepts either { icon, category } (rendered as a CategoryIcon) or any node.
export default function ListRow({
  title, subtitle, leading, value, onPress, chevron = !!onPress, divider = false,
  destructive = false, accessibilityLabel, style,
}) {
  const lead = leading && !isValidElement(leading) && leading.icon
    ? <CategoryIcon icon={leading.icon} category={leading.category} size={36} />
    : leading
  const body = (
    <View style={[s.row, divider && s.divider, style]}>
      {lead}
      <View style={s.text}>
        <Text style={[s.title, destructive && { color: colors.dangerInk }]}>{title}</Text>
        {!!subtitle && <Text style={s.sub}>{subtitle}</Text>}
      </View>
      {value != null && <Text style={s.value} numberOfLines={1}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
    </View>
  )
  if (!onPress) return body
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={press.small}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || [title, subtitle, value].filter(Boolean).join(', ')}
    >
      {body}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  row:     { minHeight: TAP + 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  text:    { flex: 1 },
  title:   { ...type.rowTitle, color: colors.textPrimary },
  sub:     { ...type.small, color: colors.textSecondary, marginTop: 2 },
  value:   { ...type.body, color: colors.textSecondary, maxWidth: '45%' },
})
