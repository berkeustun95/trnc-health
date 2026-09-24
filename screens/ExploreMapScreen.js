// ADA's one map: every pinnable content type on a single surface, clustered.
//
// PIN SOURCES ARE NOT DECIDED HERE. constants/mapSources.js derives them at runtime from
// MODULE_FLAGS + the Explore taxonomy; this file only draws what it is handed. That is
// deliberate — the gate is the security-relevant part and it belongs in one testable
// place, not spread through a render tree.
//
// NO LOCATION PERMISSION IS REQUESTED, EVER. `userLocation` arrives as a prop that App.js
// already holds; when it is null the map simply frames the island and draws no blue dot.
// This screen must never call expo-location, and must never write a user position anywhere.
//
// Clustering is supercluster — pure JS, one pure-JS dependency (kdbush), no native module,
// so it ships over OTA and needs no rebuild.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, ScrollView, useWindowDimensions, Alert, Linking,
} from 'react-native'
import * as Location from 'expo-location'
import MapView, { Marker } from 'react-native-maps'
import { Ionicons, Feather } from '@expo/vector-icons'
import Supercluster from 'supercluster'
import { supabase } from '../lib/supabase'
import { BROWSE_COLS, placeName } from './ExploreScreen'
import {
  buildMapSources, mapFetchCategories, selectedPins, applyOpenNow, openNowApplicable,
  TRNC_CENTER,
} from '../constants/mapSources'
import { CATEGORY_LABEL_KEY } from '../constants/exploreCategories'
import { REGION_LABEL_KEY } from '../constants/regions'
import { partnerAsset } from '../constants/partnerAssets'
import { colors, shadow, ellipsizeSlack } from '../constants/theme'
import { t } from '../constants/i18n'
import { EXPLORE_ROUTES_LIVE } from '../constants/flags'
import { EXPLORE_REVIEW, reviewStatuses } from '../utils/exploreReview'
import { routesLayerVisible, resolveRoutes, ROUTE_COLOR, walkStep, walkAdvance, legKey } from '../constants/walkingRoutes'
import { RouteOverlay, RoutePicker, RoutePanel, WalkPanel, useWalkPosition, useLocationGranted, useHeading, fitRoute } from '../components/WalkingRoutes'

const TYPE_EMOJI = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

// ─── RETURN-TO-MAP MEMORY ───────────────────────────────────────────────────
// Opening a place or facility from this map UNMOUNTS it: App.js's content selector renders
// the profile INSTEAD of the tab shell (and instead of the admin review preview). So on back
// — the in-screen button or Android back, both of which just clear App state — the map
// mounted fresh: chips reset, route closed, camera back at the island.
//
// The view is written here at the moment of HANDOFF and read ONCE on the next mount. Ids,
// never objects: routes and pins are rebuilt from fresh fetches after the remount. Written
// only on handoff, so switching tabs still starts the map fresh, exactly as before.
// Module-level on purpose: it has to outlive the component.
let returnSnapshot = null

// NO LOCATION PERMISSION IS REQUESTED ON OPEN — still true. With EXPLORE_ROUTES_LIVE the map
// shows the dot when permission is ALREADY granted, and asks only when the user taps
// "locate me" (or starts a walk). Every watch is foreground-only and ends with the screen.
const FOLLOW_ZOOM = 17, FOLLOW_ALTITUDE = 600   // zoom for Google (Android), altitude (m) for Apple (iOS)

// Supercluster's radius/extent are tile-space pixels; the zoom we feed it is computed
// below at Google's 256px tile scale. minPoints 3 keeps a lone pair of neighbours as two
// real pins — at this dataset size a bubble reading "2" is noise, not a summary.
const CLUSTER_OPTS = { radius: 48, extent: 512, minZoom: 0, maxZoom: 17, minPoints: 3 }

// Region -> Google zoom level. The (width / 256) term is not optional: without it the
// zoom is only right on a 256pt-wide viewport and every cluster radius drifts with
// screen size.
function regionToZoom(region, width) {
  return Math.round(Math.log2((360 * (width / 256)) / region.longitudeDelta))
}

