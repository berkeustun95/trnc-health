import { TouchableOpacity, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

// The app's single back control. Replaces five ad-hoc variants (chevron-back at
// 18/20/22, arrow-back at 24, Feather arrow-left at 16/24) across ~35 files.
//
// WHY 44 LIVES ON THE VIEW, NOT ONLY IN hitSlop: not one back button in the app
// reached the 44x44 HIG/Material minimum — the tallest was 24px, most were 20.
// hitSlop alone is not a fix: on Android it does not extend past an ancestor's
// bounds, so inside a tight header row it silently collapses back to the visual
// box. The box itself is therefore >= 44 and hitSlop is additive on top.
//
// NO SHADOW, NO ELEVATION — deliberate, and asserted here so it cannot creep
// back in. Auditing the old call sites found zero shadowed back buttons, so the
// tester's "drop shadow" report was never about this; the real defects were the
// five inconsistent variants and the sub-44 targets.
const MIN_TARGET = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }
const ICON = 24

// One diameter and one alpha for the floating chips over hero photos. They were
// 38px @ rgba(0,0,0,0.35) on Explore and 36px @ 0.45 on Property — visibly two
// different controls doing one job.
const HERO_SIZE = 44
const HERO_SCRIM = 'rgba(0,0,0,0.40)'

export default function BackButton({
  variant = 'labelled',   // 'labelled' | 'bare' | 'hero'
  label,                  // overrides the default t('back') — BusRoutes passes a title
  lang,
  onPress,
  style,
  accessibilityLabel,
}) {
  const hero = variant === 'hero'
  const text = label ?? t('back', lang)

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? text}
      style={[s.base, hero ? s.hero : s.inline, style]}
    >
      <Ionicons
        name="chevron-back"
        size={ICON}
        color={hero ? '#FFFFFF' : colors.textPrimary}
      />
      {/* numberOfLines guards the constrained call sites: BusRoutes caps its pill at
          120px and passes a module title, not "Back" — 'Transportation' at 15px plus
          the 24px chevron overflows that and would wrap, breaking the 44px row. */}
      {variant === 'labelled' ? <Text style={s.label} numberOfLines={1}>{text}</Text> : null}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  base:   { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  // Left-aligned, not centred: centring a 24px glyph inside the 44px box would
  // start it 10px in from the container edge, visibly indenting every back button
  // against where the old 20/24px icons sat. The box still grows rightward to keep
  // the target, which costs nothing — it grows toward the title, not the margin.
  inline: { flexDirection: 'row', minWidth: MIN_TARGET, justifyContent: 'flex-start' },
  label:  { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, flexShrink: 1 },
  hero:   { width: HERO_SIZE, height: HERO_SIZE, borderRadius: HERO_SIZE / 2,
            backgroundColor: HERO_SCRIM,
            // Optical centring: chevron-back's glyph sits right of the box centre.
            paddingRight: 2 },
})
