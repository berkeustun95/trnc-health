import { StyleSheet, View, Text } from 'react-native'
import MapView, { Marker, Callout } from 'react-native-maps'
import { colors } from '../constants/theme'

const LEFKOSA = { latitude: 35.1856, longitude: 33.3823, latitudeDelta: 0.08, longitudeDelta: 0.08 }

export default function MapScreen({ facilities, dutyFacilityId, userLocation, onSelectFacility }) {
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
          pinColor={facility.id === dutyFacilityId ? colors.accent : colors.danger}
        >
          <Callout onPress={() => onSelectFacility(facility)}>
            <View style={styles.callout}>
              <Text style={styles.calloutName}>{facility.name}</Text>
              <Text style={styles.calloutType}>{facility.type}</Text>
              <Text style={styles.calloutAction}>Tap to book</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map:           { flex: 1 },
  callout:       { width: 180, padding: 4 },
  calloutName:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  calloutType:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textTransform: 'capitalize', marginBottom: 6 },
  calloutAction: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.accent },
})
