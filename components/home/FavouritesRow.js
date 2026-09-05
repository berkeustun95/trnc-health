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
          />
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
})
