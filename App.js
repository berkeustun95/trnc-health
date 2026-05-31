import { useEffect, useState } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Platform, TextInput, ScrollView } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useFonts, Inter_400Regular, Inter_700Bold } from '@expo-google-fonts/inter'
import { supabase } from './lib/supabase'
import { colors, typeColors, shadow } from './constants/theme'
import { t } from './constants/i18n'
import AuthScreen from './screens/AuthScreen'
import BookingScreen from './screens/BookingScreen'
import ProviderScreen from './screens/ProviderScreen'
import MapScreen from './screens/MapScreen'
import AdminScreen from './screens/AdminScreen'
import ProfileScreen from './screens/ProfileScreen'
import QuizNavigator from './screens/quiz/QuizNavigator'
import ResultsScreen from './screens/quiz/ResultsScreen'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

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
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_700Bold })
  const [session, setSession] = useState(undefined)
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [dutyFacilityId, setDutyFacilityId] = useState(null)
  const [selectedFacility, setSelectedFacility] = useState(null)
  const [profile, setProfile] = useState(null)
  const [view, setView] = useState('list')
  const [showProfile, setShowProfile] = useState(false)
  const [showQuiz, setShowQuiz] = useState(false)
  const [latestResult, setLatestResult] = useState(null)
  const [showLatestResult, setShowLatestResult] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [activeType, setActiveType] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); setLatestResult(null); return }
    supabase.from('profiles').select('role, preferred_language').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data ?? null))
    fetchLatestResult(session.user.id)
  }, [session])

  async function fetchLatestResult(userId) {
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, final_result, reviewed_at, facilities(name)')
      .eq('customer_id', userId)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setLatestResult(data ?? null)
  }

  useEffect(() => {
    if (!session) return
    async function registerPushToken() {
      try {
        if (!Device.isDevice) return
        const { status } = await Notifications.requestPermissionsAsync()
        if (status !== 'granted') return
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
          })
        }
        const { data: token } = await Notifications.getExpoPushTokenAsync()
        if (token) {
          await supabase.from('profiles').update({ push_token: token }).eq('id', session.user.id)
        }
      } catch (e) {
        console.log('Push registration skipped:', e.message)
      }
    }
    registerPushToken()
  }, [session])

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from('facilities').select('*').order('name')
      if (error) console.error(error)
      else setFacilities(data)

      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const { data: duty } = await supabase
        .from('duty_schedule').select('facility_id').eq('date', today).maybeSingle()
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
        : null,
    }))
    .sort((a, b) => {
      if (a.id === dutyFacilityId) return -1
      if (b.id === dutyFacilityId) return 1
      if (a._dist == null && b._dist == null) return 0
      if (a._dist == null) return 1
      if (b._dist == null) return -1
      return a._dist - b._dist
    })
    .filter(f => !activeType || f.type === activeType)
    .filter(f => {
      const q = searchText.trim().toLowerCase()
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        (f.address && f.address.toLowerCase().includes(q))
      )
    })

  const lang = profile?.preferred_language || 'English'

  let content

  if (session === undefined || !fontsLoaded) {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  } else if (!session) {
    content = <AuthScreen />
  } else if (loading || !profile) {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  } else if (profile.role === 'admin') {
    content = <AdminScreen session={session} />
  } else if (profile.role === 'provider') {
    content = <ProviderScreen session={session} />
  } else if (showLatestResult && latestResult) {
    content = <ResultsScreen
      result={latestResult.final_result}
      onBack={() => setShowLatestResult(false)}
      readOnly
    />
  } else if (showQuiz) {
    content = <QuizNavigator onClose={() => { setShowQuiz(false); fetchLatestResult(session.user.id) }} profileLang={lang} />
  } else if (showProfile) {
    content = <ProfileScreen
      session={session}
      lang={lang}
      onBack={() => setShowProfile(false)}
      onLangChange={newLang => setProfile(prev => ({ ...prev, preferred_language: newLang }))}
    />
  } else if (selectedFacility) {
    content = <BookingScreen facility={selectedFacility} session={session} lang={lang} onBack={() => setSelectedFacility(null)} />
  } else {
    content = (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.wordmark}>TRNC Health</Text>
            <View style={styles.headerRight}>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'list' && styles.toggleBtnActive]}
                  onPress={() => setView('list')}
                >
                  <Text style={[styles.toggleText, view === 'list' && styles.toggleTextActive]}>{t('list', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'map' && styles.toggleBtnActive]}
                  onPress={() => setView('map')}
                >
                  <Text style={[styles.toggleText, view === 'map' && styles.toggleTextActive]}>{t('map', lang)}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.quizBtn} onPress={() => setShowQuiz(true)}>
                <Text style={styles.quizBtnText}>💊</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatarBtn} onPress={() => setShowProfile(true)}>
                <Text style={styles.avatarBtnText}>
                  {session.user.email[0].toUpperCase()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search by name or address…"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterContent}
          >
            {[null, 'pharmacy', 'clinic', 'hospital', 'dentist'].map(type => (
              <TouchableOpacity
                key={type ?? 'all'}
                style={[styles.filterChip, activeType === type && styles.filterChipActive]}
                onPress={() => setActiveType(type)}
              >
                <Text style={[styles.filterChipText, activeType === type && styles.filterChipTextActive]}>
                  {type ? t(type, lang) : t('all', lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {latestResult && (
            <TouchableOpacity style={styles.resultCard} onPress={() => setShowLatestResult(true)} activeOpacity={0.8}>
              <View style={styles.resultCardLeft}>
                <Text style={styles.resultCardEmoji}>💊</Text>
                <View>
                  <Text style={styles.resultCardTitle}>Your Supplement Plan</Text>
                  <Text style={styles.resultCardSub}>
                    Approved by {latestResult.facilities?.name} · {new Date(latestResult.reviewed_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
              <Text style={styles.resultCardArrow}>→</Text>
            </TouchableOpacity>
          )}

          {view === 'map' ? (
            <MapScreen
              facilities={facilities}
              dutyFacilityId={dutyFacilityId}
              userLocation={userLocation}
              onSelectFacility={setSelectedFacility}
            />
          ) : (
            <>
              {locationDenied && (
                <Text style={styles.locationNote}>{t('enableLocation', lang)}</Text>
              )}
              <FlatList
                data={listed}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const isOpen = parseIsOpen(item.opening_hours)
                  const tc = typeColors[item.type] || typeColors.clinic
                  const isDuty = item.id === dutyFacilityId
                  return (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={[styles.card, isDuty && styles.dutyCard]}
                      onPress={() => setSelectedFacility(item)}
                    >
                      {isDuty && (
                        <View style={styles.dutyBanner}>
                          <Text style={styles.dutyLabel}>{t('onDuty', lang)}</Text>
                        </View>
                      )}
                      <View style={styles.cardTop}>
                        <Text style={styles.facilityName} numberOfLines={1}>{item.name}</Text>
                        {item._dist != null && (
                          <Text style={styles.distanceText}>{item._dist.toFixed(1)} km</Text>
                        )}
                      </View>
                      <View style={styles.badgeRow}>
                        <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
                          <Text style={[styles.typeBadgeText, { color: tc.text }]}>{t(item.type, lang)}</Text>
                        </View>
                        {isOpen != null && (
                          <View style={[styles.statusBadge, isOpen ? styles.openBadge : styles.closedBadge]}>
                            <Text style={[styles.statusText, isOpen ? styles.openText : styles.closedText]}>
                              {isOpen ? t('open', lang) : t('closed', lang)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.addressText} numberOfLines={1}>{item.address}</Text>
                    </TouchableOpacity>
                  )
                }}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    )
  }

  return <SafeAreaProvider>{content}</SafeAreaProvider>
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  container:        { flex: 1, paddingHorizontal: 16 },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 12 },
  wordmark:         { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5 },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewToggle:       { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2 },
  toggleBtn:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  toggleBtnActive:  { backgroundColor: colors.surface, ...shadow },
  toggleText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  toggleTextActive: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  quizBtn:          { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentLight, justifyContent: 'center', alignItems: 'center' },
  quizBtnText:      { fontSize: 16 },
  avatarBtn:        { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  avatarBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  locationNote:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 10, textAlign: 'center' },
  searchBar:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, gap: 8 },
  searchIcon:       { fontSize: 15 },
  searchInput:      { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  searchClear:      { fontSize: 13, color: colors.textSecondary, paddingHorizontal: 4 },
  filterRow:        { marginBottom: 12 },
  filterContent:    { gap: 8, paddingRight: 4 },
  filterChip:       { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterChipText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textTransform: 'capitalize' },
  filterChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  listContent:      { paddingBottom: 32 },
  card:             { backgroundColor: colors.cardBg, borderRadius: 12, padding: 16, marginBottom: 10, ...shadow },
  dutyCard:         { borderWidth: 1.5, borderColor: colors.accent },
  dutyBanner:       { backgroundColor: colors.accentLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 10 },
  dutyLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTop:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  facilityName:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, marginRight: 8 },
  distanceText:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  badgeRow:         { flexDirection: 'row', gap: 6, marginBottom: 8 },
  typeBadge:        { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:    { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  statusBadge:      { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  openBadge:        { backgroundColor: colors.successLight },
  closedBadge:      { backgroundColor: colors.dangerLight },
  statusText:       { fontSize: 12, fontFamily: 'Inter_700Bold' },
  openText:         { color: colors.success },
  closedText:       { color: colors.danger },
  addressText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  resultCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: colors.primary + '30' },
  resultCardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  resultCardEmoji:  { fontSize: 28 },
  resultCardTitle:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 2 },
  resultCardSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary + 'AA' },
  resultCardArrow:  { fontSize: 16, color: colors.primary, fontFamily: 'Inter_700Bold' },
})
