import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { colors, category as CATEGORY, type, radii, elevation, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { GRID_LABEL_HEIGHT, GRID_LABEL_LINE_HEIGHT, tileLabel } from '../../../constants/homeModules'
import { liveGroups, categoryOf } from '../../../constants/homeGroups'
import { CategoryIcon } from '../../ui'

// ─── WIDTH BUDGET — WHY THE PANEL HAS A 4pt INNER GUTTER ───────────────────
// The Ev Hizmetleri tile carries the partner-signed phrase "Tadilat · Bakım · Onarım" at
// 8.2pt over 3 lines (constants/homeModules.js). That was measured against a 68pt label box
// at 320dp, and the binding token is Russian "Обслуживание ·" at 67.5pt. A panel inside the
// page gutter would shrink the box, so the panel keeps only a 4pt inner gutter and the tile
// a 1pt side pad: (320 − 2·16 − 2·4) / 4 − 2·1 = 68pt, exactly V2's box. Do not add panel
// padding without re-measuring (vault: 2026-09-05_tile-label-metrics.mjs).
// Exported so the Düzenle slot boxes (FavouritesEditSheet) are built from the same three
// numbers as these tiles and cannot drift from them. HomeScreen's rBelow pads by PAGE_INSET.
export const PAGE_INSET = 16
export const PANEL_GUTTER = 4
export const TILE_PAD = 1
export const TILE_WIDTH = '25%'
// Large system text: labels grow at most 1.15×, and the label area is fixed at two lines of
// that (2 · 16 · 1.15 ≈ 37 → 38), so every row keeps one height and nothing spills into the
// tile below or beside it. labels:check measures at font scale 1.0 and 1.3 against this cap.
const LABEL_CAP = 1.15
// Below NARROW_W the 68pt column cannot take 1.15× (single words like "Événements" or
// "Renovation" would break mid-word), so narrow phones keep the designed size instead of
// rewording ~45 labels — including a partner-signed one — for one corner case.
const LABEL_CAP_NARROW = 1.0
// 360, not 350 (2026-10-09): at 350dp the 1.15× cap broke Russian "Обслуживание" mid-word
// (labels:check now samples NARROW_W itself, the wide band's narrowest and worst width).
const NARROW_W = 360
export function labelCap(width) { return width < NARROW_W ? LABEL_CAP_NARROW : LABEL_CAP }
const LABEL_BOX = 38

export function ServiceTile({ mod, cat, lang, onPress, width = TILE_WIDTH }) {
  const cap = labelCap(useWindowDimensions().width)
  const fit = tileLabel(mod, lang)
  const lines = fit.lines
  const label = t(fit.key, lang)
  return (
    <TouchableOpacity style={[s.tile, { width }]} onPress={() => onPress(mod)} activeOpacity={press.small}
      accessibilityRole="button" accessibilityLabel={mod.soon ? `${label}, ${t('hrSoonBadge', lang)}` : label}>
      <View>
        <CategoryIcon icon={mod.icon} category={cat} size={52} />
        {mod.soon && (
          <View style={s.soon}><Text style={s.soonText} numberOfLines={1} maxFontSizeMultiplier={cap}>{t('hrSoonBadge', lang)}</Text></View>
        )}
      </View>
      <View style={s.labelBox}>
        <Text
          style={[s.label, { fontSize: fit.size, lineHeight: GRID_LABEL_HEIGHT / lines }]}
          numberOfLines={lines}
          maxFontSizeMultiplier={cap}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default function ServicePanels({ lang, onPress, unlocked }) {
  const cap = labelCap(useWindowDimensions().width)
  return (
    <View style={{ gap: 12 }}>
      {liveGroups(unlocked).map(g => (
        <View key={g.key} style={[s.panel, elevation.card]}>
          <View style={s.head}>
            <View style={[s.dot, { backgroundColor: CATEGORY[g.key].ink }]} />
            <Text style={s.title} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={cap}>{t(g.titleKey, lang)}</Text>
          </View>
          <View style={s.grid}>
            {g.modules.map(mod => (
              <ServiceTile key={mod.id} mod={mod} cat={g.key} lang={lang} onPress={onPress} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

// Favourites: the same tile, in a single white panel, coloured by each module's category.
export function FavouritePanel({ ids, modules, lang, onPress }) {
  return (
    <View style={[s.panel, elevation.card]}>
      <View style={s.grid}>
        {ids.map(id => modules.get(id)).filter(Boolean).map(mod => (
          <ServiceTile key={mod.id} mod={mod} cat={categoryOf(mod.id)} lang={lang} onPress={onPress} />
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  panel:    { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: PANEL_GUTTER },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 4 },
  dot:      { width: 8, height: 8, borderRadius: 4 },
  title:    { ...type.rowTitle, color: colors.textPrimary },
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  tile:     { alignItems: 'center', paddingVertical: 8, paddingHorizontal: TILE_PAD },
  labelBox: { height: LABEL_BOX, alignSelf: 'stretch', marginTop: 8, overflow: 'hidden' },
  // Medium (500) — final (Berke, 2026-10-01). check-tile-labels reads this family to pick its font.
  label:    { fontSize: 11, lineHeight: GRID_LABEL_LINE_HEIGHT, fontFamily: 'Inter_500Medium', color: colors.tileInk, textAlign: 'center' },
  // "Yakında": white on tileInk, 8.61:1. Sits over the icon's top edge so the label box —
  // the 68pt budget above — is untouched.
  soon:     { position: 'absolute', top: -7, alignSelf: 'center', paddingHorizontal: 6, height: 16,
              borderRadius: 8, backgroundColor: colors.tileInk, justifyContent: 'center' },
  soonText: { fontSize: 9.5, lineHeight: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
})
