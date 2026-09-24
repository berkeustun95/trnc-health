// The Visit NCY walking-routes layer on the Keşfet map: what goes INSIDE the MapView
// (lines + stop markers), the route picker, and the route panel. The gate and the numbers
// live in constants/walkingRoutes.js; nothing here decides whether routes are shown.
//
// The panel is an in-map panel, not a Modal: a Modal's backdrop would cover the very route
// it describes. Android back is therefore handled here (OliGuide's pattern) — App.js's
// handler knows nothing about local panel state and would leave the tab instead.

import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, BackHandler, AppState } from 'react-native'
import * as Location from 'expo-location'
import { Marker, Polyline } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { placeName } from '../screens/ExploreScreen'
import { ROUTE_COLOR, walkingDirectionsUrl, creditUrl, creditBrand, overlapSlots, metresBetween, walkDistance } from '../constants/walkingRoutes'
import { logContactEvent } from '../utils/logContactEvent'
import { REGION_LABEL_KEY } from '../constants/regions'
import { CATEGORY_LABEL_KEY } from '../constants/exploreCategories'
import { colors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'

// If dashes ever render wrong on a device, this is the one line to change to `undefined`
// (solid) — both platforms implement lineDashPattern natively in react-native-maps 1.20.
const DASH = [10, 7]

export function routeName(route, lang) {
  const n = route.name_i18n || {}
  return n[LANG_CODES[lang] ?? 'en'] || n.en || ''
}

export function routeSummary(route, lang) {
  const { km, min } = route.estimate
  const base = min >= 60
    ? t('routeSummaryHm', lang).replace('{h}', String(Math.floor(min / 60))).replace('{m}', String(min % 60))
    : t('routeSummary', lang).replace('{min}', String(min))
  return base.replace('{n}', String(route.stops.length)).replace('{km}', String(km))
}

// The Ministry's click-through figure. Never from a dev build: review sessions run against
// the production database, so an unguarded tap during a device pass would be counted as a
// reader's. `__DEV__` is false in every release bundle and OTA, so production is unaffected.
export function logCreditTap(entityId, region) {
  if (__DEV__) return
  logContactEvent('explore', entityId, 'website', region)
}

const coordsOf = route => route.stops.map(p => ({ latitude: p.latitude, longitude: p.longitude }))

// Android snapshots a custom-child Marker on first layout; tracksViewChanges false from the
// first frame can ship a blank bubble, true forever stutters. Track briefly, then stop —
// ExploreMapScreen's ClusterMarker, same reason.
//
// `slot` shifts the VIEW sideways for near-overlapping stops (overlapSlots): `anchor` on
// Android, `centerOffset` (points) on iOS — both needed, each platform reads one.
// A stop marker does not navigate on first tap: it shows its name (the native callout, from
// `title`), and tapping THAT opens the place. onCalloutPress on the Marker, not a <Callout>
// child: an Android callout is a bitmap, and a child's own onPress is unreliable there.
const MARKER_W = 26
const SLOT_SHIFT = 1.2   // × marker width per slot: a pair lands ~31 pt apart, centre to centre
function RouteMarker({ coordinate, onPress, title, onCalloutPress, slot = 0, zIndex, variant, children }) {
  // Re-snapshot whenever the look changes (walk mode restyles a stop as it becomes next,
  // then done) — Android would otherwise keep drawing the old bitmap.
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    setTracks(true)
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [variant])
  const shift = slot * SLOT_SHIFT
  return (
    <Marker coordinate={coordinate} tracksViewChanges={tracks}
      anchor={{ x: 0.5 - shift, y: 0.5 }} centerOffset={{ x: shift * MARKER_W, y: 0 }}
      title={title} onCalloutPress={onCalloutPress} zIndex={zIndex}
      onPress={e => { e.stopPropagation(); onPress?.() }}>
      {children}
    </Marker>
  )
}

