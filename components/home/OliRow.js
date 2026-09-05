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
// He must rise above the banner's top edge and the banner must NOT grow to fit him.
// Those pull against each other and the naive arrangements each break one:
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
// 132 -> 158 in round 6.
//
// ⚠ HIS BOTTOM WAS ALREADY ON THE CARD'S EDGE. The brief read as "he floats", and the
//   arithmetic said otherwise — ASSET_BOTTOM has pinned the artwork's lowest pixel to
//   the card's bottom since round 3. What actually made him hover is that the artwork
//   TAPERS: measured row by row, he is 116px wide at 86% of his height, 32px at 90%, and
//   0 at 91.3%. So the extreme point being on the edge left his visible MASS about 7pt
//   above it, resting on a wisp of bandana. The fix is size, not position — at 158 the
//   body is large enough that the taper is a small fraction of him and he reads as
//   standing on the row.
const MASCOT_BOX   = 158
const ASSET_TOP    = 0.054    // fraction of the asset above the artwork
const ASSET_BOTTOM = 0.086    // fraction below it
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
  // RECOMPUTED 2026-09-05 for the new type scale and the removed marginHorizontal — both
  // of which move these numbers, and a comment carrying a measured figure has to be
  // regenerated rather than left to age.
  //
  // Text block: title 16pt (~19.2 line) + subtitle 12pt x2 (~28.8) + 2pt margin = ~50pt,
  // centred in an 88pt card, so it occupies y 19..69 (was y 17..71 at the old sizes).
  // The card is now 361pt wide on a 393pt screen (was 341, before the 10pt inset went),
  // so the text's right edge is 361 - 16 padding - 34 chevron - 12 gap = 299 (was 279).
  //
  // Each shape must clear the text EITHER horizontally (start beyond 299) OR vertically
  // (stay below y=69).
  //
  // A wide, shallow arc along the bottom — the "wave". A disc of diameter 520 whose top
  // sits at y=76 shows only its crown, a soft swell across the middle of the card, now 7pt
  // below the lowest text (was 5pt — the smaller type gained 2pt). bottom is -508 because
  // a child's top lands at parentH - bottom - childH = 88 + 508 - 520 = 76.
  decorWave: { position: 'absolute', left: -90, bottom: -508, width: 520, height: 520,
               borderRadius: 260, backgroundColor: 'rgba(255,255,255,0.06)' },
  // A smaller swell in the right-hand strip, clear of the text horizontally: its left
  // edge lands at 361 + 10 - 64 = 307, beyond the text's 299. The margin grew from 8pt to
  // 8pt — both edges moved by 20, so the clearance is unchanged, which is the point of
  // positioning it from the card's own right edge rather than from a screen width.
  decorDot:  { position: 'absolute', right: -10, top: -24, width: 64, height: 64,
               borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.05)' },
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
  mascot:  { position: 'absolute', left: 14, bottom: -Math.round(MASCOT_BOX * ASSET_BOTTOM),
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
