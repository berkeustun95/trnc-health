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
// He must fit INSIDE the banner and the banner must NOT grow to fit him. (Until
// 2026-09-07 the first half was the opposite — he rose ABOVE its top edge as a cut-out —
// which is why the arrangement below is built the way it is. It still holds, and for the
// same two reasons, but the premise it was written under has been inverted.)
// These pull against each other and the naive arrangements each break one:
//
//   • A taller Image inside the flex row GROWS the row. Explicitly forbidden.
//   • A child overflowing a view that carries `elevation` gets CLIPPED on Android, so he
//     cannot live inside the shadowed teal card at all — and the card needs
//     `overflow: 'hidden'` of its own to clip the decoration, which would clip him too.
//
// So: a transparent `wrap` holds the shadowed `card` (fixed height) and the mascot as an
// absolutely-positioned sibling. He is outside the elevated, clipping view, takes part in
// no layout, and cannot change the card's height.
//
// ─── THE OFFSETS ARE DERIVED FROM THE ARTWORK, NOT EYEBALLED ────────────────
// oli-button.png is 1024x1024 with its content bounding box at x 26.6%..72.2%,
// y 5.4%..91.4% — measured from the alpha channel. Under resizeMode 'contain' in a
// square box those fractions hold, so:
//
//   bottom offset  MASCOT_INSET - MASCOT_BOX * 0.086   puts his FEET (the 91.4% crop
//                                                        line) MASCOT_INSET above the
//                                                        card's bottom edge
//   visible top     MASCOT_BOX * 0.054                   below the box top
//
// which lands the visible mascot wholly inside the card. The offset used to be plain
// -MASCOT_BOX * 0.086, pinning his feet flush to the card's bottom — right when he stood
// ON the banner, and a clipped look now that he stands IN it.
//
// If the artwork is ever re-exported with different margins, re-measure the bbox — these
// are its numbers, not arbitrary nudges. `npm run home:check` asserts the offset keeps
// this form.
const CARD_H       = 88
// Transparent slack above the card, for when the mascot's BOX overflowed it. It does not
// any more — he is entirely inside the card — so there is nothing to keep clear of the
// wrap's top edge and this is zero. Kept as a named constant because WRAP_H and the wrap's
// negative margin are both derived from it, and because a future taller mascot needs it
// back rather than needing it reinvented.
const HEADROOM     = 0
// 158 -> 88 on 2026-09-07. He no longer stands ON the banner breaking its top line; he
// sits INSIDE it.
//
// ⚠ THE NUMBER IS SOLVED, NOT PICKED. His artwork occupies (1 - ASSET_TOP - ASSET_BOTTOM)
//   = 0.860 of the box, and it has to fit inside an 88pt card with room to breathe at both
//   ends. At 88 the artwork is 75.7pt: standing on a 6pt inset it reaches 81.7, clearing
//   the card's top edge by 6.3pt — near-symmetric padding above and below, which is what
//   "inside the card" has to mean if it is not to look dropped in.
//
//   The next size up that still fits is 92 (2.9pt of headroom), which is inside the
//   rounding noise of a device's pixel grid. 88 is the largest he can be and still read as
//   deliberately placed rather than jammed.
//
//   He is now 40pt of ink wide by 76 tall, down from 72 x 136.
const MASCOT_BOX   = 88
// How far his feet sit above the card's bottom edge. He used to be pinned flush to it,
// which was right when he was standing ON the card and wrong now that he is in it —
// resting on the edge from the inside reads as clipped.
const MASCOT_INSET = 6
const ASSET_TOP    = 0.054    // fraction of the asset above the artwork
const ASSET_BOTTOM = 0.086    // fraction below it
// With no overhang and no headroom this is simply the card. The expression is kept in
// derived form rather than collapsed to CARD_H so that restoring either constant restores
// the geometry, instead of quietly doing nothing.
const WRAP_H       = CARD_H + OLI_OVERHANG + HEADROOM
// Where the text starts: clear of the mascot's widest point.
const TEXT_INSET   = 14 + Math.round(MASCOT_BOX * 0.722) + 12

