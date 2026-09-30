import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, category as CATEGORY, type, radii, elevation, press } from '../../../constants/theme'
import { t } from '../../../constants/i18n'
import { GRID_LABEL_HEIGHT, GRID_LABEL_LINE_HEIGHT } from '../../../constants/homeModules'
import { liveGroups, categoryOf } from '../../../constants/homeGroups'
import { CategoryIcon } from '../../ui'

// ─── WIDTH BUDGET — WHY THE PANEL HAS A 4pt INNER GUTTER ───────────────────
// The Ev Hizmetleri tile carries the partner-signed phrase "Tadilat · Bakım · Onarım" at
// 8.2pt over 3 lines (constants/homeModules.js). That was measured against a 68pt label box
// at 320dp, and the binding token is Russian "Обслуживание ·" at 67.5pt. A panel inside the
// page gutter would shrink the box, so the panel keeps only a 4pt inner gutter and the tile
// a 1pt side pad: (320 − 2·16 − 2·4) / 4 − 2·1 = 68pt, exactly V2's box. Do not add panel
// padding without re-measuring (vault: 2026-09-05_tile-label-metrics.mjs).
const PANEL_GUTTER = 4
const TILE_PAD = 1

export function ServiceTile({ mod, cat, lang, onPress, labelWeight = 500, width = '25%' }) {
  const override = mod.gridLabel
  const lines = override?.lines ?? 2
  const label = t(override?.key ?? mod.labelKey, lang)
  return (
    <TouchableOpacity style={[s.tile, { width }]} onPress={() => onPress(mod)} activeOpacity={press.small}
      accessibilityRole="button" accessibilityLabel={mod.soon ? `${label}, ${t('hrSoonBadge', lang)}` : label}>
      <View>
        <CategoryIcon icon={mod.icon} category={cat} size={52} />
        {mod.soon && (
          <View style={s.soon}><Text style={s.soonText} numberOfLines={1}>{t('hrSoonBadge', lang)}</Text></View>
        )}
      </View>
      <View style={s.labelBox}>
        <Text
          style={[s.label, { fontFamily: labelWeight === 700 ? 'Inter_700Bold' : 'Inter_500Medium' },
            override && { fontSize: override.size, lineHeight: GRID_LABEL_HEIGHT / lines }]}
          numberOfLines={lines}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default function ServicePanels({ lang, onPress, labelWeight }) {
  return (
    <View style={{ gap: 12 }}>
      {liveGroups().map(g => (
        <View key={g.key} style={[s.panel, elevation.card]}>
          <View style={s.head}>
            <View style={[s.dot, { backgroundColor: CATEGORY[g.key].ink }]} />
            <Text style={s.title} accessibilityRole="header">{t(g.titleKey, lang)}</Text>
          </View>
          <View style={s.grid}>
            {g.modules.map(mod => (
              <ServiceTile key={mod.id} mod={mod} cat={g.key} lang={lang} onPress={onPress} labelWeight={labelWeight} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

// Favourites: the same tile, in a single white panel, coloured by each module's category.
export function FavouritePanel({ ids, modules, lang, onPress, labelWeight }) {
  return (
    <View style={[s.panel, elevation.card]}>
      <View style={s.grid}>
        {ids.map(id => modules.get(id)).filter(Boolean).map(mod => (
          <ServiceTile key={mod.id} mod={mod} cat={categoryOf(mod.id)} lang={lang} onPress={onPress} labelWeight={labelWeight} />
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
  labelBox: { height: GRID_LABEL_HEIGHT, alignSelf: 'stretch', marginTop: 8 },
  label:    { fontSize: 11, lineHeight: GRID_LABEL_LINE_HEIGHT, color: colors.tileInk, textAlign: 'center' },
  // "Yakında": white on tileInk, 8.61:1. Sits over the icon's top edge so the label box —
  // the 68pt budget above — is untouched.
  soon:     { position: 'absolute', top: -7, alignSelf: 'center', paddingHorizontal: 6, height: 16,
              borderRadius: 8, backgroundColor: colors.tileInk, justifyContent: 'center' },
  soonText: { fontSize: 9.5, lineHeight: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
})
