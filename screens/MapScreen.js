import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const LEFKOSA    = { latitude: 35.1856, longitude: 33.3823, latitudeDelta: 0.08, longitudeDelta: 0.08 }
const PIN_COLORS = { pharmacy: '#7C3AED', clinic: '#0E7C7B', hospital: '#D1495B', dentist: '#2E9E5B' }
const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

export default function MapScreen({ facilities, dutyFacilityId, userLocation, onSelectFacility, onSelectUnclaimed, lang = 'en' }) {
  const [selectedPin, setSelectedPin] = useState(null)

  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : LEFKOSA

  const mapped = facilities.filter(f => f.latitude != null && f.longitude != null)

  const tc = selectedPin ? (typeColors[selectedPin.type] ?? typeColors.clinic) : null

  function handleViewProfile() {
    if (!selectedPin) return
    const facility = selectedPin
    setSelectedPin(null)
    if (facility.provider_id) {
      onSelectFacility(facility)
    } else {
      onSelectUnclaimed(facility)
    }
  }

  return (
    <View style={s.container}>
      <MapView
        style={s.map}
        initialRegion={initialRegion}
        showsUserLocation={!!userLocation}
        onPress={() => setSelectedPin(null)}
      >
        {mapped.map(facility => (
          <Marker
            key={facility.id}
            coordinate={{ latitude: facility.latitude, longitude: facility.longitude }}
            pinColor={facility.id === dutyFacilityId ? colors.accent : (PIN_COLORS[facility.type] ?? colors.primary)}
            tracksViewChanges={false}
            onPress={() => setSelectedPin(facility)}
          />
        ))}
      </MapView>

      {selectedPin && (
        <View style={s.card}>
          <View style={s.cardRow}>
            {selectedPin.logo_url
              ? <Image source={{ uri: selectedPin.logo_url }} style={s.logo} resizeMode="contain" />
              : <View style={[s.logo, s.logoFallback, { backgroundColor: tc.bg }]}>
                  <Text style={{ fontSize: 20 }}>{TYPE_ICONS[selectedPin.type] ?? '🏥'}</Text>
                </View>
            }
            <View style={{ flex: 1 }}>
              <View style={[s.typeBadge, { backgroundColor: tc.bg }]}>
                <Text style={[s.typeBadgeText, { color: tc.text }]}>{t(selectedPin.type, lang)}</Text>
              </View>
              <Text style={s.name} numberOfLines={1}>{selectedPin.name}</Text>
              {selectedPin.address
                ? <Text style={s.address} numberOfLines={1}>{selectedPin.address}</Text>
                : null
              }
            </View>
            <TouchableOpacity
              onPress={() => setSelectedPin(null)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.viewBtn} onPress={handleViewProfile} activeOpacity={0.85}>
            <Text style={s.viewBtnText}>{t('viewProfile', lang)}</Text>
            <Ionicons name="chevron-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container:    { flex: 1 },
  map:          { flex: 1 },
  card:         { position: 'absolute', bottom: 24, left: 16, right: 16, backgroundColor: colors.cardBg, borderRadius: 20, padding: 16, ...shadow },
  cardRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  logo:         { width: 52, height: 52, borderRadius: 14, flexShrink: 0 },
  logoFallback: { justifyContent: 'center', alignItems: 'center' },
  typeBadge:    { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  typeBadgeText:{ fontSize: 10, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  name:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.2 },
  address:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  viewBtn:      { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  viewBtnText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
})
