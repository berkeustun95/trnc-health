import { TouchableOpacity, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// The app's single back control. Replaces five ad-hoc variants (chevron-back at
// 18/20/22, arrow-back 24, Feather arrow-left at 16/24) across ~35 files.
//
// NO CONTAINER. The glyph sits bare on the header — no chip, no circle, no fill,
// no border, no shadow, no elevation. The only box here is an invisible one that
// exists purely to carry the touch target. Asserted in this comment so it cannot
// creep back in: any backgroundColor or borderRadius reaching this component is
// a regression, whether it is added here or passed in via `style`.
//
// WHY 44 LIVES ON THE VIEW, NOT ONLY IN hitSlop: not one back button in the app
// reached the 44x44 HIG/Material minimum — the tallest was 24px, most were 20.
// hitSlop alone is not a fix: on Android it does not extend past an ancestor's
// bounds, so inside a tight header row it silently collapses back to the visual
// box. The box itself is therefore >= 44 and hitSlop is additive on top.
// Legibility over photography. A ZERO offset makes this a soft halo in every
// direction rather than a drop shadow with a light source — it separates the
// glyph from a background that does not contrast, and is effectively invisible
// against one that already does. The halo is always the INVERSE of the glyph:
// white glyphs over photos get a dark one, the dark glyph over Home's artwork
// gets a light one, because those two fail in opposite directions.
const HALO_DARK  = { textShadowColor: 'rgba(0,0,0,0.55)',       textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 }
const HALO_LIGHT = { textShadowColor: 'rgba(255,255,255,0.85)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 }

const MIN_TARGET = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }
const ICON = 24

export default function BackButton({
  variant = 'labelled',   // 'labelled' | 'bare' | 'hero'
  onImage = false,        // sits over a photo/artwork — adds the legibility halo.
                          // 'hero' implies it; Home's facility-list back opts in.
  label,                  // overrides the default t('back') — BusRoutes passes a title
  lang,
  onPress,
  style,
  accessibilityLabel,
  onLayout,            // passthrough; TouchableOpacity supports it and callers may measure
}) {
  const text = label ?? t('back', lang)
  const hero = variant === 'hero'
  // Inverse of the glyph colour, or nothing at all on a solid header.
  const halo = (onImage || hero) ? (hero ? HALO_DARK : HALO_LIGHT) : null

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? text}
      style={[s.base, style]}
      onLayout={onLayout}
    >
      <Ionicons
        name="chevron-back"
        size={ICON}
        // 'hero' differs from 'bare' ONLY in colour: these two sit over a photo
        // rather than a header. See the legibility note at the call sites.
        color={hero ? '#FFFFFF' : colors.textPrimary}
        style={halo}
      />
      {/* numberOfLines guards the constrained call sites: BusRoutes caps its pill at
          120px and passes a module title, not "Back" — 'Transportation' at 15px plus
          the 24px chevron overflows that and would wrap, breaking the 44px row. */}
      {variant === 'labelled'
        ? <Text style={[s.label, halo]} numberOfLines={1}>{text}</Text>
        : null}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // Left-aligned, not centred: centring a 24px glyph inside the 44px box would
  // start it 10px in from the container edge, visibly indenting every back button
  // against where the old 20/24px icons sat. The box still grows rightward to keep
  // the target, which costs nothing — it grows toward the title, not the margin.
  //
  // `gap` belongs here, not at the call sites. It used to come from each site's own
  // pill style; with those stripped, the icon and label would otherwise touch.
  base:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
           minHeight: MIN_TARGET, minWidth: MIN_TARGET, gap: 2 },
  // ─── WHY THIS IS A PADDING AND NOT flexGrow ────────────────────────────────
  //
  // The label clips without help. Measured on device 2026-09-19: ScreenHeader's back
  // column is 70.0dp, the chevron's advance is exactly 1.0 em (24.00dp at size 24, read
  // from Ionicons.ttf), "Geri" is 29.22dp in Inter_400Regular at 15px — and the audit
  // reported the Text was GIVEN 29.9dp and ellipsized anyway, with ~14dp spare in the row.
  // Because flexBasis is auto, a Text is allocated EXACTLY its own measured width, and it
  // has no tolerance at all for the measure pass and the draw pass disagreeing.
  //
  // ► flexGrow: 1 WAS THE FIRST FIX AND IT BROKE EVERY HEADER IN THE APP.
  //   Yoga measures an auto-width container against the space AVAILABLE to it. A flexGrow
  //   child inside consumes that available space, so BackButton's measured content width
  //   became the FULL header width — the title was pushed out and clipped, and the
  //   right-hand buttons disappeared entirely. It is not that the fix was too aggressive
  //   on a crowded header; an auto-sized box containing a growing child is unbounded by
  //   construction, and the one header I measured simply had nothing to its right to lose.
  //
  //   The tolerance therefore has to be BOUNDED. 2dp of padding adds 2dp to this Text and
  //   to nothing else: it cannot consume a row, and it cannot vary with what is beside it.
  //   flexShrink stays, so a genuinely constrained call site (BusRoutes caps its pill at
  //   maxWidth 120 and passes a module title) still ellipsizes rather than overflowing.
  label: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary,
           flexShrink: 1, paddingRight: 2 },
})
