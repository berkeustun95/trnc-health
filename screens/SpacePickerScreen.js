import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, type, radii, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { spaceIds, SPACE_SCENE, SPACE_LABEL_KEY } from '../constants/homeGroups'
import { Button, IconButton } from '../components/ui'
import { PHOTO_TEAL, CONTENT_MAX_W } from '../components/ui/PhotoFade'
import { bandCap } from '../components/ui/OliBand'

// ─── App spaces: the full-screen picker (HOME_SPACES_LIVE) ───────────────────
// A 2x2 grid of equal glass tiles on the onboarding teal (PHOTO_TEAL), one per LIVE home group, each
// with its mascot scene and a white label. Tiles fill the screen height; no scrolling. Health gets
// its own neutral label (`spaceHealth`): the Home panel title says "Health", which the store listing
// may not. No tab bar: App.js renders this in place of the tab shell until a space is chosen.
const PAD = 20

function SpaceTile({ id, lang, width, cap, onPress, selected }) {
  const label = t(SPACE_LABEL_KEY[id], lang)
  return (
    <TouchableOpacity style={[s.tile, selected && s.tileOn, { width }]} onPress={() => onPress(id)} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }}>
      <View style={s.inner}>
        <Image source={SPACE_SCENE[id]} style={s.img} resizeMode="contain" accessible={false} accessibilityIgnoresInvertColors />
        <View style={s.labelWrap}>
          <Text style={s.label} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={cap}>{label}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// `current`: the space (or 'all') the user came from; its tile is marked. `onShowAll`: the full Home
// for this app version. `onProfile`: the picker has no tab bar, so this is how a guest reaches Profile.
export default function SpacePickerScreen({ lang, current = null, onChoose, onShowAll, onProfile, onEmergency }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const compact = height < 640   // small phones: tighter gaps so the grid keeps its room
  const gap = compact ? 10 : 12
  const cap = bandCap(width)
  const tileW = (Math.min(width, CONTENT_MAX_W) - PAD * 2 - gap) / 2
  const ids = spaceIds()
  const rows = []
  for (let i = 0; i < ids.length; i += 2) rows.push(ids.slice(i, i + 2))
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={[s.col, { paddingTop: insets.top + (compact ? 12 : 24) }]}>
        {!!onProfile && (
          <IconButton icon="person-circle-outline" variant="frosted" onPress={onProfile} iconSize={24}
            accessibilityLabel={t('tabProfile', lang)} style={[s.profile, { top: insets.top + (compact ? 2 : 8) }]} />
        )}
        <Text style={[s.title, { marginBottom: compact ? 16 : 20 }]} accessibilityRole="header" numberOfLines={2}
          adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={cap}>
          {t('spacePickerTitle', lang)}
        </Text>
        <View style={[s.grid, { gap }]}>
          {rows.map((row, i) => (
            <View key={i} style={[s.row, { gap }]}>
              {row.map(id => <SpaceTile key={id} id={id} lang={lang} width={tileW} cap={cap} onPress={onChoose} selected={id === current} />)}
            </View>
          ))}
        </View>
        {!!onShowAll && (
          <TouchableOpacity style={[s.showAll, current === 'all' && s.showAllOn]} onPress={onShowAll} activeOpacity={press.card} accessibilityRole="button"
            accessibilityState={{ selected: current === 'all' }}>
            <Text style={s.showAllText} numberOfLines={2} maxFontSizeMultiplier={cap}>{t('showAll', lang)}</Text>
          </TouchableOpacity>
        )}
        {/* Emergency numbers stay one tap away from the picker (same sheet as Home's tile). */}
        {!!onEmergency && (
          <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
            <Button size="lg" variant="inverse" icon="call" title={t('menuEmergency', lang)} onPress={onEmergency} fullWidth />
          </View>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: PHOTO_TEAL },
  col:   { flex: 1, width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingHorizontal: PAD },
  title: { ...type.heroHeadline, color: colors.onPrimary, textAlign: 'center', flexShrink: 0, paddingHorizontal: 48 },
  profile: { position: 'absolute', right: PAD, zIndex: 1 },
  grid:  { flex: 1 },
  row:   { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  tile:  { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
           borderRadius: radii.card, padding: 12, alignItems: 'center' },
  tileOn: { backgroundColor: 'rgba(255,255,255,0.28)', borderWidth: 2, borderColor: colors.onPrimary, padding: 11 },
  showAll: { flexShrink: 0, minHeight: 44, alignSelf: 'center', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  showAllOn: { backgroundColor: 'rgba(255,255,255,0.28)', borderWidth: 2, borderColor: colors.onPrimary, borderRadius: radii.card },
  showAllText: { ...type.rowTitle, color: colors.onPrimary, textDecorationLine: 'underline', textAlign: 'center' },
  inner: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  img:   { width: '100%', aspectRatio: 1.1, maxHeight: 150, flexShrink: 1, minHeight: 0 },
  labelWrap: { flexShrink: 0, minHeight: 40, justifyContent: 'center', marginTop: 8 },
  label: { ...type.rowTitle, color: colors.onPrimary, textAlign: 'center' },
  footer: { flexShrink: 0, paddingTop: 12 },
})
