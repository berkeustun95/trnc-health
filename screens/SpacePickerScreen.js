import { useRef } from 'react'
import { View, Text, Image, TouchableOpacity, Animated, StyleSheet, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, type, radii, press, motion, worldColors, fontDisplayFor } from '../constants/theme'
import { t } from '../constants/i18n'
import { spaceIds, SPACE_SCENE, SPACE_LABEL_KEY } from '../constants/homeGroups'
import { Button, IconButton } from '../components/ui'
import { PHOTO_TEAL, CONTENT_MAX_W } from '../components/ui/PhotoFade'
import { bandCap } from '../components/ui/OliBand'
import { haptic } from '../components/ui/haptics'
import useReduceMotion from '../components/ui/useReduceMotion'

// ─── App spaces: the full-screen picker (HOME_SPACES_LIVE) ───────────────────
// A 2x2 grid of equal glass tiles on the onboarding teal (PHOTO_TEAL), one per LIVE home group, each
// with its mascot scene and a white label. Tiles fill the screen height; no scrolling. Health gets
// its own neutral label (`spaceHealth`): the Home panel title says "Health", which the store listing
// may not. No tab bar: App.js renders this in place of the tab shell until a space is chosen.
const PAD = 20

// Glass tile: a light white veil, a hairline border, and a 1px top highlight (inside the rounded clip).
// Alphas are tuned so white labels keep >= 4.5:1 (measured numbers in constants/theme.js `worldColors`).
const GLASS_FILL = 'rgba(255,255,255,0.08)'
const GLASS_FILL_ON = 'rgba(255,255,255,0.20)'   // selected: 6.84:1 for the white label (0.28 was 5.35)
const GLASS_BORDER = 'rgba(255,255,255,0.22)'
const GLASS_HIGHLIGHT = 'rgba(255,255,255,0.40)'
const SUBTITLE_COLOR = 'rgba(255,255,255,0.85)'   // 9.46:1 on PHOTO_TEAL (full white is 12.54:1)
const PRESS_SCALE = 0.96

function SpaceTile({ id, lang, width, cap, onPress, selected }) {
  const label = t(SPACE_LABEL_KEY[id], lang)
  const reduce = useReduceMotion()
  const scale = useRef(new Animated.Value(1)).current
  // Reduce Motion: no scale animation (the haptic on press stays).
  const springTo = toValue => { if (!reduce) Animated.spring(scale, { toValue, ...motion.spring, useNativeDriver: true }).start() }
  return (
    <TouchableOpacity style={[s.tile, selected && s.tileOn, { width, transform: [{ scale }] }]}
      onPress={() => { haptic(); onPress(id) }} onPressIn={() => springTo(PRESS_SCALE)} onPressOut={() => springTo(1)} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }}>
      <View style={[s.glass, selected && s.glassOn]} pointerEvents="none" />
      <View style={s.highlight} pointerEvents="none" />
      <View style={s.inner}>
        {/* Static glow behind the mascot only (never the label): the white PNG is tinted per space. */}
        <View style={s.img}>
          <Image source={require('../assets/oli-scenes/oli-glow.png')} style={[s.fill, { tintColor: worldColors[id].glow }]}
            resizeMode="contain" accessible={false} pointerEvents="none" accessibilityIgnoresInvertColors />
          <Image source={SPACE_SCENE[id]} style={s.fill} resizeMode="contain" accessible={false} accessibilityIgnoresInvertColors />
        </View>
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
  const display = fontDisplayFor(lang)   // null where Playfair lacks the script (Greek, Arabic, Persian)
  const showSub = !compact               // small phones keep the room for the grid
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
        <Text style={[s.title, display && { ...type.display, fontFamily: display.bold }, { marginBottom: showSub ? 8 : 16 }]}
          accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={cap}>
          {t('spacePickerTitle', lang)}
        </Text>
        {showSub && (
          <Text style={s.subtitle} numberOfLines={2} maxFontSizeMultiplier={cap}>{t('spacePickerSubtitle', lang)}</Text>
        )}
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
  subtitle: { ...type.body, color: SUBTITLE_COLOR, textAlign: 'center', flexShrink: 0, paddingHorizontal: 24, marginBottom: 20 },
  // transparent + overflow hidden: the glass fill is its own child, so borderRadius + borderWidth never render opaque on Android.
  tile:  { backgroundColor: 'transparent', borderWidth: 1, borderColor: GLASS_BORDER, borderRadius: radii.widget,
           overflow: 'hidden', padding: 12, alignItems: 'center' },
  tileOn: { borderWidth: 2, borderColor: colors.onPrimary, padding: 11 },
  glass: { ...StyleSheet.absoluteFillObject, backgroundColor: GLASS_FILL },
  glassOn: { backgroundColor: GLASS_FILL_ON },
  highlight: { position: 'absolute', top: 0, left: radii.widget, right: radii.widget, height: 1, backgroundColor: GLASS_HIGHLIGHT },
  showAll: { flexShrink: 0, minHeight: 44, alignSelf: 'center', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  showAllOn: { backgroundColor: 'rgba(255,255,255,0.28)', borderWidth: 2, borderColor: colors.onPrimary, borderRadius: radii.card },
  showAllText: { ...type.rowTitle, color: colors.onPrimary, textDecorationLine: 'underline', textAlign: 'center' },
  inner: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  img:   { width: '100%', aspectRatio: 1.1, maxHeight: 150, flexShrink: 1, minHeight: 0 },
  fill:  { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  labelWrap: { flexShrink: 0, minHeight: 40, justifyContent: 'center', marginTop: 8 },
  label: { ...type.rowTitle, color: colors.onPrimary, textAlign: 'center' },
  footer: { flexShrink: 0, paddingTop: 12 },
})
