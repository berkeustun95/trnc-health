import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CAT, type, radii } from '../../constants/theme'

// The pharmacy-style info banner at the top of a module list (S3): one tinted strip with the
// module's category colour, an icon and one or two sentences. textPrimary on any category
// tint is ≥ 12:1; the icon uses the category ink (≥ 5:1 on its tint).
export default function InfoBanner({ icon = 'information-circle-outline', category = 'city', title, message, style }) {
  const c = CAT[category] || CAT.city
  if (!title && !message) return null
  return (
    <View style={[s.box, { backgroundColor: c.bg }, style]}>
      <Ionicons name={icon} size={20} color={c.ink} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {!!title && <Text style={s.title}>{title}</Text>}
        {!!message && <Text style={s.msg}>{message}</Text>}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  box:   { flexDirection: 'row', gap: 10, borderRadius: radii.card, paddingHorizontal: 14, paddingVertical: 12 },
  title: { ...type.rowTitle, color: colors.textPrimary, marginBottom: 2 },
  msg:   { ...type.small, color: colors.textPrimary },
})
