import { View, StyleSheet } from 'react-native'
import { HOME_MODULES, GRID_COLUMNS, HIDDEN_TILES } from '../../constants/homeModules'
import ModuleTile from './ModuleTile'

// Tüm modüller — every module, four across, bare icons.
//
// ─── THIS COMPONENT KNOWS NOTHING ABOUT ANY MODULE ──────────────────────────
// It renders constants/homeModules.js. There is no per-module branch here, no
// conditional tile, no special case — a consolidation pass that removes six modules and
// merges four others touches that config array and this file not at all. That is the
// whole reason the list is not inline.
//
// ─── AND IT NO LONGER KNOWS WHAT A TILE LOOKS LIKE EITHER ───────────────────
// The tile moved to ModuleTile.js in Slice 3, so the favourites row above can render the
// same thing rather than a copy of it. This file is now only the LAYOUT: how many across,
// and in what order.
//
// ─── BARE ICONS, NO CARDS ───────────────────────────────────────────────────
// No cards and no shadows: nineteen white cards with nineteen drop shadows is what made
// the V1 grid feel like a wall. The tint square stays because it is the only thing
// separating urgent from everything else at a glance.
//
// ⚠ THE GRID SHOWS EVERY MODULE TO EVERY USER, INCLUDING DARK ONES, AND THAT IS NOT AN
//   OVERSIGHT TO BE "FIXED" WHILE ADDING FAVOURITES. A dark tile routes to Coming Soon
//   through the gates in App.js, which is the towing lesson: a flag-gated entry point
//   hides the very demand the flag is waiting for (towing collected exactly zero waitlist
//   signups because nobody could reach its Coming Soon screen to sign up).
//
//   The favourites row above applies the OPPOSITE rule and filters dark modules out. The
//   two are not inconsistent: this grid is the app's navigation and must be complete,
//   while a favourite claims "this is what you reach for", which Coming Soon is not.
//   Neither rule belongs in the other row.
export default function ModuleGrid({ lang, onPress }) {
  return (
    <View style={s.grid}>
      {/* HIDDEN_TILES is the ONLY filter in this grid, and it is a visibility decision
          rather than a readiness one — see its note in constants/homeModules.js. Dark
          modules still render, deliberately. */}
      {HOME_MODULES.filter(mod => !HIDDEN_TILES.has(mod.id)).map(mod => (
        <ModuleTile
          key={mod.id}
          mod={mod}
          lang={lang}
          onPress={onPress}
          // Percentage width rather than a computed pixel width: the grid then survives a
          // rotation or a split-screen resize without a re-measure, and GRID_COLUMNS stays
          // the single number that decides the shape.
          width={`${100 / GRID_COLUMNS}%`}
        />
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
})
