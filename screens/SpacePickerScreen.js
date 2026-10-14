import { useEffect, useRef, useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, type, radii, press, motion, worldColors, fontDisplayFor, font } from '../constants/theme'
import { t } from '../constants/i18n'
import { spaceIds, SPACE_SCENE, SPACE_LABEL_KEY } from '../constants/homeGroups'
import { Button, IconButton } from '../components/ui'
import { PHOTO_TEAL, CONTENT_MAX_W } from '../components/ui/PhotoFade'
import { bandCap } from '../components/ui/OliBand'
import { haptic } from '../components/ui/haptics'
import useReduceMotion from '../components/ui/useReduceMotion'
import useForeground from '../components/ui/useForeground'

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
const GLOW = require('../assets/oli-scenes/oli-glow.png')

// ─── Motion (core Animated, native driver only: the store binaries ship no reanimated/lottie/skia) ───
// Two linear 0 -> 1 "clocks" on the whole picker, looped on the native thread: the breath clock (shared by
// all four tiles, per-tile phase in breathe()) and the ambient drift clock. Every animated style is derived
// from a clock with memoized .interpolate() over sampled-cosine keyframes (ease in/out, no JS work per frame).
// Slice A3 derives the mascot idle bob (translateY) from this SAME breath clock: add another interpolate, no second loop.
const BREATH_MS = 4000           // glow period
const BREATH_PHASE = 0.25        // per-tile phase offset (x index), fraction of the period
const GLOW_OPACITY = [0.55, 1]   // breathing range; frozen (Reduce Motion) at 0.8
const GLOW_SCALE = [0.94, 1.04]  // frozen at 1
const GLOW_FROZEN_OPACITY = 0.8
const DRIFT_MS = 18000           // ambient layers: one full ping-pong
const DRIFT_DP = 24
const AMBIENT_SIZE = 1.4         // x screen width
// Ambient layer opacity per colour, keyed by the space id whose glow tints it. City (#9A5CF0) has low
// luminance, so it needs more to read on the teal. MEASURED (/tmp throwaway script, WCAG, white over
// PHOTO_TEAL + both layers stacked at the PNG's real peak alpha 107/255 + glass 0.20): worst case 5.79:1
// (all cases: selected glass, unselected glass 0.08, title, subtitle @0.85; floor 4.5). Even at an
// assumed PNG alpha of 1.0 the worst case is 4.69:1.
const AMBIENT_OPACITY = { health: 0.14, explore: 0.14, homeLife: 0.14, city: 0.20 }
const STEPS = 24                 // keyframes per cycle
const BOB_DP = 3                 // mascot idle bob (translateY +-), trailing the glow by BOB_LAG of a period
const BOB_LAG = 0.15
// Entrance (one native 0 -> 1 value, no loop): the header block fades in, then each tile fades + rises, staggered.
const HEAD_MS = 240
const TILE_MS = 220
const TILE_STAGGER_MS = 60
const TILE_RISE_DP = 12
const EASE_OUT = Easing.out(Easing.cubic)
const EASE_STEPS = 8

// `value` 0 -> 1 mapped over [a, b] with ease-out-cubic, as sampled keyframes: the native driver ignores an
// interpolation's `easing` function, but it runs plain inputRange/outputRange natively.
function easedRange(value, a, b, from, to) {
  const input = [], output = []
  for (let k = 0; k <= EASE_STEPS; k++) {
    input.push(a + (b - a) * (k / EASE_STEPS))
    output.push(from + (to - from) * EASE_OUT(k / EASE_STEPS))
  }
  return value.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' })
}

// Time-of-day greeting key from the device's local hour.
function greetKey(hour) {
  if (hour >= 5 && hour < 12) return 'spaceGreetMorning'
  if (hour >= 12 && hour < 18) return 'spaceGreetAfternoon'
  if (hour >= 18 && hour < 23) return 'spaceGreetEvening'
  return 'spaceGreetNight'
}

