import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'

// The Oli entry point, as a row.
//
// ─── IT REPLACES THE FAB, IT DOES NOT JOIN IT ───────────────────────────────
// OliGuide mounts a DRAGGABLE floating button whose visibility condition in App.js is
// already `inTabShell && activeTab === 'home' && …` — Home and nowhere else. So the FAB
// has exactly one surface, and giving Home a second Oli entry point would mean two
// buttons for one sheet on the only screen either appears on. Under HOME_V2_LIVE the FAB
// is suppressed and this row is the entry.
//
// The SHEET is untouched: this calls straight into OliGuide's openSheet through a ref, so
// the chip set, resolveOliQuery matching, keyboard handling, hardware-back handler and
// accessibility modality all stay exactly where they are. Nothing about Ask Oli was
// reimplemented for the redesign — only the thing you press.
//
// The drag / edge-snap / @trnc_oli_pos code stays in OliGuide.js and is dormant while
// this row is in use. It is not dead: HOME_V2_LIVE can be false, and V1 still shows the
// FAB. It becomes deletable the day old Home is deleted, and not before.
export default function OliRow({ lang, onPress }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
      <Image source={require('../../assets/oli-button.png')} style={s.avatar} resizeMode="cover" />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{t('homeOliTitle', lang)}</Text>
        <Text style={s.sub} numberOfLines={1}>{t('homeOliSub', lang)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.primary} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // Pulled up over the hero's bottom edge — the mockup's overlap — with the negative
  // margin on the ROW rather than on whatever follows it, so the spacing below is
  // ordinary and nothing downstream has to know this row overlaps anything.
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cardBg, borderRadius: 16, padding: 12, marginTop: -22, marginHorizontal: 10, ...shadow },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight },
  title:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  sub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
})
