import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, category } from '../../constants/theme'
import { t } from '../../constants/i18n'
import Button from './Button'
import { useOnPhoto } from './onPhoto'
import { CARD_BG } from './ModuleScreen'

// A fetch failed. Icon + message + "Tekrar dene", plus an optional fallback action for
// the cases where retrying is not enough (the duty list's "call KTEB" is the model).
// `compact` fits inside a widget tile.
export default function ErrorState({ message, onRetry, fallback, lang, compact = false, style }) {
  const onPhoto = useOnPhoto()   // on a module photo: inside a 93% white card
  return (
    <View style={[compact ? s.compact : s.wrap, onPhoto && !compact && s.card, style]} accessibilityRole="alert">
      <View style={[s.icon, compact && s.iconSmall]}>
        <Ionicons name="cloud-offline-outline" size={compact ? 18 : 26} color={colors.dangerInk} />
      </View>
      <Text style={[s.msg, compact && s.msgSmall]}>{message || t('uiLoadFailed', lang)}</Text>
      {!!onRetry && (
        <Button variant={compact ? 'text' : 'secondary'} icon="refresh" title={t('uiRetry', lang)} onPress={onRetry} />
      )}
      {!!fallback && (
        <Button variant="text" icon={fallback.icon} title={fallback.label} onPress={fallback.onPress} />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card:      { backgroundColor: CARD_BG, borderRadius: radii.card, marginHorizontal: 16, marginVertical: 12 },
  wrap:      { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24, gap: 10 },
  compact:   { alignItems: 'flex-start', gap: 6 },
  icon:      { width: 56, height: 56, borderRadius: radii.tile, backgroundColor: category.health.bg,
               justifyContent: 'center', alignItems: 'center' },
  iconSmall: { width: 32, height: 32, borderRadius: radii.sm },
  msg:       { ...type.body, color: colors.textPrimary, textAlign: 'center' },
  msgSmall:  { ...type.small, textAlign: 'left' },
})
