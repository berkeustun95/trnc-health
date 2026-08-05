import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'

// Small gold "Featured" pill for a directory card. Display-only; the caller
// decides when to render it (showFeatured gate + isFeatured(row)). Kept generic
// so every facility directory (garage/grooming/health) uses the same badge.
export default function FeaturedBadge({ lang, style }) {
  return (
    <View style={[s.badge, style]}>
      <Ionicons name="star" size={11} color={s.txt.color} />
      <Text style={s.txt}>{t('featuredBadge', lang)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  // Gold on light amber. backgroundColor set explicitly alongside the border
  // (Android borderRadius + borderWidth gotcha).
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
           paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
           backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A' },
  txt:   { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#B45309', letterSpacing: 0.3 },
})
