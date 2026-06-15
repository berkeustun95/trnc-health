import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const LEFKOSA    = { latitude: 35.1856, longitude: 33.3823, latitudeDelta: 0.08, longitudeDelta: 0.08 }
const PIN_COLORS = { pharmacy: '#7C3AED', clinic: '#0E7C7B', hospital: '#D1495B', dentist: '#2E9E5B' }
const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }
const FACILITY_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']
const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }

function parseIsOpen(hours) {
  if (!hours) return null
  if (hours.trim() === '24/7') return true
  const match = hours.match(/^([A-Z][a-z]+)-([A-Z][a-z]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (!match) return null
  const [, startDay, endDay, startTime, endTime] = match
  const dayStart = DAY_INDEX[startDay]
  const dayEnd   = DAY_INDEX[endDay]
  if (dayStart == null || dayEnd == null || dayStart > dayEnd) return null
  const now = new Date()
  const day = now.getDay()
  if (day < dayStart || day > dayEnd) return false
  const toMins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const nowMins = now.getHours() * 60 + now.getMinutes()
  return nowMins >= toMins(startTime) && nowMins < toMins(endTime)
}

export default function MapScreen({ facilities, dutyFacilityId, userLocation, onSelectFacility, onSelectUnclaimed, lang = 'en' }) {
  const [selectedPin, setSelectedPin] = useState(null)
  const [filterType, setFilterType]   = useState(null)
  const [openOnly, setOpenOnly]       = useState(false)

  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : LEFKOSA

  const mapped = facilities
    .filter(f => f.latitude != null && f.longitude != null)
    .filter(f => filterType == null || f.type === filterType)
    .filter(f => !openOnly || parseIsOpen(f.opening_hours) === true)

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

  function setFilter(type) {
    setFilterType(prev => prev === type ? null : type)
    setSelectedPin(null)
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterBar}
        contentContainerStyle={s.filterBarContent}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={[s.filterChip, openOnly && { backgroundColor: colors.successLight, borderColor: colors.success }]}
          onPress={() => { setOpenOnly(v => !v); setSelectedPin(null) }}
          activeOpacity={0.8}
        >
          <Feather name="clock" size={13} color={openOnly ? colors.success : colors.textSecondary} />
          <Text style={[s.filterChipText, openOnly && { color: colors.success }]}>
            {t('openNow', lang)}
          </Text>
        </TouchableOpacity>
        {FACILITY_TYPES.map(type => {
          const active = filterType === type
          const tc = typeColors[type] ?? typeColors.clinic
          return (
            <TouchableOpacity
              key={type}
              style={[s.filterChip, active && { backgroundColor: tc.bg, borderColor: tc.text }]}
              onPress={() => setFilter(type)}
              activeOpacity={0.8}
            >
              <Text style={s.filterChipEmoji}>{TYPE_ICONS[type]}</Text>
              <Text style={[s.filterChipText, active && { color: tc.text }]}>
                {t(type, lang)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

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
  filterBar:        { position: 'absolute', top: 12, left: 0, right: 0, zIndex: 10 },
  filterBarContent: { paddingHorizontal: 12, gap: 8, flexDirection: 'row' },
  filterChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow },
  filterChipEmoji:  { fontSize: 14 },
  filterChipText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'capitalize' },
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
