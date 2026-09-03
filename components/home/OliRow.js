import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { HERO_OVERLAP } from './HomeHero'

// The Oli entry point: a solid brand-teal banner overlapping the hero's bottom edge.
//
// ─── IT REPLACES THE FAB, IT DOES NOT JOIN IT ───────────────────────────────
// OliGuide's visibility condition in App.js is already `activeTab === 'home' && …` —
// Home and nowhere else. So the FAB has exactly one surface, and giving Home a second
// Oli entry point would mean two buttons for one sheet on the only screen either appears
// on. Under HOME_V2_LIVE the FAB is suppressed and this row is the entry.
//
// The SHEET is untouched: this calls straight into OliGuide's openSheet through a ref, so
// the chip set, resolveOliQuery matching, keyboard handling, hardware-back handler and
// accessibility modality all stay where they are. Nothing about Ask Oli was
// reimplemented for the redesign — only the thing you press.
//
// The drag / edge-snap / @trnc_oli_pos code stays in OliGuide.js and is dormant while
// this row is in use. It is not dead: HOME_V2_LIVE can be false, and V1 still shows the
// FAB. It becomes deletable the day old Home is deleted, and not before.
//
// ─── SOLID TEAL, NOT A WHITE CARD ───────────────────────────────────────────
// As a small white card with a small avatar this had no presence at all — it read as a
// list row that happened to be above the grid, on a page whose every other surface is
// also a white card. Ask Oli is the one thing on Home that answers a question instead of
// navigating somewhere, and the brand colour is what says so.
//
// CONTRAST, MEASURED. White title on solid primary is 5.01:1. The subtitle wanted
// `primaryLight` for hierarchy and that lands at 4.44:1 — under the 4.5 AA floor for
// 13pt regular text, by a margin small enough to have been waved through on the grounds
// that it "looks fine on teal". It is #F2FAFA instead, a shade lighter, at 4.74:1.
// Hierarchy still comes from size and weight (17 bold against 13 regular), which is
// where it should come from anyway. (An earlier draft of this comment asserted 7.4:1 for
// the title, a figure nobody had computed; if these colours change, recompute.)
export default function OliRow({ lang, onPress }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.88} accessibilityRole="button">
      <Image source={require('../../assets/oli-button.png')} style={s.mascot} resizeMode="cover" />
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>{t('homeOliTitle', lang)}</Text>
        <Text style={s.sub} numberOfLines={2}>{t('homeOliSub', lang)}</Text>
      </View>
      {/* A filled circle rather than a bare chevron: on a saturated background a lone
          glyph reads as decoration, and this is the row's only affordance. */}
      <View style={s.chevron}>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // marginTop is the NEGATIVE of the hero's reserved overlap — imported, never retyped.
  // HomeHero pads its content by this same figure plus clearance, so the band this card
  // covers provably holds nothing tappable.
  row:     { flexDirection: 'row', alignItems: 'center', gap: 14,
             backgroundColor: colors.primary, borderRadius: 18,
             paddingVertical: 14, paddingHorizontal: 16,
             marginTop: -HERO_OVERLAP, marginHorizontal: 10, ...shadow },
  mascot:  { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryLight },
  text:    { flex: 1 },
  title:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  // #F2FAFA, not colors.primaryLight: see the contrast note above. A literal because
  // it exists to clear a threshold on ONE background, not as a palette entry.
  sub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#F2FAFA', marginTop: 2 },
  chevron: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
             justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
})
