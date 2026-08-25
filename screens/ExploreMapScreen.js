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
  ActivityIndicator, useWindowDimensions,
} from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import Supercluster from 'supercluster'
import { supabase } from '../lib/supabase'
import { BROWSE_COLS, TRNC_CENTER, placeName } from './ExploreScreen'
import { buildMapSources, mapFetchCategories } from '../constants/mapSources'
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
}) {
  const { width, height } = useWindowDimensions()
  const mapRef = useRef(null)

  const [places, setPlaces]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

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

  const pins = useMemo(() => sources.flatMap(src => src.pins), [sources])

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

const cl = StyleSheet.create({
  bubble: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 2.5, borderColor: '#fff', ...shadow },
  count:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})

const s = StyleSheet.create({
  container:     { flex: 1 },
  map:           { flex: 1 },
  loading:       { position: 'absolute', top: 16, alignSelf: 'center', backgroundColor: colors.cardBg, borderRadius: 20, padding: 10, ...shadow },
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
