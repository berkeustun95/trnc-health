import { useState, useRef, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet, ActivityIndicator } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { Feather } from '@expo/vector-icons'
import { colors } from '../constants/theme'

const NICOSIA = { latitude: 35.1856, longitude: 33.3823 }
const DELTA   = { latitudeDelta: 0.012, longitudeDelta: 0.012 }

export default function MapPinPicker({ visible, initialLat, initialLng, onConfirm, onCancel }) {
  const [coord, setCoord]     = useState(NICOSIA)
  const [locating, setLocating] = useState(false)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!visible) return
    const target = initialLat != null && initialLng != null
      ? { latitude: initialLat, longitude: initialLng }
      : NICOSIA
    setCoord(target)
    setTimeout(() => {
      mapRef.current?.animateToRegion({ ...target, ...DELTA }, 300)
    }, 150)
  }, [visible])

  function handleMapPress(e) {
    setCoord(e.nativeEvent.coordinate)
  }

  function handleDragEnd(e) {
    setCoord(e.nativeEvent.coordinate)
  }

  async function useMyLocation() {
    setLocating(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { setLocating(false); return }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const target = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setCoord(target)
      mapRef.current?.animateToRegion({ ...target, ...DELTA }, 500)
    } catch {}
    setLocating(false)
  }

  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>Pin Your Location</Text>
          <View style={s.headerRight} />
        </View>

        <MapView
          ref={mapRef}
          style={s.map}
          initialRegion={{ ...NICOSIA, ...DELTA }}
          onPress={handleMapPress}
          showsUserLocation
          showsMyLocationButton={false}
        >
          <Marker
            coordinate={coord}
            draggable
            onDragEnd={handleDragEnd}
            pinColor={colors.primary}
          />
        </MapView>

        <View style={s.hint}>
          <Feather name="info" size={12} color={colors.textSecondary} />
          <Text style={s.hintText}>Tap the map or drag the pin to position your facility exactly.</Text>
        </View>

        <View style={s.bottom}>
          <View style={s.coordPill}>
            <Feather name="map-pin" size={13} color={colors.primary} />
            <Text style={s.coordText}>
              {coord.latitude.toFixed(5)},  {coord.longitude.toFixed(5)}
            </Text>
          </View>
          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.myLocBtn, locating && s.disabled]}
              onPress={useMyLocation}
              disabled={locating}
              activeOpacity={0.8}
            >
              {locating
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Feather name="crosshair" size={15} color={colors.primary} />
              }
              <Text style={s.myLocText}>{locating ? 'Finding…' : 'My location'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.confirmBtn}
              onPress={() => onConfirm(coord.latitude, coord.longitude)}
              activeOpacity={0.8}
            >
              <Text style={s.confirmText}>Confirm Pin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#fff' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  cancelText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, minWidth: 60 },
  title:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  headerRight:{ minWidth: 60 },
  map:        { flex: 1 },
  hint:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.bg },
  hintText:   { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },
  bottom:     { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#F0F0F0', gap: 12 },
  coordPill:  { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  coordText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  btnRow:     { flexDirection: 'row', gap: 10 },
  myLocBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 13 },
  myLocText:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
  confirmBtn: { flex: 1.6, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  disabled:   { opacity: 0.6 },
})
