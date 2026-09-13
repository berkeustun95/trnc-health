import { View, StyleSheet } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { colors } from '../constants/theme'
import { mappableStores } from '../lib/connectivity'

// A READ-ONLY map of an operator's stores.
//
// ⚠ THE BRIEF SAID "REUSE THE GARAGES MAP COMPONENT". THERE IS NO SUCH COMPONENT.
//   screens/GaragesScreen.js has no map at all, and components/CoverageMap.js — the only
//   other map-shaped thing — is the TOWING module's static PNG region mask: seven
//   pre-rasterised polygons, no tiles, no coordinates, deliberately offline. It cannot
//   plot a pin. So this is the thin wrapper the brief allowed for instead, built on
//   react-native-maps, which is already a dependency (1.20.1) and already the map
//   everywhere else in the app. No second map implementation is introduced.
//
// The read-only treatment is lifted verbatim from screens/DormPartnerScreen.js — a
// MapView with `pointerEvents="none"` and Markers. That is what makes it read-only: the
// map does not pan, zoom or intercept a touch, so it reads as a picture of where the
// stores are and the surrounding card stays scrollable. A gesture-enabled map inside a
// ScrollView steals vertical drags and makes the page feel broken.
//
// ⚠ RENDERS NOTHING when no store has coordinates. An address-only store row is legitimate
//   and still belongs in the LIST beside this map — it just cannot be a pin. Returning null
//   rather than an empty map matters because a MapView with no markers shows an arbitrary
//   region (the middle of the ocean, by default), which looks like a bug rather than an
//   absence. The caller decides what to draw instead; see ConnectivityPackageScreen.

// Padding around the bounding box of the pins, in degrees. Enough that a marker never sits
// against the frame edge, and enough that a single store does not render fully zoomed in.
const MIN_DELTA = 0.02
const PAD = 1.6

function regionFor(stores) {
  const lats = stores.map(s => s.latitude)
  const lngs = stores.map(s => s.longitude)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  return {
    latitude:  (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta:  Math.max((maxLat - minLat) * PAD, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PAD, MIN_DELTA),
  }
}

export default function StoreMap({ stores, height = 120, pinColor, style }) {
  const pins = mappableStores(stores)
  if (!pins.length) return null

  return (
    <View style={[{ height }, style]} pointerEvents="none">
      <MapView
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        initialRegion={regionFor(pins)}
        // Belt and braces: pointerEvents already blocks touches, but a future caller that
        // drops the wrapper should not silently get an interactive map back.
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {pins.map(store => (
          <Marker
            key={store.id}
            coordinate={{ latitude: store.latitude, longitude: store.longitude }}
            title={store.name ?? undefined}
            description={store.address ?? undefined}
            pinColor={pinColor}
          />
        ))}
      </MapView>
    </View>
  )
}

export const STORE_MAP_FALLBACK_BG = colors.primaryLight