function regionToBBox(region) {
  return [
    region.longitude - region.longitudeDelta / 2,
    region.latitude  - region.latitudeDelta  / 2,
    region.longitude + region.longitudeDelta / 2,
    region.latitude  + region.latitudeDelta  / 2,
  ]
}

// Android renders a custom-child Marker from a snapshot taken on first layout. With
// tracksViewChanges false from the very first frame that snapshot can be empty, and the
// bubble ships blank; leaving it true forever re-snapshots on every frame and stutters
// the map. Track briefly, then stop. Module-level so it never remounts with the parent.
function ClusterMarker({ cluster, onPress }) {
  const [tracks, setTracks] = useState(true)
  const count = cluster.properties.point_count

  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [count])

  const [lng, lat] = cluster.geometry.coordinates
  const size = count < 10 ? 38 : count < 100 ? 46 : 54

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      tracksViewChanges={tracks}
      onPress={() => onPress(cluster)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[cl.bubble, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={cl.count}>{count}</Text>
      </View>
    </Marker>
  )
}

// ─── Filter chips ─────────────────────────────────────────────────────────────
//
// The chips RENDER buildMapSources()'s output; they do not decide it. A dark module has
// no source, so it can draw no chip and contribute no pin — there is no chip-level gate
// to keep in sync with the pin-level one, because there is only one gate.
//
// Every chip carries a dot in its pin's colour so the legend and the map read as one
// thing. Counts are shown because "Kültürel Miras 38" is the single most useful fact on
// this screen for someone deciding where to look.

