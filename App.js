import { useEffect, useState, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View, Text, Image, ImageBackground, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Platform, TextInput, ScrollView, Linking, BackHandler, Animated, Share, Alert, Modal, Dimensions } from 'react-native'
import { BlurView } from 'expo-blur'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useFonts, Inter_400Regular, Inter_700Bold } from '@expo-google-fonts/inter'
import { PlayfairDisplay_400Regular, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display'
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { supabase } from './lib/supabase'
import { colors, typeColors, shadow } from './constants/theme'
import { t } from './constants/i18n'
import { getPreset } from './constants/avatars'
import { SPECIALTIES_BY_TYPE } from './constants/specialties'
import AuthScreen from './screens/AuthScreen'
import BookingScreen from './screens/BookingScreen'
import FacilityProfileScreen from './screens/FacilityProfileScreen'
import ProviderScreen from './screens/ProviderScreen'
import ProviderOnboardingScreen from './screens/ProviderOnboardingScreen'
import MapScreen from './screens/MapScreen'
import AdminScreen from './screens/AdminScreen'
import ProfileScreen from './screens/ProfileScreen'
import QuizNavigator from './screens/quiz/QuizNavigator'
import ResultsScreen from './screens/quiz/ResultsScreen'

const QUIZ_LANG_MAP = {
  Turkish: 'tr', English: 'en', Arabic: 'ar', Russian: 'ru',
  Greek: 'el', French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa',
}
import DutyListScreen from './screens/DutyListScreen'
import EventsScreen from './screens/EventsScreen'
import OrganizerScreen from './screens/OrganizerScreen'
import AccommodationScreen from './screens/AccommodationScreen'
import PropertyDetailScreen from './screens/PropertyDetailScreen'
import EstateAgentOnboardingScreen from './screens/EstateAgentOnboardingScreen'
import EstateAgentDashboardScreen from './screens/EstateAgentDashboardScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import TutorialCoachMarks from './screens/TutorialCoachMarks'
import NotificationsScreen from './screens/NotificationsScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import { FacilityCardSkeleton, Skeleton } from './components/Skeleton'
import * as Updates from 'expo-updates'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

const TYPE_ICON_MAP = {
  pharmacy: { lib: 'ion', name: 'medkit' },
  clinic:   { lib: 'ion', name: 'medical' },
  hospital: { lib: 'ion', name: 'business' },
  dentist:  { lib: 'mci', name: 'tooth' },
}

function TypeSVGIcon({ type, size, color }) {
  const cfg = TYPE_ICON_MAP[type] || TYPE_ICON_MAP.clinic
  if (cfg.lib === 'mci') return <MaterialCommunityIcons name={cfg.name} size={size} color={color} />
  return <Ionicons name={cfg.name} size={size} color={color} />
}

const LANGUAGES = [
  { key: 'English', label: 'English' },
  { key: 'Turkish', label: 'Türkçe' },
  { key: 'Arabic',  label: 'العربية' },
  { key: 'Russian', label: 'Русский' },
  { key: 'Greek',   label: 'Ελληνικά' },
  { key: 'French',  label: 'Français' },
  { key: 'Spanish', label: 'Español' },
  { key: 'German',  label: 'Deutsch' },
  { key: 'Persian', label: 'فارسی' },
]

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

function uvLevel(index) {
  if (index == null) return null
  if (index < 3)  return { key: 'uvLow',      color: '#22C55E', warn: false }
  if (index < 6)  return { key: 'uvModerate',  color: '#EAB308', warn: false }
  if (index < 8)  return { key: 'uvHigh',      color: '#F97316', warn: true  }
  if (index < 11) return { key: 'uvVeryHigh',  color: '#EF4444', warn: true  }
  return           { key: 'uvExtreme',  color: '#9333EA', warn: true  }
}

function weatherIcon(code) {
  if (code === 0)              return '☀️'
  if (code <= 2)               return '🌤️'
  if (code === 3)              return '☁️'
  if (code <= 48)              return '🌫️'
  if (code <= 55)              return '🌦️'
  if (code <= 65)              return '🌧️'
  if (code <= 75)              return '❄️'
  if (code <= 82)              return '🌦️'
  if (code <= 99)              return '⛈️'
  return '🌡️'
}

function weatherDesc(code) {
  if (code === 0)  return 'Clear sky'
  if (code <= 2)   return 'Partly cloudy'
  if (code === 3)  return 'Overcast'
  if (code <= 48)  return 'Foggy'
  if (code <= 55)  return 'Drizzle'
  if (code <= 65)  return 'Rainy'
  if (code <= 75)  return 'Snow'
  if (code <= 82)  return 'Rain showers'
  if (code <= 99)  return 'Thunderstorm'
  return 'Unknown'
}

const AVAIL_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
function isAvailableToday(availability) {
  if (!availability?.schedule) return false
  const day = availability.schedule[AVAIL_DAY_KEYS[new Date().getDay()]]
  return !!(day && !day.closed)
}

const TAB_ITEMS = [
  { key: 'home',       iconOff: 'home-outline',   iconOn: 'home',    label: 'Home' },
  { key: 'map',        iconOff: 'map-outline',     iconOn: 'map',     label: 'Map' },
  { key: 'favourites', iconOff: 'heart-outline',   iconOn: 'heart',   label: 'Saved' },
  { key: 'profile',    iconOff: 'person-outline',  iconOn: 'person',  label: 'Profile' },
]

function BottomTabBar({ activeTab, onTabPress, mapTabRef }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[tabBar.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TAB_ITEMS.map(tab => {
        const active = activeTab === tab.key
        return (
          <TouchableOpacity
            key={tab.key}
            ref={tab.key === 'map' ? mapTabRef : undefined}
            style={tabBar.btn}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={active ? tab.iconOn : tab.iconOff}
              size={24}
              color={active ? colors.primary : colors.textSecondary}
            />
            <Text style={[tabBar.label, active && tabBar.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const tabBar = StyleSheet.create({
  bar:        { flexDirection: 'row', backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  btn:        { flex: 1, alignItems: 'center', gap: 3 },
  label:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  labelActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },
})

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_700Bold, PlayfairDisplay_400Regular, PlayfairDisplay_700Bold })
  const [session, setSession] = useState(undefined)
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [dutyFacilityId, setDutyFacilityId] = useState(null)
  const [selectedFacility, setSelectedFacility] = useState(null)
  const [bookingFacility, setBookingFacility] = useState(null)
  const [profile, setProfile] = useState(null)
  const [activeTab, setActiveTab] = useState('home')
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
  const [showAll, setShowAll] = useState(false)
  const [langFilter, setLangFilter] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [historyResult, setHistoryResult] = useState(null)
  const [activeSpecialty, setActiveSpecialty] = useState(null)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [showWelcome, setShowWelcome] = useState(true)
  const [facilityLoadError, setFacilityLoadError] = useState(false)
  const [notifsLoading, setNotifsLoading] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [weatherData, setWeatherData] = useState(null)
  const [weatherExpanded, setWeatherExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showQuizSubmenu, setShowQuizSubmenu] = useState(false)
  const [showQuizHistory, setShowQuizHistory] = useState(false)
  const [quizHistory, setQuizHistory] = useState([])
  const [quizHistoryLoading, setQuizHistoryLoading] = useState(false)
  const [showEmergencyModal, setShowEmergencyModal] = useState(false)
  const [showMunicipalModal, setShowMunicipalModal] = useState(false)
  const [expandedMuni, setExpandedMuni] = useState(null)
  const [showEvents, setShowEvents] = useState(false)
  const [showAccommodation, setShowAccommodation] = useState(false)
  const [openedProperty, setOpenedProperty] = useState(null)
  const [showAgentOnboarding, setShowAgentOnboarding] = useState(false)
  const [showLangModal, setShowLangModal] = useState(false)
  const [showCoachMarks, setShowCoachMarks] = useState(false)
  const [coachSteps, setCoachSteps]         = useState([])
  const hamburgerRef       = useRef(null)
  const searchRef          = useRef(null)
  const filterBarRef       = useRef(null)
  const dutyBannerRef      = useRef(null)
  const mapTabRef          = useRef(null)
  const menuLangRef        = useRef(null)
  const menuQuizRef        = useRef(null)
  const menuEmergencyRef   = useRef(null)
  const menuTutorialItemRef = useRef(null)
  const menuAnim = useRef(new Animated.Value(260)).current
  const menuStepCountRef = useRef(0)

  function openMenu() {
    setShowMenu(true)
    Animated.timing(menuAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start()
  }
  function closeMenu() {
    Animated.timing(menuAnim, { toValue: 260, duration: 200, useNativeDriver: true }).start(() => { setShowMenu(false); setShowQuizSubmenu(false) })
  }

  function measureRef(ref) {
    return new Promise(resolve => {
      if (!ref?.current) { resolve(null); return }
      ref.current.measure((_x, _y, w, h, pageX, pageY) => {
        resolve(w > 0 && h > 0 ? { x: pageX, y: pageY, w, h } : null)
      })
    })
  }

  async function startCoachMarks() {
    await new Promise(r => setTimeout(r, 400))
    menuStepCountRef.current = 0

    const [menuBtn, search, filters, duty, map] = await Promise.all([
      measureRef(hamburgerRef),
      measureRef(searchRef),
      measureRef(filterBarRef),
      measureRef(dutyBannerRef),
      measureRef(mapTabRef),
    ])

    const steps = []
    if (menuBtn) steps.push({ ...menuBtn, title: t('coachMenuTitle', lang), body: t('coachMenuBody', lang) })
    if (search)  steps.push({ ...search,  title: t('coachSearchTitle', lang),  body: t('coachSearchBody', lang) })
    if (filters) steps.push({ ...filters, title: t('coachFiltersTitle', lang), body: t('coachFiltersBody', lang) })
    if (duty)    steps.push({ ...duty,    title: t('coachDutyTitle', lang),    body: t('coachDutyBody', lang) })
    if (map)     steps.push({ ...map,     title: t('coachMapTitle', lang),     body: t('coachMapBody', lang) })
    if (steps.length) { setCoachSteps(steps); setShowCoachMarks(true) }
  }

  async function handleCoachNext(fromStep) {
    if (fromStep === 0) {
      // Hamburger step done — open menu and inject in-menu steps before advancing
      openMenu()
      await new Promise(r => setTimeout(r, 350))
      const [langItem, quizItem, emergencyItem] = await Promise.all([
        measureRef(menuLangRef),
        measureRef(menuQuizRef),
        measureRef(menuEmergencyRef),
      ])
      const menuItems = []
      if (langItem)      menuItems.push({ ...langItem,      title: t('coachLangTitle', lang),      body: t('coachLangBody', lang) })
      if (quizItem)      menuItems.push({ ...quizItem,      title: t('coachQuizTitle', lang),      body: t('coachQuizBody', lang) })
      if (emergencyItem) menuItems.push({ ...emergencyItem, title: t('coachEmergencyTitle', lang), body: t('coachEmergencyBody', lang) })
      menuStepCountRef.current = menuItems.length
      if (menuItems.length > 0) {
        setCoachSteps(prev => [prev[0], ...menuItems, ...prev.slice(1)])
      }
    } else if (menuStepCountRef.current > 0 && fromStep === menuStepCountRef.current) {
      // Last in-menu step done — close menu before showing screen steps
      closeMenu()
      await new Promise(r => setTimeout(r, 250))
    }
  }

  function handleCoachFinish() {
    setShowCoachMarks(false)
    closeMenu()
  }

  async function loadQuizHistory() {
    setQuizHistoryLoading(true)
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id, final_result, reviewed_at, facilities(name)')
      .eq('customer_id', session.user.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(20)
    if (data) setQuizHistory(data)
    setQuizHistoryLoading(false)
  }
  function shareApp() {
    Share.share({
      message: 'Find pharmacies, clinics, hospitals and dentists in North Cyprus with ADA.',
      url: 'https://play.google.com/store/apps/details?id=com.berkeustun95.ada',
    })
  }
  function rateApp() {
    const url = Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/id'
      : 'market://details?id=com.berkeustun95.ada'
    Linking.openURL(url).catch(() =>
      Linking.openURL('https://play.google.com/store/apps/details?id=com.berkeustun95.ada')
    )
  }
  function showEmergencyNumbers() {
    setShowEmergencyModal(true)
  }
  async function selectLang(langKey) {
    setProfile(prev => ({ ...prev, preferred_language: langKey }))
    setShowLangModal(false)
    await supabase.from('profiles').update({ preferred_language: langKey }).eq('id', session.user.id)
  }
  function showAbout() {
    Alert.alert('ADA', 'Version 1.0.0\n\nHealth facility directory for North Cyprus (TRNC).', [{ text: 'OK' }])
  }

  function toggleFavorite(id) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      AsyncStorage.setItem('ada_favorites', JSON.stringify([...next]))
      return next
    })
  }

  useEffect(() => {
    if (!__DEV__) {
      Updates.checkForUpdateAsync().then(({ isAvailable }) => {
        if (isAvailable) Updates.fetchUpdateAsync().then(() => Updates.reloadAsync())
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { menuAnim.setValue(260); setShowMenu(false) }
      if (event === 'PASSWORD_RECOVERY') setShowPasswordReset(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function handleDeepLink(url) {
      if (!url?.startsWith('ada://')) return
      try {
        const parsed     = new URL(url.replace('ada://', 'https://x/'))
        const qp         = parsed.searchParams
        const hp         = new URLSearchParams(parsed.hash.replace(/^#/, ''))
        const tokenHash  = qp.get('token_hash')  || hp.get('token_hash')
        const type       = qp.get('type')         || hp.get('type')
        const code       = qp.get('code')         || hp.get('code')
        const accessToken  = qp.get('access_token')  || hp.get('access_token')
        const refreshToken = qp.get('refresh_token') || hp.get('refresh_token')
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (type === 'recovery') setShowPasswordReset(true)
        } else if (tokenHash && type) {
          await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          if (type === 'recovery') setShowPasswordReset(true)
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(url)
          if (url.includes('recovery')) setShowPasswordReset(true)
        }
      } catch {}
    }
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url) })
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showMenu) { closeMenu(); return true }
      if (showPasswordReset) { setShowPasswordReset(false); return true }
      if (showLatestResult) { setShowLatestResult(false); return true }
      if (showQuiz) { setShowQuiz(false); return true }
      if (historyResult) { setHistoryResult(null); return true }
      if (showNotifs) { setShowNotifs(false); return true }
      if (showDutyList) { setShowDutyList(false); return true }
      if (showEvents) { setShowEvents(false); return true }
      if (openedProperty) { setOpenedProperty(null); return true }
      if (showAgentOnboarding) { setShowAgentOnboarding(false); return true }
      if (showAccommodation) { setShowAccommodation(false); return true }
      if (showQuizHistory) { setShowQuizHistory(false); return true }
      if (unclaimedFacility) { setUnclaimedFacility(null); return true }
      if (bookingFacility) { setBookingFacility(null); return true }
      if (selectedFacility) { setSelectedFacility(null); setBookingFacility(null); return true }
      if (activeTab !== 'home') { setActiveTab('home'); return true }
      return false
    })
    return () => sub.remove()
  }, [showMenu, showPasswordReset, showLatestResult, showQuiz, historyResult, showNotifs, showDutyList, showEvents, showQuizHistory, unclaimedFacility, selectedFacility, bookingFacility, activeTab, showAccommodation, openedProperty, showAgentOnboarding])

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

  async function clearAllNotifs() {
    await supabase.from('notifications').delete().eq('user_id', session.user.id)
    setNotifications([])
  }

  async function markNotifRead(item) {
    if (item.read) return
    await supabase.from('notifications').update({ read: true }).eq('id', item.id)
    setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n))
  }

  async function completeOnboarding(selectedLang) {
    await AsyncStorage.multiSet([['@trnc_onboarded', 'true'], ['@trnc_lang', selectedLang]])
    setPendingLang(selectedLang)
    setOnboarded(true)
  }

  async function reloadFacilities() {
    const { data } = await supabase.from('facilities').select('*').order('name')
    if (data) setFacilities(data)
  }

  async function loadProviderFacility() {
    const { data: fac } = await supabase
      .from('facilities')
      .select('id, name, type, status, membership_tier, trial_ends_at, is_quiz_partner, phone, address, opening_hours, cover_image_url, logo_url, availability, description, languages, specialty, latitude, longitude, photos')
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
    menuAnim.setValue(260)
    setShowMenu(false)
    setShowNotifs(false)
    if (!session) {
      setProfile(null); setLatestResult(null); setNotifications([]); setProviderFacility(undefined); setPendingClaim(undefined); return
    }
    supabase.from('profiles').select('role, preferred_language, avatar_url, blocked_until').eq('id', session.user.id).single()
      .then(async ({ data }) => {
        setProfile(data ?? null)
        if (data?.role === 'provider') {
          loadProviderFacility()
        } else if (!data?.role || data?.role === 'customer') {
          scheduleAppointmentReminders(session.user.id, data?.preferred_language ?? 'en')
          AsyncStorage.getItem('@trnc_coach_v1').then(shown => {
            if (!shown) { AsyncStorage.setItem('@trnc_coach_v1', 'true'); startCoachMarks() }
          })
        }
      })
    fetchLatestResult(session.user.id)
    setNotifsLoading(true)
    supabase.from('notifications').select('id, title, body, read, created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setNotifications(data); setNotifsLoading(false) })
  }, [session])

  async function scheduleAppointmentReminders(userId, currentLang) {
    try {
      const now = new Date()
      const { data } = await supabase
        .from('appointments')
        .select('id, requested_time, facilities(name)')
        .eq('customer_id', userId)
        .eq('status', 'confirmed')
        .gt('requested_time', now.toISOString())
        .order('requested_time', { ascending: true })
        .limit(10)
      if (!data) return
      for (const appt of data) {
        const apptTime = new Date(appt.requested_time)
        const reminderTime = new Date(apptTime.getTime() - 60 * 60 * 1000)
        const reviewTime   = new Date(apptTime.getTime() + 60 * 60 * 1000)
        if (reminderTime > now) {
          await Notifications.scheduleNotificationAsync({
            identifier: `appt-reminder-${appt.id}`,
            content: {
              title: t('apptReminderTitle', currentLang),
              body: t('apptReminderBody', currentLang).replace('{name}', appt.facilities?.name ?? ''),
              data: { screen: 'notifications' },
            },
            trigger: { date: reminderTime },
          })
        }
        if (reviewTime > now) {
          await Notifications.scheduleNotificationAsync({
            identifier: `appt-review-${appt.id}`,
            content: {
              title: t('reviewPromptTitle', currentLang),
              body: t('reviewPromptBody', currentLang).replace('{name}', appt.facilities?.name ?? ''),
              data: { screen: 'profile' },
            },
            trigger: { date: reviewTime },
          })
        }
      }
    } catch (e) {
      if (__DEV__) console.log('Schedule reminders error:', e.message)
    }
  }

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
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data   = response.notification.request.content.data ?? {}
      const screen = data.screen
      if (screen === 'duty') {
        setShowDutyList(true)
      } else if (screen === 'profile') {
        setActiveTab('profile')
      } else if (screen === 'notifications') {
        setShowNotifs(true)
      }
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    setFacilityLoadError(false)
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


      // TODO: replace with a computed avg_rating + review_count column on facilities
      // once review volume grows, to avoid fetching every row on startup.
      const { data: reviewsData } = await supabase.from('reviews').select('facility_id, rating').limit(2000)
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

      let resolvedCoords = { latitude: 35.1856, longitude: 33.3823 }
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          setLocationDenied(true)
        } else {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          setUserLocation(loc.coords)
          resolvedCoords = loc.coords
        }
      } catch {
        setLocationDenied(true)
      }

      try {
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${resolvedCoords.latitude}&longitude=${resolvedCoords.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max&timezone=auto&forecast_days=4`
        )
        const weatherJson = await weatherRes.json()
        if (weatherJson?.current) setWeatherData(weatherJson)
      } catch {}

      setLoading(false)
    }
    load()
  }, [retryCount])



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
    .filter(f => searchText.trim() || showAll || !!f.provider_id)
    .filter(f => !activeType || f.type === activeType)
    .filter(f => !openOnly || parseIsOpen(f.opening_hours) === true)
    .filter(f => !activeSpecialty || (Array.isArray(f.specialty) ? f.specialty.includes(activeSpecialty) : f.specialty === activeSpecialty))
    .filter(f => {
      if (!langFilter) return true
      const CODE_TO_NAME = { en: 'english', tr: 'turkish', ar: 'arabic', ru: 'russian', el: 'greek', fr: 'french', es: 'spanish', de: 'german', fa: 'persian' }
      const raw = profile?.preferred_language || pendingLang || ''
      const target = (CODE_TO_NAME[raw] || raw).toLowerCase()
      if (!target) return true
      return Array.isArray(f.languages) && f.languages.some(l => l.toLowerCase() === target)
    })
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
  } else if (!session && showWelcome) {
    content = <WelcomeScreen lang={lang} onContinue={() => setShowWelcome(false)} />
  } else if (!session) {
    content = <AuthScreen lang={lang} onLangChange={l => { setPendingLang(l); AsyncStorage.setItem('@trnc_lang', l) }} />
  } else if (loading || !profile) {
    content = (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Skeleton width={72} height={32} borderRadius={10} />
            <Skeleton width={40} height={40} borderRadius={20} />
            <Skeleton width={64} height={32} borderRadius={10} />
          </View>
          <Skeleton width="100%" height={44} borderRadius={12} style={{ marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Skeleton width={72} height={30} borderRadius={20} />
            <Skeleton width={80} height={30} borderRadius={20} />
            <Skeleton width={64} height={30} borderRadius={20} />
          </View>
          <View style={{ flex: 1 }}>
            {[0, 1, 2, 3, 4].map(i => <FacilityCardSkeleton key={i} />)}
          </View>
        </View>
      </SafeAreaView>
    )
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
      content = <ProviderScreen session={session} lang={lang} facility={providerFacility} trialDaysLeft={trialDaysLeft} onFacilityUpdated={() => { loadProviderFacility(); reloadFacilities() }} />
    }
  } else if (profile.role === 'estate_agent') {
    content = <EstateAgentDashboardScreen session={session} lang={lang} />
  } else if (profile.role === 'organizer') {
    content = <OrganizerScreen session={session} lang={lang} />
  } else if (showLatestResult && latestResult) {
    content = <ResultsScreen
      result={latestResult.final_result}
      onBack={() => setShowLatestResult(false)}
      readOnly
    />
  } else if (showQuiz) {
    content = <QuizNavigator onClose={() => { setShowQuiz(false); fetchLatestResult(session.user.id) }} profileLang={lang} />
  } else if (historyResult) {
    content = <ResultsScreen
      result={historyResult}
      onBack={() => setHistoryResult(null)}
      readOnly
      langOverride={QUIZ_LANG_MAP[lang] ?? 'en'}
    />
  } else if (showNotifs) {
    content = <NotificationsScreen
      notifications={notifications}
      loading={notifsLoading}
      lang={lang}
      onBack={() => { setShowNotifs(false); supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).then(() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))) }}
      onMarkAllRead={markAllNotifsRead}
      onClearAll={clearAllNotifs}
      onMarkRead={markNotifRead}
      onNotifPress={() => {
        setShowNotifs(false)
        setShowDutyList(true)
      }}
    />
  } else if (showDutyList) {
    content = <DutyListScreen onBack={() => setShowDutyList(false)} lang={lang} />
  } else if (showEvents) {
    content = <EventsScreen lang={lang} onBack={() => setShowEvents(false)} />
  } else if (showAgentOnboarding) {
    content = (
      <EstateAgentOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowAgentOnboarding(false)}
        onSubmitted={() => setShowAgentOnboarding(false)}
      />
    )
  } else if (openedProperty) {
    content = (
      <PropertyDetailScreen
        property={openedProperty}
        lang={lang}
        onClose={() => setOpenedProperty(null)}
      />
    )
  } else if (showAccommodation) {
    content = (
      <AccommodationScreen
        lang={lang}
        session={session}
        onClose={() => setShowAccommodation(false)}
        onBecomeAgent={() => { setShowAccommodation(false); setShowAgentOnboarding(true) }}
        onOpenProperty={prop => setOpenedProperty(prop)}
      />
    )
  } else if (showQuizHistory) {
    content = (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.header, { paddingBottom: 16, justifyContent: 'space-between' }]}>
          <TouchableOpacity style={styles.backPill} onPress={() => setShowQuizHistory(false)}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backPillText}>{t('back', lang)}</Text>
          </TouchableOpacity>
          <Text style={styles.favScreenTitle}>{t('supplementPlans', lang)}</Text>
          <View style={{ width: 60 }} />
        </View>
        {quizHistoryLoading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : quizHistory.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="flask-outline" size={40} color={colors.border} style={{ marginBottom: 12 }} />
            <Text style={styles.noFavText}>{t('noSupplementPlans', lang)}</Text>
          </View>
        ) : (
          <FlatList
            data={quizHistory}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.quizHistCard}
                activeOpacity={0.75}
                onPress={() => setHistoryResult(item.final_result)}
              >
                <View style={styles.quizHistIconWrap}>
                  <Ionicons name="flask-outline" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quizHistPharmacy} numberOfLines={1}>
                    {item.facilities?.name ?? t('supplementAdvisor', lang)}
                  </Text>
                  <Text style={styles.quizHistMeta}>
                    {item.final_result?.stack?.length ?? 0} {t('supplements', lang)}
                    {item.reviewed_at ? ` · ${new Date(item.reviewed_at).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    )
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
            <TypeSVGIcon type={unclaimedFacility.type} size={36} color={colors.primary} />
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
          <TouchableOpacity
            style={styles.reportBtn}
            onPress={() => Linking.openURL(
              `mailto:berke.ustun95@gmail.com?subject=${encodeURIComponent(`ADA – Correction: ${unclaimedFacility.name}`)}&body=${encodeURIComponent(`Hi,\n\nI'd like to suggest a correction for: ${unclaimedFacility.name}\n\n`)}`
            )}
          >
            <Feather name="flag" size={13} color={colors.textSecondary} />
            <Text style={styles.reportBtnText}>{t('reportProblem', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  } else if (bookingFacility) {
    content = <BookingScreen facility={bookingFacility} session={session} lang={lang} blockedUntil={profile?.blocked_until} onBack={() => setBookingFacility(null)} />
  } else if (selectedFacility) {
    content = <FacilityProfileScreen
      facility={selectedFacility}
      lang={lang}
      isFavorite={favorites.has(selectedFacility.id)}
      onToggleFavorite={() => toggleFavorite(selectedFacility.id)}
      onBook={() => setBookingFacility(selectedFacility)}
      onBack={() => setSelectedFacility(null)}
    />
  } else {
    const favList = facilities.filter(f => favorites.has(f.id))
    content = (
      <View style={{ flex: 1 }}>

        {activeTab === 'home' && (
          <ImageBackground source={require('./assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
          <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]} edges={['top']}>
          <View style={styles.container}>
            <View style={styles.header}>
              <View style={styles.headerLogoWrap} pointerEvents="none">
                <Image source={require('./assets/logonobg.png')} style={styles.headerIcon} resizeMode="contain" />
              </View>
              <View style={styles.headerRight}>
                <TouchableOpacity style={styles.notifBtn} onPress={() => setShowNotifs(true)}>
                  <Ionicons name="notifications-outline" size={18} color={colors.textSecondary} />
                  {notifications.some(n => !n.read) && <View style={styles.notifDot} />}
                </TouchableOpacity>
                <TouchableOpacity ref={hamburgerRef} style={styles.hamburgerBtn} onPress={openMenu}>
                  <Feather name="menu" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

          {weatherData && (() => {
            const cur   = weatherData.current
            const daily = weatherData.daily
            const uv    = uvLevel(cur.uv_index)
            const days  = (daily?.time ?? []).slice(0, 4)
            return (
              <TouchableOpacity
                style={styles.weatherCard}
                onPress={() => setWeatherExpanded(v => !v)}
                activeOpacity={0.85}
              >
                <View style={styles.weatherRow}>
                  <Text style={styles.weatherEmoji}>{weatherIcon(cur.weather_code)}</Text>
                  <Text style={styles.weatherTemp}>{Math.round(cur.temperature_2m)}°C</Text>
                  <Text style={styles.weatherDescInline} numberOfLines={1}>{weatherDesc(cur.weather_code)}</Text>
                  <View style={{ flex: 1 }} />
                  {uv && (
                    <View style={[styles.uvBadge, { backgroundColor: uv.color }]}>
                      <Text style={styles.uvBadgeText}>UV {Math.round(cur.uv_index)}</Text>
                    </View>
                  )}
                  <Feather name={weatherExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
                </View>

                {weatherExpanded && (
                  <>
                    <View style={styles.weatherExpandStats}>
                      <Text style={styles.weatherStat}>💧 {cur.relative_humidity_2m}%</Text>
                      <Text style={styles.weatherStat}>💨 {Math.round(cur.wind_speed_10m)} km/h</Text>
                      <Text style={styles.weatherStat}>Feels {Math.round(cur.apparent_temperature)}°C</Text>
                      {uv && <Text style={styles.weatherStat}>{t(uv.key, lang)}</Text>}
                    </View>
                    {uv?.warn && (
                      <Text style={styles.uvWarnText}>🧴 {t('uvSunscreen', lang)}</Text>
                    )}
                    {days.length > 0 && (
                      <View style={styles.forecastRow}>
                        {days.map((date, i) => {
                          const label = i === 0 ? 'Today' : new Date(date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' })
                          return (
                            <View key={date} style={styles.forecastDay}>
                              <Text style={styles.forecastLabel}>{label}</Text>
                              <Text style={styles.forecastIcon}>{weatherIcon(daily.weather_code[i])}</Text>
                              <Text style={styles.forecastMax}>{Math.round(daily.temperature_2m_max[i])}°</Text>
                              <Text style={styles.forecastMin}>{Math.round(daily.temperature_2m_min[i])}°</Text>
                            </View>
                          )
                        })}
                      </View>
                    )}
                  </>
                )}
              </TouchableOpacity>
            )
          })()}

          <View ref={searchRef} style={styles.searchBar}>
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

          <View ref={filterBarRef} style={styles.filterBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarContent}>
              <TouchableOpacity
                style={[styles.toggleChip, openOnly && styles.toggleChipOpen]}
                onPress={() => setOpenOnly(v => !v)}
              >
                <Feather name="clock" size={12} color={openOnly ? colors.success : colors.textSecondary} />
                <Text style={[styles.toggleChipText, openOnly && { color: colors.success }]}>{t('open', lang)}</Text>
              </TouchableOpacity>
              {activeType && (
                <TouchableOpacity style={styles.activeFilterPill} onPress={() => { setActiveType(null); setActiveSpecialty(null) }}>
                  <TypeSVGIcon type={activeType} size={11} color={colors.primary} />
                  <Text style={styles.activeFilterPillText}>{t(activeType, lang)}</Text>
                  <Feather name="x" size={10} color={colors.primary} />
                </TouchableOpacity>
              )}
              {activeSpecialty && (
                <TouchableOpacity style={styles.activeFilterPill} onPress={() => setActiveSpecialty(null)}>
                  <Text style={styles.activeFilterPillText}>{activeSpecialty}</Text>
                  <Feather name="x" size={10} color={colors.primary} />
                </TouchableOpacity>
              )}
              {showAll && (
                <TouchableOpacity style={styles.activeFilterPill} onPress={() => setShowAll(false)}>
                  <Ionicons name="eye" size={11} color={colors.primary} />
                  <Text style={styles.activeFilterPillText}>{t('adaOnly', lang)}</Text>
                  <Feather name="x" size={10} color={colors.primary} />
                </TouchableOpacity>
              )}
              {langFilter && (
                <TouchableOpacity style={styles.activeFilterPill} onPress={() => setLangFilter(false)}>
                  <Ionicons name="language-outline" size={11} color={colors.primary} />
                  <Text style={styles.activeFilterPillText}>{t('myLang', lang)}</Text>
                  <Feather name="x" size={10} color={colors.primary} />
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
              onPress={() => setShowFilters(v => !v)}
            >
              <Feather name="sliders" size={14} color={showFilters ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {showFilters && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.typeRow}
              contentContainerStyle={styles.typeRowContent}
            >
              {[null, 'pharmacy', 'clinic', 'hospital', 'dentist'].map(type => (
                <TouchableOpacity
                  key={type ?? 'all'}
                  style={[styles.typeChip, activeType === type && styles.typeChipActive]}
                  onPress={() => { setActiveType(type); setActiveSpecialty(null) }}
                >
                  {type
                    ? <TypeSVGIcon type={type} size={14} color={activeType === type ? '#fff' : colors.textSecondary} />
                    : <Ionicons name="apps-outline" size={14} color={activeType === type ? '#fff' : colors.textSecondary} />
                  }
                  <Text style={[styles.typeChipText, activeType === type && styles.typeChipTextActive]}>
                    {type ? t({ pharmacy: 'pharmacies', clinic: 'clinics', hospital: 'hospitals', dentist: 'dentists' }[type] || type, lang) : t('all', lang)}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.chipDivider} />
              <TouchableOpacity
                style={[styles.toggleChip, showAll && styles.toggleChipShowAll]}
                onPress={() => setShowAll(v => !v)}
              >
                <Ionicons name={showAll ? 'eye' : 'eye-outline'} size={12} color={showAll ? colors.primary : colors.textSecondary} />
                <Text style={[styles.toggleChipText, showAll && { color: colors.primary }]}>{showAll ? t('adaOnly', lang) : t('showAll', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleChip, langFilter && styles.toggleChipLang]}
                onPress={() => setLangFilter(v => !v)}
              >
                <Ionicons name="language-outline" size={12} color={langFilter ? colors.accent : colors.textSecondary} />
                <Text style={[styles.toggleChipText, langFilter && { color: colors.accent }]}>{t('myLang', lang)}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {(() => {
            if (!activeType) return null
            const specList = (SPECIALTIES_BY_TYPE[activeType] || []).filter(sp => facilities.some(f => Array.isArray(f.specialty) ? f.specialty.includes(sp) : f.specialty === sp))
            if (!specList.length) return null
            return (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
                {specList.map(sp => (
                  <TouchableOpacity
                    key={sp}
                    style={[styles.filterChip, activeSpecialty === sp && styles.filterChipActive]}
                    onPress={() => setActiveSpecialty(prev => prev === sp ? null : sp)}
                  >
                    <Text style={[styles.filterChipText, activeSpecialty === sp && styles.filterChipTextActive]}>{sp}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )
          })()}

          <TouchableOpacity ref={dutyBannerRef} style={styles.dutyBanner} onPress={() => setShowDutyList(true)} activeOpacity={0.8}>
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

          {facilityLoadError && (
              <View style={styles.errorRow}>
                <Text style={styles.locationNote}>{t('facilityLoadError', lang)}</Text>
                <TouchableOpacity onPress={() => { setLoading(true); setRetryCount(c => c + 1) }} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>{t('tryAgain', lang)}</Text>
                </TouchableOpacity>
              </View>
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
                  <View style={styles.emptyBlurBubble}>
                    <BlurView intensity={85} tint="light" style={StyleSheet.absoluteFill} />
                    {searchText || activeType || activeSpecialty ? (
                      <>
                        <Ionicons name="search-outline" size={44} color={colors.border} style={{ marginBottom: 16 }} />
                        <Text style={styles.emptyTitle}>{t('noResultsTitle', lang)}</Text>
                        <Text style={styles.emptyBody}>{t('noResultsBody', lang)}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.emptyIcon}>🏥</Text>
                        <Text style={styles.emptyTitle}>{t('noFacilitiesTitle', lang)}</Text>
                        <Text style={styles.emptyBody}>{t('noFacilitiesBody', lang)}</Text>
                      </>
                    )}
                  </View>
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
                    {item.cover_image_url ? (
                      <Image source={{ uri: item.cover_image_url }} style={styles.cardCover} resizeMode="cover" />
                    ) : null}
                    <View style={styles.cardBody}>
                    {isDuty && (
                      <View style={styles.dutyCardBadge}>
                        <Text style={styles.dutyLabel}>{t('onDuty', lang)}</Text>
                      </View>
                    )}
                    <View style={styles.cardMain}>
                      <View style={[styles.typeIcon, { backgroundColor: tc.bg }]}>
                        {item.logo_url
                          ? <Image source={{ uri: item.logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
                          : <TypeSVGIcon type={item.type} size={22} color={tc.text} />
                        }
                      </View>
                      <View style={styles.cardContent}>
                        <View style={styles.cardTop}>
                          <View style={styles.cardNameRow}>
                            <Text style={styles.facilityName} numberOfLines={1}>{item.name}</Text>
                          </View>
                          {item._dist != null && (
                            <Text style={styles.distanceText}>{item._dist.toFixed(1)} km</Text>
                          )}
                        </View>
                        <View style={styles.badgeRow}>
                          <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
                            <Text style={[styles.typeBadgeText, { color: tc.text }]}>{t(item.type, lang)}</Text>
                          </View>
                          {item.verified && (
                            <View style={styles.verifiedBadge}>
                              <Ionicons name="shield-checkmark" size={10} color="#fff" />
                              <Text style={styles.verifiedBadgeText}>{t('verified', lang)}</Text>
                            </View>
                          )}
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
                          {isAvailableToday(item.availability) && (
                            <View style={styles.bookableBadge}>
                              <Feather name="calendar" size={10} color={colors.primary} />
                              <Text style={styles.bookableBadgeText}>Bookable</Text>
                            </View>
                          )}
                        </View>
                        {item.specialty?.length ? <Text style={styles.specialtyText} numberOfLines={1}>{Array.isArray(item.specialty) ? item.specialty.join(' · ') : item.specialty}</Text> : null}
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
                        {isDuty ? (
                          <TouchableOpacity
                            style={styles.directionsPill}
                            onPress={() => Linking.openURL(
                              item.latitude != null
                                ? `https://maps.google.com/?q=${item.latitude},${item.longitude}`
                                : item.address
                                  ? `https://maps.google.com/?q=${encodeURIComponent(item.address)}`
                                  : `https://maps.google.com/?q=${encodeURIComponent(item.name)}`
                            )}
                            activeOpacity={0.7}
                          >
                            <Feather name="navigation" size={11} color={colors.primary} />
                            <Text style={styles.directionsPillText}>{t('getDirections', lang)}</Text>
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
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
          </View>
          </SafeAreaView>
          </ImageBackground>
        )}

        {activeTab === 'map' && (
          <SafeAreaView style={styles.safe} edges={['top']}>
            <MapScreen
              facilities={facilities}
              dutyFacilityId={dutyFacilityId}
              userLocation={userLocation}
              onSelectFacility={setSelectedFacility}
              onSelectUnclaimed={setUnclaimedFacility}
              lang={lang}
            />
          </SafeAreaView>
        )}

        {activeTab === 'favourites' && (
          <SafeAreaView style={styles.safe} edges={['top']}>
            <View style={[styles.header, { paddingHorizontal: 16, paddingBottom: 16 }]}>
              <Text style={styles.favScreenTitle}>{t('favourites', lang)}</Text>
            </View>
            {favList.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="heart" size={48} color={colors.border} style={{ marginBottom: 16 }} />
                <Text style={styles.emptyTitle}>{t('noFavourites', lang)}</Text>
                <Text style={styles.emptyBody}>Tap the ❤️ on any facility to save it here for quick access</Text>
              </View>
            ) : (
              <FlatList
                data={favList}
                keyExtractor={f => f.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
                renderItem={({ item }) => {
                  const tc = typeColors[item.type] || typeColors.clinic
                  const isOpen = parseIsOpen(item.opening_hours)
                  const dist = userLocation && item.latitude != null && item.longitude != null
                    ? haversineKm(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude)
                    : null
                  const rating = facilityRatings[item.id]
                  return (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.card}
                      onPress={() => setSelectedFacility(item)}
                    >
                      <View style={styles.cardBody}>
                        <View style={styles.cardMain}>
                          <View style={[styles.typeIcon, { backgroundColor: tc.bg }]}>
                            {item.logo_url
                              ? <Image source={{ uri: item.logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
                              : <TypeSVGIcon type={item.type} size={22} color={tc.text} />
                            }
                          </View>
                          <View style={styles.cardContent}>
                            <View style={styles.cardTop}>
                              <View style={styles.cardNameRow}>
                                <Text style={styles.facilityName} numberOfLines={1}>{item.name}</Text>
                              </View>
                              {dist != null && (
                                <Text style={styles.distanceText}>{dist.toFixed(1)} km</Text>
                              )}
                            </View>
                            <View style={styles.badgeRow}>
                              <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
                                <Text style={[styles.typeBadgeText, { color: tc.text }]}>{t(item.type, lang)}</Text>
                              </View>
                              {item.verified && (
                                <View style={styles.verifiedBadge}>
                                  <Ionicons name="shield-checkmark" size={10} color="#fff" />
                                  <Text style={styles.verifiedBadgeText}>{t('verified', lang)}</Text>
                                </View>
                              )}
                              {isOpen != null && (
                                <View style={[styles.statusBadge, isOpen ? styles.openBadge : styles.closedBadge]}>
                                  <Text style={[styles.statusText, isOpen ? styles.openText : styles.closedText]}>
                                    {isOpen ? t('open', lang) : t('closed', lang)}
                                  </Text>
                                </View>
                              )}
                            </View>
                            {item.address ? <Text style={styles.addressText} numberOfLines={1}>{item.address}</Text> : null}
                            {rating && (
                              <View style={styles.ratingRow}>
                                <Ionicons name="star" size={11} color="#F5A623" />
                                <Text style={styles.ratingText}> {rating.avg} ({rating.count})</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )
                }}
              />
            )}
          </SafeAreaView>
        )}

        {activeTab === 'profile' && (
          <ProfileScreen
            session={session}
            lang={lang}
            onBack={() => setActiveTab('home')}
            onLangChange={newLang => setProfile(prev => ({ ...prev, preferred_language: newLang }))}
            onAvatarChange={url => setProfile(prev => ({ ...prev, avatar_url: url }))}
          />
        )}

        <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} mapTabRef={mapTabRef} />

        {showMenu && (
          <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={closeMenu} />
        )}
        {showMenu && (
        <Animated.View style={[styles.menuDrawer, { transform: [{ translateX: menuAnim }] }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={styles.menuUserRow}>
            {(() => {
              const preset = getPreset(profile?.avatar_url)
              if (preset) return (
                <View style={[styles.menuAvatar, { backgroundColor: preset.bg }]}>
                  <Text style={{ fontSize: 22 }}>{preset.emoji}</Text>
                </View>
              )
              if (profile?.avatar_url?.startsWith('http')) return (
                <Image source={{ uri: profile.avatar_url }} style={styles.menuAvatar} />
              )
              return (
                <View style={[styles.menuAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.menuAvatarText}>{session.user.email[0].toUpperCase()}</Text>
                </View>
              )
            })()}
            <Text style={styles.menuEmail} numberOfLines={1}>{session.user.email}</Text>
            <TouchableOpacity onPress={closeMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ flexShrink: 0 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={styles.menuDivider} />
            <TouchableOpacity ref={menuLangRef} style={styles.menuItem} onPress={() => { closeMenu(); setShowLangModal(true) }}>
              <Ionicons name="globe-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuLanguage', lang)}</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />
            <TouchableOpacity ref={menuQuizRef} style={styles.menuItem} onPress={() => setShowQuizSubmenu(v => !v)}>
              <Ionicons name="flask-outline" size={20} color={colors.accent} />
              <Text style={styles.menuItemText}>{t('supplementQuiz', lang)}</Text>
              <Ionicons name={showQuizSubmenu ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            {showQuizSubmenu && (
              <>
                <TouchableOpacity style={styles.menuSubItem} onPress={() => { closeMenu(); setShowQuiz(true) }}>
                  <Ionicons name="add-circle-outline" size={17} color={colors.accent} />
                  <Text style={styles.menuSubItemText}>{t('newQuiz', lang)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuSubItem} onPress={() => { closeMenu(); loadQuizHistory(); setShowQuizHistory(true) }}>
                  <Ionicons name="time-outline" size={17} color={colors.accent} />
                  <Text style={styles.menuSubItemText}>{t('pastPlans', lang)}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity ref={menuEmergencyRef} style={styles.menuItem} onPress={() => { closeMenu(); showEmergencyNumbers() }}>
              <Ionicons name="call-outline" size={20} color={colors.danger} />
              <Text style={styles.menuItemText}>{t('menuEmergency', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { closeMenu(); setShowMunicipalModal(true) }}>
              <Ionicons name="business-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuMunicipalities', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { closeMenu(); setShowEvents(true) }}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
              <Text style={styles.menuItemText}>{t('menuEvents', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { closeMenu(); setShowAccommodation(true) }}>
              <Ionicons name="home-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuAccommodations', lang)}</Text>
            </TouchableOpacity>
            <View style={[styles.menuItem, { opacity: 0.4 }]}>
              <Ionicons name="car-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuTransportation', lang)}</Text>
              <View style={styles.soonBadge}><Text style={styles.soonBadgeText}>{t('comingSoon', lang)}</Text></View>
            </View>

            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={rateApp}>
              <Ionicons name="star-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuRateApp', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={shareApp}>
              <Feather name="share-2" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuShareApp', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={showAbout}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('menuAbout', lang)}</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.menuDivider} />
          <TouchableOpacity ref={menuTutorialItemRef} style={styles.menuItem} onPress={() => { closeMenu(); startCoachMarks() }}>
            <Ionicons name="compass-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.menuItemText}>{t('menuTutorial', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuItem, { paddingBottom: 24 }]} onPress={() => supabase.auth.signOut()}>
            <Feather name="log-out" size={20} color={colors.danger} />
            <Text style={[styles.menuItemText, { color: colors.danger }]}>{t('signOut', lang)}</Text>
          </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>
        )}

        <Modal visible={showLangModal} transparent animationType="fade" onRequestClose={() => setShowLangModal(false)}>
          <TouchableOpacity style={styles.emergencyBackdrop} activeOpacity={1} onPress={() => setShowLangModal(false)}>
            <View style={styles.emergencySheet} onStartShouldSetResponder={() => true}>
              <View style={styles.emergencyHeader}>
                <Text style={styles.emergencyTitle}>{t('menuLanguage', lang)}</Text>
                <TouchableOpacity onPress={() => setShowLangModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {LANGUAGES.map(({ key, label }) => {
                const active = (profile?.preferred_language || 'English') === key
                return (
                  <TouchableOpacity key={key} style={styles.langRow} onPress={() => selectLang(key)}>
                    <Text style={[styles.langRowLabel, active && styles.langRowLabelActive]}>{label}</Text>
                    {active && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                )
              })}
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={showEmergencyModal} transparent animationType="fade" onRequestClose={() => setShowEmergencyModal(false)}>
          <TouchableOpacity style={styles.emergencyBackdrop} activeOpacity={1} onPress={() => setShowEmergencyModal(false)}>
            <View style={styles.emergencySheet} onStartShouldSetResponder={() => true}>
              <View style={styles.emergencyHeader}>
                <Text style={styles.emergencyTitle}>{t('menuEmergency', lang)}</Text>
                <TouchableOpacity onPress={() => setShowEmergencyModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.emergencySubtitle}>{t('emergencySubtitle', lang)}</Text>
              {[
                { label: t('menuPolice', lang), number: '155', icon: 'shield-outline' },
                { label: t('menuAmbulance', lang), number: '112', icon: 'medkit-outline' },
                { label: t('menuFire', lang), number: '199', icon: 'flame-outline' },
                { label: t('menuCoastGuard', lang), number: '158', icon: 'boat-outline' },
              ].map(({ label, number, icon }) => (
                <TouchableOpacity key={number} style={styles.emergencyRow} onPress={() => { setShowEmergencyModal(false); Linking.openURL(`tel:${number}`) }}>
                  <View style={styles.emergencyIconWrap}>
                    <Ionicons name={icon} size={20} color={colors.danger} />
                  </View>
                  <Text style={styles.emergencyLabel}>{label}</Text>
                  <Text style={styles.emergencyNumber}>{number}</Text>
                  <Ionicons name="call" size={18} color={colors.danger} />
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={showMunicipalModal} transparent animationType="fade" onRequestClose={() => setShowMunicipalModal(false)}>
          <View style={styles.emergencyBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowMunicipalModal(false)} />
            <View style={[styles.emergencySheet, { maxHeight: Dimensions.get('window').height * 0.75 }]}>
              <View style={styles.emergencyHeader}>
                <Text style={styles.emergencyTitle}>{t('menuMunicipalities', lang)}</Text>
                <TouchableOpacity onPress={() => setShowMunicipalModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.emergencySubtitle}>Kıbrıs Türk Belediyeler Birliği</Text>
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {[
                  { name: 'Lefkoşa',                  phone: '03922285221', mapQuery: 'Lefkoşa Türk Belediyesi' },
                  { name: 'Gazimağusa',                phone: '03923665332', mapQuery: 'Gazimağusa Belediyesi Fazıl Polatpaşa Bulvarı Gazimağusa KKTC' },
                  { name: 'Girne',                     phone: '03928152118', mapQuery: 'Girne Belediyesi Ecevit Caddesi 68 Girne KKTC' },
                  { name: 'Gönyeli-Alayköy',           phone: '03922231901', mapQuery: 'Gönyeli Belediyesi Belediye Bulvarı 30 Yenikent Gönyeli KKTC' },
                  { name: 'Lapta-Alsancak-Çamlıbel',  phone: '03928228623', mapQuery: 'Lapta Belediyesi Lapta Girne KKTC' },
                  { name: 'Güzelyurt',                 phone: '03927142813', mapQuery: 'Güzelyurt Belediyesi Alemdar Sokak 14 Güzelyurt KKTC' },
                  { name: 'Değirmenlik-Akıncılar',     phone: '03922323322', mapQuery: 'Değirmenlik Belediyesi Başpınar Yolu Sokak 27 Değirmenlik KKTC' },
                  { name: 'Dikmen',                    phone: '03922372863', mapQuery: 'Dikmen Belediyesi 20 Temmuz Caddesi Dikmen Girne KKTC' },
                  { name: 'Lefke',                     phone: '03927287347', mapQuery: 'Lefke Belediyesi Tahir Efendi Sokak 1 Lefke KKTC' },
                  { name: 'Mesarya',                   phone: '03923777459', mapQuery: 'Mesarya Belediyesi Ulus Ülfet Sokak 6 Akdoğan KKTC' },
                  { name: 'Çatalköy-Esentepe',         phone: '03928244068', mapQuery: 'Çatalköy Belediyesi Mücahit Sokak 10 Çatalköy Girne KKTC' },
                  { name: 'İskele',                    phone: '03923712521', mapQuery: 'İskele Belediyesi Bozdağ Sokak 4 İskele KKTC' },
                  { name: 'Erenköy-Karpaz',            phone: '03923744350', mapQuery: 'Yeni Erenköy Belediyesi İstiklal Caddesi Yeni Erenköy İskele KKTC' },
                  { name: 'Yeni Boğaziçi',             phone: '03923788145', mapQuery: 'Yeniboğaziçi Belediyesi İstiklal Caddesi Yeniboğaziçi Gazimağusa KKTC' },
                  { name: 'Geçitkale-Serdarlı',        phone: '03923733147', mapQuery: 'Geçitkale Belediyesi Ecevit Caddesi 70 Geçitkale Gazimağusa KKTC' },
                  { name: 'Mehmetçik-Büyükkonuk',      phone: '03923755090', mapQuery: 'Mehmetçik Belediyesi Atatürk Meydanı 3 Mehmetçik İskele KKTC' },
                  { name: 'Beyarmudu',                 phone: '03923799401', mapQuery: 'Beyarmudu Belediyesi Hüseyin Kafa Caddesi 68 Beyarmudu Gazimağusa KKTC' },
                  { name: 'Tatlısu',                   phone: '03923892026', mapQuery: 'Tatlısu Belediyesi Cumhuriyet Sokak 9 Tatlısu Gazimağusa KKTC' },
                ].map(({ name, phone, mapQuery }) => {
                  const isExpanded = expandedMuni === name
                  return (
                    <View key={name}>
                      <View style={styles.emergencyRow}>
                        <View style={styles.emergencyIconWrap}>
                          <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
                        </View>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => setExpandedMuni(isExpanded ? null : name)}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={[styles.emergencyLabel, { flex: 0 }]}>{name}</Text>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textSecondary} />
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 14 }}>
                          <Ionicons name="map-outline" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setShowMunicipalModal(false); Linking.openURL(`tel:${phone}`) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="call" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      </View>
                      {isExpanded && (
                        <View style={styles.muniHoursBubble}>
                          <Ionicons name="time-outline" size={13} color={colors.primary} style={{ marginTop: 1 }} />
                          <View>
                            <Text style={styles.muniHoursText}>Mon – Wed, Fri{'  '}08:00 – 15:30</Text>
                            <Text style={styles.muniHoursText}>Thu{'  '}08:00 – 12:30 / 13:00 – 17:30</Text>
                            <Text style={styles.muniHoursText}>Sat – Sun{'  '}Closed</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <TutorialCoachMarks
          steps={coachSteps}
          visible={showCoachMarks}
          onNext={handleCoachNext}
          onFinish={handleCoachFinish}
        />

      </View>
    )
  }

  return <SafeAreaProvider>{content}</SafeAreaProvider>
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  container:        { flex: 1, paddingHorizontal: 16 },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  header:           { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingTop: 16, paddingBottom: 12, position: 'relative' },
  headerLogoWrap:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  wordmark:         { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5 },
  headerIcon:       { width: 110, height: 54 },
  subText:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
  signOutLink:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  memberIdLabel:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  memberIdValue:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: 2, marginTop: 6 },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewToggle:       { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 8, padding: 2, gap: 2 },
  viewBtn:          { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  viewBtnActive:    { backgroundColor: colors.surface },
  notifBtn:         { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },
  notifDot:         { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.bg },
  errorRow:         { alignItems: 'center', marginBottom: 10 },
  locationNote:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
  retryBtn:         { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 10 },
  retryBtnText:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  searchBar:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchInput:      { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  filterBar:        { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  filterBarContent: { gap: 6, alignItems: 'center', paddingRight: 8 },
  activeFilterPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  activeFilterPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  filterToggleBtn:  { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginLeft: 6, flexShrink: 0 },
  filterToggleBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterToggles:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
  toggleChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  toggleChipText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  toggleChipOpen:   { borderColor: colors.success, backgroundColor: colors.successLight },
  toggleChipShowAll:{ borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toggleChipLang:   { borderColor: colors.accent, backgroundColor: colors.accentLight },
  typeRow:          { flexGrow: 0, marginBottom: 10 },
  typeRowContent:   { gap: 6, paddingRight: 4, alignItems: 'center' },
  chipDivider:      { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2, alignSelf: 'center' },
  typeChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  typeChipActive:   { borderColor: colors.primary, backgroundColor: colors.primary },
  typeChipEmoji:    { fontSize: 13 },
  typeChipText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  typeChipTextActive: { color: '#fff' },
  filterRow:        { marginBottom: 8, flexGrow: 0 },
  filterContent:    { gap: 8, paddingRight: 4, alignItems: 'center' },
  filterChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#C8D3DC', backgroundColor: colors.cardBg, alignSelf: 'flex-start' },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#1A2B33' },
  filterChipTextActive: { fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  favScreenTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  noFavText:        { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32, marginTop: 8 },
  listContent:      { paddingBottom: 32 },
  card:             { backgroundColor: colors.cardBg, borderRadius: 16, overflow: 'hidden', marginBottom: 10, shadowColor: '#1A2B33', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  cardCover:        { width: '100%', height: 120 },
  cardBody:         { padding: 16 },
  dutyCard:         { borderWidth: 1.5, borderColor: colors.accent },
  dutyCardBadge:    { backgroundColor: colors.accentLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 10 },
  dutyLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardMain:         { flexDirection: 'row', alignItems: 'center' },
  cardNameRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  cardActions:      { flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginLeft: 6, alignSelf: 'stretch', paddingVertical: 2 },
  callPill:         { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, backgroundColor: colors.accentLight, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  callPillText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.accent },
  directionsPill:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, backgroundColor: colors.primaryLight, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  directionsPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  typeIcon:         { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  typeIconText:     { fontSize: 22 },
  cardContent:      { flex: 1 },
  cardTop:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  facilityName:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1 },
  distanceText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  badgeRow:         { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  typeBadge:        { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:    { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  statusBadge:      { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  openBadge:        { backgroundColor: colors.successLight },
  closedBadge:      { backgroundColor: colors.dangerLight },
  statusText:       { fontSize: 11, fontFamily: 'Inter_700Bold' },
  openText:         { color: colors.success },
  closedText:       { color: colors.danger },
  specialtyText:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 3 },
  addressText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 4 },
  ratingRow:        { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ratingText:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  cardUnclaimed:    { opacity: 1 },
  notOnAdaBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.border },
  notOnAdaBadgeText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  verifiedBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: colors.primary },
  verifiedBadgeText:{ fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  bookableBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.primaryLight },
  bookableBadgeText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
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
  reportBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, alignSelf: 'center' },
  reportBtnText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textDecorationLine: 'underline' },
  actionBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  actionBtnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
  dutyBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.accentLight, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.accent + '30' },
  dutyBannerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dutyBannerIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.accent + '20', justifyContent: 'center', alignItems: 'center' },
  dutyBannerTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.accent, marginBottom: 2 },
  dutyBannerSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.accent + 'AA' },
  weatherCard:        { backgroundColor: colors.cardBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10, ...shadow },
  weatherRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weatherEmoji:       { fontSize: 20 },
  weatherTemp:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  weatherDescInline:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  weatherExpandStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10 },
  weatherStat:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  uvBadge:            { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  uvBadgeText:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  uvWarnText:         { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, paddingTop: 8 },
  forecastRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10 },
  forecastDay:        { flex: 1, alignItems: 'center', gap: 3 },
  forecastLabel:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  forecastIcon:       { fontSize: 16 },
  forecastMax:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  forecastMin:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
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
  emptyBlurBubble:  { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 28, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  emptyIcon:        { fontSize: 48, marginBottom: 16 },
  emptyTitle:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  emptyBody:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  hamburgerBtn:     { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },
  menuBackdrop:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 10 },
  menuDrawer:       { position: 'absolute', top: 0, right: 0, bottom: 0, width: 260, backgroundColor: colors.bg, zIndex: 11, paddingHorizontal: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: -4, height: 0 }, elevation: 20 },
  menuUserRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  menuAvatar:       { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  menuAvatarText:   { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
  menuEmail:        { flex: 1, minWidth: 0, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  menuDivider:      { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  menuItem:         { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  menuItemText:     { flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  menuSubItem:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9, paddingLeft: 34 },
  menuSubItemText:  { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.accent },
  quizHistCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cardBg, borderRadius: 14, padding: 14, marginBottom: 8, ...shadow },
  quizHistIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  quizHistPharmacy: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  quizHistMeta:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  soonBadge:        { backgroundColor: colors.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  soonBadgeText:    { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  langRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  langRowLabel:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  langRowLabelActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  emergencyBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  emergencySheet:     { width: '100%', backgroundColor: colors.bg, borderRadius: 18, padding: 20, ...shadow },
  emergencyHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  emergencyTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  emergencySubtitle:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 16 },
  emergencyRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  emergencyIconWrap:  { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(220,38,38,0.1)', justifyContent: 'center', alignItems: 'center' },
  emergencyLabel:     { flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  emergencyNumber:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginRight: 4 },
  muniHoursBubble:    { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: colors.primaryLight, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, marginLeft: 46 },
  muniHoursText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, lineHeight: 19 },
})
