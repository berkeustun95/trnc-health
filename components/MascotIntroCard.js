import { View, Text, StyleSheet } from 'react-native'
import { colors, shadow } from '../constants/theme'
import ModuleMascotBadge from './ModuleMascotBadge'

// Row intro card: mascot on the left, title/subtitle to the right. Used on
// module screens that don't have the Pets-style centered hero card.
export default function MascotIntroCard({ module, title, subtitle, mascotSize = 96, style }) {
  return (
    <View style={[s.card, style]}>
      <ModuleMascotBadge module={module} size={mascotSize} style={s.mascot} />
      <View style={s.body}>
        {title ? <Text style={s.title}>{title}</Text> : null}
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, ...shadow },
  mascot:   { marginRight: 12, flexShrink: 0 },
  body:     { flex: 1 },
  title:    { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },
})
