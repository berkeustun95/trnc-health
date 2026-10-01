import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Button } from './ui'
import { CARD_BG } from './ui/ModuleScreen'
import { colors, type, radii, elevation } from '../constants/theme'
import { t } from '../constants/i18n'

// Location not allowed (redesign): one quiet row on the screens that use it, no nagging.
// canAsk → "Konumumu kullan" (the explanation, then the OS pop-up); the OS will no longer ask →
// "Ayarları aç". App.js owns the action (enableLocation) and re-reads on return from Settings.
export default function LocationOffRow({ lang, canAsk, onEnable, style }) {
  return (
    <View style={[s.row, style]}>
      <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
      <Text style={s.text}>{t('enableLocation', lang)}</Text>
      <Button variant="text" title={t(canAsk ? 'permUseLocation' : 'openSettings', lang)} onPress={onEnable} />
    </View>
  )
}

const s = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, minHeight: 48,
          borderRadius: radii.md, backgroundColor: CARD_BG, flexShrink: 0, ...elevation.card },
  text: { ...type.small, color: colors.textSecondary, flex: 1, paddingVertical: 8 },
})