export default function OliRow({ lang, onPress }) {
  return (
    <TouchableOpacity style={s.wrap} onPress={onPress} activeOpacity={0.88} accessibilityRole="button">
      <View style={s.card}>
        {/* ─── DECORATION: TWO SOFT DISCS, AND THEY STAY OFF THE TEXT ────────
            The brief asked for a lighter-teal motif behind the text. The contrast budget
            forbids it, and the arithmetic is not close: white on primary is 5.01:1 and
            the subtitle 4.74:1, so lightening the card by even 3% white takes the
            subtitle to 4.23:1 — under the floor — while being barely visible. The only
            alpha that keeps 4.5:1 is 0.012, which is nothing at all.

            So the decoration lives where the text does not: a shallow wave whose crown
            sits BELOW the lowest text line, and a disc in the right-hand strip BEYOND the
            text's right edge. Both clipped by `overflow: 'hidden'`. The band behind the
            title and subtitle is untouched flat primary, so both keep their measured
            figures exactly — 5.01:1 and 4.74:1, unchanged rather than assumed.

            Views with borderRadius rather than SVG: react-native-svg is not installed and
            this repo does not add packages for decoration. */}
        <View style={s.decorWave} pointerEvents="none" />
        <View style={s.decorWave2} pointerEvents="none" />
        <View style={s.decorDot} pointerEvents="none" />

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
  // ─── NO marginHorizontal — IT USED TO BE 10, AND THAT WAS A MISALIGNMENT ──
  // v2Below already insets this whole column by 16pt. A further 10 here put the Oli
  // card's edges 26pt from the screen while the live strip, the Nöbetçi row and the
  // module grid all sit at 16 — so the one card with a shadow and a mascot was also the
  // one card that did not line up with anything, which is what made the top of the
  // screen read as slightly loose. Nothing depended on the number: TEXT_INSET is derived
  // from MASCOT_BOX, and the decoration is positioned from the card's own edges.
  wrap:    { height: WRAP_H, marginTop: -(HERO_OVERLAP + OLI_OVERHANG + HEADROOM) },
  // overflow:'hidden' clips the decoration to the card's rounded shape. Safe now only
  // because the mascot is a SIBLING, not a child — as a child he would be clipped too.
  card:    { position: 'absolute', left: 0, right: 0, bottom: 0, height: CARD_H,
             flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden',
             backgroundColor: colors.primary, borderRadius: 18,
             paddingLeft: TEXT_INSET, paddingRight: 16, ...shadow },
  // ─── Decoration geometry, and it is checked, not eyeballed ────────────────
  //
  // RECOMPUTED 2026-09-07. Two things moved it: the type scale, and the card growing 20pt
  // wider when its stray horizontal margin went. A comment carrying a measured figure has
  // to be regenerated rather than left to age.
  //
  // Text block: title 16pt (~19.2 line) + subtitle 12pt x2 (~28.8) + 2pt margin = ~50pt,
  // centred in an 88pt card, so it occupies y 19..69. The card is 361pt wide on a 393pt
  // screen, so the text's right edge is 361 - 16 padding - 34 chevron - 12 gap = 299.
  //
  // ⚠ THE CONSTRAINT IS UNCHANGED AND IS NOT NEGOTIABLE: every shape must clear the text
  //   EITHER horizontally (start beyond its right edge) OR vertically (stay below y=69).
  //   Lightening the card behind the text is what the contrast budget forbids — white on
  //   primary is 5.01:1 and the subtitle 4.74:1, so even 3% of white takes the subtitle to
  //   4.23:1, under the floor, while being barely visible. The band behind the text stays
  //   flat primary and both figures hold exactly.
  //
  // ─── WHAT CHANGED: MORE PRESENT, SAME CONSTRAINT ──────────────────────────
  //
  // The old motif was one 6%-white crown and one 5% disc, which at that strength read as a
  // printing artefact rather than as decoration. This is two crowns of DIFFERENT curvature
  // (520 and 620 diameter) crossing at slightly different heights, plus a stronger corner
  // swell — a layered wave with an actual shape to it, at 11% / 8% / 9%.
  //
  // Both crowns sit BELOW the text: a disc of diameter D whose top is at y=T needs
  // bottom = 88 - D - T, so 74 and 82 give 5pt and 13pt of clearance under the lowest text
  // line. Two diameters rather than two offsets of one, because parallel arcs of equal
  // curvature read as a mistake and crossing arcs read as drawn.
  //
  // The corner disc is positioned from the card's RIGHT edge, which makes its clearance
  // device-independent by construction: its left edge lands at cardW - 58 while the text
  // ends at cardW - 62, so the 4pt gap holds at 393dp and at 320dp without a second
  // measurement. That property is the reason it is anchored right rather than left.
  //
  // Views with borderRadius rather than SVG: react-native-svg is not installed and this
  // repo does not add packages for decoration.
  decorWave: { position: 'absolute', left: -90, bottom: -506, width: 520, height: 520,
               borderRadius: 260, backgroundColor: 'rgba(255,255,255,0.11)' },
  decorWave2:{ position: 'absolute', left: -180, bottom: -614, width: 620, height: 620,
               borderRadius: 310, backgroundColor: 'rgba(255,255,255,0.08)' },
  decorDot:  { position: 'absolute', right: -22, top: -40, width: 80, height: 80,
               borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.09)' },
  // ─── RESTORED IN ROUND 7 AFTER A SCRIPTED EDIT DELETED IT ─────────────────
  // Round 6's decoration edit replaced a slice running from a comment down to
  // `text:` — and this style sat inside that range, so it was removed silently. With
  // `s.mascot` undefined, `<Image style={undefined}>` falls back to the asset's
  // INTRINSIC size: 1024x1024dp, unpositioned. He covered the grid and the tab bar.
  //
  // Nothing complained. JS has no error for a missing style key, and the failure is not
  // "a bit off" but three orders of magnitude — which is why scripts/check-home-geometry.mjs
  // now asserts that every `s.X` used in these components is actually defined. Same
  // family as the logo's `contain` bug: a size that is not what anyone thinks it is.
  //
  // No disc, no borderRadius, no background — the whole point is that he is a cut-out.
  // ─── POSITIONED FROM HIS INK, NOT HIS BOX ────────────────────────────────
  // The asset carries transparent margins (ASSET_BOTTOM of the box sits below the lowest
  // pixel), so pinning the BOX to a position puts the visible mascot somewhere else. This
  // offsets by that margin, which places his FEET exactly MASCOT_INSET above the card's
  // bottom edge — the thing the design is actually about.
  mascot:  { position: 'absolute', left: 14, bottom: MASCOT_INSET - Math.round(MASCOT_BOX * ASSET_BOTTOM),
             width: MASCOT_BOX, height: MASCOT_BOX },
  text:    { flex: 1 },
  // 16/600 — the shared ROW TITLE step. Oli, the live strip and the Nöbetçi row are
  // peers, and they were 17 / 16 / 15, which read as three sizes for one job. White on
  // primary is 5.01:1, unchanged by the size (contrast is a property of the two colours,
  // and nothing here leans on WCAG's large-text exemption).
  title:   { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  // 12/400 — the shared ROW SUBTITLE step (was 13, while the strip and Nöbetçi rows
  // were both already 12).
  //
  // #F2FAFA, not colors.primaryLight: primaryLight is 4.44:1 on primary, under the 4.5
  // floor. This is 4.74:1 — RE-MEASURED after the size change, not assumed: 12pt regular
  // sits under the same 4.5 floor as 13pt did, so the figure still clears it.
  sub:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#F2FAFA', marginTop: 2 },
  chevron: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
             justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
})

// Exported for the fold arithmetic in the log and for anything that needs to know how
// much vertical space this row actually consumes after its negative margin.
export const OLI_ROW_FLOW_HEIGHT = WRAP_H - (HERO_OVERLAP + OLI_OVERHANG + HEADROOM)
