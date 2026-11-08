// Icon pins on the Keşfet map (Berke 2026-11-08). The hue wheel is full, so these layers differ by SHAPE
// and ICON, never by a new colour: gyms a barbell disc, services a wrench disc (group tokens), and partner
// eateries their logo in a white circle with a star — drawn on top, never clustered (the free OSM cafés
// beside them stay plain pins, which is what makes the partner stand out).
import { useState, useEffect } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { colors, placeColors } from '../constants/theme'
import { GROUP_META, ICON_PIN } from '../constants/exploreCategories'
import { eateryImageUrl } from './EateryBits'

// Android snapshots a custom-child Marker: track briefly after mount, then stop (HotelMarker).
function useBriefTracking(ready = true) {
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    if (!ready) return
    const id = setTimeout(() => setTracks(false), 300)
    return () => clearTimeout(id)
  }, [ready])
  return tracks
}

export function PlaceIconMarker({ pin, onPress }) {
  const tracks = useBriefTracking()
  const ink = GROUP_META[pin.group]?.colorToken?.text || placeColors.landmark.text
  return (
    <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} tracksViewChanges={tracks} anchor={{ x: 0.5, y: 0.5 }}
      onPress={e => { e.stopPropagation(); onPress() }}>
      <View collapsable={false} style={[m.disc, { backgroundColor: ink }]}>
        <Ionicons name={ICON_PIN[pin.group].icon} size={14} color="#fff" />
      </View>
    </Marker>
  )
}

// The remote logo must be in the snapshot: keep tracking until it has loaded (or failed), then 300 ms.
export function PartnerMarker({ pin, onPress }) {
  const uri = eateryImageUrl(pin.row.logo_path)
  const [loaded, setLoaded] = useState(!uri)
  const tracks = useBriefTracking(loaded)
  return (
    <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} tracksViewChanges={tracks} anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1000} onPress={e => { e.stopPropagation(); onPress() }}>
      <View collapsable={false} style={m.partnerWrap}>
        <View collapsable={false} style={m.partner}>
          {uri
            ? <Image source={{ uri }} style={m.logo} resizeMode="contain" onLoadEnd={() => setLoaded(true)} />
            : <Ionicons name="restaurant" size={18} color={placeColors.eatery.text} />}
        </View>
        <View collapsable={false} style={m.star}>
          <Ionicons name="star" size={9} color="#fff" />
        </View>
      </View>
    </Marker>
  )
}

const m = StyleSheet.create({
  disc:        { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  // Row layout + negative margin keeps the badge inside the snapshot bounds (the stage 2 marker-badge fix).
  partnerWrap: { flexDirection: 'row', padding: 2 },
  partner:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 2.5, borderColor: placeColors.eatery.text,
                 alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo:        { width: 30, height: 30 },
  star:        { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 1.5, borderColor: '#fff',
                 alignItems: 'center', justifyContent: 'center', marginLeft: -12, marginTop: -2 },
})
