import { Component, Fragment, useEffect, useState, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View, Text, Image, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Pressable, Platform, TextInput, ScrollView, Linking, BackHandler, Animated, Share, Alert, Modal, Dimensions, AppState } from 'react-native'
import { BlurView } from 'expo-blur'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useFonts, Inter_400Regular, Inter_700Bold } from '@expo-google-fonts/inter'
import { PlayfairDisplay_400Regular, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display'
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import Constants from 'expo-constants'
import { supabase, isGuest } from './lib/supabase'
import AccountRequiredSheet from './components/AccountRequiredSheet'
import { colors, typeColors, shadow } from './constants/theme'
import { t } from './constants/i18n'
import { getPreset } from './constants/avatars'
import { SPECIALTIES_BY_TYPE } from './constants/specialties'
import { MODULE_FLAGS, EXPLORE_MAP_LIVE } from './constants/flags'
import AuthScreen from './screens/AuthScreen'
import BookingScreen from './screens/BookingScreen'
import FacilityProfileScreen from './screens/FacilityProfileScreen'
import ProviderScreen from './screens/ProviderScreen'
import ProviderOnboardingScreen from './screens/ProviderOnboardingScreen'
import MapScreen from './screens/MapScreen'
import ExploreMapScreen from './screens/ExploreMapScreen'
import AdminScreen from './screens/AdminScreen'
import ProfileScreen from './screens/ProfileScreen'
import DutyListScreen from './screens/DutyListScreen'
import EventsScreen from './screens/EventsScreen'
import OrganizerScreen from './screens/OrganizerScreen'
import AccommodationScreen from './screens/AccommodationScreen'
import EstateAgentOnboardingScreen from './screens/EstateAgentOnboardingScreen'
import EstateAgentDashboardScreen from './screens/EstateAgentDashboardScreen'
import HomeServiceDashboardScreen from './screens/HomeServiceDashboardScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import HomeServicesScreen from './screens/HomeServicesScreen'
import JobPostingsScreen from './screens/JobPostingsScreen'
import TransportScreen from './screens/TransportScreen'
import InsuranceScreen from './screens/InsuranceScreen'
import GroomingScreen from './screens/GroomingScreen'
import GaragesScreen from './screens/GaragesScreen'
import TowingScreen from './screens/TowingScreen'
import EsimScreen from './screens/EsimScreen'
import InsuranceDashboardScreen from './screens/InsuranceDashboardScreen'
import ExploreScreen from './screens/ExploreScreen'
import ExploreProfileScreen from './screens/ExploreProfileScreen'
import PetsHomeScreen from './screens/pets/PetsHomeScreen'
import BringingPetScreen from './screens/pets/BringingPetScreen'
import TimelineCalculatorScreen from './screens/pets/TimelineCalculatorScreen'
import VetDirectoryScreen from './screens/pets/VetDirectoryScreen'
import TravelWithPetScreen from './screens/pets/TravelWithPetScreen'
import OwningPetScreen from './screens/pets/OwningPetScreen'
import TutorialCoachMarks from './screens/TutorialCoachMarks'
import NotificationsScreen from './screens/NotificationsScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import HomeScreen from './screens/HomeScreen'
import LegalScreen from './screens/LegalScreen'
import NewcomerEssentialsScreen from './screens/NewcomerEssentialsScreen'
import ExchangeRatesScreen from './screens/ExchangeRatesScreen'
import GamesHubScreen from './screens/games/GamesHubScreen'
import XoxGameScreen from './screens/games/XoxGameScreen'
import MemoryMatchScreen from './screens/games/MemoryMatchScreen'
import Game2048Screen from './screens/games/Game2048Screen'
import SudokuScreen from './screens/games/SudokuScreen'
import { haversineKm, parseIsOpen, coarseCoord } from './utils/facilityUtils'
import { dutyStatus, localDateKey, DUTY_FRESH } from './utils/dutyStatus'
import {
  evaluateCityWelcome, markWelcomeShown, setCityWelcomeEnabled,
  loadCityWelcomeState, shouldAskHomeCity, markAskShown, setHomeCity,
} from './utils/cityWelcome'
import CityWelcomeCard from './components/CityWelcomeCard'
import HomeCitySheet from './components/HomeCitySheet'
import CityWelcomeSettings from './components/CityWelcomeSettings'
import { FacilityCardSkeleton, Skeleton } from './components/Skeleton'
import OliGuide from './components/OliGuide'
import ComingSoonScreen from './components/ComingSoonScreen'
import * as Updates from 'expo-updates'
import BackButton from './components/BackButton'

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

// The `map` tab's identity follows EXPLORE_MAP_LIVE, label AND icon together. A tab
// reading "Keşfet" under a folded-map icon is half-swapped, and half-swapped reads as a
// bug rather than a feature. Evaluated once at module load — the flag is a build-time
// constant, so there is nothing to re-render.
const TAB_ITEMS = [
  { key: 'home',       iconOff: 'home-outline',   iconOn: 'home',    labelKey: 'tabHome' },
  {
    key:      'map',
    iconOff:  EXPLORE_MAP_LIVE ? 'compass-outline' : 'map-outline',
    iconOn:   EXPLORE_MAP_LIVE ? 'compass'         : 'map',
    labelKey: EXPLORE_MAP_LIVE ? 'menuExplore'     : 'map',
  },
  { key: 'favourites', iconOff: 'heart-outline',   iconOn: 'heart',   labelKey: 'tabSaved' },
  { key: 'profile',    iconOff: 'person-outline',  iconOn: 'person',  labelKey: 'tabProfile' },
]

function BottomTabBar({ activeTab, onTabPress, mapTabRef, lang }) {
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
            <Text style={[tabBar.label, active && tabBar.labelActive]}>{t(tab.labelKey, lang)}</Text>
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

// Gate the Welcome Video drawer row until a real video (and its playback tech)
// exists. Kept false so the row does not render — flip to true once wired.
const WELCOME_VIDEO_LIVE = false

// Garages / Auto Services dark-launch. Controls only the Home TILE's visibility;
// the module screen itself is gated by MODULE_FLAGS.garages (Coming Soon). false
// hides the tile from normal users so a tap can't dead-end in Coming Soon; admins
// and existing garage owners still see it (garagesTileVisible) for preview. Flip
// to true only in lockstep with MODULE_FLAGS.garages when the module launches.
const GARAGES_LIVE = false

// One repeatable drawer row. Defined at module level so it never remounts with
// the parent. Each item: { key, iconSet, icon, labelKey, onPress, danger? }.
function DrawerRow({ item, lang }) {
  const Icon = item.iconSet === 'feather' ? Feather : Ionicons
  const color = item.danger ? colors.danger : colors.textPrimary
  return (
    <TouchableOpacity style={styles.menuItem} onPress={item.onPress}>
      <Icon name={item.icon} size={20} color={color} />
      <Text style={[styles.menuItemText, item.danger && { color: colors.danger }]}>{t(item.labelKey, lang)}</Text>
    </TouchableOpacity>
  )
}

// Centered sheet rendered as a root-level absolute overlay, NOT a <Modal>.
// A native Modal opens its own window above the whole React root, so the Ask Oli
// floating button can never be drawn or tapped over one — no zIndex reaches it.
// Anything Oli must stay reachable from (Emergency, Municipalities) belongs here
// instead, in the same hierarchy as the FAB, where stacking is ours to control.
// Same pattern as CityWelcomeCard / HomeCitySheet.
function SheetOverlay({ onDismiss, children }) {
  const fade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start()
  }, [fade])

  return (
    <Animated.View style={[styles.sheetOverlay, { opacity: fade }]} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      {children}
    </Animated.View>
  )
}

