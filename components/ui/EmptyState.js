import { View, Text, StyleSheet } from 'react-native'
import { colors, type } from '../../constants/theme'
import CategoryIcon from './CategoryIcon'
import Button from './Button'

// "There is genuinely nothing here." NEVER used for a failed fetch — that is ErrorState.
// An empty result from a table that cannot legitimately be empty is an error (CLAUDE.md).
// tone 'wash': the message in WASH_SECONDARY, for an empty list drawn on ModuleBackdrop C.
export default function EmptyState({ icon = 'albums-outline', category, title, message, action, style, tone }) {
  return (
    <View style={[s.wrap, style]}>
      <CategoryIcon icon={icon} category={category} size={56} />
      {!!title && <Text style={s.title}>{title}</Text>}
      {!!message && <Text style={[s.msg, tone === 'wash' && { color: '#3E4A59' }, tone === 'light' && { color: '#3E4A59' }]}>{message}</Text>}
      {!!action && <Button variant="secondary" title={action.label} onPress={action.onPress} style={s.btn} />}
    </View>
  )
}

const s = StyleSheet.create({
  wrap:  { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  title: { ...type.rowTitle, color: colors.textPrimary, marginTop: 14, textAlign: 'center' },
  msg:   { ...type.body, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  btn:   { marginTop: 16 },
})
