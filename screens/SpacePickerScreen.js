import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, category as CATEGORY, type, radii, elevation, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { spaceIds, SPACE_ICON, SPACE_LABEL_KEY } from '../constants/homeGroups'
import { CategoryIcon } from '../components/ui'

// ─── App spaces: the full-screen picker (HOME_SPACES_LIVE) ───────────────────
// One big tile per LIVE home group, in the group's own category colour (the same one favourites
// and search use). Health gets its own neutral label (`spaceHealth`) — the Home panel title
// says "Health", which the store listing may not. No tab bar, no Oli: App.js renders this in
// place of the tab shell until a space is chosen.
const CAP = 1.2   // large system text: grow at most 1.2×, the tile has room for that

function SpaceTile({ id, lang, onPress }) {
  const label = t(SPACE_LABEL_KEY[id], lang)
  return (
    <TouchableOpacity style={[s.tile, elevation.card]} onPress={() => onPress(id)} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={label}>
      <CategoryIcon icon={SPACE_ICON[id]} category={id} size={64} />
      <Text style={s.label} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CAP}>{label}</Text>
      <Ionicons name="chevron-forward" size={22} color={CATEGORY[id].ink} />
    </TouchableOpacity>
  )
}

export default function SpacePickerScreen({ lang, onChoose, onEmergency }) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const compact = height < 640   // small phones: tighter gaps so four tiles still fit without scrolling
  return (
    <View style={[s.root, { paddingTop: insets.top + (compact ? 16 : 32), paddingBottom: insets.bottom + 16 }]}>
      <Text style={s.title} accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CAP}>
        {t('spacePickerTitle', lang)}
      </Text>
      <View style={[s.list, { gap: compact ? 10 : 14 }]}>
        {spaceIds().map(id => <SpaceTile key={id} id={id} lang={lang} onPress={onChoose} />)}
      </View>
      {/* Emergency numbers stay one tap away from the picker (same sheet as Home's tile). */}
      {!!onEmergency && (
        <TouchableOpacity style={s.emergency} onPress={onEmergency} activeOpacity={press.card}
          accessibilityRole="button" accessibilityLabel={t('menuEmergency', lang)}>
          <Ionicons name="call" size={20} color={CATEGORY.health.ink} />
          <Text style={s.emergencyText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CAP}>{t('menuEmergency', lang)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: 20 },
  title: { ...type.pageTitle, color: colors.textPrimary, marginBottom: 20, flexShrink: 0 },
  list:  { flex: 1 },
  tile:  { flex: 1, maxHeight: 150, minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 16,
           backgroundColor: colors.card, borderRadius: radii.card, paddingHorizontal: 18 },
  label: { flex: 1, ...type.sectionHeading, color: colors.textPrimary },
  emergency:     { flexShrink: 0, marginTop: 14, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                   backgroundColor: 'transparent', borderRadius: radii.card, borderWidth: 1.5, borderColor: CATEGORY.health.ink, paddingHorizontal: 16 },
  emergencyText: { ...type.rowTitle, color: CATEGORY.health.ink, flexShrink: 1 },
})