class BLErrorBoundary extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, padding: 24, backgroundColor: '#F7F8FA', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#1E293B', marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24 }}>Please go back and try again.</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })} style={{ padding: 14, backgroundColor: '#0E7C7B', borderRadius: 12 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_700Bold, PlayfairDisplay_400Regular, PlayfairDisplay_700Bold })
  const [session, setSession] = useState(undefined)
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [dutyFacilityId, setDutyFacilityId] = useState(null)
  // Roster health for the Home banner. Read from duty_list — the table DutyListScreen
  // already depends on — so the banner can stop promising a list that is not there.
  // This does NOT settle which table is authoritative; that decision is still open.
  const [dutyRosterStatus, setDutyRosterStatus] = useState(DUTY_FRESH)
  // City welcome: the pending decision, plus the region each deep-linked screen
  // should open pre-filtered to. Cleared on that screen's back, so a later manual
  // open is not still filtered to a city the user has since left.
  const [cityWelcome, setCityWelcome] = useState(null)
  const [exploreBeachRegion, setExploreBeachRegion] = useState(null)
  const [eventsDistrict, setEventsDistrict] = useState(null)
  const [dutyRegion, setDutyRegion] = useState(null)
  const [detectedRegion, setDetectedRegion] = useState(null)
  const [showHomeCityAsk, setShowHomeCityAsk] = useState(false)
  const [showCitySettings, setShowCitySettings] = useState(false)
  const [selectedFacility, setSelectedFacility] = useState(null)
  const [bookingFacility, setBookingFacility] = useState(null)
  const [profile, setProfile] = useState(null)
  const [activeTab, setActiveTab] = useState('home')
  const [showDutyList, setShowDutyList] = useState(false)
  const [onboarded, setOnboarded] = useState(null)
  const [pendingLang, setPendingLang] = useState('English')
  const [facilityRatings, setFacilityRatings] = useState({})
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [providerFacility, setProviderFacility] = useState(undefined)
  const [pendingClaim, setPendingClaim] = useState(undefined)
  const [ownsGarage, setOwnsGarage] = useState(false) // drives the dark-launched garages tile for owners (see gate)
  const [unclaimedFacility, setUnclaimedFacility] = useState(null)
  const [favorites, setFavorites] = useState(new Set())
  const [placeFavorites, setPlaceFavorites] = useState(new Set())   // Explore places — SEPARATE from `favorites` (ada_fav_places), no type discriminator to corrupt the facility Saved tab
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [showWelcome, setShowWelcome] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const [gateKey, setGateKey] = useState(null)
  const [facilityLoadError, setFacilityLoadError] = useState(false)
  const [notifsLoading, setNotifsLoading] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [weatherData, setWeatherData] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showEmergencyModal, setShowEmergencyModal] = useState(false)
  const [showMunicipalModal, setShowMunicipalModal] = useState(false)
  const [expandedMuni, setExpandedMuni] = useState(null)
  const [showEvents, setShowEvents] = useState(false)
  const [showAccommodation, setShowAccommodation] = useState(false)
  const [showPets, setShowPets] = useState(false)
  const [showHomeServices, setShowHomeServices] = useState(false)
  const [showJobPostings,  setShowJobPostings]  = useState(false)
  const [showExploreBeach, setShowExploreBeach] = useState(false)
  const [showExplore, setShowExplore] = useState(false)   // the full Explore module tile (dark until MODULE_FLAGS.explore)
  const [adminPreview, setAdminPreview] = useState(null)                 // null | 'explore' | (future preview keys). Admins never reach HomeScreen /
                                                                         // the customer module chain (role-first branch below), so any admin preview
                                                                         // surface is entered from AdminScreen via this single gate — one condition,
                                                                         // not a per-surface boolean.
  const [selectedExplorePlace, setSelectedExplorePlace] = useState(null) // Explore profile drill-down — sole place-profile state (frozen beaches flow removed in Slice 5 pt B)
  const [showTransport, setShowTransport] = useState(false)
  const [showInsurance, setShowInsurance] = useState(false)
  const [showLegal, setShowLegal] = useState(false)
  const [showGrooming, setShowGrooming] = useState(false)
  const [showGarages, setShowGarages] = useState(false)
  const [showTowing, setShowTowing] = useState(false)
  const [showStudentHub, setShowStudentHub] = useState(false)
  const [showEsim, setShowEsim] = useState(false)
  const [showNewcomerEssentials, setShowNewcomerEssentials] = useState(false)
  const [showExchangeRates, setShowExchangeRates] = useState(false)
  const [petsSubScreen, setPetsSubScreen] = useState(null)
  const [showGames, setShowGames] = useState(false)
  const [gamesSubScreen, setGamesSubScreen] = useState(null)
  const [openedProperty, setOpenedProperty] = useState(null)
  const [showAgentOnboarding, setShowAgentOnboarding] = useState(false)
  const [showLangModal, setShowLangModal] = useState(false)
  // Ask Oli's sheet is a root overlay now, not a <Modal>: the root has to know it is
  // up (to hide the app content from the a11y tree) and how to close it (hardware back).
  const [oliSheetOpen, setOliSheetOpen] = useState(false)
  const oliCloseRef = useRef(null)
  const [showCoachMarks, setShowCoachMarks] = useState(false)
  const [coachSteps, setCoachSteps]         = useState([])
  const hamburgerRef       = useRef(null)
  const searchRef          = useRef(null)
  const filterBarRef       = useRef(null)
  const dutyBannerRef      = useRef(null)
  const mapTabRef          = useRef(null)
  const menuAnim = useRef(new Animated.Value(260)).current
  const sessionRef = useRef(null)
  const toSignUpRef = useRef(false)
  const handledColdStartRef = useRef(false)

  function openMenu() {
    setShowMenu(true)
    Animated.timing(menuAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start()
  }
  function closeMenu() {
    Animated.timing(menuAnim, { toValue: 260, duration: 200, useNativeDriver: true }).start(() => { setShowMenu(false) })
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
    setActiveTab('home')
    setShowNotifs(false)
    await new Promise(r => setTimeout(r, 400))

    // On-screen basics only. The drawer is now settings, not navigation, so the
    // menu step just highlights the button — it never opens the drawer.
    const [menuBtn, search, duty, map] = await Promise.all([
      measureRef(hamburgerRef),
      measureRef(searchRef),
      measureRef(dutyBannerRef),
      measureRef(mapTabRef),
    ])

    const steps = []
    if (menuBtn) steps.push({ ...menuBtn, title: t('coachMenuTitle', lang), body: t('coachMenuBody', lang) })
    if (search)  steps.push({ ...search,  title: t('coachSearchTitle', lang),  body: t('coachSearchBody', lang) })
    if (duty)    steps.push({ ...duty,    title: t('coachDutyTitle', lang),    body: t('coachDutyBody', lang) })
    // Copy follows EXPLORE_MAP_LIVE with the tab label and icon. The coach mark points
    // AT that tab; describing health facilities while it reads Keşfet is half-swapped.
    if (map)     steps.push({ ...map,     title: t(EXPLORE_MAP_LIVE ? 'coachExploreTitle' : 'coachMapTitle', lang),
                                          body:  t(EXPLORE_MAP_LIVE ? 'coachExploreBody'  : 'coachMapBody',  lang) })
    if (steps.length) { setCoachSteps(steps); setShowCoachMarks(true) }
  }

  function handleCoachFinish() {
    setShowCoachMarks(false)
    closeMenu()
  }

  function shareApp() {
    const link = Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/id6783996527'
      : 'https://play.google.com/store/apps/details?id=com.berkeustun95.ada'
    Share.share({ message: `${t('shareAppMessage', lang)}\n${link}` })
  }
  function rateApp() {
    const url = Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/id6783996527?action=write-review'
      : 'market://details?id=com.berkeustun95.ada'
    Linking.openURL(url).catch(() =>
      Linking.openURL('https://play.google.com/store/apps/details?id=com.berkeustun95.ada')
    )
  }
  // Returns true if the action was gated (caller should stop). Guests only.
  function requireAccount(messageKey) {
    if (!isGuest(session)) return false
    setGateKey(messageKey)
    return true
  }

  // We dropped upgrade-in-place, so the guest session is discarded and the user
  // goes through the normal signup. Favourites live in AsyncStorage and survive.
  async function gateSignUp() {
    setGateKey(null)
    setAuthMode('signup')
    toSignUpRef.current = true
    setShowWelcome(false)
    await supabase.auth.signOut()
  }

  async function selectLang(langKey) {
    setProfile(prev => ({ ...prev, preferred_language: langKey }))
    setPendingLang(langKey)
    setShowLangModal(false)
    AsyncStorage.setItem('@trnc_lang', langKey)
    // Guests have no writable profile row, so the device copy above is their only store.
    if (isGuest(session)) return
    await supabase.from('profiles').update({ preferred_language: langKey }).eq('id', session.user.id)
  }
  function showAbout() {
    Alert.alert('ADA', `Version ${Constants.expoConfig?.version ?? '1.1.0'}\n\n${t('aboutDescription', lang)}`, [{ text: 'OK' }])
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

  function togglePlaceFavorite(id) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPlaceFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      AsyncStorage.setItem('ada_fav_places', JSON.stringify([...next]))
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
      // A normal sign-out returns to the entry screen; a gate-driven one is on its way
      // to the sign-up form, so don't bounce it back to the entry screen.
      if (event === 'SIGNED_OUT') {
        if (toSignUpRef.current) { toSignUpRef.current = false; setShowWelcome(false) }
        else setShowWelcome(true)
      }
      if (event === 'PASSWORD_RECOVERY') setShowPasswordReset(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Supabase RN token auto-refresh: complement to autoRefreshToken:true in
  // lib/supabase.js. Keep the refresh ticker running only while foregrounded
  // (RN throttles JS timers in the background). Start once on mount because the
  // app launches 'active' and the 'change' event won't fire for that initial state.
  useEffect(() => {
    supabase.auth.startAutoRefresh()
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })
    return () => sub.remove()
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
      // These are root overlays, not <Modal>s, so there is no onRequestClose to catch
      // the hardware back button. They are topmost, so they go first — Oli's sheet above
      // the other two. OliGuide registers its own handler while open (which wins, being
      // the newest), but this effect re-registers on any of its 30+ deps and would then
      // fall through to `return false` and EXIT THE APP with the sheet still up.
      if (oliSheetOpen) { oliCloseRef.current?.(); return true }
      if (showMunicipalModal) { setShowMunicipalModal(false); return true }
      if (showEmergencyModal) { setShowEmergencyModal(false); return true }
      if (showMenu) { closeMenu(); return true }
      if (showPasswordReset) { setShowPasswordReset(false); return true }
      if (showNotifs) { setShowNotifs(false); return true }
      if (showDutyList) { setShowDutyList(false); return true }
      if (showEvents) { setShowEvents(false); return true }
      if (openedProperty) { setOpenedProperty(null); return true }
      if (showAgentOnboarding) { setShowAgentOnboarding(false); return true }
      if (showAccommodation) { setShowAccommodation(false); return true }
      if (unclaimedFacility) { setUnclaimedFacility(null); return true }
      if (bookingFacility) { setBookingFacility(null); return true }
      if (selectedFacility) { setSelectedFacility(null); setBookingFacility(null); return true }
      if (petsSubScreen) { setPetsSubScreen(null); return true }
      if (showPets) { setShowPets(false); return true }
      if (showHomeServices) { setShowHomeServices(false); return true }
      if (showJobPostings)  { setShowJobPostings(false);  return true }
      if (showTransport) { setShowTransport(false); return true }
      if (showInsurance) { setShowInsurance(false); return true }
      if (showGrooming) { setShowGrooming(false); return true }
      if (showGarages) { setShowGarages(false); return true }
      if (showTowing) { setShowTowing(false); return true }
      if (showStudentHub) { setShowStudentHub(false); return true }
      if (showEsim) { setShowEsim(false); return true }
      if (showLegal) { setShowLegal(false); return true }
      if (selectedExplorePlace) { setSelectedExplorePlace(null); return true }
      if (showExploreBeach)     { setShowExploreBeach(false); return true }
      if (showExplore)          { setShowExplore(false); return true }
      if (adminPreview)         { setAdminPreview(null); return true }
      if (showNewcomerEssentials) { setShowNewcomerEssentials(false); return true }
      if (showExchangeRates) { setShowExchangeRates(false); return true }
      if (gamesSubScreen) { setGamesSubScreen(null); return true }
      if (showGames) { setShowGames(false); return true }
      if (activeTab !== 'home') { setActiveTab('home'); return true }
      if (!sessionRef.current && !showWelcome) { setShowWelcome(true); return true }
      return false
    })
    return () => sub.remove()
  }, [showMenu, showPasswordReset, showNotifs, showDutyList, showEvents, unclaimedFacility, selectedFacility, bookingFacility, activeTab, showAccommodation, openedProperty, showAgentOnboarding, showPets, petsSubScreen, showHomeServices, showJobPostings, showTransport, showInsurance, showGrooming, showGarages, showTowing, showStudentHub, showEsim, showLegal, showExploreBeach, showExplore, adminPreview, selectedExplorePlace, showNewcomerEssentials, showExchangeRates, showGames, gamesSubScreen, showWelcome, showEmergencyModal, showMunicipalModal, oliSheetOpen])

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
      .select('id, name, type, status, hidden_at, hidden_reason, membership_tier, trial_ends_at, phone, address, opening_hours, cover_image_url, logo_url, availability, description, languages, specialty, latitude, longitude, photos')
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
    sessionRef.current = session
    menuAnim.setValue(260)
    setShowMenu(false)
    setShowNotifs(false)
    if (!session) {
      setProfile(null); setNotifications([]); setProviderFacility(undefined); setPendingClaim(undefined); setOwnsGarage(false); return
    }
    supabase.from('profiles').select('role, preferred_language, avatar_url, blocked_until').eq('id', session.user.id).single()
      .then(async ({ data }) => {
        setProfile(data ?? null)

        // Language self-heal (SERVER column only — in-app already resolves a NULL
        // column via pendingLang since the L1 migration). A pre-auth/onboarding
        // language pick lives solely in AsyncStorage (@trnc_lang) because no session
        // exists at onboarding; persist it to the server the FIRST time the column is
        // still unset, so cross-user notifications and the duty-push edge function use
        // the right language. Reads @trnc_lang directly (not the possibly-stale
        // pendingLang state) to avoid a mount-effect race. Runs on every session load,
        // but writes at most once: the `== null` guard means an existing value is
        // never overwritten, and guests are excluded EXPLICITLY (they cannot write the
        // row — not left to the RLS block to fail silently).
        const storedLang = await AsyncStorage.getItem('@trnc_lang')
        const effectiveLang = data?.preferred_language || storedLang || 'English'
        if (data && data.preferred_language == null && !isGuest(session) && storedLang) {
          const { error: syncErr } = await supabase.from('profiles')
            .update({ preferred_language: storedLang }).eq('id', session.user.id)
          if (!syncErr) setProfile(prev => (prev ? { ...prev, preferred_language: storedLang } : prev))
        }

        if (data?.role === 'provider') {
          loadProviderFacility()
        } else if (!data?.role || data?.role === 'customer') {
          scheduleAppointmentReminders(session.user.id, effectiveLang)
          AsyncStorage.getItem('@trnc_coach_v2').then(async shown => {
            // First run is already spending its attention on the carousel, the
            // entry screen and the coach marks. The home-city question waits for
            // the NEXT cold start, where it is the only thing on screen.
            const coachMarksRunning = !shown
            if (coachMarksRunning) { AsyncStorage.setItem('@trnc_coach_v2', 'true'); startCoachMarks() }

            // This effect runs once per session mount, so this is a cold-start-only
            // path by construction — a foreground can never surface the question.
            const st = await loadCityWelcomeState()
            if (shouldAskHomeCity({ ...st, coachMarksRunning, now: Date.now() }).ask) {
              markAskShown()
              setShowHomeCityAsk(true)
            }
          })
        }
      })
    setNotifsLoading(true)
    supabase.from('notifications').select('id, title, body, read, created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setNotifications(data); setNotifsLoading(false) })

    // Owns a garage? Drives the dark-launched garages tile for owners onboarded
    // before GARAGES_LIVE flips public. Guests can't own one — skip the query.
    if (!isGuest(session)) {
      supabase.from('facilities').select('id')
        .eq('provider_id', session.user.id).eq('type', 'garage').limit(1)
        .then(({ data }) => setOwnsGarage((data?.length ?? 0) > 0))
    } else {
      setOwnsGarage(false)
    }
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

  useEffect(() => {
    // Guests can't hold a push token (the profiles write is refused by RLS), so don't
    // raise an OS permission prompt we can't honour.
    if (!session || isGuest(session)) return
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
      if (!sessionRef.current) return
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

  // Handle cold-start notification tap (app killed → tapped → opened)
  useEffect(() => {
    if (!session || handledColdStartRef.current) return
    handledColdStartRef.current = true
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return
      const screen = response.notification.request.content.data?.screen
      if (screen === 'duty') setShowDutyList(true)
    })
  }, [session])

  useEffect(() => {
    setFacilityLoadError(false)
    async function load() {
      const favVal = await AsyncStorage.getItem('ada_favorites')
      if (favVal) setFavorites(new Set(JSON.parse(favVal)))
      const placeFavVal = await AsyncStorage.getItem('ada_fav_places')
      if (placeFavVal) setPlaceFavorites(new Set(JSON.parse(placeFavVal)))

      const { data, error } = await supabase.from('facilities').select('*').order('name')
      if (error) setFacilityLoadError(true)
      else setFacilities(data ?? [])

      // localDateKey(), not toISOString(): TRNC is UTC+2/+3, so between local midnight
      // and 03:00 the UTC date is still YESTERDAY — exactly the hours someone needs this.
      const today = localDateKey()
      const { data: duty } = await supabase
        .from('duty_schedule').select('facility_id').eq('date', today).maybeSingle()
      if (duty) setDutyFacilityId(duty.facility_id)

      // Roster health, from duty_list. Two cheap reads: is today covered, and what is the
      // newest day we hold. The second separates "never seeded" from "ran out".
      const [{ count: dutyToday }, { data: dutyNewest }] = await Promise.all([
        supabase.from('duty_list').select('id', { head: true, count: 'exact' }).eq('duty_date', today),
        supabase.from('duty_list').select('duty_date').order('duty_date', { ascending: false }).limit(1),
      ])
      setDutyRosterStatus(dutyStatus({
        todayCount: dutyToday ?? 0,
        maxDate: dutyNewest?.[0]?.duty_date ?? null,
      }))


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
        const wLat = coarseCoord(resolvedCoords.latitude)
        const wLon = coarseCoord(resolvedCoords.longitude)
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max&timezone=auto&forecast_days=4`
        )
        const weatherJson = await weatherRes.json()
        if (weatherJson?.current) setWeatherData(weatherJson)
      } catch {}

      setLoading(false)
    }
    load()
  }, [retryCount])

  // City welcome — foreground trigger.
  //
  // Fires on cold start and on every background -> active transition. iOS also
  // emits 'active' when a transient overlay (notification centre, control
  // centre) is dismissed, so the previous state is tracked and only a real
  // background -> active counts — otherwise a pull-down would burn the city's
  // 30-day cooldown.
  useEffect(() => {
    let cancelled = false
    const prevState = { current: AppState.currentState }

    const check = async trigger => {
      const decision = await evaluateCityWelcome(trigger)
      if (cancelled) return
      // Kept even when the card is suppressed: the home-city question uses it to
      // say "Looks like you're in Kyrenia" as a HINT. It never pre-selects.
      setDetectedRegion(decision?.region ?? null)
      if (!decision?.show) return
      setCityWelcome(decision)
    }

    check('cold-start')

    const sub = AppState.addEventListener('change', next => {
      const wasBackgrounded = prevState.current.match(/inactive|background/)
      prevState.current = next
      if (wasBackgrounded && next === 'active') check('foreground')
    })

    return () => { cancelled = true; sub.remove() }
  }, [])

  // The customer hub: signed in (guest or not), on a customer role, with no
  // drawer, coach marks or facility sheet covering the screen. Gates both the
  // Ask Oli button and the city-welcome card — neither may appear over an auth
  // screen or a provider dashboard.
  const inCustomerHub =
    !!session && !!profile &&
    !['admin', 'provider', 'estate_agent', 'organizer', 'home_service_provider', 'insurance_provider'].includes(profile.role) &&
    !showMenu && !showCoachMarks &&
    !selectedFacility && !bookingFacility

  // The question outranks the card: if we do not yet know where they live, we
  // must not be welcoming them anywhere. (decideWelcome already guarantees this
  // — asked=false suppresses the card — but the two overlays share a slot, so
  // this makes the precedence explicit rather than incidental.)
  const homeCityAskVisible = showHomeCityAsk && inCustomerHub
  const cityWelcomeVisible = !!cityWelcome && inCustomerHub && !homeCityAskVisible

  // Burn the city's 30-day cooldown only once the card is actually on screen.
  // Marking it at decision time would spend the cooldown on a card the user
  // never saw — e.g. one decided while they were still on the auth screen.
  useEffect(() => {
    if (cityWelcomeVisible) markWelcomeShown(cityWelcome.region)
  }, [cityWelcomeVisible, cityWelcome?.region])

  const lang = profile?.preferred_language || pendingLang

  if (showPasswordReset) {
    return (
      <SafeAreaProvider>
        <ResetPasswordScreen onDone={() => setShowPasswordReset(false)} lang={profile?.preferred_language || pendingLang} />
      </SafeAreaProvider>
    )
  }

  let content
  // True only when the tab shell (the final else of the chain below) renders.
  // Every pushed module screen short-circuits earlier in that same chain, so this
  // IS "no pushed screen open" — derived from the chain itself rather than by
  // restating its ~25 flags, which would drift the moment a module is added.
  let inTabShell = false

  // Admins bypass the marketplace module gate to preview a "Coming soon" module.
  // (Mirrors the existing garagesTileVisible admin check.) Admins normally render
  // AdminScreen and don't reach the module chain, so in practice previewing a
  // gated module is done by flipping its MODULE_FLAGS entry, but the bypass is
  // kept for parity and any path that does reach these screens as admin.
  const isAdmin = profile?.role === 'admin'

  if (session === undefined || !fontsLoaded || onboarded === null) {
    content = <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  } else if (onboarded === false) {
    content = <OnboardingScreen onComplete={completeOnboarding} />
  } else if (!session && showWelcome) {
    content = (
      <WelcomeScreen
        lang={lang}
        onLangChange={l => { setPendingLang(l); AsyncStorage.setItem('@trnc_lang', l) }}
        onLogin={() => { setAuthMode('login'); setShowWelcome(false) }}
        onSignUp={() => { setAuthMode('signup'); setShowWelcome(false) }}
      />
    )
  } else if (!session) {
    content = <AuthScreen lang={lang} initialMode={authMode} onBack={() => setShowWelcome(true)} onLangChange={l => { setPendingLang(l); AsyncStorage.setItem('@trnc_lang', l) }} />
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
  } else if (profile.role === 'admin' && !adminPreview) {
    content = <AdminScreen session={session} lang={lang} onShowExplore={() => setAdminPreview('explore')} />
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
      content = <ProviderOnboardingScreen session={session} lang={lang} onDone={loadProviderFacility} />
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
  } else if (profile.role === 'home_service_provider') {
    content = <HomeServiceDashboardScreen session={session} lang={lang} />
  } else if (profile.role === 'insurance_provider') {
    content = <InsuranceDashboardScreen session={session} lang={lang} />
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
    content = <DutyListScreen onBack={() => { setShowDutyList(false); setDutyRegion(null) }} lang={lang} userLocation={userLocation} locationDenied={locationDenied} initialRegion={dutyRegion} />
  } else if (showEvents) {
    content = (MODULE_FLAGS.events || isAdmin)
      ? <EventsScreen lang={lang} onBack={() => { setShowEvents(false); setEventsDistrict(null) }} initialDistrict={eventsDistrict} />
      : <ComingSoonScreen lang={lang} moduleKey="events" titleKey="menuEvents" session={session} onBack={() => { setShowEvents(false); setEventsDistrict(null) }} />
  // PARKED, NOT DEAD. `showAgentOnboarding` is never set to true any more: the only
  // caller was the "become an agent" CTA on AccommodationScreen, removed in Slice 3c
  // because the self-serve marketplace is parked in favour of the partner feed.
  //
  // This branch is kept intact ON PURPOSE so reviving the flow is ONE line — restore
  // the prop on <AccommodationScreen> above:
  //     onBecomeAgent={() => { if (requireAccount('gateEstateAgent')) return
  //                            setShowAccommodation(false); setShowAgentOnboarding(true) }}
  // and re-add the footer CTA in AccommodationScreen. Do not "clean up" the state, the
  // import, the back-handler line or this branch — deleting them turns a one-line
  // revival into a ten-line archaeology exercise.
  } else if (showAgentOnboarding) {
    content = (
      <EstateAgentOnboardingScreen
        session={session}
        lang={lang}
        onClose={() => setShowAgentOnboarding(false)}
        onSubmitted={() => setShowAgentOnboarding(false)}
      />
    )
  } else if (showAccommodation) {
    content = (MODULE_FLAGS.accommodation || isAdmin) ? (
      <AccommodationScreen
        lang={lang}
        onClose={() => setShowAccommodation(false)}
        onOpenProperty={prop => setOpenedProperty(prop)}
        selectedProperty={openedProperty}
        onCloseProperty={() => setOpenedProperty(null)}
      />
    ) : (
      <ComingSoonScreen lang={lang} moduleKey="accommodation" titleKey="menuAccommodations" session={session} onBack={() => setShowAccommodation(false)} />
    )
  } else if (showHomeServices) {
    content = (MODULE_FLAGS.homeServices || isAdmin)
      ? <HomeServicesScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowHomeServices(false)} />
      : <ComingSoonScreen lang={lang} moduleKey="homeServices" titleKey="menuHomeServices" session={session} onBack={() => setShowHomeServices(false)} />
  } else if (showJobPostings) {
    content = (MODULE_FLAGS.jobs || isAdmin)
      ? <JobPostingsScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowJobPostings(false)} />
      : <ComingSoonScreen lang={lang} moduleKey="jobs" titleKey="menuJobPostings" session={session} onBack={() => setShowJobPostings(false)} />
  } else if (showTransport) {
    content = (MODULE_FLAGS.transport || isAdmin)
      ? <TransportScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowTransport(false)} />
      : <ComingSoonScreen lang={lang} moduleKey="transport" titleKey="menuTransportation" session={session} onBack={() => setShowTransport(false)} />
  } else if (showInsurance) {
    content = (MODULE_FLAGS.insurance || isAdmin)
      ? <InsuranceScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowInsurance(false)} />
      : <ComingSoonScreen lang={lang} moduleKey="insurance" titleKey="menuInsurance" session={session} onBack={() => setShowInsurance(false)} />
  } else if (showEsim) {
    content = <EsimScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowEsim(false)} />
  } else if (showLegal) {
    content = <LegalScreen lang={lang} onBack={() => setShowLegal(false)} />
  } else if (selectedExplorePlace) {
    content = <ExploreProfileScreen place={selectedExplorePlace} lang={lang} session={session} onBack={() => setSelectedExplorePlace(null)} onRequireAccount={requireAccount} isFavorite={placeFavorites.has(selectedExplorePlace.id)} onToggleFavorite={() => togglePlaceFavorite(selectedExplorePlace.id)} />
  } else if (showExploreBeach) {
    content = (
      <BLErrorBoundary>
        <ExploreScreen lang={lang} onBack={() => { setShowExploreBeach(false); setExploreBeachRegion(null) }} userLocation={userLocation} onSelectPlace={setSelectedExplorePlace} session={session} onRequireAccount={requireAccount} placeFavorites={placeFavorites} onTogglePlaceFavorite={togglePlaceFavorite} initialCategory="beach" initialRegion={exploreBeachRegion} />
      </BLErrorBoundary>
    )
  } else if (showExplore) {
    // Public Explore tile — gated on MODULE_FLAGS.explore (|| isAdmin, house pattern; admins
    // never reach HomeScreen so it's moot for the tile path). Dark today → Coming Soon, whose
    // Notify-me upserts module='explore' into module_waitlist (shape-guard accepts it now).
    content = (MODULE_FLAGS.explore || isAdmin) ? (
      <BLErrorBoundary>
        <ExploreScreen lang={lang} onBack={() => setShowExplore(false)} userLocation={userLocation} onSelectPlace={setSelectedExplorePlace} session={session} onRequireAccount={requireAccount} placeFavorites={placeFavorites} onTogglePlaceFavorite={togglePlaceFavorite} isAdmin={isAdmin} />
      </BLErrorBoundary>
    ) : (
      <ComingSoonScreen lang={lang} moduleKey="explore" titleKey="menuExplore" session={session} onBack={() => setShowExplore(false)} />
    )
  } else if (adminPreview === 'explore') {
    content = (
      <BLErrorBoundary>
        <ExploreScreen lang={lang} onBack={() => setAdminPreview(null)} userLocation={userLocation} onSelectPlace={setSelectedExplorePlace} session={session} onRequireAccount={requireAccount} placeFavorites={placeFavorites} onTogglePlaceFavorite={togglePlaceFavorite} isAdmin={isAdmin} />
      </BLErrorBoundary>
    )
  } else if (showNewcomerEssentials) {
    content = (
      <NewcomerEssentialsScreen
        lang={lang}
        onBack={() => setShowNewcomerEssentials(false)}
        onShowExchangeRates={() => { setShowNewcomerEssentials(false); setShowExchangeRates(true) }}
      />
    )
  } else if (showExchangeRates) {
    content = <ExchangeRatesScreen lang={lang} onBack={() => setShowExchangeRates(false)} />
  } else if (showGames) {
    if (gamesSubScreen === 'xox') {
      content = <XoxGameScreen lang={lang} onBack={() => setGamesSubScreen(null)} />
    } else if (gamesSubScreen === 'memory') {
      content = <MemoryMatchScreen lang={lang} onBack={() => setGamesSubScreen(null)} />
    } else if (gamesSubScreen === '2048') {
      content = <Game2048Screen lang={lang} onBack={() => setGamesSubScreen(null)} />
    } else if (gamesSubScreen === 'sudoku') {
      content = <SudokuScreen lang={lang} onBack={() => setGamesSubScreen(null)} />
    } else {
      content = <GamesHubScreen lang={lang} onBack={() => setShowGames(false)} onNavigate={setGamesSubScreen} />
    }
  } else if (showPets) {
    if (!MODULE_FLAGS.pets && !isAdmin) {
      content = <ComingSoonScreen lang={lang} moduleKey="pets" titleKey="menuPets" session={session} onBack={() => setShowPets(false)} />
    } else if (petsSubScreen === 'bringing') {
      content = <BringingPetScreen lang={lang} onBack={() => setPetsSubScreen(null)} />
    } else if (petsSubScreen === 'timeline') {
      content = <TimelineCalculatorScreen lang={lang} onBack={() => setPetsSubScreen(null)} />
    } else if (petsSubScreen === 'vetdirectory') {
      content = (
        <VetDirectoryScreen
          lang={lang}
          onBack={() => setPetsSubScreen(null)}
          onOpenVet={fac => setSelectedFacility(fac)}
        />
      )
    } else if (petsSubScreen === 'travel') {
      content = <TravelWithPetScreen lang={lang} onBack={() => setPetsSubScreen(null)} />
    } else if (petsSubScreen === 'owning') {
      content = (
        <OwningPetScreen
          lang={lang}
          onBack={() => setPetsSubScreen(null)}
          onNavigate={dest => setPetsSubScreen(dest)}
        />
      )
    } else {
      content = (
        <PetsHomeScreen
          lang={lang}
          onBack={() => setShowPets(false)}
          onNavigate={dest => setPetsSubScreen(dest)}
        />
      )
    }
  } else if (unclaimedFacility) {
    content = (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <BackButton lang={lang} onPress={() => setUnclaimedFacility(null)} />
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
              `mailto:getadaapp@gmail.com?subject=${encodeURIComponent(`ADA – Correction: ${unclaimedFacility.name}`)}&body=${encodeURIComponent(`Hi,\n\nI'd like to suggest a correction for: ${unclaimedFacility.name}\n\n`)}`
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
      session={session}
      isFavorite={favorites.has(selectedFacility.id)}
      onToggleFavorite={() => toggleFavorite(selectedFacility.id)}
      onBook={() => { if (requireAccount('gateBooking')) return; setBookingFacility(selectedFacility) }}
      onRequireAccount={requireAccount}
      onBack={() => setSelectedFacility(null)}
    />
  } else if (showGrooming) {
    content = (MODULE_FLAGS.grooming || isAdmin)
      ? <GroomingScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowGrooming(false)} onOpenFacility={setSelectedFacility} />
      : <ComingSoonScreen lang={lang} moduleKey="grooming" titleKey="menuGrooming" session={session} onBack={() => setShowGrooming(false)} />
  } else if (showGarages) {
    content = (MODULE_FLAGS.garages || isAdmin || ownsGarage)
      ? <GaragesScreen lang={lang} session={session} onRequireAccount={requireAccount} onBack={() => setShowGarages(false)} onOpenFacility={setSelectedFacility} onShowTowing={() => { setShowGarages(false); setShowTowing(true) }} isAdmin={profile?.role === 'admin'} />
      : <ComingSoonScreen lang={lang} moduleKey="garages" titleKey="menuGarages" session={session} onBack={() => setShowGarages(false)} />
  } else if (showTowing) {
    content = (MODULE_FLAGS.towing || isAdmin)
      ? <TowingScreen lang={lang} userLocation={userLocation} onBack={() => setShowTowing(false)} />
      : <ComingSoonScreen lang={lang} moduleKey="towing" titleKey="menuTowing" session={session} onBack={() => setShowTowing(false)} />
  } else if (showStudentHub) {
    // No StudentHubScreen in main yet (it lives on the unmerged feat/student-hub
    // branch). Route ALL users — admins included — to Coming Soon; the flag exists
    // so a future merge can restore the standard gate:
    //   (MODULE_FLAGS.studentHub || isAdmin) ? <StudentHubScreen/> : <ComingSoonScreen/>
    content = <ComingSoonScreen lang={lang} moduleKey="studentHub" titleKey="menuStudentHub" session={session} onBack={() => setShowStudentHub(false)} />
  } else {
    inTabShell = true
    const favList = facilities.filter(f => favorites.has(f.id))
    // Utility-only drawer. Home's module grid is the app's navigation now, so the
    // drawer holds settings & app options. `dividerBefore` opens a visual group.
    const drawerItems = [
      { key: 'language',     iconSet: 'ionicons', icon: 'globe-outline',             labelKey: 'menuLanguage',     dividerBefore: true, onPress: () => { closeMenu(); setShowLangModal(true) } },
      { key: 'cityWelcome',  iconSet: 'ionicons', icon: 'location-outline',          labelKey: 'cwMenuCityWelcome', onPress: () => { closeMenu(); setShowCitySettings(true) } },
      { key: 'legal',        iconSet: 'ionicons', icon: 'document-text-outline',     labelKey: 'menuLegal',        onPress: () => { closeMenu(); setShowLegal(true) } },
      { key: 'contact',      iconSet: 'ionicons', icon: 'mail-outline',              labelKey: 'menuContact',      onPress: () => { closeMenu(); Linking.openURL(`mailto:getadaapp@gmail.com?subject=${encodeURIComponent('ADA Feedback')}`) } },
      { key: 'welcomeVideo', iconSet: 'ionicons', icon: 'play-circle-outline',       labelKey: 'menuWelcomeVideo', visible: WELCOME_VIDEO_LIVE, onPress: () => {} },
      { key: 'rate',         iconSet: 'ionicons', icon: 'star-outline',              labelKey: 'menuRateApp',      dividerBefore: true, onPress: rateApp },
      { key: 'share',        iconSet: 'feather',  icon: 'share-2',                   labelKey: 'menuShareApp',     onPress: shareApp },
      { key: 'about',        iconSet: 'ionicons', icon: 'information-circle-outline', labelKey: 'menuAbout',        onPress: showAbout },
      { key: 'tutorial',     iconSet: 'ionicons', icon: 'compass-outline',           labelKey: 'menuTutorial',     dividerBefore: true, onPress: () => { closeMenu(); startCoachMarks() } },
      { key: 'signOut',      iconSet: 'feather',  icon: 'log-out',                   labelKey: 'signOut',          danger: true, onPress: () => supabase.auth.signOut() },
    ].filter(i => i.visible !== false)
    content = (
      <View style={{ flex: 1 }}>

        {activeTab === 'home' && (
          <HomeScreen
            lang={lang}
            facilities={facilities}
            dutyFacilityId={dutyFacilityId}
            dutyRosterStatus={dutyRosterStatus}
            userLocation={userLocation}
            facilityRatings={facilityRatings}
            favorites={favorites}
            notifications={notifications}
            facilityLoadError={facilityLoadError}
            locationDenied={locationDenied}
            weatherData={weatherData}
            hamburgerRef={hamburgerRef}
            searchRef={searchRef}

            dutyBannerRef={dutyBannerRef}
            onOpenMenu={openMenu}
            onShowNotifs={() => { if (requireAccount('gateNotifications')) return; setShowNotifs(true) }}
            onShowDutyList={() => setShowDutyList(true)}
            onSelectFacility={setSelectedFacility}
            onUnclaimedFacility={setUnclaimedFacility}
            onToggleFavorite={toggleFavorite}
            onRetry={() => { setLoading(true); setRetryCount(c => c + 1) }}
            onShowEvents={() => setShowEvents(true)}
            onShowAccommodation={() => setShowAccommodation(true)}
            onShowPets={() => setShowPets(true)}
            onShowHomeServices={() => setShowHomeServices(true)}
            onShowJobPostings={() => setShowJobPostings(true)}
            onShowExploreBeach={() => setShowExploreBeach(true)}
            onShowExplore={() => setShowExplore(true)}
            onShowTransport={() => setShowTransport(true)}
            onShowInsurance={() => setShowInsurance(true)}
            onShowGrooming={() => setShowGrooming(true)}
            onShowGarages={() => setShowGarages(true)}
            onShowTowing={() => setShowTowing(true)}
            garagesTileVisible={GARAGES_LIVE || profile?.role === 'admin' || ownsGarage}
            onShowStudentHub={() => setShowStudentHub(true)}
            onShowEsim={() => setShowEsim(true)}
            onShowEmergency={() => setShowEmergencyModal(true)}
            onShowMunicipal={() => setShowMunicipalModal(true)}
            onSelectExplorePlace={setSelectedExplorePlace}
            onShowNewcomerEssentials={() => setShowNewcomerEssentials(true)}
            onShowExchangeRates={() => setShowExchangeRates(true)}
            onShowGames={() => setShowGames(true)}
          />
        )}


        {activeTab === 'map' && (
          <SafeAreaView style={styles.safe} edges={['top']}>
            {/* MapScreen is NOT dead code and must not be deleted — it is the committed
                behaviour of this tab and the thing users have today. EXPLORE_MAP_LIVE
                chooses between the two; both branches ship in every bundle. */}
            {EXPLORE_MAP_LIVE ? (
              <ExploreMapScreen
                facilities={facilities}
                dutyFacilityId={dutyFacilityId}
                userLocation={userLocation}
                // Structurally FALSE here: the content selector is role-first, so an admin
                // short-circuits to AdminScreen and never reaches the tab shell. Passed
                // anyway so the component needs no change if an AdminScreen preview entry
                // is ever added, and so its Explore gate reads one variable, not two.
                isAdmin={isAdmin}
                onSelectFacility={setSelectedFacility}
                onSelectUnclaimed={setUnclaimedFacility}
                onSelectPlace={setSelectedExplorePlace}
                lang={lang}
              />
            ) : (
              <MapScreen
                facilities={facilities}
                dutyFacilityId={dutyFacilityId}
                userLocation={userLocation}
                onSelectFacility={setSelectedFacility}
                onSelectUnclaimed={setUnclaimedFacility}
                lang={lang}
              />
            )}
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

        <BottomTabBar
          activeTab={activeTab}
          onTabPress={tab => { if (tab === 'profile' && requireAccount('gateProfile')) return; setActiveTab(tab) }}
          mapTabRef={mapTabRef}
          lang={lang}
        />

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
                  <Text style={styles.menuAvatarText}>
                    {session.user.email?.[0]?.toUpperCase() ?? t('guestLabel', lang)[0].toUpperCase()}
                  </Text>
                </View>
              )
            })()}
            <Text style={styles.menuEmail} numberOfLines={1}>{session.user.email ?? t('guestLabel', lang)}</Text>
            <TouchableOpacity onPress={closeMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ flexShrink: 0 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {drawerItems.map(item => (
              <Fragment key={item.key}>
                {item.dividerBefore && <View style={styles.menuDivider} />}
                <DrawerRow item={item} lang={lang} />
              </Fragment>
            ))}
          </ScrollView>
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
                // Compare against the RESOLVED language (profile?.preferred_language ||
                // pendingLang), not the raw column — so a NULL-column user who picked
                // Turkish at onboarding sees Turkish highlighted, not English.
                const active = lang === key
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

        <TutorialCoachMarks
          steps={coachSteps}
          visible={showCoachMarks}
          onFinish={handleCoachFinish}
          lang={lang}
        />

      </View>
    )
  }

  // Ask Oli routing: map an intent target → the app's navigation state setters.
  // Close any open module sub-screen first so only the target renders.
  const oliNavigate = (target) => {
    setShowDutyList(false); setShowEvents(false); setShowAccommodation(false)
    setShowPets(false); setPetsSubScreen(null); setShowHomeServices(false)
    setShowJobPostings(false); setShowExploreBeach(false); setShowExplore(false); setShowTransport(false)
    setShowInsurance(false); setShowEsim(false); setShowTowing(false)
    setShowNewcomerEssentials(false); setShowExchangeRates(false)
    setSelectedExplorePlace(null); setShowNotifs(false)
    switch (target) {
      case 'pharmacy':      setActiveTab('home'); setShowDutyList(true); break
      case 'clinic':        setActiveTab('home'); break
      case 'events':        setShowEvents(true); break
      case 'homeServices':  setShowHomeServices(true); break
      case 'jobs':          setShowJobPostings(true); break
      case 'accommodation': setShowAccommodation(true); break
      case 'pets':          setShowPets(true); break
      case 'transport':     setShowTransport(true); break
      case 'beaches':       setShowExploreBeach(true); break
      case 'exchange':      setShowExchangeRates(true); break
      case 'newcomer':      setShowNewcomerEssentials(true); break
      case 'municipal':     setShowMunicipalModal(true); break
      case 'emergency':     setShowEmergencyModal(true); break
      case 'towing':        setShowTowing(true); break
    }
  }

  // City-welcome routing: same reset-then-open shape as oliNavigate, but it also
  // carries the region so the target screen opens filtered to that city.
  const cityNavigate = (target) => {
    const region = cityWelcome?.region
    setCityWelcome(null)
    setShowDutyList(false); setShowEvents(false); setShowAccommodation(false)
    setShowPets(false); setPetsSubScreen(null); setShowHomeServices(false)
    setShowJobPostings(false); setShowExploreBeach(false); setShowExplore(false); setShowTransport(false)
    setShowInsurance(false); setShowEsim(false); setShowTowing(false)
    setShowNewcomerEssentials(false); setShowExchangeRates(false)
    setSelectedExplorePlace(null); setShowNotifs(false)
    switch (target) {
      case 'beaches': setExploreBeachRegion(region); setShowExploreBeach(true); break
      case 'events':  setEventsDistrict(region);  setShowEvents(true); break
      case 'duty':    setActiveTab('home'); setDutyRegion(region); setShowDutyList(true); break
    }
  }

  // Oli is hidden under either sheet (same reason it hides for the drawer and
  // coach marks — they are root overlays and would cover the floating button).
  //
  // HOME ONLY: `inTabShell` rules out every pushed module screen, `activeTab` rules
  // out the Map / Saved / Profile tabs. Testers read a chatbot that follows you into
  // every screen as clutter, and on Map it sat over the pan surface.
  // Drag, edge-snap and @trnc_oli_pos persistence are untouched: bounds in
  // OliGuide.js come from useWindowDimensions + safe-area insets, never from a
  // screen's own layout, so a position saved elsewhere still clamps correctly here.
  const oliVisible =
    inTabShell && activeTab === 'home' &&
    inCustomerHub && !cityWelcomeVisible && !homeCityAskVisible

  // Explicit answer -> asked=true, and city welcome goes live. 'visiting' is a
  // real answer, not an absence of one: it means every city is welcome-eligible.
  const resolveHomeCity = (value) => {
    setHomeCity(value)
    setShowHomeCityAsk(false)
  }

  // Soft dismiss. Deliberately resolves to NOTHING: `asked` stays false, so we
  // re-ask on a later cold start (bounded to daily by shouldAskHomeCity). It must
  // never silently fall through to "visitor".
  const dismissHomeCityAsk = () => setShowHomeCityAsk(false)

  return (
    <SafeAreaProvider>
      <View style={styles.rootFill} importantForAccessibility={oliSheetOpen ? 'no-hide-descendants' : 'auto'}>
        {content}
      </View>
      {oliVisible && (
        <OliGuide lang={lang} onNavigate={oliNavigate} onOpenChange={setOliSheetOpen} closeRef={oliCloseRef} />
      )}

      {showEmergencyModal && (
        <SheetOverlay onDismiss={() => setShowEmergencyModal(false)}>
          <View style={styles.emergencySheet}>
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
              { label: t('menuCWRI', lang), number: '+905488111190', icon: 'paw-outline', subtitle: t('menuCWRISubtitle', lang) },
            ].map(({ label, number, icon, subtitle }) => (
              <TouchableOpacity key={number} style={styles.emergencyRow} onPress={() => { setShowEmergencyModal(false); Linking.openURL(`tel:${number}`) }}>
                <View style={styles.emergencyIconWrap}>
                  <Ionicons name={icon} size={20} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emergencyEntryLabel}>{label}</Text>
                  {subtitle ? <Text style={styles.emergencySubLabel}>{subtitle}</Text> : null}
                </View>
                <Text style={styles.emergencyNumber}>{number}</Text>
                <Ionicons name="call" size={18} color={colors.danger} />
              </TouchableOpacity>
            ))}

            {/* Towing sits AFTER the state emergency numbers, never among them: 155 /
                112 / 199 / 158 are life-safety lines and nothing commercial may appear
                above them. Flag-gated like the other two entry points. */}
            {MODULE_FLAGS.towing && (
              <TouchableOpacity
                style={[styles.emergencyRow, { marginTop: 8 }]}
                onPress={() => { setShowEmergencyModal(false); setShowTowing(true) }}
              >
                <View style={styles.emergencyIconWrap}>
                  <Ionicons name="car-outline" size={20} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emergencyEntryLabel}>{t('menuTowing', lang)}</Text>
                  <Text style={styles.emergencySubLabel}>{t('towingFromEmergencySub', lang)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </SheetOverlay>
      )}

      {showMunicipalModal && (
        <SheetOverlay onDismiss={() => setShowMunicipalModal(false)}>
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
        </SheetOverlay>
      )}

      {cityWelcomeVisible && (
        <CityWelcomeCard
          region={cityWelcome.region}
          variant={cityWelcome.variant}
          lang={lang}
          onNavigate={cityNavigate}
          onDismiss={() => setCityWelcome(null)}
          onTurnOff={() => { setCityWelcomeEnabled(false); setCityWelcome(null) }}
        />
      )}
      {homeCityAskVisible && (
        <HomeCitySheet
          detectedRegion={detectedRegion}
          lang={lang}
          onResolve={resolveHomeCity}
          onDismiss={dismissHomeCityAsk}
        />
      )}
      <CityWelcomeSettings
        visible={showCitySettings}
        lang={lang}
        onClose={() => setShowCitySettings(false)}
      />
      <AccountRequiredSheet
        visible={!!gateKey}
        messageKey={gateKey}
        lang={lang}
        onSignUp={gateSignUp}
        onClose={() => setGateKey(null)}
      />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: colors.bg },
  rootFill:         { flex: 1 },
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
  hiddenFacHint:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, marginHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)', flexShrink: 1, maxWidth: 180 },
  hiddenFacHintText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flexShrink: 1 },
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
  soonBadge:        { backgroundColor: colors.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  soonBadgeText:    { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  langRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  langRowLabel:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  langRowLabelActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  emergencyBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  // Root overlay for the Emergency / Municipalities sheets. zIndex 100 puts them
  // over the screen; the Ask Oli FAB sits at 200 so it stays tappable on top of
  // them, and TutorialCoachMarks stays above everything at 9999. elevation is
  // raised in step with zIndex because on Android it can override draw order.
  sheetOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24, zIndex: 100, elevation: 12 },
  emergencySheet:     { width: '100%', backgroundColor: colors.bg, borderRadius: 18, padding: 20, ...shadow },
  emergencyHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  emergencyTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  emergencySubtitle:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 16 },
  emergencyRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  emergencyIconWrap:  { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(220,38,38,0.1)', justifyContent: 'center', alignItems: 'center' },
  emergencyLabel:     { flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  emergencyEntryLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  emergencySubLabel:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 15 },
  emergencyNumber:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginRight: 4 },
  muniHoursBubble:    { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: colors.primaryLight, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, marginLeft: 46 },
  muniHoursText:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, lineHeight: 19 },
})
