import { StyleSheet } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { colors } from '../constants/theme'

const LEFKOSA = { latitude: 35.1856, longitude: 33.3823, latitudeDelta: 0.08, longitudeDelta: 0.08 }
const PIN_COLORS = { pharmacy: '#7C3AED', clinic: '#0E7C7B', hospital: '#D1495B', dentist: '#2E9E5B' }

export default function MapScreen({ facilities, dutyFacilityId, userLocation, onSelectFacility, onSelectUnclaimed, lang = 'English' }) {
  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : LEFKOSA

  const mapped = facilities.filter(f => f.latitude != null && f.longitude != null)

  return (
    <MapView style={styles.map} initialRegion={initialRegion} showsUserLocation={!!userLocation}>
      {mapped.map(facility => (
        <Marker
          key={facility.id}
          coordinate={{ latitude: facility.latitude, longitude: facility.longitude }}
          pinColor={facility.id === dutyFacilityId ? colors.accent : (PIN_COLORS[facility.type] ?? colors.primary)}
          tracksViewChanges={false}
          title={facility.name}
          onPress={() => facility.provider_id ? onSelectFacility(facility) : onSelectUnclaimed(facility)}
        />
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map:           { flex: 1 },
})
