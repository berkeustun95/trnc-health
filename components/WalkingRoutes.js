// The Visit NCY walking-routes layer on the Keşfet map: what goes INSIDE the MapView
// (lines + stop markers), the route picker, and the route panel. The gate and the numbers
// live in constants/walkingRoutes.js; nothing here decides whether routes are shown.
//
// The panel is an in-map panel, not a Modal: a Modal's backdrop would cover the very route
// it describes. Android back is therefore handled here (OliGuide's pattern) — App.js's
// handler knows nothing about local panel state and would leave the tab instead.

import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, BackHandler } from 'react-native'
import { Marker, Polyline } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { placeName } from '../screens/ExploreScreen'
import { ROUTE_COLOR, walkingDirectionsUrl, creditUrl, creditBrand } from '../constants/walkingRoutes'
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
function RouteMarker({ coordinate, onPress, children }) {
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [])
  return (
    <Marker coordinate={coordinate} tracksViewChanges={tracks} anchor={{ x: 0.5, y: 0.5 }}
      onPress={e => { e.stopPropagation(); onPress() }}>
      {children}
    </Marker>
  )
}

// With no route selected: every route's line plus one start marker each. With one selected:
// only that route, every stop numbered.
export function RouteOverlay({ routes, selected, onSelectRoute, onSelectStop }) {
  const shown = selected ? [selected] : routes
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
        ? selected.stops.map((p, i) => (
            <RouteMarker key={`s:${selected.id}:${p.id}`} coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              onPress={() => onSelectStop(p)}>
              <View style={m.num}><Text style={m.numText}>{i + 1}</Text></View>
            </RouteMarker>
          ))
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

export function RoutePanel({ route, lang, maxHeight, review, onClose, onSelectStop, initialScrollY = 0, onScrollY }) {
  const scrollRef = useRef(null)
  const restored  = useRef(initialScrollY === 0)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true })
    return () => sub.remove()
  }, [onClose])

  const city = REGION_LABEL_KEY[route.region] ? t(REGION_LABEL_KEY[route.region], lang) : route.region
  const start = () => Linking.openURL(walkingDirectionsUrl(route.stops[0])).catch(() => {})
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
      <TouchableOpacity style={p.startBtn} onPress={start} activeOpacity={0.85}>
        <Ionicons name="navigate" size={16} color="#fff" />
        <Text style={p.startText}>{t('routeStart', lang)}</Text>
      </TouchableOpacity>
    </View>
  )
}

const m = StyleSheet.create({
  num:     { width: 26, height: 26, borderRadius: 13, backgroundColor: ROUTE_COLOR, borderWidth: 2, borderColor: '#fff',
             alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
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
