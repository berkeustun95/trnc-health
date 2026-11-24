import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '../ui'
import { colors, type, radii } from '../../constants/theme'
import { t } from '../../constants/i18n'

// The Döveç entry at the top of Emlak's list. Rendered only when there are visible projects (AccommodationScreen).
export default function DovecEntryCard({ lang, onPress }) {
  return (
    <Card onPress={onPress} style={s.card} accessibilityLabel={`${t('dovecEntryTitle', lang)}. ${t('dovecEntrySub', lang)}`}>
      <View style={s.row}>
        <View style={s.icon}><Ionicons name="business-outline" size={22} color={colors.primaryDark} /></View>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={2}>{t('dovecEntryTitle', lang)}</Text>
          <Text style={s.sub} numberOfLines={2}>{t('dovecEntrySub', lang)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </View>
    </Card>
  )
}

const s = StyleSheet.create({
  card:  { marginBottom: 12 },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:  { width: 44, height: 44, borderRadius: radii.tile, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  text:  { flex: 1, gap: 2 },
  title: { ...type.rowTitle, color: colors.textPrimary },
  sub:   { ...type.small, color: colors.textSecondary },
})