function Chip({ label, count, color, colorBg, active, icon, ionicon, onPress }) {
  return (
    <TouchableOpacity
      style={[ch.chip, active && { backgroundColor: colorBg, borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {ionicon
        ? <Ionicons name={ionicon} size={14} color={active ? color : colors.textSecondary} />
        : icon
        ? <Feather name={icon} size={13} color={active ? color : colors.textSecondary} />
        : color ? <View style={[ch.dot, { backgroundColor: color }]} /> : null}
      <Text style={[ch.label, active && { color }]} numberOfLines={1}>{label}</Text>
      {count != null && (
        <Text style={[ch.count, active && { color }]}>{count}</Text>
      )}
    </TouchableOpacity>
  )
}

function ChipRow({ sources, selectedKeys, onToggle, onAll, openNow, canOpenNow, onOpenNow, showRoutes, routesMode, onRoutes, lang }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={ch.bar}
      contentContainerStyle={ch.barContent}
    >
      <Chip
        label={t('all', lang)}
        active={!routesMode && selectedKeys.size === 0}
        color={colors.primary}
        colorBg={colors.primaryLight}
        onPress={onAll}
      />
      {/* A MODE, not a filter: routes replace the pins while it is on, and any other chip
          leaves it. Numbered stops under a layer of clustered pins would be unreadable. */}
      {showRoutes && (
        <Chip
          label={t('routesChip', lang)}
          ionicon="walk"
          active={routesMode}
          color={ROUTE_COLOR}
          colorBg="#E0F2F1"
          onPress={onRoutes}
        />
      )}
      {/* Hidden while no facility has parseable hours — see openNowApplicable(). */}
      {canOpenNow && (
        <Chip
          label={t('openNow', lang)}
          icon="clock"
          active={!routesMode && openNow}
          color={colors.success}
          colorBg={colors.successLight}
          onPress={onOpenNow}
        />
      )}
      {sources.map(src => (
        <Chip
          key={src.key}
          label={t(src.labelKey, lang)}
          count={src.pins.length}
          color={src.color}
          colorBg={src.colorBg}
          active={!routesMode && selectedKeys.has(src.key)}
          onPress={() => onToggle(src.key)}
        />
      ))}
    </ScrollView>
  )
}

// Three pin kinds, three row shapes. A pet hotel pin carries a CONFIG entry
// (constants/petPartners.js), not a places row: its photo is a bundled asset rather than a
// URL, it has no `category`, and its region is `district`. Read as a place, it would render
// a broken image, an undefined badge and a blank subtitle.
function pinCardContent(pin, lang) {
  const row = pin.row
  if (pin.kind === 'health') return {
    image: row.logo_url ? { uri: row.logo_url } : null,
    title: row.name,
    badge: t(row.type, lang),
    sub:   row.address,
  }
  if (pin.kind === 'pethotel') return {
    // The 192x192 card thumb, not a 900 px gallery frame, for a 56pt box.
    image: partnerAsset(row.thumb) || null,
    title: row.name,
    badge: t('petHotelDogBoarding', lang),
    sub:   REGION_LABEL_KEY[row.district] ? t(REGION_LABEL_KEY[row.district], lang) : null,
  }
  const photo = row.cover_image_url || row.photos?.[0]
  return {
    image: photo ? { uri: photo } : null,
    title: placeName(row, lang),
    badge: CATEGORY_LABEL_KEY[row.category] ? t(CATEGORY_LABEL_KEY[row.category], lang) : row.category,
    sub:   REGION_LABEL_KEY[row.region] ? t(REGION_LABEL_KEY[row.region], lang) : row.region,
  }
}

function PinCard({ pin, lang, onClose, onViewProfile }) {
  const isHealth = pin.kind === 'health'
  const row      = pin.row

  const tc = { bg: pin.colorBg, text: pin.color }

  const { image, title, badge, sub } = pinCardContent(pin, lang)

  return (
    <View style={s.card}>
      <View style={s.cardRow}>
        {image
          ? <Image source={image} style={s.thumb} resizeMode={isHealth ? 'contain' : 'cover'} />
          : <View style={[s.thumb, s.thumbFallback, { backgroundColor: tc.bg }]}>
              <Text style={{ fontSize: 20 }}>{isHealth ? (TYPE_EMOJI[row.type] || '🏥') : '📍'}</Text>
            </View>
        }
        <View style={{ flex: 1 }}>
          <View style={[s.typeBadge, { backgroundColor: tc.bg }]}>
            <Text style={[s.typeBadgeText, { color: tc.text }]}>{badge}</Text>
          </View>
          <Text style={s.name} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={s.viewBtn} onPress={onViewProfile} activeOpacity={0.85}>
        <Text style={s.viewBtnText}>{t('viewProfile', lang)}</Text>
        <Ionicons name="chevron-forward" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  )
}

export default function ExploreMapScreen({
  facilities,
  dutyFacilityId,
  userLocation,
  isAdmin = false,
  lang = 'en',
  onSelectFacility,
  onSelectUnclaimed,
  onSelectPlace,
  // Opens PetHotelPartnerScreen. A pet hotel pin exists only while PET_HOTEL_LIVE is true
  // (constants/mapSources.js), and App.js's route re-checks the flag.
  onSelectPetHotel,
  // ─── THE DIRECTORY'S SECOND ENTRANCE ──────────────────────────────────────
  // Until 2026-09-11 the browsable places directory had exactly ONE non-admin entrance:
  // the `explore` tile on Home. This tab showed the same content as a map and offered no
  // way to reach the list — so hiding that tile would have stranded the 2-level taxonomy,
  // the ownership guards, the claimed listings and the featured tier for every user.
  //
  // This is that second entrance, and it has to ship and be checked on device BEFORE the
  // tile is hidden. Optional so the screen still renders if a caller does not pass it.
  onShowList,
}) {
  const { width, height } = useWindowDimensions()
  const mapRef = useRef(null)
  // Consumed once per mount. Pending ids resolve in effects below, once routes/pins exist.
  const [snap] = useState(() => { const v = returnSnapshot; returnSnapshot = null; return v })
  const pendingRouteId = useRef(snap?.routeId ?? null)
  const pendingPinId   = useRef(snap?.pinId ?? null)
  const panelScrollY   = useRef(snap?.panelScrollY ?? 0)
  const pendingWalk    = useRef(snap?.walkNext ?? null)

  const [places, setPlaces]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  // Empty set = "All". See selectedPins(): All is the UNION OF VISIBLE SOURCES, never a
  // bypass of the gate — the default path is the one nearly every user takes, so it is
  // the path that most needs the gate on it.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(snap?.selectedKeys ?? []))
  const [openNow, setOpenNow] = useState(snap?.openNow ?? false)

  const review   = EXPLORE_REVIEW && isAdmin
  const routesOn = routesLayerVisible({ routesLive: EXPLORE_ROUTES_LIVE, review: EXPLORE_REVIEW, isAdmin })
  const [routeRows, setRouteRows]         = useState([])
  const [legRows, setLegRows]             = useState([])
  const [routesError, setRoutesError]     = useState(false)
  const [routesMode, setRoutesMode]       = useState(snap?.routesMode ?? false)
  const [selectedRoute, setSelectedRoute] = useState(null)
  // Walk mode ("Başla"): null, or { next, armed } — see walkAdvance() in constants/walkingRoutes.
  const [walk, setWalk] = useState(null)
  const { pos: walkPos, status: walkStatus } = useWalkPosition(!!walk && !!selectedRoute)

  // "My location" — gated with the routes layer, so production keeps today's behaviour
  // (dot only when App.js already holds a location) until the flag flips.
  const locateOn = routesOn
  const [locGranted, setLocGranted] = useLocationGranted(locateOn)
  const [locating, setLocating] = useState(false)
  // Follow mode (walk only): the camera tracks and turns with the walker; a pan pauses it.
  const [follow, setFollow] = useState(snap?.follow ?? true)
  const [followReady, setFollowReady] = useState(snap?.walkNext != null)
  const firstFollow = useRef(true)
  const followTimer = useRef(null)
  useEffect(() => () => clearTimeout(followTimer.current), [])
  const walking = !!walk

  // ─── The live leg: my position → the next stop, on OUR map ────────────────────
  // Fetched from the walk-leg Edge Function when a walk starts (first fix) and whenever the
  // next stop changes — never on every GPS fix: ORS allows 2,000 a day for the whole app.
  // A reply that lands after the target moved on is dropped (request counter). No path
  // (offline, quota, too far) → no line; Yol tarifi to Google Maps is still there.
  const [liveLeg, setLiveLeg] = useState(null)          // { toId, coords | null }
  const liveReq = useRef(0)
  const lastPos = useRef(null)
  useEffect(() => { lastPos.current = walkPos }, [walkPos])
  const liveTarget = walk && selectedRoute && walk.next < selectedRoute.stops.length
    ? selectedRoute.stops[walk.next] : null
  const havePos = !!walkPos
  useEffect(() => {
    if (!liveTarget || !havePos) { if (!liveTarget) setLiveLeg(null); return }
    const id = ++liveReq.current
    const from = lastPos.current
    supabase.functions.invoke('walk-leg', {
      body: { from: { lat: from.latitude, lon: from.longitude }, to_place_id: liveTarget.id },
    }).then(({ data }) => {
      if (id !== liveReq.current) return
      setLiveLeg({
        toId: liveTarget.id,
        coords: Array.isArray(data?.path) ? data.path.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) : null,
      })
    }).catch(() => { if (id === liveReq.current) setLiveLeg({ toId: liveTarget.id, coords: null }) })
  }, [liveTarget?.id, havePos])
  const heading = useHeading(walking && follow && walkStatus === 'granted')

  const initialRegion = useMemo(() => snap?.region ?? (
    userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude,
          latitudeDelta: 0.5, longitudeDelta: 0.5 }
      : TRNC_CENTER
  ), [userLocation, snap])

  const [region, setRegion] = useState(initialRegion)

  useEffect(() => {
    let active = true
    ;(async () => {
      // Explicit BROWSE_COLS, imported rather than re-typed. ExploreProfileScreen takes
      // `place` as a PROP and never re-fetches, so a column missing from this select is a
      // column its photo-attribution renderer can never see — it would silently fall back
      // to photo_credits and drop the licence link with nothing on screen to say why.
      //
      // `places` ONLY. beaches and landmarks are frozen legacy mirrors of these same 42
      // rows; querying them too would double every pin.
      let q = supabase.from('places').select(review ? `${BROWSE_COLS}, status` : BROWSE_COLS)
        .in('status', reviewStatuses(review))
      const cats = mapFetchCategories(isAdmin)
      if (cats) q = q.in('category', cats)
      const { data } = await q
      if (!active) return
      setPlaces(data || [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [isAdmin, review])

  // Five rows, fetched only when the layer is on — with EXPLORE_ROUTES_LIVE false and no
  // review mode this effect never queries. is_active is filtered HERE as well as by RLS,
  // because RLS opens inactive routes to admins and an admin in production is a user.
  useEffect(() => {
    if (!routesOn) return
    let active = true
    ;(async () => {
      let q = supabase.from('walking_routes')
        .select('id, region, name_i18n, sort_order, is_active, walking_route_stops(position, place_id)')
      if (!review) q = q.eq('is_active', true)
      // Real walking paths (walking_legs, 20261049). RLS shows a leg only while both of its
      // places are visible, so pending stops keep theirs dark. A failed read is not an error
      // state: every leg simply falls back to its straight connector.
      const [{ data, error }, legsRes] = await Promise.all([
        q,
        supabase.from('walking_legs').select('from_place_id, to_place_id, path, metres'),
      ])
      if (!active) return
      setRoutesError(!!error)
      setRouteRows(error ? [] : (data || []))
      setLegRows(legsRes.error ? [] : (legsRes.data || []))
    })()
    return () => { active = false }
  }, [routesOn, review])

  // Stops resolve against the places this screen ALREADY loaded — RLS- and status-filtered —
  // so a stop that is not live is skipped and the rest renumbered (resolveRoutes).
  const routes = useMemo(
    () => resolveRoutes(routeRows, new Map(places.map(p => [p.id, p])), {
      review, legsByPair: new Map(legRows.map(l => [legKey(l.from_place_id, l.to_place_id), l])),
    }),
    [routeRows, places, review, legRows]
  )
  const showRoutesChip = routesOn && (routeRows.length > 0 || routesError)

  // Restore, NOT open: openRoute() would fitTo and fight the restored camera.
  useEffect(() => {
    const id = pendingRouteId.current
    if (!id || routes.length === 0) return
    pendingRouteId.current = null
    const r = routes.find(x => x.id === id)
    if (!r) return
    setSelectedRoute(r)
    if (pendingWalk.current != null) setWalk(walkStep(r.stops, pendingWalk.current, null))
    pendingWalk.current = null
  }, [routes])

  // Auto-advance on every fix. Functional update: the fix may land between renders.
  useEffect(() => {
    if (!walkPos || !selectedRoute) return
    setWalk(w => (w ? walkAdvance(selectedRoute.stops, w, walkPos) : w))
  }, [walkPos, selectedRoute])

  // Follow: centre on each fix and turn to the compass. Waits `followReady` (1.5 s after Başla)
  // so the route overview is seen first. Zoom is set only on the first move after (re)engaging,
  // so a pinch while following is kept. Only center/heading otherwise — a partial camera.
  useEffect(() => {
    if (!walking || !follow || !followReady || !walkPos) return
    const cam = { center: walkPos, pitch: 0 }
    if (heading != null) cam.heading = heading
    if (firstFollow.current) { cam.zoom = FOLLOW_ZOOM; cam.altitude = FOLLOW_ALTITUDE; firstFollow.current = false }
    mapRef.current?.animateCamera(cam, { duration: 600 })
  }, [walking, follow, followReady, walkPos, heading])

  const recenter = useCallback(() => { firstFollow.current = true; setFollow(true); setFollowReady(true) }, [])

  const locateMe = useCallback(async () => {
    if (walking) { recenter(); return }
    if (locating) return
    setLocating(true)
    try {
      let { status, canAskAgain } = await Location.getForegroundPermissionsAsync()
      let justAsked = false
      if (status !== 'granted' && canAskAgain) {
        justAsked = true
        ;({ status } = await Location.requestForegroundPermissionsAsync())
      }
      if (status !== 'granted') {
        // Only point at Settings when the OS will no longer ask — never right after a "No".
        if (!justAsked) Alert.alert(t('locationOffTitle', lang), t('locationOffBody', lang), [
          { text: t('cancel', lang), style: 'cancel' },
          { text: t('openSettings', lang), onPress: () => Linking.openSettings().catch(() => {}) },
        ])
        return
      }
      setLocGranted(true)
      const loc = (await Location.getLastKnownPositionAsync({ maxAge: 60000 }))
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
      if (loc) mapRef.current?.animateCamera(
        { center: { latitude: loc.coords.latitude, longitude: loc.coords.longitude }, zoom: 16, altitude: 1500 },
        { duration: 600 })
    } catch { /* no fix: the dot, if any, is still the answer */ } finally {
      setLocating(false)
    }
  }, [walking, recenter, locating, lang, setLocGranted])

  const endWalk  = useCallback(() => {
    setWalk(null)
    clearTimeout(followTimer.current)
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 })   // north-up again
  }, [])
  const stepWalk = useCallback(d => setWalk(w => w && walkStep(selectedRoute.stops, w.next + d, walkPos)),
    [selectedRoute, walkPos])

  const fitTo = useCallback((coords, bottomShare) => {
    if (!coords.length) return
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 110, right: 40, bottom: Math.round(height * bottomShare), left: 40 },
      animated: true,
    })
  }, [height])

  const enterRoutes = useCallback(() => {
    setSelected(null)
    setSelectedRoute(null)
    setRoutesMode(true)
    fitTo(routes.flatMap(fitRoute), 0.3)
  }, [routes, fitTo])
  const leaveRoutes = useCallback(() => { setRoutesMode(false); setSelectedRoute(null); setWalk(null) }, [])

  const startWalk = useCallback(() => {
    if (!selectedRoute) return
    setWalk(walkStep(selectedRoute.stops, 0, walkPos))
    fitTo(fitRoute(selectedRoute), 0.42)
    firstFollow.current = true
    setFollow(true)
    setFollowReady(false)
    clearTimeout(followTimer.current)
    followTimer.current = setTimeout(() => setFollowReady(true), 1500)
  }, [selectedRoute, walkPos, fitTo])
  const openRoute = useCallback(r => {
    panelScrollY.current = 0
    setSelectedRoute(r)
    fitTo(fitRoute(r), 0.55)
  }, [fitTo])
  const closeRoute = useCallback(() => {
    setWalk(null)
    setSelectedRoute(null)
    fitTo(routes.flatMap(fitRoute), 0.3)
  }, [routes, fitTo])

  const sources = useMemo(
    () => buildMapSources({ facilities, places, dutyFacilityId, isAdmin }),
    [facilities, places, dutyFacilityId, isAdmin]
  )

  // Applicability is computed over ALL pins, not the current selection, so the Open-now
  // chip does not appear and vanish as the user changes chips.
  const canOpenNow = useMemo(() => openNowApplicable(sources.flatMap(s => s.pins)), [sources])

  // Filtering happens HERE, before the index is built — not on the rendered clusters.
  // Cluster a superset and the bubbles count content the user has filtered out, so a
  // cluster reading "12" opens onto 4 pins.
  const pins = useMemo(
    () => applyOpenNow(selectedPins(sources, selectedKeys), openNow && canOpenNow),
    [sources, selectedKeys, openNow, canOpenNow]
  )

  const toggleSource = useCallback(key => {
    setSelected(null)
    leaveRoutes()
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [leaveRoutes])

  useEffect(() => {
    const id = pendingPinId.current
    if (!id || pins.length === 0) return
    pendingPinId.current = null
    const pin = pins.find(x => x.id === id)
    if (pin) setSelected(pin)
  }, [pins])

  // Every handoff off this map goes through here, so every one of them comes back to it.
  const handOff = useCallback((go, pinId = null) => {
    returnSnapshot = {
      region, selectedKeys: [...selectedKeys], openNow, routesMode,
      routeId: selectedRoute?.id ?? null, panelScrollY: panelScrollY.current, pinId,
      walkNext: walk ? walk.next : null, follow,
    }
    go()
  }, [region, selectedKeys, openNow, routesMode, selectedRoute, walk, follow])

  const index = useMemo(() => {
    const idx = new Supercluster(CLUSTER_OPTS)
    idx.load(pins.map(p => ({
      type: 'Feature',
      properties: { pin: p },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })))
    return idx
  }, [pins])

  const clusters = useMemo(
    () => index.getClusters(regionToBBox(region), regionToZoom(region, width)),
    [index, region, width]
  )

  const expandCluster = useCallback(cluster => {
    const [lng, lat] = cluster.geometry.coordinates
    const zoom = Math.min(
      index.getClusterExpansionZoom(cluster.properties.cluster_id),
      CLUSTER_OPTS.maxZoom
    )
    const longitudeDelta = (360 * (width / 256)) / Math.pow(2, zoom)
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lng,
      longitudeDelta,
      latitudeDelta: longitudeDelta * (height / width),
    }, 350)
  }, [index, width, height])

  return (
    <View style={s.container}>
      {/* ─── MAP / LIST, AS A PAIR ────────────────────────────────────────────
          A segmented control rather than a lone "list" button: a pair states that there
          are two views of one thing, where a single button reads as an action leaving the
          screen. The map half is inert — it is the view you are already on — and carries
          the selected treatment so the control still says where you are.

          It floats over the map on its own surface rather than pushing the map down: the
          map is the content here, and a header bar would cost it the height for a control
          most sessions will not touch. */}
      {!!onShowList && (
        <View style={s.viewToggle} pointerEvents="box-none">
          <View style={s.segment}>
            <View style={[s.segItem, s.segItemActive]}>
              <Ionicons name="map" size={15} color="#fff" />
              <Text style={[s.segText, s.segTextActive]}>{t('exploreViewMap', lang)}</Text>
            </View>
            <TouchableOpacity
              style={s.segItem}
              onPress={onShowList}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('exploreViewList', lang)}
            >
              <Ionicons name="list" size={15} color={colors.textPrimary} />
              <Text style={s.segText}>{t('exploreViewList', lang)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={s.map}
        initialRegion={initialRegion}
        // In walk mode the dot follows the walk's own permission, never asks for it: on iOS
        // showsUserLocation alone would raise the permission prompt.
        showsUserLocation={locateOn ? (locGranted || walkStatus === 'granted') : (!!userLocation || (!!walk && walkStatus === 'granted'))}
        showsMyLocationButton={false}
        onPanDrag={walking && follow ? () => setFollow(false) : undefined}
        onRegionChangeComplete={setRegion}
        onPress={() => setSelected(null)}
      >
        {routesMode && (
          <RouteOverlay
            routes={routes}
            selected={selectedRoute}
            lang={lang}
            walkNext={walk ? walk.next : null}
            liveLeg={walk && liveLeg?.toId === liveTarget?.id ? liveLeg.coords : null}
            onSelectRoute={openRoute}
            onSelectStop={p => handOff(() => onSelectPlace?.(p))}
          />
        )}
        {!routesMode && clusters.map(c => {
          if (c.properties.cluster) {
            return <ClusterMarker key={`c:${c.properties.cluster_id}`} cluster={c} onPress={expandCluster} />
          }
          const pin = c.properties.pin
          return (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              pinColor={pin.isDuty ? colors.accent : pin.color}
              tracksViewChanges={false}
              onPress={e => { e.stopPropagation(); setSelected(pin) }}
            />
          )
        })}
      </MapView>

      <ChipRow
        sources={sources}
        selectedKeys={selectedKeys}
        onToggle={toggleSource}
        onAll={() => { setSelected(null); leaveRoutes(); setSelectedKeys(new Set()) }}
        openNow={openNow}
        canOpenNow={canOpenNow}
        onOpenNow={() => { setSelected(null); leaveRoutes(); setOpenNow(v => !v) }}
        showRoutes={showRoutesChip}
        routesMode={routesMode}
        onRoutes={() => (routesMode ? leaveRoutes() : enterRoutes())}
        lang={lang}
      />

      {locateOn && (
        <View style={s.locateWrap} pointerEvents="box-none">
          {walking && !follow && walkStatus === 'granted' && (
            <TouchableOpacity style={s.recenterPill} onPress={recenter} activeOpacity={0.85}>
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={s.recenterText}>{t('locateRecenter', lang)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.locateBtn, walking && follow && s.locateBtnOn]} onPress={locateMe}
            activeOpacity={0.85} accessibilityRole="button"
            accessibilityLabel={walking ? t('locateRecenter', lang) : t('locateMe', lang)}>
            {locating
              ? <ActivityIndicator size="small" color={ROUTE_COLOR} />
              : <Ionicons name={walking ? 'navigate' : 'locate'} size={20} color={walking && follow ? '#fff' : ROUTE_COLOR} />}
          </TouchableOpacity>
        </View>
      )}

      {routesMode && (selectedRoute && walk
        ? <WalkPanel
            route={selectedRoute}
            lang={lang}
            walk={walk}
            pos={walkPos}
            status={walkStatus}
            onPrev={() => stepWalk(-1)}
            onNext={() => stepWalk(1)}
            onEnd={endWalk}
            onSelectStop={p => handOff(() => onSelectPlace?.(p))}
          />
        : selectedRoute
        ? <RoutePanel
            key={selectedRoute.id}
            route={selectedRoute}
            lang={lang}
            maxHeight={Math.round(height * 0.55)}
            review={review}
            onClose={closeRoute}
            onSelectStop={p => handOff(() => onSelectPlace?.(p))}
            onStart={startWalk}
            initialScrollY={panelScrollY.current}
            onScrollY={y => { panelScrollY.current = y }}
          />
        : <RoutePicker routes={routes} lang={lang} error={routesError} onSelectRoute={openRoute} />
      )}

      {loading && (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {selected && (
        <PinCard
          pin={selected}
          lang={lang}
          onClose={() => setSelected(null)}
          onViewProfile={() => {
            const pin = selected
            setSelected(null)
            if (pin.kind === 'place') { handOff(() => onSelectPlace?.(pin.row), pin.id); return }
            if (pin.kind === 'pethotel') { handOff(() => onSelectPetHotel?.(pin.row), pin.id); return }
            // Health keeps the claimed / unclaimed split the tab has always had: an
            // unclaimed facility has no provider and opens the unclaimed sheet instead.
            if (pin.row.provider_id) handOff(() => onSelectFacility?.(pin.row), pin.id)
            else handOff(() => onSelectUnclaimed?.(pin.row), pin.id)
          }}
        />
      )}
    </View>
  )
}

const ch = StyleSheet.create({
  bar:        { position: 'absolute', top: 12, left: 0, right: 0, zIndex: 10, maxHeight: 44 },
  barContent: { paddingHorizontal: 12, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  // ellipsizeSlack: RN ellipsizes on EQUALITY — 'Kültürel Miras' needed exactly its box
  // (89.6dp) and painted 'Kültürel Mir…' (dev text audit, 2026-09-24). See constants/theme.js.
  label:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, ...ellipsizeSlack },
  count:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})

const cl = StyleSheet.create({
  bubble: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 2.5, borderColor: '#fff', ...shadow },
  count:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})

const s = StyleSheet.create({
  // ─── The map/list segmented control ───────────────────────────────────────
  // Floats over the map, below the safe-area top. `pointerEvents: box-none` on the wrapper
  // so the empty space beside the control still pans the map — a full-width invisible bar
  // that ate gestures would be a worse bug than the one this fixes.
  viewToggle: { position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  segment:    { flexDirection: 'row', backgroundColor: colors.cardBg, borderRadius: 20,
                padding: 3, gap: 2, ...shadow },
  segItem:    { flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17 },
  // Selected is a filled pill, not a colour swap on the label: the same discipline the
  // grid's tints follow, so the state survives greyscale. White on primary is 5.01:1;
  // textPrimary on cardBg is 14.6:1.
  segItemActive: { backgroundColor: colors.primary },
  segText:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  segTextActive: { color: '#fff' },

  container:     { flex: 1 },
  // Below the chip bar and the map/list control, clear of every bottom panel.
  locateWrap:    { position: 'absolute', top: 100, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 6 },
  locateBtn:     { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardBg,
                   alignItems: 'center', justifyContent: 'center', ...shadow },
  locateBtnOn:   { backgroundColor: ROUTE_COLOR },
  recenterPill:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36,
                   borderRadius: 18, backgroundColor: ROUTE_COLOR, ...shadow },
  recenterText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  map:           { flex: 1 },
  loading:       { position: 'absolute', top: 66, alignSelf: 'center', backgroundColor: colors.cardBg, borderRadius: 20, padding: 10, ...shadow },
  card:          { position: 'absolute', bottom: 24, left: 16, right: 16, backgroundColor: colors.cardBg, borderRadius: 20, padding: 16, ...shadow },
  cardRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  thumb:         { width: 52, height: 52, borderRadius: 14, flexShrink: 0 },
  thumbFallback: { justifyContent: 'center', alignItems: 'center' },
  typeBadge:     { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  typeBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  name:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.2 },
  sub:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  viewBtn:       { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  viewBtnText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
