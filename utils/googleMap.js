// Can THIS binary draw a Google map? Google Places content may only be shown on a Google map
// (Maps Platform Service Specific Terms §14.2), so the Google provider and every Google pin
// are gated on this.
//   Android: react-native-maps always renders Google Maps.
//   iOS: only a binary built with ios.config.googleMapsApiKey carries the Google Maps SDK
//        (Expo's withMaps adds the react-native-google-maps pod only then). The test is the
//        one react-native-maps makes itself (lib/decorateMapComponent.js googleMapIsInstalled):
//        is the AIRGoogleMap view manager registered. So an OTA of this code onto a 1.3.0
//        iPhone — or a later build that forgot the key — keeps Apple Maps instead of the blank
//        "not supported" view PROVIDER_GOOGLE would give it.
import { Platform, UIManager } from 'react-native'
import { PROVIDER_GOOGLE } from 'react-native-maps'

const IOS_GOOGLE = Platform.OS === 'ios' && !!UIManager.hasViewManagerConfig?.('AIRGoogleMap')

export const GOOGLE_MAP_OK = Platform.OS === 'android' || IOS_GOOGLE
export const MAP_PROVIDER = IOS_GOOGLE ? PROVIDER_GOOGLE : undefined

// Google's own business / POI labels off, so only ADA's pins carry places. Roads, water and
// towns stay. Only ever passed with a Google provider (Apple ignores customMapStyle).
export const NO_POI_STYLE = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]