// Linear 0->1 loop on the native thread while `running`; stops on pause/unmount. It always restarts from 0:
// a native loop captures its from-value once and replays from->1 every lap, so resuming mid-cycle (e.g. 0.6)
// would snap back to 0.6 on every lap. Resetting costs one invisible phase snap on resume, which beats a snap per lap.
function useLoopClock(ms, running) {
  const clock = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!running) return
    clock.setValue(0)
    const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [running, ms])
  return clock
}

// Sampled cosine "breath" of the clock, phase-shifted: output[k] = lo + (hi-lo) * (1 - cos(2pi(k/STEPS+phase)))/2.
function breathe(clock, lo, hi, phase = 0) {
  const input = [], output = []
  for (let k = 0; k <= STEPS; k++) {
    input.push(k / STEPS)
    output.push(lo + (hi - lo) * (1 - Math.cos(2 * Math.PI * (k / STEPS + phase))) / 2)
  }
  return clock.interpolate({ inputRange: input, outputRange: output })
}

// Two big, faint tinted glows drifting behind everything (title, grid): colours = the glow of the space the
// user came from (health when none) and of city (health when that is the current one): two distinct hues
// that are already part of the picker's palette. Frozen (centred, no loop) under Reduce Motion.
function AmbientGlows({ idA, idB, width, running, reduce }) {
  const clock = useLoopClock(DRIFT_MS, running)
  const size = width * AMBIENT_SIZE
  const [driftA, driftB] = useMemo(() => {
    const drift = (phase, sign) => reduce ? {} : { transform: [
      { translateX: breathe(clock, -DRIFT_DP * sign, DRIFT_DP * sign, phase) },
      { translateY: breathe(clock, DRIFT_DP * sign, -DRIFT_DP * sign, phase + 0.25) },
    ] }
    return [drift(0, 1), drift(0.5, -1)]
  }, [clock, reduce])
  const base = { position: 'absolute', width: size, height: size }
  return (
    <>
      <Animated.Image source={GLOW} resizeMode="contain" pointerEvents="none" accessible={false} accessibilityIgnoresInvertColors
        style={[base, { left: -size * 0.3, top: -size * 0.1, tintColor: worldColors[idA].glow, opacity: AMBIENT_OPACITY[idA] }, driftA]} />
      <Animated.Image source={GLOW} resizeMode="contain" pointerEvents="none" accessible={false} accessibilityIgnoresInvertColors
        style={[base, { right: -size * 0.3, bottom: -size * 0.1, tintColor: worldColors[idB].glow, opacity: AMBIENT_OPACITY[idB] }, driftB]} />
    </>
  )
}

