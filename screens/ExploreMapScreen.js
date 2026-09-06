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
  ActivityIndicator, ScrollView, useWindowDimensions,
} from 'react-native'
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
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const TYPE_EMOJI = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

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

function Chip({ label, count, color, colorBg, active, icon, onPress }) {
  return (
    <TouchableOpacity
      style={[ch.chip, active && { backgroundColor: colorBg, borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {icon
        ? <Feather name={icon} size={13} color={active ? color : colors.textSecondary} />
        : color ? <View style={[ch.dot, { backgroundColor: color }]} /> : null}
      <Text style={[ch.label, active && { color }]} numberOfLines={1}>{label}</Text>
      {count != null && (
        <Text style={[ch.count, active && { color }]}>{count}</Text>
      )}
    </TouchableOpacity>
  )
}

function ChipRow({ sources, selectedKeys, onToggle, onAll, openNow, canOpenNow, onOpenNow, lang }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={ch.bar}
      contentContainerStyle={ch.barContent}
    >
      <Chip
        label={t('all', lang)}
        active={selectedKeys.size === 0}
        color={colors.primary}
        colorBg={colors.primaryLight}
        onPress={onAll}
      />
      {/* Hidden while no facility has parseable hours — see openNowApplicable(). */}
      {canOpenNow && (
        <Chip
          label={t('openNow', lang)}
          icon="clock"
          active={openNow}
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
          active={selectedKeys.has(src.key)}
          onPress={() => onToggle(src.key)}
        />
      ))}
    </ScrollView>
  )
}

function PinCard({ pin, lang, onClose, onViewProfile }) {
  const isHealth = pin.kind === 'health'
  const row      = pin.row

  const tc = { bg: pin.colorBg, text: pin.color }

  const photo = isHealth ? row.logo_url : (row.cover_image_url || row.photos?.[0])
  const title = isHealth ? row.name : placeName(row, lang)

  const badge = isHealth
    ? t(row.type, lang)
    : (CATEGORY_LABEL_KEY[row.category] ? t(CATEGORY_LABEL_KEY[row.category], lang) : row.category)

  const sub = isHealth
    ? row.address
    : (REGION_LABEL_KEY[row.region] ? t(REGION_LABEL_KEY[row.region], lang) : row.region)

  return (
    <View style={s.card}>
      <View style={s.cardRow}>
        {photo
          ? <Image source={{ uri: photo }} style={s.thumb} resizeMode={isHealth ? 'contain' : 'cover'} />
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

  const [places, setPlaces]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  // Empty set = "All". See selectedPins(): All is the UNION OF VISIBLE SOURCES, never a
  // bypass of the gate — the default path is the one nearly every user takes, so it is
  // the path that most needs the gate on it.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [openNow, setOpenNow] = useState(false)

  const initialRegion = useMemo(() => (
    userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude,
          latitudeDelta: 0.5, longitudeDelta: 0.5 }
      : TRNC_CENTER
  ), [userLocation])

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
      let q = supabase.from('places').select(BROWSE_COLS).eq('status', 'active')
      const cats = mapFetchCategories(isAdmin)
      if (cats) q = q.in('category', cats)
      const { data } = await q
      if (!active) return
      setPlaces(data || [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [isAdmin])

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
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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
        showsUserLocation={!!userLocation}
        onRegionChangeComplete={setRegion}
        onPress={() => setSelected(null)}
      >
        {clusters.map(c => {
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
        onAll={() => { setSelected(null); setSelectedKeys(new Set()) }}
        openNow={openNow}
        canOpenNow={canOpenNow}
        onOpenNow={() => { setSelected(null); setOpenNow(v => !v) }}
        lang={lang}
      />

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
            if (pin.kind === 'place') { onSelectPlace?.(pin.row); return }
            // Health keeps the claimed / unclaimed split the tab has always had: an
            // unclaimed facility has no provider and opens the unclaimed sheet instead.
            if (pin.row.provider_id) onSelectFacility?.(pin.row)
            else onSelectUnclaimed?.(pin.row)
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
  label:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
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
