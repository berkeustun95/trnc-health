import { useEffect, useState } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import * as Location from 'expo-location'
import { supabase } from './lib/supabase'
import AuthScreen from './screens/AuthScreen'

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }

function parseIsOpen(hours) {
  if (!hours) return null
  if (hours.trim() === '24/7') return true
  const match = hours.match(/^([A-Z][a-z]+)-([A-Z][a-z]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (!match) return null
  const [, startDay, endDay, startTime, endTime] = match
  const dayStart = DAY_INDEX[startDay]
  const dayEnd = DAY_INDEX[endDay]
  if (dayStart == null || dayEnd == null || dayStart > dayEnd) return null
  const now = new Date()
  const day = now.getDay()
  if (day < dayStart || day > dayEnd) return false
  const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const nowMins = now.getHours() * 60 + now.getMinutes()
  return nowMins >= toMins(startTime) && nowMins < toMins(endTime)
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [dutyFacilityId, setDutyFacilityId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('facilities')
        .select('*')
        .order('name')
      if (error) console.error(error)
      else setFacilities(data)

      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const { data: duty } = await supabase
        .from('duty_schedule')
        .select('facility_id')
        .eq('date', today)
        .maybeSingle()
      if (duty) setDutyFacilityId(duty.facility_id)

      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          setLocationDenied(true)
        } else {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          setUserLocation(loc.coords)
        }
      } catch {
        setLocationDenied(true)
      }

      setLoading(false)
    }
    load()
  }, [])

  const listed = facilities
    .map(f => ({
      ...f,
      _dist: userLocation && f.latitude != null && f.longitude != null
        ? haversineKm(userLocation.latitude, userLocation.longitude, f.latitude, f.longitude)
        : null
    }))
    .sort((a, b) => {
      if (a.id === dutyFacilityId) return -1
      if (b.id === dutyFacilityId) return 1
      if (a._dist == null && b._dist == null) return 0
      if (a._dist == null) return 1
      if (b._dist == null) return -1
      return a._dist - b._dist
    })

  if (session === undefined) return <View style={styles.center}><ActivityIndicator size="large" /></View>
  if (!session) return <AuthScreen />

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Health Services Near You</Text>
      {locationDenied && (
        <Text style={styles.locationNote}>Enable location to see nearest services.</Text>
      )}
      <FlatList
        data={listed}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isOpen = parseIsOpen(item.opening_hours)
          return (
            <View style={[styles.card, item.id === dutyFacilityId && styles.dutyCard]}>
              {item.id === dutyFacilityId && (
                <Text style={styles.dutyLabel}>On duty tonight</Text>
              )}
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.type}>{item.type}</Text>
              <Text style={styles.detail}>{item.address}</Text>
              <Text style={styles.detail}>{item.opening_hours}</Text>
              {isOpen != null && (
                <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
                  <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
                    {isOpen ? 'Open now' : 'Closed'}
                  </Text>
                </View>
              )}
              {item._dist != null && (
                <Text style={styles.distance}>{item._dist.toFixed(1)} km away</Text>
              )}
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:       { flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: '#fff' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading:         { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  locationNote:    { fontSize: 13, color: '#6b7280', marginBottom: 10, textAlign: 'center' },
  card:            { padding: 14, borderRadius: 10, backgroundColor: '#f3f4f6', marginBottom: 10 },
  dutyCard:        { backgroundColor: '#fef9c3', borderColor: '#fbbf24', borderWidth: 1 },
  dutyLabel:       { fontSize: 12, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  name:            { fontSize: 17, fontWeight: '600' },
  type:            { fontSize: 13, color: '#2563eb', textTransform: 'capitalize', marginTop: 2 },
  detail:          { fontSize: 14, color: '#444', marginTop: 4 },
  badge:           { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6 },
  badgeOpen:       { backgroundColor: '#dcfce7' },
  badgeClosed:     { backgroundColor: '#fee2e2' },
  badgeText:       { fontSize: 12, fontWeight: '600' },
  badgeTextOpen:   { color: '#15803d' },
  badgeTextClosed: { color: '#dc2626' },
  distance:        { fontSize: 13, color: '#16a34a', fontWeight: '500', marginTop: 4 },
})
