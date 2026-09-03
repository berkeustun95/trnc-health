import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { HERO_OVERLAP, OLI_OVERHANG } from './homeLayout'

// The Oli entry point: a solid brand-teal banner overlapping the hero's bottom edge,
// with the mascot sitting ON it rather than inside it.
//
// ─── IT REPLACES THE FAB, IT DOES NOT JOIN IT ───────────────────────────────
// OliGuide's visibility condition in App.js is already `activeTab === 'home' && …` —
// Home and nowhere else. So the FAB has exactly one surface, and giving Home a second
// Oli entry point would mean two buttons for one sheet on the only screen either appears
// on. Under HOME_V2_LIVE the FAB is suppressed and this row is the entry.
//
// The SHEET is untouched: this calls straight into OliGuide's openSheet through a ref, so
// the chip set, resolveOliQuery matching, keyboard handling, hardware-back handler and
// accessibility modality all stay where they are. The drag / edge-snap / @trnc_oli_pos
// code stays there too, dormant, because HOME_V2_LIVE can be false and V1 still shows
// the FAB. It becomes deletable the day old Home is deleted, and not before.
//
// ─── THE MASCOT IS AN ABSOLUTE SIBLING OF THE CARD, AND THAT IS THREE FIXES ─
//
// He must rise above the banner's top edge, the banner must NOT grow to fit him, and his
// flat shoulder crop must not show. Those three pull against each other and the naive
// arrangements each break one:
//
//   • A taller Image inside the flex row GROWS the row. Explicitly forbidden.
//   • `overflow: 'hidden'` hides the flat crop but also clips the ears — it cannot both
//     let him break the top edge and clip the bottom.
//   • A child overflowing a view that carries `elevation` gets CLIPPED on Android, so he
//     cannot live inside the shadowed teal card at all.
//
// So: a transparent `wrap` holds the shadowed `card` (fixed height) and the mascot as an
// absolutely-positioned sibling. He is outside the elevated view, takes part in no
// layout, and cannot change the card's height. The flat crop needs no clipping because
// it is placed to coincide exactly with the card's bottom edge.
//
// ─── THE OFFSETS ARE DERIVED FROM THE ARTWORK, NOT EYEBALLED ────────────────
// oli-button.png is 1024x1024 with its content bounding box at x 26.6%..72.2%,
// y 5.4%..91.4% — measured from the alpha channel. Under resizeMode 'contain' in a
// square box those fractions hold, so:
//
//   bottom offset  -MASCOT_BOX * 0.086   puts the 91.4% crop line on the card's bottom
//   visible top     MASCOT_BOX * 0.054   below the box top
//
// which lands the visible mascot exactly OLI_OVERHANG above the card. If the artwork is
// ever re-exported with different margins, re-measure the bbox — these are its numbers,
// not arbitrary nudges.
const CARD_H       = 88
// Transparent slack above the card so the mascot's BOX (not its ink) never sits flush
// with the wrap's top edge, where Android would be entitled to clip it.
const HEADROOM     = 10
const MASCOT_BOX   = 132
const ASSET_TOP    = 0.054    // fraction of the asset above the artwork
const ASSET_BOTTOM = 0.086    // fraction below it
const WRAP_H       = CARD_H + OLI_OVERHANG + HEADROOM
// Where the text starts: clear of the mascot's widest point.
const TEXT_INSET   = 14 + Math.round(MASCOT_BOX * 0.722) + 12

export default function OliRow({ lang, onPress }) {
  return (
    <TouchableOpacity style={s.wrap} onPress={onPress} activeOpacity={0.88} accessibilityRole="button">
      <View style={s.card}>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={1}>{t('homeOliTitle', lang)}</Text>
          <Text style={s.sub} numberOfLines={2}>{t('homeOliSub', lang)}</Text>
        </View>
        {/* A filled circle rather than a bare chevron: on a saturated background a lone
            glyph reads as decoration, and this is the row's only affordance. */}
        <View style={s.chevron}>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </View>
      </View>

      <Image
        source={require('../../assets/oli-button.png')}
        style={s.mascot}
        resizeMode="contain"
        pointerEvents="none"
      />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // marginTop lifts the CARD's top edge to HERO_OVERLAP above the hero's bottom — the
  // wrap's own transparent headroom has to be added back, or the card would sit that
  // much lower than the hero reserved for it.
  wrap:    { height: WRAP_H, marginTop: -(HERO_OVERLAP + OLI_OVERHANG + HEADROOM),
             marginHorizontal: 10 },
  card:    { position: 'absolute', left: 0, right: 0, bottom: 0, height: CARD_H,
             flexDirection: 'row', alignItems: 'center', gap: 12,
             backgroundColor: colors.primary, borderRadius: 18,
             paddingLeft: TEXT_INSET, paddingRight: 16, ...shadow },
  // No disc, no borderRadius, no background — the whole point is that he is a cut-out.
  mascot:  { position: 'absolute', left: 14, bottom: -Math.round(MASCOT_BOX * ASSET_BOTTOM),
             width: MASCOT_BOX, height: MASCOT_BOX },
  text:    { flex: 1 },
  title:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  // #F2FAFA, not colors.primaryLight: primaryLight is 4.44:1 on primary, under the 4.5
  // floor for 13pt regular. This is 4.74:1. Title white on primary is 5.01:1.
  sub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#F2FAFA', marginTop: 2 },
  chevron: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
             justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
})

// Exported for the fold arithmetic in the log and for anything that needs to know how
// much vertical space this row actually consumes after its negative margin.
export const OLI_ROW_FLOW_HEIGHT = WRAP_H - (HERO_OVERLAP + OLI_OVERHANG + HEADROOM)
