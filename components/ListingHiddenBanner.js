import { View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'

// Owner-only notice shown on a provider's own management view (garage/grooming
// ActiveState, health ProviderScreen) when their listing is hidden from customers
// by moderation. Renders nothing unless hidden_at is set, so it is always safe to
// mount unconditionally. Display-only — never changes moderation state.
//
// Visibility of a hidden row is already scoped to owner + admin by the facilities
// RLS (facilities_hide_reported), so a non-owner never reaches this component.
export default function ListingHiddenBanner({ hiddenAt, hiddenReason, lang, style }) {
  if (!hiddenAt) return null

  const bodyKey = hiddenReason === 'auto_reports'
    ? 'listingHiddenAutoReports'
    : 'listingHiddenModeration'

  return (
    <View style={[s.wrap, style]}>
      <View style={s.row}>
        <Ionicons name="eye-off-outline" size={18} color={s.iconColor.color} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t('listingHiddenTitle', lang)}</Text>
          <Text style={s.body}>{t(bodyKey, lang)}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL('mailto:getadaapp@gmail.com?subject=ADA%20listing%20hidden')}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={s.link}>{t('listingHiddenContact', lang)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  // Amber = calm attention, not error. backgroundColor set explicitly with the
  // border (Android borderRadius+borderWidth gotcha).
  wrap:      { backgroundColor: '#FEF3C7', borderRadius: 14, borderWidth: 1, borderColor: '#FDE68A',
               paddingHorizontal: 14, paddingVertical: 12 },
  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconColor: { color: '#B45309' },
  title:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#92400E', marginBottom: 3 },
  body:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#92400E', lineHeight: 19 },
  link:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#B45309', marginTop: 6,
               textDecorationLine: 'underline' },
})
