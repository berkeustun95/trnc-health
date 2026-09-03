import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import {
  HOME_MODULES, GRID_COLUMNS, GRID_LABEL_HEIGHT, GRID_LABEL_LINE_HEIGHT,
} from '../../constants/homeModules'

// TWO families, matching the `tint` vocabulary in constants/homeModules.js. This map is
// the whole of the grid's colour logic — there is no module id anywhere in this file, so
// recolouring a module is an edit to its data row and nothing else.
//
// Equal strength on both, deliberately: each is a pale background carrying a saturated
// icon at the same weight, so `standard` reads as "not urgent" rather than as disabled.
// MEASURED, not asserted — urgent is 3.75:1 on its own background, standard 4.44:1, a
// gap of 0.70. Both clear the 3:1 minimum for a UI component and they are close enough
// that neither family reads as recessed beside the other. (The first draft of this
// comment claimed 4.79 and 5.09, which were numbers nobody had computed. If these pairs
// are ever retuned, recompute rather than adjust the sentence.)
const TINTS = {
  urgent:   { bg: colors.tintUrgentBg,  fg: colors.tintUrgentFg  },
  standard: { bg: colors.tintServiceBg, fg: colors.tintServiceFg },
}

// Tüm modüller — every module, four across, bare icons.
//
// ─── THIS COMPONENT KNOWS NOTHING ABOUT ANY MODULE ──────────────────────────
// It renders constants/homeModules.js. There is no per-module branch here, no
// conditional tile, no special case — a consolidation pass that removes six modules and
// merges four others touches that config array and this file not at all. That is the
// whole reason the list is not inline.
//
// ─── BARE ICONS, AND THE LABEL BOX IS A FIXED HEIGHT ────────────────────────
// No cards and no shadows: nineteen white cards with nineteen drop shadows is what made
// the V1 grid feel like a wall. The tint square stays because it is the only thing
// separating urgent from everything else at a glance.
//
// The label box is GRID_LABEL_HEIGHT tall in every state — one-word English and two-line
// Turkish occupy identical space — so the grid is the same shape in all nine locales and
// does not reflow when the language changes. numberOfLines={2} is the other half of
// that: without it a third line escapes the box instead of ellipsing.
export default function ModuleGrid({ lang, onPress }) {
  return (
    <View style={s.grid}>
      {HOME_MODULES.map(mod => {
        // Falls back to `standard`, which is the one that still exists — the old
        // fallback named `service`, a key the two-family rewrite removed, so an unknown
        // tint would have crashed on `tint.bg` instead of degrading to teal.
        const tint = TINTS[mod.tint] || TINTS.standard
        return (
          <TouchableOpacity
            key={mod.id}
            style={s.tile}
            onPress={() => onPress(mod)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t(mod.labelKey, lang)}
          >
            <View style={[s.icon, { backgroundColor: tint.bg }]}>
              <Ionicons name={mod.icon} size={24} color={tint.fg} />
            </View>
            <View style={s.labelBox}>
              <Text style={s.label} numberOfLines={2}>{t(mod.labelKey, lang)}</Text>
            </View>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  // Percentage width rather than a computed pixel width: the grid then survives a
  // rotation or a split-screen resize without a re-measure, and GRID_COLUMNS stays the
  // single number that decides the shape.
  tile:     { width: `${100 / GRID_COLUMNS}%`, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2 },
  icon:     { width: 52, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  labelBox: { height: GRID_LABEL_HEIGHT, justifyContent: 'flex-start', alignSelf: 'stretch' },
  // ─── Inter_400Regular, AND THAT IS A BUG FIX, NOT A STYLE CHOICE ──────────
  // This said Inter_600SemiBold, which App.js DOES NOT LOAD — useFonts registers only
  // Inter_400Regular and Inter_700Bold. React Native cannot find an unregistered family
  // and silently falls back to the platform default (Roboto on Android), so these labels
  // were never rendering in Inter at all. That is exactly the "heavier and more cramped
  // than the draft" symptom: a different typeface at a different apparent weight, with
  // no error anywhere to say so.
  //
  // Regular is also what the draft wants, so the fix and the intent agree. Registering
  // the SemiBold face instead would pull a font file into the bundle and restyle the six
  // other files that reference it — a separate decision, noted in the log.
  //
  // Colour is #3F4E57, softer than textPrimary's near-black at 8.24:1 on the canvas.
  label:    { fontSize: 11, lineHeight: GRID_LABEL_LINE_HEIGHT, fontFamily: 'Inter_400Regular', color: '#3F4E57', textAlign: 'center' },
})
