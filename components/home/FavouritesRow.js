import { View, StyleSheet } from 'react-native'
import { HOME_MODULES } from '../../constants/homeModules'
import { FAVOURITE_SLOTS } from '../../constants/homeFavourites'
import ModuleTile from './ModuleTile'

// Sık kullandıkların — four tiles, the same ones the grid draws.
//
// ─── IT RENDERS ModuleTile, IT DOES NOT RESEMBLE IT ─────────────────────────
// Bare icon, urgency tint from `mod.tint`, fixed two-line label box: all of it comes from
// the shared component, so this row cannot drift from the grid ten lines below it. The
// only thing decided here is how wide a tile is, and that is FAVOURITE_SLOTS rather than
// GRID_COLUMNS — two numbers that happen both to be 4 today and mean different things.
//
// ─── THE ROW CANNOT COME UP EMPTY ───────────────────────────────────────────
// There is no empty branch here and no early return, which matters because the section
// heading sits in HomeScreen (so all three headings share one token) and would otherwise
// be left standing over nothing. The guarantee is upstream and structural:
// UNGATED_MODULES holds seven ids no flag can switch off, so the auto-fill pool is never
// smaller than seven whatever is stored, whatever the flags say and whatever the network
// is doing — and `npm run home:check` recomputes that against an all-false flag set on
// every run rather than trusting this paragraph.
//
// ─── ORDER IS FIXED FOR THE LIFE OF THE MOUNT ───────────────────────────────
// `ids` is resolved once by HomeScreen and passed down. Tapping a tile records a count and
// navigates; it does NOT re-sort the row under the user's thumb. See the note at the
// resolve site in HomeScreen for why a foreground listener was rejected.
export default function FavouritesRow({ ids, lang, onPress }) {
  const byId = new Map(HOME_MODULES.map(m => [m.id, m]))
  return (
    <View style={s.row}>
      {ids.map(id => {
        const mod = byId.get(id)
        // Belt and braces: resolveFavourites only ever returns ids that exist in
        // HOME_MODULES, so this cannot fire today. It stays because the alternative to a
        // skipped tile is `mod.tint` throwing on undefined and taking the whole Home
        // screen down — and this row's entire job is to render ids that came out of
        // storage on a device we have never seen.
        if (!mod) return null
        return (
          <ModuleTile
            key={id}
            mod={mod}
            lang={lang}
            onPress={onPress}
            width={`${100 / FAVOURITE_SLOTS}%`}
            // ─── THE FULL PHRASE, SAME AS THE GRID ──────────────────────────
            //
            // Added 2026-09-13. The module has two names and users were hitting the seam:
            // the grid read "Tadilat · Bakım · Onarım" and this row, ten lines above it on
            // the same screen, read "Tadilat".
            //
            // The original split was drawn in the wrong place. It was justified by the
            // edit sheet's slot PREVIEW, a 56pt box at 320dp that would need 7.31pt type —
            // and that constraint is real, but it belongs to the sheet, not here. This row
            // is a surface a user READS; the sheet's slots are chips inside a picker. They
            // do not have to agree, and the row should agree with the grid instead.
            //
            // ⚠ NO EXTRA WIDTH HERE, DESPITE APPEARANCES. Four tiles rather than sixteen
            //   suggests a wider tile, and it is not: FAVOURITE_SLOTS and GRID_COLUMNS are
            //   both 4, both rows sit inside the same page inset, so the label box is the
            //   SAME 86.25pt at 393dp and 68.0pt at 320dp. This works because the phrase
            //   already fits that box — measured across all nine locales — not because
            //   there is room to spare.
            //
            // Tile height does not move. ModuleTile derives lineHeight from
            // GRID_LABEL_HEIGHT / lines, so three lines occupy the same 32pt two do, and
            // this tile stays uniform with the other three by construction rather than by
            // luck.
            labelOverride={mod.gridLabel}
          />
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
})