// With no route selected: every route's line plus one start marker each. With one selected:
// only that route, every stop numbered.
export function RouteOverlay({ routes, selected, lang, walkNext = null, onSelectRoute, onSelectStop }) {
  const shown = selected ? [selected] : routes
  const slots = selected ? overlapSlots(selected.stops) : []
  return (
    <>
      {shown.map(r => (
        <Polyline
          key={`l:${r.id}`}
          coordinates={coordsOf(r)}
          strokeColor={ROUTE_COLOR}
          strokeWidth={selected ? 4 : 3}
          lineDashPattern={DASH}
          tappable
          onPress={() => onSelectRoute(r)}
        />
      ))}
      {selected
        ? selected.stops.map((p, i) => {
            // Walk mode: stops already passed go grey, the one being walked to is ringed and
            // drawn on top; outside walk mode every stop looks the same.
            const variant = walkNext == null ? 'plain' : i < walkNext ? 'done' : i === walkNext ? 'next' : 'plain'
            return (
              <RouteMarker key={`s:${selected.id}:${p.id}`} coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                slot={slots[i]} title={`${i + 1}. ${placeName(p, lang)}`} onCalloutPress={() => onSelectStop(p)}
                variant={variant} zIndex={variant === 'next' ? 10 : 1}>
                <View style={[m.num, variant === 'done' && m.numDone, variant === 'next' && m.numNext]}>
                  <Text style={m.numText}>{i + 1}</Text>
                </View>
              </RouteMarker>
            )
          })
        : routes.map(r => (
            <RouteMarker key={`h:${r.id}`} coordinate={{ latitude: r.stops[0].latitude, longitude: r.stops[0].longitude }}
              onPress={() => onSelectRoute(r)}>
              <View style={m.start}><Ionicons name="walk" size={16} color="#fff" /></View>
            </RouteMarker>
          ))}
    </>
  )
}

export const fitRoute = route => coordsOf(route)