function SpaceTile({ id, index, lang, width, cap, onPress, selected, reduce, clock, enter, enterMs }) {
  const label = t(SPACE_LABEL_KEY[id], lang)
  const scale = useRef(new Animated.Value(1)).current
  const glowStyle = useMemo(() => reduce
    ? { opacity: GLOW_FROZEN_OPACITY }
    : { opacity: breathe(clock, ...GLOW_OPACITY, index * BREATH_PHASE), transform: [{ scale: breathe(clock, ...GLOW_SCALE, index * BREATH_PHASE) }] },
  [clock, index, reduce])
  // Mascot idle bob from the same breath clock, a little behind the glow. Frozen under Reduce Motion.
  const bobStyle = useMemo(() => reduce ? null
    : { transform: [{ translateY: breathe(clock, -BOB_DP, BOB_DP, index * BREATH_PHASE + BOB_LAG) }] },
  [clock, index, reduce])
  // Entrance: this tile's slice of the shared `enter` value (a wrapper, so it never fights the press scale).
  const enterStyle = useMemo(() => {
    const a = (index * TILE_STAGGER_MS) / enterMs, b = (index * TILE_STAGGER_MS + TILE_MS) / enterMs
    return {
      opacity: easedRange(enter, a, b, 0, 1),
      transform: [{ translateY: easedRange(enter, a, b, TILE_RISE_DP, 0) }],
    }
  }, [enter, enterMs, index])
  // Reduce Motion: no scale animation, and the tile snaps back to 1 (the haptic on press stays).
  const springTo = toValue => {
    if (reduce) scale.setValue(1)
    else Animated.spring(scale, { toValue, ...motion.spring, useNativeDriver: true }).start()
  }
  return (
    <Animated.View style={[{ width }, enterStyle]}>
    <TouchableOpacity style={[s.tile, selected && s.tileOn, { flex: 1, transform: [{ scale }] }]}
      // The touch point seeds the colour bloom; an accessibility activation has none (SpaceWash centres it).
      onPress={e => { haptic(); onPress(id, { x: e?.nativeEvent?.pageX, y: e?.nativeEvent?.pageY, reduce }) }} onPressIn={() => springTo(PRESS_SCALE)} onPressOut={() => springTo(1)} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }}>
      <View style={[s.glass, selected && s.glassOn]} pointerEvents="none" />
      <View style={s.highlight} pointerEvents="none" />
      <View style={s.inner}>
        {/* Breathing glow behind the mascot only (never the label): the white PNG is tinted per space. */}
        <View style={s.img}>
          <Animated.Image source={GLOW} style={[s.fill, { tintColor: worldColors[id].glow }, glowStyle]}
            resizeMode="contain" accessible={false} pointerEvents="none" accessibilityIgnoresInvertColors />
          <Animated.Image source={SPACE_SCENE[id]} style={[s.fill, bobStyle]} resizeMode="contain" accessible={false} accessibilityIgnoresInvertColors />
        </View>
        <View style={s.labelWrap}>
          <Text style={s.label} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={cap}>{label}</Text>
        </View>
      </View>
    </TouchableOpacity>
    </Animated.View>
  )
}

