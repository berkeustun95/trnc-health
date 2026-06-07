import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View, Text, Image, ImageBackground, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Platform, TextInput, ScrollView, Linking } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useFonts, Inter_400Regular, Inter_700Bold } from '@expo-google-fonts/inter'
import { Feather, Ionicons } from '@expo/vector-icons'
import { supabase } from './lib/supabase'
import { colors, typeColors, shadow } from './constants/theme'
import { t } from './constants/i18n'
import AuthScreen from './screens/AuthScreen'
import BookingScreen from './screens/BookingScreen'
import ProviderScreen from './screens/ProviderScreen'
import ProviderOnboardingScreen from './screens/ProviderOnboardingScreen'
import MapScreen from './screens/MapScreen'
import AdminScreen from './screens/AdminScreen'
import ProfileScreen from './screens/ProfileScreen'
import QuizNavigator from './screens/quiz/QuizNavigator'
import ResultsScreen from './screens/quiz/ResultsScreen'
import DutyListScreen from './screens/DutyListScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import NotificationsScreen from './screens/NotificationsScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

const TYPE_ICONS = { pharmacy: '💊', clinic: '🩺', hospital: '🏥', dentist: '🦷' }

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
  const [showDutyList, setShowDutyList] = useState(false)
  const [onboarded, setOnboarded] = useState(null)
  const [pendingLang, setPendingLang] = useState('English')
  const [facilityRatings, setFacilityRatings] = useState({})
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [providerFacility, setProviderFacility] = useState(undefined)
  const [pendingClaim, setPendingClaim] = useState(undefined)
  const [unclaimedFacility, setUnclaimedFacility] = useState(null)
  const [favorites, setFavorites] = useState(new Set())
  const [openOnly, setOpenOnly] = useState(false)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [facilityLoadError, setFacilityLoadError] = useState(false)
  const [notifsLoading, setNotifsLoading] = useState(false)

  function toggleFavorite(id) {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      AsyncStorage.setItem('ada_favorites', JSON.stringify([...next]))
      return next
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setShowPasswordReset(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function handleDeepLink(url) {
      if (!url?.startsWith('ada://')) return
      try {
        await supabase.auth.exchangeCodeForSession(url)
      } catch {}
    }
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url) })
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('@trnc_onboarded'),
      AsyncStorage.getItem('@trnc_lang'),
    ]).then(([onboardedVal, langVal]) => {
      if (langVal) setPendingLang(langVal)
      setOnboarded(onboardedVal === 'true')
    })
  }, [])

  async function markAllNotifsRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (!unreadIds.length) return
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function completeOnboarding(selectedLang) {
    await AsyncStorage.multiSet([['@trnc_onboarded', 'true'], ['@trnc_lang', selectedLang]])
    setPendingLang(selectedLang)
    setOnboarded(true)
  }

  async function loadProviderFacility() {
    const { data: fac } = await supabase
      .from('facilities')
      .select('id, name, type, status, membership_tier, trial_ends_at, is_quiz_partner, phone, address, opening_hours')
      .eq('provider_id', session?.user.id)
      .maybeSingle()
    setProviderFacility(fac ?? null)
    if (!fac) {
      const { data: claim } = await supabase
        .from('claim_requests')
        .select('id, requested_tier, facilities(name, type)')
        .eq('requester_id', session?.user.id)
        .eq('status', 'pending')
        .maybeSingle()
      setPendingClaim(claim ?? null)
    } else {
      setPendingClaim(null)
    }
  }

  useEffect(() => {
    if (!session) {
      setProfile(null); setLatestResult(null); setNotifications([]); setProviderFacility(undefined); setPendingClaim(undefined); return
    }
    supabase.from('profiles').select('role, preferred_language').eq('id', session.user.id).single()
      .then(async ({ data }) => {
        setProfile(data ?? null)
        if (data?.role === 'provider') {
          const { data: fac } = await supabase
            .from('facilities')
            .select('id, name, type, status, membership_tier, trial_ends_at, is_quiz_partner, phone, address, opening_hours')
            .eq('provider_id', session.user.id)
            .maybeSingle()
          setProviderFacility(fac ?? null)
          if (!fac) {
            const { data: claim } = await supabase
              .from('claim_requests')
              .select('id, requested_tier, facilities(name, type)')
              .eq('requester_id', session.user.id)
              .eq('status', 'pending')
              .maybeSingle()
            setPendingClaim(claim ?? null)
          } else {
            setPendingClaim(null)
          }
        }
      })
    fetchLatestResult(session.user.id)
    setNotifsLoading(true)
    supabase.from('notifications').select('id, title, body, read, created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setNotifications(data); setNotifsLoading(false) })
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
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: '704d192a-1a80-41f8-ab98-cb3c8f078d7c' })
        if (token) {
          await supabase.from('profiles').update({ push_token: token }).eq('id', session.user.id)
        }
      } catch (e) {
        if (__DEV__) console.log('Push registration skipped:', e.message)
      }
    }
    registerPushToken()
  }, [session])

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setShowNotifs(true)
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    async function load() {
      const favVal = await AsyncStorage.getItem('ada_favorites')
      if (favVal) setFavorites(new Set(JSON.parse(favVal)))

      const { data, error } = await supabase.from('facilities').select('*').order('name')
      if (error) setFacilityLoadError(true)
      else setFacilities(data ?? [])

      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const { data: duty } = await supabase
        .from('duty_schedule').select('facility_id').eq('date', today).maybeSingle()
      if (duty) setDutyFacilityId(duty.facility_id)

      const { data: reviewsData } = await supabase.from('reviews').select('facility_id, rating')
      if (reviewsData?.length) {
        const map = {}
        for (const r of reviewsData) {
          if (!map[r.facility_id]) map[r.facility_id] = { sum: 0, count: 0 }
          map[r.facility_id].sum += r.rating
          map[r.facility_id].count++
        }
        const ratings = {}
        for (const [id, v] of Object.entries(map)) {
          ratings[id] = { avg: (v.sum / v.count).toFixed(1), count: v.count }
        }
        setFacilityRatings(ratings)
      }

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
      const aFav = favorites.has(a.id), bFav = favorites.has(b.id)
      if (aFav && !bFav) return -1
      if (!aFav && bFav) return 1
      if (a._dist == null && b._dist == null) return 0
      if (a._dist == null) return 1
      if (b._dist == null) return -1
      return a._dist - b._dist
    })
    .filter(f => !activeType || f.type === activeType)
    .filter(f => !openOnly || parseIsOpen(f.opening_hours) === true)
    .filter(f => {
      const q = searchText.trim().toLowerCase()
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        (f.address && f.address.toLowerCase().includes(q))
      )
    })

  const lang = profile?.preferred_language || pendingLang

  if (showPasswordReset) {
    return (
      <SafeAreaProvider>
        <ResetPasswordScreen onDone={() => setShowPasswordReset(false)} lang={profile?.preferred_language || pendingLang} />
      </SafeAreaProvider>
    )
  }

  let content

  if (session === undefined || !fontsLoaded || onboarded === null) {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  } else if (onboarded === false) {
    content = <OnboardingScreen onComplete={completeOnboarding} />
  } else if (!session) {
    content = <AuthScreen lang={lang} />
  } else if (loading || !profile) {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  } else if (profile.role === 'admin') {
    content = <AdminScreen session={session} />
  } else if (profile.role === 'provider') {
    if (providerFacility === undefined || (providerFacility === null && pendingClaim === undefined)) {
      content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
    } else if (providerFacility === null && pendingClaim) {
      content = (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: 20 }}>⏳</Text>
            <Text style={styles.wordmark}>{t('claimPending', lang)}</Text>
            <Text style={[styles.subText, { marginTop: 12, marginBottom: 24 }]}>
              {t('claimPendingSub', lang).replace('{name}', pendingClaim.facilities?.name ?? 'your facility')}
            </Text>
            <Text style={styles.memberIdLabel}>{t('membershipId', lang)}</Text>
            <Text style={styles.memberIdValue}>{session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
            <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
              <Text style={styles.signOutLink}>{t('signOut', lang)}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    } else if (providerFacility === null) {
      content = <ProviderOnboardingScreen session={session} onDone={loadProviderFacility} />
    } else if (providerFacility.status === 'pending') {
      content = (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: 20 }}>⏳</Text>
            <Text style={styles.wordmark}>{t('pendingVerification', lang)}</Text>
            <Text style={[styles.subText, { marginTop: 12, marginBottom: 24 }]}>
              {t('pendingVerificationSub', lang)}
            </Text>
            <Text style={styles.memberIdLabel}>{t('membershipId', lang)}</Text>
            <Text style={styles.memberIdValue}>{session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
            <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
              <Text style={styles.signOutLink}>{t('signOut', lang)}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    } else if (providerFacility.status === 'suspended') {
      content = (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: 20 }}>🔒</Text>
            <Text style={styles.wordmark}>{t('accountSuspended', lang)}</Text>
            <Text style={[styles.subText, { marginTop: 12, marginBottom: 24 }]}>
              {t('accountSuspendedSub', lang)}
            </Text>
            <Text style={styles.memberIdLabel}>{t('membershipId', lang)}</Text>
            <Text style={styles.memberIdValue}>{session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
            <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
              <Text style={styles.signOutLink}>{t('signOut', lang)}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    } else if (providerFacility.status === 'trial' && providerFacility.trial_ends_at && new Date() > new Date(providerFacility.trial_ends_at)) {
      content = (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: 20 }}>⌛</Text>
            <Text style={styles.wordmark}>{t('trialEnded', lang)}</Text>
            <Text style={[styles.subText, { marginTop: 12, marginBottom: 24 }]}>
              {t('trialEndedSub', lang).replace('{tier}', providerFacility.membership_tier === 'pro' ? 'Pro' : 'Basic')}
            </Text>
            <Text style={styles.memberIdLabel}>{t('membershipId', lang)}</Text>
            <Text style={styles.memberIdValue}>{session.user.id.replace(/-/g, '').slice(0, 12).toUpperCase()}</Text>
            <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ marginTop: 32 }}>
              <Text style={styles.signOutLink}>{t('signOut', lang)}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    } else {
      const trialDaysLeft = providerFacility.status === 'trial' && providerFacility.trial_ends_at
        ? Math.max(0, Math.ceil((new Date(providerFacility.trial_ends_at) - new Date()) / 86400000))
        : null
      content = <ProviderScreen session={session} lang={lang} facility={providerFacility} trialDaysLeft={trialDaysLeft} onFacilityUpdated={loadProviderFacility} />
    }
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
  } else if (showNotifs) {
    content = <NotificationsScreen
      notifications={notifications}
      loading={notifsLoading}
      lang={lang}
      onBack={() => { setShowNotifs(false); supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).then(() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))) }}
      onMarkAllRead={markAllNotifsRead}
    />
  } else if (showDutyList) {
    content = <DutyListScreen onBack={() => setShowDutyList(false)} lang={lang} />
  } else if (unclaimedFacility) {
    content = (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backPill} onPress={() => setUnclaimedFacility(null)}>
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
            <Text style={styles.backPillText}>{t('back', lang)}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.unclaimedWrap}>
          <View style={styles.unclaimedIconWrap}>
            <Text style={styles.unclaimedEmoji}>{TYPE_ICONS[unclaimedFacility.type] ?? '🏥'}</Text>
          </View>
          <Text style={styles.unclaimedName}>{unclaimedFacility.name}</Text>
          <View style={styles.unclaimedBadgeRow}>
            <View style={[styles.typeBadge, { backgroundColor: (typeColors[unclaimedFacility.type] || typeColors.clinic).bg }]}>
              <Text style={[styles.typeBadgeText, { color: (typeColors[unclaimedFacility.type] || typeColors.clinic).text }]}>
                {t(unclaimedFacility.type, lang)}
              </Text>
            </View>
            <View style={styles.notOnAdaBadge}>
              <Text style={styles.notOnAdaBadgeText}>{t('notOnAda', lang)}</Text>
            </View>
          </View>
          {unclaimedFacility.address ? (
            <View style={styles.unclaimedRow}>
              <Feather name="map-pin" size={14} color={colors.textSecondary} />
              <Text style={styles.unclaimedRowText}>{unclaimedFacility.address}</Text>
            </View>
          ) : null}
          {unclaimedFacility.phone ? (
            <View style={styles.unclaimedRow}>
              <Feather name="phone" size={14} color={colors.textSecondary} />
              <Text style={styles.unclaimedRowText}>{unclaimedFacility.phone}</Text>
            </View>
          ) : null}
          <View style={styles.unclaimedNotice}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.unclaimedNoticeText}>{t('notOnAdaDesc', lang)}</Text>
          </View>
          <View style={styles.unclaimedActions}>
            {unclaimedFacility.phone ? (
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(`tel:${unclaimedFacility.phone.replace(/\s+/g, '')}`)}
              >
                <Feather name="phone" size={16} color={colors.primary} />
                <Text style={styles.actionBtnText}>{t('call', lang)}</Text>
              </TouchableOpacity>
            ) : null}
            {unclaimedFacility.latitude != null && unclaimedFacility.longitude != null ? (
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(`https://maps.google.com/?q=${unclaimedFacility.latitude},${unclaimedFacility.longitude}`)}
              >
                <Feather name="navigation" size={16} color={colors.primary} />
                <Text style={styles.actionBtnText}>{t('getDirections', lang)}</Text>
              </TouchableOpacity>
            ) : null}
            {unclaimedFacility.website ? (
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1 }]}
                onPress={() => Linking.openURL(unclaimedFacility.website)}
              >
                <Feather name="globe" size={16} color={colors.primary} />
                <Text style={styles.actionBtnText}>{t('visitWebsite', lang)}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  } else if (selectedFacility) {
    content = <BookingScreen facility={selectedFacility} session={session} lang={lang} onBack={() => setSelectedFacility(null)} />
  } else {
    content = (
      <ImageBackground source={require('./assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Image source={require('./assets/logonobg.png')} style={styles.headerIcon} resizeMode="contain" />
            <View style={styles.headerRight}>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewBtn, view === 'list' && styles.viewBtnActive]}
                  onPress={() => setView('list')}
                >
                  <Feather name="list" size={17} color={view === 'list' ? colors.primary : colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewBtn, view === 'map' && styles.viewBtnActive]}
                  onPress={() => setView('map')}
                >
                  <Ionicons name="map-outline" size={17} color={view === 'map' ? colors.primary : colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.quizBtn} onPress={() => setShowQuiz(true)}>
                <Ionicons name="flask-outline" size={18} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.notifBtn} onPress={() => setShowNotifs(true)}>
                <Ionicons name="notifications-outline" size={18} color={colors.textSecondary} />
                {notifications.some(n => !n.read) && <View style={styles.notifDot} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatarBtn} onPress={() => setShowProfile(true)}>
                <Text style={styles.avatarBtnText}>
                  {session.user.email[0].toUpperCase()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Feather name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t('searchPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Feather name="x" size={15} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterContent}
          >
            <TouchableOpacity
              style={[styles.filterChip, openOnly && styles.filterChipOpen]}
              onPress={() => setOpenOnly(v => !v)}
            >
              <Feather name="clock" size={11} color={openOnly ? colors.success : colors.textSecondary} />
              <Text style={[styles.filterChipText, openOnly && styles.filterChipOpenText]}> {t('open', lang)}</Text>
            </TouchableOpacity>
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
                <View style={styles.resultCardIconWrap}>
                  <Ionicons name="flask-outline" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultCardTitle}>{t('supplementPlanTitle', lang)}</Text>
                  <Text style={styles.resultCardSub} numberOfLines={1}>
                    {t('approvedBy', lang)} {latestResult.facilities?.name}{latestResult.reviewed_at ? ` · ${new Date(latestResult.reviewed_at).toLocaleDateString()}` : ''}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}

          {!latestResult && (
            <TouchableOpacity style={styles.quizPromoCard} onPress={() => setShowQuiz(true)} activeOpacity={0.8}>
              <View style={styles.quizPromoLeft}>
                <View style={styles.quizPromoIconWrap}>
                  <Ionicons name="flask-outline" size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quizPromoTitle}>{t('supplementAdvisor', lang)}</Text>
                  <Text style={styles.quizPromoSub} numberOfLines={2}>{t('supplementAdvisorSub', lang)}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.dutyBanner} onPress={() => setShowDutyList(true)} activeOpacity={0.8}>
            <View style={styles.dutyBannerLeft}>
              <View style={styles.dutyBannerIconWrap}>
                <Ionicons name="medical-outline" size={20} color={colors.accent} />
              </View>
              <View>
                <Text style={styles.dutyBannerTitle}>{t('tonightDuty', lang)}</Text>
                <Text style={styles.dutyBannerSub}>{t('allRegions', lang)}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.accent} />
          </TouchableOpacity>

          {view === 'map' ? (
            <MapScreen
              facilities={facilities}
              dutyFacilityId={dutyFacilityId}
              userLocation={userLocation}
              onSelectFacility={setSelectedFacility}
              lang={lang}
            />
          ) : (
            <>
              {facilityLoadError && (
                <Text style={styles.locationNote}>{t('facilityLoadError', lang)}</Text>
              )}
              {locationDenied && (
                <Text style={styles.locationNote}>{t('enableLocation', lang)}</Text>
              )}
              <FlatList
                data={listed}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={(
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyIcon}>🏥</Text>
                    <Text style={styles.emptyTitle}>{t('noFacilitiesTitle', lang)}</Text>
                    <Text style={styles.emptyBody}>{t('noFacilitiesBody', lang)}</Text>
                  </View>
                )}
                renderItem={({ item }) => {
                  const isOpen = parseIsOpen(item.opening_hours)
                  const tc = typeColors[item.type] || typeColors.clinic
                  const isDuty = item.id === dutyFacilityId
                  const isFav = favorites.has(item.id)
                  return (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={[styles.card, isDuty && styles.dutyCard, !item.provider_id && styles.cardUnclaimed]}
                      onPress={() => item.provider_id ? setSelectedFacility(item) : setUnclaimedFacility(item)}
                    >
                      {isDuty && (
                        <View style={styles.dutyCardBadge}>
                          <Text style={styles.dutyLabel}>{t('onDuty', lang)}</Text>
                        </View>
                      )}
                      <View style={styles.cardMain}>
                        <View style={[styles.typeIcon, { backgroundColor: tc.bg }]}>
                          <Text style={styles.typeIconText}>{TYPE_ICONS[item.type] ?? '🏥'}</Text>
                        </View>
                        <View style={styles.cardContent}>
                          <View style={styles.cardTop}>
                            <View style={styles.cardNameRow}>
                              <Text style={styles.facilityName} numberOfLines={1}>{item.name}</Text>
                              {item.verified && (
                                <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
                              )}
                            </View>
                            {item._dist != null && (
                              <Text style={styles.distanceText}>{item._dist.toFixed(1)} km</Text>
                            )}
                          </View>
                          <View style={styles.badgeRow}>
                            <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
                              <Text style={[styles.typeBadgeText, { color: tc.text }]}>{t(item.type, lang)}</Text>
                            </View>
                            {item.provider_id ? (
                              isOpen != null && (
                                <View style={[styles.statusBadge, isOpen ? styles.openBadge : styles.closedBadge]}>
                                  <Text style={[styles.statusText, isOpen ? styles.openText : styles.closedText]}>
                                    {isOpen ? t('open', lang) : t('closed', lang)}
                                  </Text>
                                </View>
                              )
                            ) : (
                              <View style={styles.notOnAdaBadge}>
                                <Text style={styles.notOnAdaBadgeText}>{t('notOnAda', lang)}</Text>
                              </View>
                            )}
                          </View>
                          {item.address ? <Text style={styles.addressText} numberOfLines={1}>{item.address}</Text> : null}
                          {facilityRatings[item.id] && (
                            <View style={styles.ratingRow}>
                              <Ionicons name="star" size={11} color="#F5A623" />
                              <Text style={styles.ratingText}> {facilityRatings[item.id].avg} ({facilityRatings[item.id].count})</Text>
                            </View>
                          )}
                          {item.phone ? (
                            <TouchableOpacity
                              style={styles.callPill}
                              onPress={() => Linking.openURL(`tel:${item.phone.replace(/\s+/g, '')}`)}
                              activeOpacity={0.7}
                            >
                              <Feather name="phone" size={11} color={colors.accent} />
                              <Text style={styles.callPillText}>{item.phone}</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        <View style={styles.cardActions}>
                          <TouchableOpacity onPress={() => toggleFavorite(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={18} color={isFav ? colors.danger : colors.border} />
                          </TouchableOpacity>
                          <Ionicons name="chevron-forward" size={16} color={colors.border} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  )
                }}
              />
            </>
          )}
        </View>
      </SafeAreaView>
      </ImageBackground>
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
  headerIcon:       { width: 72, height: 72 },
  subText:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
  signOutLink:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  memberIdLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  memberIdValue:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: 2, marginTop: 6 },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewToggle:       { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, gap: 2 },
  viewBtn:          { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  viewBtnActive:    { backgroundColor: colors.surface },
  quizBtn:          { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentLight, justifyContent: 'center', alignItems: 'center' },
  notifBtn:         { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },
  notifDot:         { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.bg },
  avatarBtn:        { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  avatarBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  locationNote:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 10, textAlign: 'center' },
  searchBar:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchInput:      { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  filterRow:        { marginBottom: 12, flexGrow: 0 },
  filterContent:    { gap: 8, paddingRight: 4, alignItems: 'center' },
  filterChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: '#C8D3DC', backgroundColor: colors.cardBg, alignSelf: 'flex-start', ...shadow },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#1A2B33' },
  filterChipOpen:   { borderColor: colors.success, backgroundColor: colors.successLight },
  filterChipOpenText: { color: colors.success, fontFamily: 'Inter_700Bold' },
  filterChipTextActive: { fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  listContent:      { paddingBottom: 32 },
  card:             { backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, marginBottom: 10, shadowColor: '#1A2B33', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  dutyCard:         { borderWidth: 1.5, borderColor: colors.accent },
  dutyCardBadge:    { backgroundColor: colors.accentLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 10 },
  dutyLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardMain:         { flexDirection: 'row', alignItems: 'center' },
  cardNameRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  cardActions:      { flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginLeft: 6, alignSelf: 'stretch', paddingVertical: 2 },
  callPill:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, backgroundColor: colors.accentLight, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  callPillText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.accent },
  typeIcon:         { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  typeIconText:     { fontSize: 22 },
  cardContent:      { flex: 1 },
  cardTop:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  facilityName:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1 },
  distanceText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  badgeRow:         { flexDirection: 'row', gap: 6, marginBottom: 6 },
  typeBadge:        { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:    { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  statusBadge:      { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  openBadge:        { backgroundColor: colors.successLight },
  closedBadge:      { backgroundColor: colors.dangerLight },
  statusText:       { fontSize: 11, fontFamily: 'Inter_700Bold' },
  openText:         { color: colors.success },
  closedText:       { color: colors.danger },
  addressText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  ratingRow:        { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ratingText:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  cardUnclaimed:    { opacity: 1 },
  notOnAdaBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.border },
  notOnAdaBadgeText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  // Unclaimed facility screen
  backPill:         { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backPillText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  unclaimedWrap:    { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  unclaimedIconWrap:{ width: 72, height: 72, borderRadius: 22, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...shadow },
  unclaimedEmoji:   { fontSize: 36 },
  unclaimedName:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  unclaimedBadgeRow:{ flexDirection: 'row', gap: 8, marginBottom: 20 },
  unclaimedRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  unclaimedRowText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  unclaimedNotice:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginTop: 12, marginBottom: 24 },
  unclaimedNoticeText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 20 },
  unclaimedActions: { flexDirection: 'row', gap: 12 },
  actionBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  actionBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  dutyBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.accentLight, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.accent + '30' },
  dutyBannerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dutyBannerIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.accent + '20', justifyContent: 'center', alignItems: 'center' },
  dutyBannerTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.accent, marginBottom: 2 },
  dutyBannerSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.accent + 'AA' },
  quizPromoCard:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.accent, borderRadius: 16, padding: 14, marginBottom: 12 },
  quizPromoLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  quizPromoIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  quizPromoTitle:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 2 },
  quizPromoSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.85)' },
  resultCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primaryLight, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.primary + '25' },
  resultCardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  resultCardIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primary + '20', justifyContent: 'center', alignItems: 'center' },
  resultCardTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 2 },
  resultCardSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary + 'AA' },
  emptyWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon:        { fontSize: 48, marginBottom: 16 },
  emptyTitle:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  emptyBody:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
})