// Bottom row of route cards — the reliable way in. A dashed line at island zoom is too thin
// to hit, and on iOS (Apple Maps) polyline taps are not guaranteed at all.
export function RoutePicker({ routes, lang, error, onSelectRoute }) {
  if (error || routes.length === 0) {
    return (
      <View style={[p.card, p.notice]}>
        <Ionicons name={error ? 'alert-circle-outline' : 'walk-outline'} size={18} color={colors.textSecondary} />
        <Text style={p.noticeText}>{error ? t('routesLoadError', lang) : t('routesEmpty', lang)}</Text>
      </View>
    )
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={p.row} contentContainerStyle={p.rowContent}>
      {routes.map(r => (
        <TouchableOpacity key={r.id} style={p.pick} onPress={() => onSelectRoute(r)} activeOpacity={0.85}>
          <View style={p.pickHead}>
            <View style={p.pickIcon}><Ionicons name="walk" size={15} color="#fff" /></View>
            <Text style={p.pickName} numberOfLines={2}>{routeName(r, lang)}</Text>
          </View>
          <Text style={p.pickSub} numberOfLines={2}>{routeSummary(r, lang)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

export function RoutePanel({ route, lang, maxHeight, review, onClose, onSelectStop, onStart, initialScrollY = 0, onScrollY }) {
  const scrollRef = useRef(null)
  const restored  = useRef(initialScrollY === 0)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true })
    return () => sub.remove()
  }, [onClose])

  const city = REGION_LABEL_KEY[route.region] ? t(REGION_LABEL_KEY[route.region], lang) : route.region
  // Logged BEFORE opening, fire-and-forget (utils/logContactEvent.js): the Ministry's
  // click-through figure. module 'explore' + action 'website' — both admitted by the live
  // CHECKs (probed 2026-09-24, no row written).
  const openCredit = () => {
    logCreditTap(route.id, route.region)
    Linking.openURL(creditUrl(lang)).catch(() => {})
  }

  return (
    <View style={[p.card, p.panel, { maxHeight }]}>
      <View style={p.head}>
        <View style={{ flex: 1 }}>
          <Text style={p.city}>{city}</Text>
          <Text style={p.name}>{routeName(route, lang)}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close-circle" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={p.summary}>{routeSummary(route, lang)}</Text>
      <Text style={p.note}>{t('routeEstimateNote', lang)}</Text>

      {/* Scroll offset survives the stop → place → back round trip (ExploreMapScreen's
          return memory). Restored once the list has laid out, on both platforms. */}
      <ScrollView
        ref={scrollRef}
        style={p.stops}
        contentContainerStyle={{ paddingVertical: 4 }}
        scrollEventThrottle={64}
        onScroll={e => onScrollY?.(e.nativeEvent.contentOffset.y)}
        onContentSizeChange={() => {
          if (restored.current) return
          restored.current = true
          scrollRef.current?.scrollTo({ y: initialScrollY, animated: false })
        }}
      >
        {route.stops.map((s, i) => (
          <TouchableOpacity key={s.id} style={p.stop} onPress={() => onSelectStop(s)} activeOpacity={0.7}>
            <View style={m.num}><Text style={m.numText}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={p.stopName} numberOfLines={1}>{placeName(s, lang)}</Text>
              <Text style={p.stopCat} numberOfLines={1}>
                {CATEGORY_LABEL_KEY[s.category] ? t(CATEGORY_LABEL_KEY[s.category], lang) : s.category}
                {review && s.status === 'pending' ? '  · PENDING' : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={p.credit} onPress={openCredit} activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="link">
        <Ionicons name="ribbon-outline" size={13} color={ROUTE_COLOR} />
        <Text style={p.creditText}>{t('routeCredit', lang).replace('{brand}', creditBrand(lang))}</Text>
        <Ionicons name="open-outline" size={12} color={ROUTE_COLOR} />
      </TouchableOpacity>
      <TouchableOpacity style={p.startBtn} onPress={onStart} activeOpacity={0.85}>
        <Ionicons name="navigate" size={16} color="#fff" />
        <Text style={p.startText}>{t('routeStart', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Walk mode ──────────────────────────────────────────────────────────────
// FOREGROUND location only, and only while walk mode is on: the watch starts when `active`
// turns true and is removed on exit, on unmount (a stop tap hands off to the place page,
// which unmounts the map) and whenever the app leaves the foreground. Permission is asked at
// most once per walk, and only if the OS still allows asking — App.js normally asked at
// launch already. Refused or unavailable → status 'denied' and the walk is manual-only.
export function useWalkPosition(active) {
  const [pos, setPos] = useState(null)
  const [status, setStatus] = useState('pending')   // 'pending' | 'granted' | 'denied'
  useEffect(() => {
    if (!active) { setPos(null); setStatus('pending'); return }
    let sub = null, starting = false, asked = false, gone = false
    const stop = () => { sub?.remove(); sub = null }
    const start = async () => {
      if (sub || starting) return
      starting = true
      try {
        let { status: st, canAskAgain } = await Location.getForegroundPermissionsAsync()
        if (st !== 'granted' && canAskAgain && !asked) {
          asked = true
          ;({ status: st } = await Location.requestForegroundPermissionsAsync())
        }
        if (gone) return
        setStatus(st === 'granted' ? 'granted' : 'denied')
        if (st !== 'granted') return
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
          l => setPos({ latitude: l.coords.latitude, longitude: l.coords.longitude })
        )
        if (gone || AppState.currentState !== 'active') s.remove()
        else sub = s
      } catch {
        if (!gone) setStatus('denied')
      } finally {
        starting = false
      }
    }
    start()
    const app = AppState.addEventListener('change', st => (st === 'active' ? start() : stop()))
    return () => { gone = true; stop(); app.remove() }
  }, [active])
  return { pos, status }
}

export function WalkPanel({ route, lang, walk, pos, status, onPrev, onNext, onEnd, onSelectStop }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onEnd(); return true })
    return () => sub.remove()
  }, [onEnd])

  const n = route.stops.length
  const done = walk.next >= n
  const stop = done ? null : route.stops[walk.next]
  const dist = stop && pos ? walkDistance(metresBetween(pos, stop)) : null
  const directions = () => stop && Linking.openURL(walkingDirectionsUrl(stop)).catch(() => {})

  return (
    <View style={[p.card, p.panel]}>
      <View style={p.head}>
        <Text style={[p.city, { flex: 1 }]}>
          {done ? routeName(route, lang) : t('walkStopOf', lang).replace('{i}', String(walk.next + 1)).replace('{n}', String(n))}
        </Text>
        <TouchableOpacity onPress={onEnd} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close-circle" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {done ? (
        <>
          <Text style={p.name}>{t('walkDone', lang)}</Text>
          <TouchableOpacity style={p.startBtn} onPress={onEnd} activeOpacity={0.85}>
            <Text style={p.startText}>{t('walkEnd', lang)}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={w.label}>{t('walkNextStop', lang)}</Text>
          <TouchableOpacity onPress={() => onSelectStop(stop)} activeOpacity={0.7} style={w.nameRow}>
            <Text style={[p.name, { flexShrink: 1 }]}>{placeName(stop, lang)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {dist ? (
            <Text style={p.summary}>
              {(dist.unit === 'm' ? t('walkAwayM', lang) : t('walkAwayKm', lang)).replace('{n}', String(dist.n))}
            </Text>
          ) : status === 'denied' ? (
            <Text style={p.note}>{t('walkNoLocation', lang)}</Text>
          ) : null}

          <View style={w.controls}>
            <TouchableOpacity style={[w.step, walk.next === 0 && w.stepOff]} onPress={onPrev}
              disabled={walk.next === 0} activeOpacity={0.8} accessibilityLabel={t('walkPrev', lang)}>
              <Ionicons name="chevron-back" size={18} color={ROUTE_COLOR} />
              <Text style={w.stepText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('walkPrev', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={w.go} onPress={directions} activeOpacity={0.85}>
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={w.goText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('walkDirections', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={w.step} onPress={onNext} activeOpacity={0.8} accessibilityLabel={t('walkNext', lang)}>
              <Text style={w.stepText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('walkNext', lang)}</Text>
              <Ionicons name="chevron-forward" size={18} color={ROUTE_COLOR} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  )
}

const w = StyleSheet.create({
  label:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 6 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  controls: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 14 },
  step:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
              paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: ROUTE_COLOR,
              backgroundColor: 'transparent' },
  stepOff:  { opacity: 0.35 },
  stepText: { flexShrink: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: ROUTE_COLOR },
  goText:   { flexShrink: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  go:       { flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingVertical: 12, borderRadius: 12, backgroundColor: ROUTE_COLOR },
})

const m = StyleSheet.create({
  num:     { width: 26, height: 26, borderRadius: 13, backgroundColor: ROUTE_COLOR, borderWidth: 2, borderColor: '#fff',
             alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  numDone: { backgroundColor: '#94A3B8' },
  numNext: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: colors.accent },
  start:   { width: 30, height: 30, borderRadius: 15, backgroundColor: ROUTE_COLOR, borderWidth: 2, borderColor: '#fff',
             alignItems: 'center', justifyContent: 'center' },
})

const p = StyleSheet.create({
  card:       { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.cardBg, borderRadius: 20, ...shadow },
  notice:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  noticeText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  row:        { position: 'absolute', left: 0, right: 0, bottom: 24, flexGrow: 0 },
  rowContent: { paddingHorizontal: 16, gap: 10 },
  pick:       { width: 220, backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, ...shadow },
  pickHead:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pickIcon:   { width: 26, height: 26, borderRadius: 13, backgroundColor: ROUTE_COLOR, alignItems: 'center', justifyContent: 'center' },
  pickName:   { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  pickSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },

  panel:      { padding: 16 },
  head:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  city:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: ROUTE_COLOR, textTransform: 'uppercase', letterSpacing: 0.4 },
  name:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 2 },
  summary:    { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginTop: 8 },
  note:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 4, lineHeight: 15 },
  stops:      { marginTop: 10, flexShrink: 1 },
  stop:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  stopName:   { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  stopCat:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  credit:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexShrink: 0 },
  creditText: { flexShrink: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: ROUTE_COLOR },
  startBtn:   { flexShrink: 0, marginTop: 12, backgroundColor: ROUTE_COLOR, borderRadius: 12, paddingVertical: 13,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  startText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
