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
const MIN_TARGET = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }
const ICON = 24

export default function BackButton({
  variant = 'labelled',   // 'labelled' | 'bare' | 'hero'
  label,                  // overrides the default t('back') — BusRoutes passes a title
  lang,
  onPress,
  style,
  accessibilityLabel,
}) {
  const text = label ?? t('back', lang)

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? text}
      style={[s.base, style]}
    >
      <Ionicons
        name="chevron-back"
        size={ICON}
        // 'hero' differs from 'bare' ONLY in colour: these two sit over a photo
        // rather than a header. See the legibility note at the call sites.
        color={variant === 'hero' ? '#FFFFFF' : colors.textPrimary}
      />
      {/* numberOfLines guards the constrained call sites: BusRoutes caps its pill at
          120px and passes a module title, not "Back" — 'Transportation' at 15px plus
          the 24px chevron overflows that and would wrap, breaking the 44px row. */}
      {variant === 'labelled' ? <Text style={s.label} numberOfLines={1}>{text}</Text> : null}
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
  label: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, flexShrink: 1 },
})
