import { View, Text, StyleSheet } from 'react-native'
import { colors, type, radii } from '../../constants/theme'
import { useOnPhoto } from './onPhoto'
import { CARD_BG } from './ModuleScreen'
import CategoryIcon from './CategoryIcon'
import Button from './Button'

// "There is genuinely nothing here." NEVER used for a failed fetch — that is ErrorState.
// An empty result from a table that cannot legitimately be empty is an error (CLAUDE.md).
// On a module photo (ModuleScreen) the whole state sits in a 93% white card.
export default function EmptyState({ icon = 'albums-outline', category, title, message, action, style }) {
  const onPhoto = useOnPhoto()
  return (
    <View style={[s.wrap, onPhoto && s.card, style]}>
      <CategoryIcon icon={icon} category={category} size={56} />
      {!!title && <Text style={s.title}>{title}</Text>}
      {!!message && <Text style={s.msg}>{message}</Text>}
      {!!action && <Button variant="secondary" title={action.label} onPress={action.onPress} style={s.btn} />}
    </View>
  )
}

const s = StyleSheet.create({
  card:  { backgroundColor: CARD_BG, borderRadius: radii.card, marginHorizontal: 16, marginVertical: 12 },
  wrap:  { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  title: { ...type.rowTitle, color: colors.textPrimary, marginTop: 14, textAlign: 'center' },
  msg:   { ...type.body, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  btn:   { marginTop: 16 },
})