// `current`: the space (or 'all') the user came from; its tile is marked. `onShowAll`: the full Home
// for this app version. `onProfile`: the picker has no tab bar, so this is how a guest reaches Profile.
export default function SpacePickerScreen({ lang, current = null, onChoose, onShowAll, onProfile, onEmergency }) {
  const insets = useSafeAreaInsets()
  const reduce = useReduceMotion()
  const fg = useForeground()
  const running = fg && !reduce   // loops stop in the background and under Reduce Motion
  const breath = useLoopClock(BREATH_MS, running)   // shared by all tiles (and by A3's mascot bob)
  const { width, height } = useWindowDimensions()
  const compact = height < 640   // small phones: tighter gaps so the grid keeps its room
  const gap = compact ? 10 : 12
  const cap = bandCap(width)
  const display = fontDisplayFor(lang)   // null where Playfair lacks the script (Greek, Arabic, Persian)
  const showSub = !compact               // small phones keep the room for the grid
  const tileW = (Math.min(width, CONTENT_MAX_W) - PAD * 2 - gap) / 2
  const ids = spaceIds()
  // Entrance: one value over the header + staggered tiles; under Reduce Motion it is simply 1 (final values).
  const enter = useRef(new Animated.Value(0)).current
  const enterMs = TILE_MS + TILE_STAGGER_MS * Math.max(ids.length - 1, 0)
  useEffect(() => {
    if (reduce) { enter.setValue(1); return }
    enter.setValue(0)
    const a = Animated.timing(enter, { toValue: 1, duration: enterMs, easing: Easing.linear, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [reduce, enterMs])
  const headStyle = useMemo(() => ({
    opacity: easedRange(enter, 0, HEAD_MS / enterMs, 0, 1),
  }), [enter, enterMs])
  const rows = []
  for (let i = 0; i < ids.length; i += 2) rows.push(ids.slice(i, i + 2))
  const ambA = worldColors[current] ? current : 'health'
  const ambB = ambA === 'city' ? 'health' : 'city'
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <AmbientGlows idA={ambA} idB={ambB} width={Math.min(width, CONTENT_MAX_W)} running={running} reduce={reduce} />
      <View style={[s.col, { paddingTop: insets.top + (compact ? 12 : 24) }]}>
        {!!onProfile && (
          <IconButton icon="person-circle-outline" variant="frosted" onPress={onProfile} iconSize={24}
            accessibilityLabel={t('tabProfile', lang)} style={[s.profile, { top: insets.top + (compact ? 2 : 8) }]} />
        )}
        <Animated.View style={[s.head, headStyle]}>
        {showSub && (
          <Text style={s.greet} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={cap}>{t(greetKey(new Date().getHours()), lang)}</Text>
        )}
        <Text style={[s.title, display && { ...type.display, fontFamily: display.bold }, { marginBottom: showSub ? 8 : 16 }]}
          accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={cap}>
          {t('spacePickerTitle', lang)}
        </Text>
        {showSub && (
          <Text style={s.subtitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={cap}>{t('spacePickerSubtitle', lang)}</Text>
        )}
        </Animated.View>
        <View style={[s.grid, { gap }]}>
          {rows.map((row, i) => (
            <View key={i} style={[s.row, { gap }]}>
              {row.map((id, j) => <SpaceTile key={id} id={id} index={i * 2 + j} clock={breath} enter={enter} enterMs={enterMs} lang={lang} width={tileW} cap={cap} onPress={onChoose} selected={id === current} reduce={reduce} />)}
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
  root:  { flex: 1, backgroundColor: PHOTO_TEAL, overflow: 'hidden' },
  col:   { flex: 1, width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingHorizontal: PAD },
  title: { ...type.heroHeadline, color: colors.onPrimary, textAlign: 'center', flexShrink: 0, paddingHorizontal: 48 },
  profile: { position: 'absolute', right: PAD, zIndex: 1 },
  grid:  { flex: 1 },
  row:   { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  head:  { flexShrink: 0 },
  greet: { ...type.meta, fontFamily: font.semibold, color: SUBTITLE_COLOR, textAlign: 'center', marginBottom: 4 },
  subtitle: { ...type.body, color: SUBTITLE_COLOR, textAlign: 'center', flexShrink: 0, paddingHorizontal: 24, marginBottom: 20 },
  // transparent + overflow hidden: the glass fill is its own child, so borderRadius + borderWidth never render opaque on Android.
  tile:  { backgroundColor: 'transparent', borderWidth: 1, borderColor: GLASS_BORDER, borderRadius: radii.widget,
           overflow: 'hidden', padding: 12, alignItems: 'center' },
  tileOn: { borderWidth: 2, borderColor: colors.onPrimary, padding: 11 },
  glass: { ...StyleSheet.absoluteFillObject, backgroundColor: GLASS_FILL },
  glassOn: { backgroundColor: GLASS_FILL_ON },
  highlight: { position: 'absolute', top: 0, left: radii.widget, right: radii.widget, height: 1, backgroundColor: GLASS_HIGHLIGHT },
  showAll: { flexShrink: 0, minHeight: 44, alignSelf: 'center', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  showAllOn: { backgroundColor: GLASS_FILL_ON, borderWidth: 2, borderColor: colors.onPrimary, borderRadius: radii.widget },
  showAllText: { ...type.rowTitle, color: colors.onPrimary, textDecorationLine: 'underline', textAlign: 'center' },
  inner: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  img:   { width: '100%', aspectRatio: 1.1, maxHeight: 150, flexShrink: 1, minHeight: 0 },
  fill:  { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  labelWrap: { flexShrink: 0, minHeight: 40, justifyContent: 'center', marginTop: 8 },
  label: { ...type.rowTitle, color: colors.onPrimary, textAlign: 'center' },
  footer: { flexShrink: 0, paddingTop: 12 },
})
