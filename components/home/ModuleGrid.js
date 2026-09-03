import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'
import {
  HOME_MODULES, GRID_COLUMNS, GRID_LABEL_HEIGHT, GRID_LABEL_LINE_HEIGHT,
} from '../../constants/homeModules'

const TINTS = {
  urgent:    { bg: colors.tintUrgentBg,    fg: colors.tintUrgentFg    },
  service:   { bg: colors.tintServiceBg,   fg: colors.tintServiceFg   },
  lifestyle: { bg: colors.tintLifestyleBg, fg: colors.tintLifestyleFg },
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
// separating urgent from lifestyle at a glance.
//
// The label box is GRID_LABEL_HEIGHT tall in every state — one-word English and two-line
// Turkish occupy identical space — so the grid is the same shape in all nine locales and
// does not reflow when the language changes. numberOfLines={2} is the other half of
// that: without it a third line escapes the box instead of ellipsing.
export default function ModuleGrid({ lang, onPress }) {
  return (
    <View style={s.grid}>
      {HOME_MODULES.map(mod => {
        const tint = TINTS[mod.tint] || TINTS.service
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
  label:    { fontSize: 11, lineHeight: GRID_LABEL_LINE_HEIGHT, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, textAlign: 'center' },
})
