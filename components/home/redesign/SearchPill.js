import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { IconButton } from '../../ui'

// ONE look in both states — white, 52pt, pill, floating shadow — so tapping it does not
// change its style, only where it sits: over the hero's edge when closed, at the top of the
// screen when open. `searchRef` stays on the closed pill for the coach mark.
export const PILL_H = 52

export default function SearchPill({ open, lang, query, onChangeText, onOpen, onClose, searchRef, style }) {
  if (!open) {
    return (
      <View ref={searchRef} collapsable={false} style={style}>
        <TouchableOpacity style={[s.pill, elevation.floating]} onPress={onOpen} activeOpacity={press.card}
          accessibilityRole="search" accessibilityLabel={t('homeSearchA11y', lang)}>
          <Feather name="search" size={18} color={colors.textSecondary} />
          <Text style={s.placeholder} numberOfLines={1}>{t('hubSearchPlaceholder', lang)}</Text>
        </TouchableOpacity>
      </View>
    )
  }
  return (
    <View style={[s.pill, elevation.floating, s.openPill, style]}>
      <Feather name="search" size={18} color={colors.textSecondary} />
      <TextInput
        style={s.input}
        value={query}
        onChangeText={onChangeText}
        placeholder={t('hubSearchPlaceholder', lang)}
        placeholderTextColor={colors.textSecondary}
        returnKeyType="search"
        autoFocus
        accessibilityLabel={t('homeSearchA11y', lang)}
      />
      <IconButton icon="close" iconSize={20} onPress={onClose} accessibilityLabel={t('uiClose', lang)} />
    </View>
  )
}

const s = StyleSheet.create({
  pill:        { height: PILL_H, borderRadius: radii.pill, backgroundColor: colors.card,
                 flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 },
  openPill:    { paddingRight: 4 },
  placeholder: { ...type.body, fontSize: 15, color: colors.textSecondary, flex: 1 },
  input:       { ...type.body, fontSize: 15, color: colors.textPrimary, flex: 1, padding: 0 },
})
