import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { GRID_COLUMNS, GRID_LABEL_HEIGHT, GRID_LABEL_LINE_HEIGHT } from '../../constants/homeModules'
import { TILE_FONT_MANROPE } from '../../constants/flags'

// ─── THE LABEL'S FAMILY IS A FLAG, AND IT IS RESOLVED ONCE ──────────────────
// Both faces are registered in App.js — useFonts cannot be called conditionally — so this
// chooses which one the label NAMES. Measured before it was offered: Manrope Medium has
// identical script coverage to Inter (Arabic and Persian fall back to the system font in
// both) and is 2.1% narrower at the same weight, so no label needs new copy.
const LABEL_FAMILY = TILE_FONT_MANROPE ? 'Manrope_500Medium' : 'Inter_700Bold'

// ONE tile, rendered identically by the module grid and the favourites row.
//
// ─── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
//
// The favourites row is specified as "the same bare-icon treatment as the grid, the same
// coral/teal urgency tint, the same fixed two-line label height". Written twice, those
// three sentences are true on the day they are written and quietly false afterwards —
// the two rows sit ten lines apart on one screen, so any drift is visible to every user
// and invisible in review. Extracting the tile makes "the same" a property of the code
// rather than a claim in a comment.
//
// It carries NO knowledge of any module. It takes a config row from
// constants/homeModules.js and renders it, exactly as ModuleGrid did — so a consolidation
// pass that removes six modules still touches only that array.

// TWO families, matching the `tint` vocabulary in constants/homeModules.js. This map is
// the whole of the grid's colour logic — there is no module id anywhere in this file, so
// recolouring a module is an edit to its data row and nothing else.
//
// Equal strength on both, deliberately: each is a pale background carrying a saturated
// icon at the same weight, so `standard` reads as "not urgent" rather than as disabled.
// MEASURED, not asserted — urgent is 3.75:1 on its own background, standard 4.44:1, a
// gap of 0.70. Both clear the 3:1 minimum for a UI component and they are close enough
// that neither family reads as recessed beside the other. (An earlier draft of this
// comment claimed 4.79 and 5.09, which were numbers nobody had computed. If these pairs
// are ever retuned, recompute rather than adjust the sentence.)
export const TINTS = {
  urgent:   { bg: colors.tintUrgentBg,  fg: colors.tintUrgentFg  },
  standard: { bg: colors.tintServiceBg, fg: colors.tintServiceFg },
}

// `width` is a PROP rather than a constant, and that is the only difference between the
// grid's tile and the favourites row's. Both rows are 4-across today and both pass
// `${100/GRID_COLUMNS}%`, but the grid's width is a consequence of GRID_COLUMNS while the
// row's is a consequence of FAVOURITE_SLOTS — two numbers that happen to be equal, not one
// number used twice. Passing it keeps that honest.
// ─── labelOverride: A PROP, NEVER A LOOKUP ──────────────────────────────────
//
// One module (Ev Hizmetleri) shows a partner's full phrase on the GRID and its short name
// everywhere else. This file could have read `mod.gridLabel` itself — and must not. The
// header above commits to carrying no knowledge of any module and no knowledge of which
// row it is drawn in; reading a field named `grid*` here would quietly break the second
// half of that, because the favourites row renders this same component and would then
// have to be told to ignore it. So ModuleGrid passes the override and the two favourites
// surfaces simply do not.
//
// ⚠ lineHeight is DERIVED from GRID_LABEL_HEIGHT, not supplied. That is what guarantees a
//   3-line label occupies exactly the same 32pt box as a 2-line one, so an override can
//   never change a row's height and the grid keeps one rhythm in all nine locales. An
//   override that could set its own lineHeight would be an override that could push one
//   tile taller than its neighbours — the thing the fixed box exists to prevent.
export default function ModuleTile({ mod, lang, onPress, width = `${100 / GRID_COLUMNS}%`, trailing, labelOverride }) {
  // Falls back to `standard`, which is the one that still exists — an older fallback
  // named `service`, a key the two-family rewrite removed, so an unknown tint would have
  // crashed on `tint.bg` instead of degrading to teal.
  const tint     = TINTS[mod.tint] || TINTS.standard
  const labelKey = labelOverride?.key ?? mod.labelKey
  const lines    = labelOverride?.lines ?? 2
  return (
    <TouchableOpacity
      style={[s.tile, { width }]}
      onPress={() => onPress(mod)}
      activeOpacity={0.7}
      accessibilityRole="button"
      // The RESOLVED label, not mod.labelKey: a screen reader must announce the tile a
      // sighted user is looking at, and on the grid that is the partner's full phrase.
      accessibilityLabel={t(labelKey, lang)}
    >
      <View style={[s.icon, { backgroundColor: tint.bg }]}>
        <Ionicons name={mod.icon} size={24} color={tint.fg} />
      </View>
      {/* The edit sheet's check/pin marker. A render prop rather than a boolean, so this
          file never learns what a pin is — it only knows something may sit on the icon. */}
      {trailing}
      <View style={s.labelBox}>
        <Text
          style={[s.label, labelOverride && {
            fontSize: labelOverride.size,
            lineHeight: GRID_LABEL_HEIGHT / lines,
          }]}
          numberOfLines={lines}
        >
          {t(labelKey, lang)}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  tile:     { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2 },
  icon:     { width: 52, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  // ─── THE LABEL BOX IS A FIXED HEIGHT IN EVERY STATE ───────────────────────
  // One-word English and two-line Turkish occupy identical space, so a row is the same
  // shape in all nine locales and does not reflow when the language changes.
  // numberOfLines={2} on the Text is the other half: without it a third line escapes the
  // box instead of ellipsing.
  labelBox: { height: GRID_LABEL_HEIGHT, justifyContent: 'flex-start', alignSelf: 'stretch' },
  // ─── Inter_500Medium ──────────────────────────────────────────────────────
  // Medium rather than SemiBold because these are 11pt labels under a 52pt tinted icon —
  // the icon is the tile's signal and the label names it. At 600 nineteen labels start
  // competing with the icons for weight, which is the "wall" the bare-icon grid exists to
  // undo.
  //
  // ⚠ THE FACE MUST STAY REGISTERED IN App.js. This block previously named
  //   Inter_600SemiBold while useFonts registered only 400 and 700; React Native cannot
  //   find an unregistered family and silently substitutes the platform default, so these
  //   labels drew in Roboto with no error anywhere. `npm run home:check` section C now
  //   asserts the registration.
  //
  // Colour is #3F4E57, softer than textPrimary's near-black at 8.24:1 on the canvas.
  label:    { fontSize: 11, lineHeight: GRID_LABEL_LINE_HEIGHT, fontFamily: LABEL_FAMILY, color: '#3F4E57', textAlign: 'center' },
})
