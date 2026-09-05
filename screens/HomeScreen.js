import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, Image, ImageBackground, FlatList, StyleSheet,
  TouchableOpacity, TextInput, ScrollView, Linking, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
// Constants, not string literals: a typo'd literal silently never matches and the
// banner would quietly stay green on a broken roster.
import { DUTY_FRESH, DUTY_PARTIAL } from '../utils/dutyStatus'
import { MODULE_FLAGS, HOME_V2_LIVE } from '../constants/flags'
import HomeTopBar from '../components/home/HomeTopBar'
import HomeHero from '../components/home/HomeHero'
import WeatherSheet from '../components/home/WeatherSheet'
import OliRow from '../components/home/OliRow'
import DutyRow from '../components/home/DutyRow'
import ModuleGrid from '../components/home/ModuleGrid'
import LiveStrip from '../components/home/LiveStrip'
import FavouritesRow from '../components/home/FavouritesRow'
import FavouritesEditSheet from '../components/home/FavouritesEditSheet'
import HomeFooterSlot from '../components/home/HomeFooterSlot'
import { HOME_MODULES } from '../constants/homeModules'
import { resolveStripItem } from '../utils/homeStripResolver'
import { resolveFavourites } from '../constants/homeFavourites'
import { loadUsage, loadPins, savePins, recordModuleOpen } from '../utils/moduleUsage'
import { SPECIALTIES_BY_TYPE } from '../constants/specialties'
import {
  haversineKm, parseIsOpen, uvLevel, weatherIcon, weatherDesc, isAvailableToday, coarseCoord,
} from '../utils/facilityUtils'
import BackButton from '../components/BackButton'

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

const LANG_LOCALE = {
  English: 'en', Turkish: 'tr', Arabic: 'ar', Russian: 'ru',
  Greek: 'el', French: 'fr', Spanish: 'es', German: 'de', Persian: 'fa',
}

const CODE_TO_NAME = {
  en: 'english', tr: 'turkish', ar: 'arabic', ru: 'russian',
  el: 'greek', fr: 'french', es: 'spanish', de: 'german', fa: 'persian',
}

// Icon tint by module category: urgent (health / emergency), service (everyday
// admin), lifestyle (leisure). Pairs live in theme.js.
const TINTS = {
  urgent:    { bg: colors.tintUrgentBg,    fg: colors.tintUrgentFg    },
  service:   { bg: colors.tintServiceBg,   fg: colors.tintServiceFg   },
  lifestyle: { bg: colors.tintLifestyleBg, fg: colors.tintLifestyleFg },
}

// The home facility list + map show only health facilities. Other facility types
// (vet has its own directory; grooming has its own module) are gated out so they
// never leak into the health "All" view.
const HEALTH_TYPES = ['pharmacy', 'clinic', 'hospital', 'dentist']

// Explore place columns for a lookup-by-id. Module scope, not component scope: it is a
// constant and does not want re-allocating on every render.
//
// Mirrors ExploreScreen's BROWSE_COLS rather than importing it — reaching for a string
// is not worth pulling that screen's module graph into Home, and this list was already
// inline in this file before HOME_V2 gave it a second caller.
//
// photo_attribution is INCLUDED and must stay: ExploreProfileScreen renders the credit
// line and source link from it, and both callers here are production routes to that
// screen.
const PLACE_COLS = 'id, category, name, name_i18n, description_i18n, region, latitude, longitude, cover_image_url, photos, photo_credits, photo_attribution, blue_flag, access_type, amenities, provider_id, featured_until'

const MODULES = [
  { id: 'exchangeRates',      icon: 'trending-up-outline', tint: 'service',   labelKey: 'menuExchangeRates'      },
  { id: 'newcomerEssentials', icon: 'compass-outline',     tint: 'service',   labelKey: 'menuNewcomerEssentials' },
  { id: 'studentHub',         icon: 'school-outline',      tint: 'service',   labelKey: 'menuStudentHub' },
  { id: 'accommodation', icon: 'home-outline',      tint: 'lifestyle', labelKey: 'menuAccommodations' },
  { id: 'pets',          icon: 'paw-outline',       tint: 'lifestyle', labelKey: 'menuPets' },
  { id: 'games',         icon: 'game-controller-outline', tint: 'lifestyle', labelKey: 'menuGames' },
  { id: 'homeServices',  icon: 'hammer-outline',    tint: 'service',   labelKey: 'menuHomeServices' },
  { id: 'jobPostings',  icon: 'briefcase-outline', tint: 'service',   labelKey: 'menuJobPostings' },
  { id: 'beaches',       icon: 'umbrella-outline',  tint: 'lifestyle', labelKey: 'menuBeaches' },
  // menuPlaces, NOT menuExplore: the bottom-nav tab owns 'Keşfet' once EXPLORE_MAP_LIVE
  // is true. This tile opens the browsable DIRECTORY (group tiles → list), the one
  // thing the map tab does not offer.
  // ⚠ Icon must not be compass-outline either — that is the tab's icon when live.
  //   albums-outline reads as a collection, which is what this is.
  { id: 'explore',       icon: 'albums-outline',    tint: 'lifestyle', labelKey: 'menuPlaces' },
  { id: 'transport',     icon: 'car-outline',       tint: 'service',   labelKey: 'menuTransportation' },
  { id: 'insurance',     icon: 'shield-checkmark-outline', tint: 'service', labelKey: 'menuInsurance' },
  { id: 'grooming',      icon: 'cut-outline',       tint: 'lifestyle', labelKey: 'menuGrooming' },
  { id: 'garages',       icon: 'car-sport-outline', tint: 'service',   labelKey: 'menuGarages' },
  { id: 'towing',        icon: 'car-outline',       tint: 'urgent',    labelKey: 'menuTowing' },
  { id: 'esim',          icon: 'cellular-outline',  tint: 'service',   labelKey: 'menuEsim' },
  { id: 'municipal',     icon: 'business-outline',  tint: 'service',   labelKey: 'menuMunicipalities' },
]

const RESULT_META = {
  medical:      { icon: 'medkit-outline',    tint: 'urgent'    },
  events:       { icon: 'calendar-outline',  tint: 'lifestyle' },
  beach:        { icon: 'umbrella-outline',  tint: 'lifestyle' },
  landmark:     { icon: 'flag-outline',      tint: 'lifestyle' },
  homeServices: { icon: 'hammer-outline',    tint: 'service'   },
  transport:    { icon: 'car-outline',       tint: 'service'   },
  jobPostings:  { icon: 'briefcase-outline', tint: 'service'   },
  towing:       { icon: 'car-outline',       tint: 'urgent'    },
}

export default function HomeScreen({
  // ─── Profile-gate props (Slice 2). All three DEFAULT to today's behaviour, so the
  //     normal render path is byte-identical and this screen has one code path, not two.
  //
  //     Why reuse this screen at all: the facility directory is already a MODE of it
  //     (showFacilityList), separate from the tile hub. A gated user must reach the
  //     directory WITHOUT the hub, because the hub carries a tile for every marketplace
  //     module — granting "the health module" would grant the whole app. The alternative
  //     was a second directory screen duplicating this one's search, distance sort,
  //     ratings and duty badge, which would drift.
  forceFacilityList = false,   // start in, and stay in, facility-list mode
  hideHeaderActions = false,   // no menu / notifications while gated
  onExitFacilityList,          // back leaves the screen instead of revealing the hub
  lang,
  facilities,
  dutyFacilityId,
  dutyRosterStatus = 'fresh',
  userLocation,
  facilityRatings,
  favorites,
  notifications,
  facilityLoadError,
  locationDenied,
  weatherData,
  hamburgerRef,
  searchRef,
  dutyBannerRef,
  onOpenMenu,
  onShowNotifs,
  onShowDutyList,
  onSelectFacility,
  onUnclaimedFacility,
  onToggleFavorite,
  onRetry,
  onShowEvents,
  onShowAccommodation,
  onShowPets,
  onShowHomeServices,
  onShowJobPostings,
  onShowExploreBeach,
  onShowExplore,
  onShowTransport,
  onShowInsurance,
  onShowGrooming,
  onShowGarages,
  garagesTileVisible,
  onShowTowing,
  onShowEsim,
  onShowEmergency,
  onShowMunicipal,
  onSelectExplorePlace,
  onShowNewcomerEssentials,
  onShowExchangeRates,
  onShowGames,
  onShowStudentHub,
  // ─── HOME_V2 props ────────────────────────────────────────────────────────
  // Both optional, and both unused while HOME_V2_LIVE is false — the V1 render path
  // never reads them, so old Home behaves identically whether App.js passes them or not.
  region,      // resolved home district slug (profile.region → City Welcome → GPS), or null
  onOpenOli,   // opens the Ask Oli sheet — OliGuide's own openSheet, reached through a ref
  // ─── Bugün ADA'da (Slice 2) ───────────────────────────────────────────────
  // Whether this user may be shown paid placement. COMPUTED IN App.js, from
  // promosAllowed() in constants/homeStrip.js — that function is the single statement of
  // the rule (guest / null DOB / under 18), and passing the ANSWER rather than the
  // profile keeps this screen from acquiring a second opinion about it. Defaults to
  // false, so every caller that has not thought about it gets the safe branch.
  promosEligible = false,
}) {
  const [showFacilityList, setShowFacilityList] = useState(forceFacilityList)
  const [searchText, setSearchText]             = useState('')
  const [activeType, setActiveType]             = useState(null)
  const [activeSpecialty, setActiveSpecialty]   = useState(null)
  const [openOnly, setOpenOnly]                 = useState(false)
  const [langFilter, setLangFilter]             = useState(false)
  const [showFilters, setShowFilters]           = useState(false)
  const [weatherExpanded, setWeatherExpanded]   = useState(false)

  // HOME_V2 only. Declared unconditionally — hooks cannot sit behind a flag — and inert
  // while HOME_V2_LIVE is false: nothing in the V1 path reads either one.
  const [searchOpen, setSearchOpen]             = useState(false)
  const [weatherOpen, setWeatherOpen]           = useState(false)

  // The live strip. `stripLoading` starts TRUE so the first paint is the fixed-height
  // skeleton rather than a collapsed row that grows when the resolver returns.
  const [stripItem, setStripItem]       = useState(null)
  const [stripLoading, setStripLoading] = useState(true)

  // ─── Sık kullandıkların ───────────────────────────────────────────────────
  // `favIds` is the RESOLVED row and is written in exactly two places: once when this
  // screen mounts, and again when the user presses Bitti in the edit sheet. Nothing else
  // may set it — see the resolve effect below for why.
  const [favIds, setFavIds]           = useState([])
  const [favPins, setFavPins]         = useState([])
  const [favUsage, setFavUsage]       = useState({})
  const [favEditOpen, setFavEditOpen] = useState(false)

  // Global hub search
  const [globalQuery, setGlobalQuery]       = useState('')
  const [globalResults, setGlobalResults]   = useState([])
  const [isSearching, setIsSearching]       = useState(false)

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) { setGlobalResults([]); setIsSearching(false); return }
    setIsSearching(true)
    const { data } = await supabase.rpc('search_content', {
      query:    q.trim(),
      user_lat: coarseCoord(userLocation?.latitude  ?? null),
      user_lon: coarseCoord(userLocation?.longitude ?? null),
    })
    setGlobalResults(data ?? [])
    setIsSearching(false)
  }, [userLocation])

  useEffect(() => {
    if (!globalQuery.trim()) { setGlobalResults([]); return }
    const timer = setTimeout(() => runSearch(globalQuery), 300)
    return () => clearTimeout(timer)
  }, [globalQuery, runSearch])

  // ─── ONE PLACE-LOOKUP, TWO CALLERS ──────────────────────────────────────────
  // Global search resolves a beach/landmark hit by id, and the V2 hero resolves its
  // district's place by id. Same table, same status filter, same columns (PLACE_COLS at
  // module scope) — one function rather than two selects that would drift the day
  // somebody adds a column to only one of them.
  //
  // A miss is a graceful no-op, never a crash: .maybeSingle() returns
  // {data: null, error: null} on zero rows — it does NOT throw — so a hero pointing at a
  // place that has since been un-published simply does nothing when tapped.
  async function openPlaceById(id) {
    if (!id) return
    const { data } = await supabase.from('places')
      .select(PLACE_COLS).eq('id', id).eq('status', 'active').maybeSingle()
    if (data) onSelectExplorePlace(data)
  }

  // ─── Bugün ADA'da — resolve once per mount ────────────────────────────────
  //
  // ⚠ GATED ON HOME_V2_LIVE, WHICH IS NOT DECORATION. The V1 hub never renders the strip,
  //   so running the ladder there would be network traffic and battery spent on a card
  //   nobody can see — and it would make the V1 path observably different from today,
  //   which is the one thing this flag promises it is not.
  //
  // Also skipped in facility-list mode: that is what the profile gate renders, and a
  // gated user must not have Home's content resolved on their behalf.
  //
  // No cleanup flag is needed — resolveStripItem never rejects (every rank catches, and
  // rank 6 is a local constant) — but an unmounted setState is still a warning, so the
  // effect tracks liveness the ordinary way.
  useEffect(() => {
    if (!HOME_V2_LIVE || showFacilityList) return
    let alive = true
    setStripLoading(true)
    resolveStripItem({ lang, promosEligible })
      .then(item => { if (alive) { setStripItem(item); setStripLoading(false) } })
    return () => { alive = false }
  }, [lang, promosEligible, showFacilityList])

  // ─── Sık kullandıkların — resolved ONCE per mount ─────────────────────────
  //
  // ⚠ THE RE-SORT TRIGGER IS "ON MOUNT", AND THE ALTERNATIVES WERE REJECTED FOR A REASON.
  //
  //   • ON TAP — immediately. Rejected outright: the row reorders under the finger that
  //     is still touching it, so the tile you meant to press has moved by the time you
  //     press it again. It also makes the row's order a function of the last thing you
  //     did rather than of what you usually do.
  //   • ON FOREGROUND (an AppState listener). Rejected, and it is the tempting one: it
  //     sounds like "between sessions". It is not. Coming back from the background leaves
  //     you looking at the screen you left, so the re-sort happens WHILE THE ROW IS
  //     VISIBLE — the same shuffle as on-tap, just delayed and less explicable.
  //   • ON MOUNT. Chosen. HomeScreen is a conditional render (`activeTab === 'home' &&`),
  //     so it remounts on every return to the tab: the order is fresh every time you
  //     arrive at Home and frozen for as long as you are looking at it.
  //
  // Which is why `favUsage` is NOT in this dependency array and why the tap handler does
  // not write it into state. A tap records to disk and is picked up next mount. Adding
  // favUsage here would silently turn this into the on-tap design.
  //
  // Gated on HOME_V2_LIVE for the same reason the strip is: the V1 hub renders no
  // favourites row, so this would be two disk reads for a row nobody can see, and it
  // would make the V1 path observably different from today.
  // The one case a MODULE_FLAGS entry cannot express. HomeScreen already receives
  // garagesTileVisible (GARAGES_LIVE || admin || ownsGarage), and a garage owner genuinely
  // uses that module while it is dark for everybody else — so for them it is a legitimate
  // favourite. Memoised because a fresh object literal in a dependency array re-runs the
  // effect on every render, which would quietly become the on-tap design.
  const favOverrides = useMemo(() => ({ garages: !!garagesTileVisible }), [garagesTileVisible])

  useEffect(() => {
    if (!HOME_V2_LIVE || showFacilityList) return
    let alive = true
    Promise.all([loadUsage(), loadPins()]).then(([usage, pins]) => {
      if (!alive) return
      setFavUsage(usage)
      setFavPins(pins)
      setFavIds(resolveFavourites({ pins, usage, overrides: favOverrides }))
    })
    return () => { alive = false }
  }, [showFacilityList, favOverrides])

  // Every V2 tile tap, from the grid AND from the favourites row. recordModuleOpen is
  // fire-and-forget by design — awaiting it would put a disk write between the finger and
  // the screen opening, for a counter that only affects the NEXT mount.
  //
  // ⚠ ONLY V2 TILES COUNT. This wrapper is called from renderHubV2 and nowhere else, so
  //   V1 records nothing and the whole feature is inherently flag-gated. Strip taps
  //   deliberately do not count either: the question the row answers is "which module
  //   TILES do you reach for", and a strip tap is a response to a card we chose to show,
  //   not a choice the user navigated to.
  function openModule(mod) {
    recordModuleOpen(mod.id)
    moduleHandlers[mod.id]?.()
  }

  function saveFavourites(pins) {
    setFavEditOpen(false)
    setFavPins(pins)
    savePins(pins)
    // Re-resolve immediately. This is NOT the shuffle the mount-only rule forbids — it is
    // the direct result of the user pressing Bitti, and a row that ignored an edit until
    // the next launch would read as the edit having failed.
    setFavIds(resolveFavourites({ pins, usage: favUsage, overrides: favOverrides }))
  }

  // The strip's `action` is a plain descriptor, never a closure — the resolver has no
  // navigation in it, and this is the one place that turns a kind into a destination.
  function handleStripPress(item) {
    const a = item?.action
    if (!a) return
    switch (a.type) {
      // Events has no initialEventId prop today, so a tapped event opens the LIST rather
      // than that event. Deliberate and recorded: adding a deep-link means threading an id
      // through EventsScreen's own selection state, which is its own change. The list is
      // date-ordered and the strip only ever surfaces something starting today, so the
      // event is at the top of it.
      case 'events':    onShowEvents?.(); break
      case 'place':     openPlaceById(a.id); break
      case 'oli':       onOpenOli?.(); break
      case 'duty':      onShowDutyList?.(); break
      case 'explore':   onShowExplore?.(); break
      case 'emergency': onShowEmergency?.(); break
      // Promos are the only outbound link on this screen. openURL can reject on a
      // malformed href, and an unhandled rejection here would be a red box over Home.
      case 'link':      if (a.url) Linking.openURL(a.url).catch(() => {}); break
    }
  }

  async function handleResultPress(result) {
    setGlobalQuery('')
    setGlobalResults([])
    switch (result.module) {
      case 'medical': {
        const fac = facilities.find(f => f.id === result.id)
        if (fac) fac.provider_id ? onSelectFacility(fac) : onUnclaimedFacility(fac)
        break
      }
      case 'events':       onShowEvents(); break
      case 'homeServices': onShowHomeServices(); break
      case 'transport':    onShowTransport(); break
      case 'jobPostings':  onShowJobPostings(); break
      // Routes through the App.js gate like every other module, so while
      // MODULE_FLAGS.towing is false this lands on Coming Soon rather than the list —
      // the same behaviour job_postings has had since it became searchable.
      case 'towing':       onShowTowing(); break
      case 'beach':
      case 'landmark': {
        // search_content still returns 'beach'/'landmark' (its arms are deferred to the DROP
        // migration), but both resolve against `places` by their preserved UUID → ExploreProfileScreen.
        // A miss (id not an active/visible place) is a graceful no-op, never a crash.
        await openPlaceById(result.id)
        break
      }
    }
  }

  const moduleHandlers = {
    exchangeRates:      onShowExchangeRates,
    newcomerEssentials: onShowNewcomerEssentials,
    games:              onShowGames,
    accommodation:      onShowAccommodation,
    pets:               onShowPets,
    homeServices:       onShowHomeServices,
    jobPostings:        onShowJobPostings,
    beaches:            onShowExploreBeach,
    explore:            onShowExplore,
    transport:          onShowTransport,
    insurance:          onShowInsurance,
    grooming:           onShowGrooming,
    garages:            onShowGarages,
    towing:             onShowTowing,
    esim:               onShowEsim,
    municipal:          onShowMunicipal,
    studentHub:         onShowStudentHub,
    // ─── Added for the V2 grid ────────────────────────────────────────────────
    // V1 reached these three from the quick-button row rather than the tile grid, so
    // they were never in this map. V2 has one grid and no quick row, so they join it.
    // `beaches` stays above and stays wired even though the V2 grid dropped its tile:
    // Ask Oli still routes to it, and the entry is one line.
    events:             onShowEvents,
    emergency:          onShowEmergency,
    health:             () => setShowFacilityList(true),
  }

  // Every configured tile must resolve to a handler. A missing wire would otherwise be a
  // tile that silently does nothing when tapped — the failure looks like a frozen app,
  // not like a bug in a config file, and it would ship. __DEV__ only: this is a
  // developer's mistake to catch at edit time, not a crash to hand a user.
  if (__DEV__ && HOME_V2_LIVE) {
    for (const m of HOME_MODULES) {
      if (typeof moduleHandlers[m.id] !== 'function') {
        console.warn(`HomeScreen: HOME_MODULES tile '${m.id}' has no handler in moduleHandlers`)
      }
    }
  }

  const listed = facilities
    .filter(f => HEALTH_TYPES.includes(f.type))
    // Defense-in-depth for moderation (the RLS gate in 20260820 is the real fix):
    // keep suspended/pending/hidden listings out of the browse list, incl. own.
    .filter(f => (f.status === 'active' || f.status === 'trial') && !f.hidden_at)
    // ── UNCLAIMED PHARMACIES ARE NOT DIRECTORY CONTENT (2026-08-28) ───────────
    //
    // 387 of the 394 visible rows are pharmacies with no provider_id — the whole KTEB
    // list, none of which has any relationship with ADA. Listing them is free promotion
    // for businesses that never joined, and it buries the 7 rows that ARE the product.
    // A pharmacy WITH a provider_id is a subscriber and keeps full visibility; a state
    // facility (sector='public') keeps it too. Only the unclaimed-pharmacy pair goes.
    //
    // ⚠ THIS MUST STAY ITS OWN .filter(), ABOVE the default-view clause below. That
    //   clause short-circuits on `searchText.trim()`, so folding this predicate into it
    //   would re-admit all 387 on the first keystroke — visible in the list the moment
    //   somebody types, which is the exact thing this removes.
    //
    // ADA still serves pharmacies, through the ONE surface where the data is real and
    // actionable: the duty roster. DutyListScreen reads duty_list, which has no join to
    // facilities and no facility_id, so it is untouched by this and by anything downstream.
    .filter(f => !(f.type === 'pharmacy' && !f.provider_id))
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
    // Default view = ADA members PLUS public infrastructure.
    //
    // provider_id alone conflated "has a commercial relationship with ADA" with "should
    // be listed by default". For a private pharmacy that is the right distinction. For a
    // state hospital it is a category error: claim_requests_guard_insert() refuses
    // public-sector claims outright, so it can NEVER hold a provider_id and could never
    // appear by default, no matter what anyone did.
    //
    // ⚠ THIS IS DOWNSTREAM OF MODERATION, WHICH IS WHAT MAKES IT SAFE. status/hidden_at
    //   are filtered ABOVE, so this clause cannot resurrect a draft or a hidden row —
    //   including the Girne duplicate (91338177…), which 20260911 set to status='draft'
    //   deliberately and which must stay invisible until the merge slice.
    //
    // ⚠ NOT hospital-scoped. sector='public' covers hospital, health_centre, polyclinic
    //   and health_room. Six rows today; ~36 more are seeded draft, so activating them
    //   grows this list by roughly 7x. That is a monetisation-visible change and wants a
    //   conversation BEFORE those drafts go active — not a reason to scope this narrower,
    //   because narrowing it would just hide the same question behind a type check.
    .filter(f => searchText.trim() || !!f.provider_id || f.sector === 'public')
    // Units inside another facility (Thalassaemia, Radyasyon Onkoloji inside BNDH) are
    // not separate destinations. 20260911 already decided this for the map — "two more
    // markers on one roof is noise, not precision" — and a list row is the same argument.
    // Zero rows today, which is exactly why it is decided now rather than when three
    // hospitals suddenly appear in Lefkoşa.
    .filter(f => !f.parent_facility_id)
    .filter(f => !activeType || f.type === activeType)
    .filter(f => !openOnly || parseIsOpen(f.opening_hours) === true)
    .filter(f => !activeSpecialty || (Array.isArray(f.specialty) ? f.specialty.includes(activeSpecialty) : f.specialty === activeSpecialty))
    .filter(f => {
      if (!langFilter) return true
      const target = (CODE_TO_NAME[lang] || lang).toLowerCase()
      if (!target) return true
      return Array.isArray(f.languages) && f.languages.some(l => l.toLowerCase() === target)
    })
    .filter(f => {
      const q = searchText.trim().toLowerCase()
      if (!q) return true
      return f.name.toLowerCase().includes(q) || (f.address && f.address.toLowerCase().includes(q))
    })

  const locale = LANG_LOCALE[lang] || 'en'

  function renderWeather() {
    if (!weatherData) return null
    const cur   = weatherData.current
    const daily = weatherData.daily
    const uv    = uvLevel(cur.uv_index)
    const days  = (daily?.time ?? []).slice(0, 4)
    return (
      <TouchableOpacity style={s.weatherCard} onPress={() => setWeatherExpanded(v => !v)} activeOpacity={0.85}>
        <View style={s.weatherRow}>
          <Text style={s.weatherEmoji}>{weatherIcon(cur.weather_code)}</Text>
          <Text style={s.weatherTemp}>{Math.round(cur.temperature_2m)}°C</Text>
          <Text style={s.weatherDescInline} numberOfLines={1}>{weatherDesc(cur.weather_code)}</Text>
          <View style={{ flex: 1 }} />
          {uv && (
            <View style={[s.uvBadge, { backgroundColor: uv.color }]}>
              <Text style={s.uvBadgeText}>UV {Math.round(cur.uv_index)}</Text>
            </View>
          )}
          <Feather name={weatherExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
        </View>
        {weatherExpanded && (
          <>
            <View style={s.weatherExpandStats}>
              <Text style={s.weatherStat}>💧 {cur.relative_humidity_2m}%</Text>
              <Text style={s.weatherStat}>💨 {Math.round(cur.wind_speed_10m)} km/h</Text>
              <Text style={s.weatherStat}>{t('feelsLike', lang)} {Math.round(cur.apparent_temperature)}°C</Text>
              {uv && <Text style={s.weatherStat}>{t(uv.key, lang)}</Text>}
            </View>
            {uv?.warn && <Text style={s.uvWarnText}>🧴 {t('uvSunscreen', lang)}</Text>}
            {days.length > 0 && (
              <View style={s.forecastRow}>
                {days.map((date, i) => {
                  const label = i === 0
                    ? t('todayLabel', lang)
                    : new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' })
                  return (
                    <View key={date} style={s.forecastDay}>
                      <Text style={s.forecastLabel}>{label}</Text>
                      <Text style={s.forecastIcon}>{weatherIcon(daily.weather_code[i])}</Text>
                      <Text style={s.forecastMax}>{Math.round(daily.temperature_2m_max[i])}°</Text>
                      <Text style={s.forecastMin}>{Math.round(daily.temperature_2m_min[i])}°</Text>
                    </View>
                  )
                })}
              </View>
            )}
          </>
        )}
      </TouchableOpacity>
    )
  }

  // ─── HOME_V2 hub ────────────────────────────────────────────────────────────
  //
  // The V2 anatomy, top to bottom: top bar · half-height district hero · Oli row ·
  // Nöbetçi eczaneler · Tüm modüller · home_footer slot.
  //
  // ⚠ THIS FUNCTION IS THE ENTIRE SCOPE OF HOME_V2_LIVE. It replaces renderHub() and
  //   nothing else. HomeScreen's facility-list mode is load-bearing for the profile
  //   gate — constants/profileGate.js names this screen in GATE_EXEMPT_SCREENS.health,
  //   and App.js renders it with forceFacilityList / hideHeaderActions /
  //   onExitFacilityList to hand an incomplete profile a READ-ONLY directory WITHOUT the
  //   hub. The hub carries a tile for every module, so if the V2 branch ever reached the
  //   gated path it would grant the whole app to a profile that has not been completed.
  //   The flag must never appear anywhere near renderFacilityList().
  //
  // ─── WHAT SLICE 1 DELIBERATELY DOES NOT RENDER ─────────────────────────────
  // The "Bugün ADA'da" live strip is Slice 2 and the "Sık kullandıkların" favourites row
  // is Slice 3. Neither is stubbed here: an empty section header with nothing under it
  // reads as a broken screen, and a placeholder card is fake content that outlives the
  // session it was written for. The Nöbetçi row sits directly under the Oli row until
  // the strip lands between them.
  function renderHubV2() {
    // hideHeaderActions is honoured here as well as in the V1 header, and that is defence
    // rather than decoration. It is UNREACHABLE today — the gate sets forceFacilityList,
    // showFacilityList starts true, and the back handler calls onExitFacilityList instead
    // of clearing it, so a gated user never reaches this hub. But "unreachable" is a
    // property of three separate conditions in two files, and the thing on the other side
    // of it is a bell and a drawer for a profile the gate has not let through.
    const topBar = (
      <HomeTopBar
        lang={lang}
        hideActions={hideHeaderActions}
        hasUnread={notifications.some(n => !n.read)}
        searchOpen={searchOpen}
        query={globalQuery}
        onQueryChange={setGlobalQuery}
        onOpenSearch={() => setSearchOpen(true)}
        onCloseSearch={() => { setSearchOpen(false); setGlobalQuery(''); setGlobalResults([]) }}
        onShowNotifs={onShowNotifs}
        onOpenMenu={onOpenMenu}
        hamburgerRef={hamburgerRef}
      />
    )

    // ─── SEARCH REPLACES THE HERO, IT DOES NOT SIT UNDER IT ───────────────────
    // With search open the results ARE the screen: the bar moves onto the canvas and the
    // hero unmounts. Leaving a 300pt photograph above a result list would mean scrolling
    // past the picture to read your own search. Same behaviour V1 had — results replaced
    // the hub — with the bar in its new home.
    if (searchOpen) {
      return (
        <>
          {topBar}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.v2SearchContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderSearchResults()}
          </ScrollView>
          <WeatherSheet
            visible={weatherOpen}
            weatherData={weatherData}
            lang={lang}
            locale={locale}
            onClose={() => setWeatherOpen(false)}
          />
        </>
      )
    }

    return (
      <>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.v2Content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Full-bleed: the hero is the ONLY thing outside v2Below's horizontal inset,
              and it runs to the top of the screen under the status bar. HomeTopBar pads
              itself by the safe-area inset from inside the photo, which is why this
              screen's V2 path does not wrap anything in a top-edge SafeAreaView. */}
          <HomeHero
            region={region}
            weatherData={weatherData}
            lang={lang}
            onOpenPlace={openPlaceById}
            onOpenWeather={() => setWeatherOpen(true)}
            topControls={topBar}
            // Search moved out of the top bar and into the hero in round 7. searchRef
            // moved with it — App.js measures that exact ref for the coach mark, and a
            // ref that measures null silently drops the step.
            onOpenSearch={() => setSearchOpen(true)}
            searchRef={searchRef}
            showSearch={!hideHeaderActions}
          />

          <View style={s.v2Below}>
            <OliRow lang={lang} onPress={onOpenOli} />

            {/* ─── Bugün ADA'da ────────────────────────────────────────────
                The heading lives HERE rather than inside LiveStrip so it uses the same
                v2SectionTitle token as "Tüm modüller" below and cannot drift from it.
                That is only safe because LiveStrip has no empty branch — it renders the
                skeleton while loading and a card otherwise, and the resolver's rank 6 is
                a local constant — so this heading can never be left standing over
                nothing.

                ⚠ AND THE STRIP SITS ABOVE THE DUTY ROW WITHOUT COMPETING WITH IT. Duty
                  is a permanent row and is deliberately not one of the strip's kinds; if
                  it were, the single most important row on this screen would disappear
                  on any day an event outranked it. */}
            <Text style={s.v2SectionTitle}>{t('stripSectionTitle', lang)}</Text>
            <LiveStrip
              item={stripItem}
              loading={stripLoading}
              lang={lang}
              onPress={handleStripPress}
            />

            {/* dutyBannerRef, not a new ref: App.js measures this exact ref to place
                the duty coach mark, and a ref that measures null drops that tutorial
                step silently. Both hub variants must attach it. */}
            <View style={s.v2DutyWrap}>
              <DutyRow
                lang={lang}
                status={dutyRosterStatus}
                onPress={onShowDutyList}
                innerRef={dutyBannerRef}
              />
            </View>

            {/* ─── Sık kullandıkların ──────────────────────────────────────
                The heading sits here rather than inside FavouritesRow so all three
                section headings on this screen share ONE type token and cannot drift.
                Safe for the same reason it was safe for the strip: the row has no empty
                branch — UNGATED_MODULES holds seven ids no flag can switch off, so the
                auto-fill pool cannot run dry and this heading can never be left standing
                over nothing.

                ⚠ THESE FOUR TILES ALSO REMAIN IN THE GRID BELOW, AND THAT DUPLICATION IS
                  THE DESIGN. The grid is the app's navigation and must be complete and
                  identical for every user; this row is a per-device shortcut. Removing a
                  favourite from the grid would make the grid's contents depend on
                  behaviour, so two people comparing phones would see different apps. */}
            <View style={s.v2SectionRow}>
              <Text style={[s.v2SectionTitle, s.v2SectionTitleInRow]}>{t('favSectionTitle', lang)}</Text>
              <TouchableOpacity
                onPress={() => setFavEditOpen(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
              >
                <Text style={s.v2SectionAction}>{t('favEdit', lang)}</Text>
              </TouchableOpacity>
            </View>
            <FavouritesRow ids={favIds} lang={lang} onPress={openModule} />

            <Text style={s.v2SectionTitle}>{t('homeAllModules', lang)}</Text>
            <ModuleGrid lang={lang} onPress={openModule} />

            <HomeFooterSlot />
          </View>
        </ScrollView>

        <WeatherSheet
          visible={weatherOpen}
          weatherData={weatherData}
          lang={lang}
          locale={locale}
          onClose={() => setWeatherOpen(false)}
        />

        <FavouritesEditSheet
          visible={favEditOpen}
          pins={favPins}
          usage={favUsage}
          overrides={favOverrides}
          lang={lang}
          onSave={saveFavourites}
          onClose={() => setFavEditOpen(false)}
        />
      </>
    )
  }

  function renderSearchResults() {
    if (!globalQuery.trim()) return null
    if (isSearching) {
      return (
        <View style={s.searchResultsWrap}>
          <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 20 }} />
        </View>
      )
    }
    if (globalResults.length === 0) {
      return (
        <View style={s.searchResultsWrap}>
          <Text style={s.searchNoResults}>{t('noResultsTitle', lang)}</Text>
        </View>
      )
    }
    return (
      <View style={s.searchResultsWrap}>
        {globalResults.map((item, idx) => {
          const meta = RESULT_META[item.module] ?? { icon: 'search-outline', tint: 'service' }
          const tint = TINTS[meta.tint]
          return (
            <TouchableOpacity key={item.id + idx} style={s.searchResultRow} onPress={() => handleResultPress(item)} activeOpacity={0.75}>
              <View style={[s.searchResultIcon, { backgroundColor: tint.bg }]}>
                <Ionicons name={meta.icon} size={18} color={tint.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.searchResultTitle} numberOfLines={1}>{item.title}</Text>
                {!!item.subtitle && <Text style={s.searchResultSub} numberOfLines={1}>{item.subtitle}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          )
        })}
      </View>
    )
  }

  function renderHub() {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.hubContent} keyboardShouldPersistTaps="handled">
        {renderWeather()}

        <View ref={searchRef} style={s.hubSearchBar}>
          <Feather name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={s.searchInput}
            value={globalQuery}
            onChangeText={setGlobalQuery}
            placeholder={t('hubSearchPlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {globalQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setGlobalQuery(''); setGlobalResults([]) }}>
              <Feather name="x" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {renderSearchResults()}

        {!globalQuery.trim() && <>
          <TouchableOpacity ref={dutyBannerRef} style={s.medicalTile} onPress={onShowDutyList} activeOpacity={0.85}>
            <View style={s.medicalTileLeft}>
              <View style={[s.medicalTileIcon, { backgroundColor: TINTS.urgent.bg }]}>
                <Ionicons name="medical-outline" size={26} color={TINTS.urgent.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.medicalTileTitle}>{t('tonightDuty', lang)}</Text>
                <Text style={s.medicalTileSub} numberOfLines={1}>{t('hubDutySub', lang)}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={TINTS.urgent.fg} />
          </TouchableOpacity>

          <View style={s.quickRow}>
            <TouchableOpacity style={s.quickBtn} onPress={() => setShowFacilityList(true)} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: TINTS.urgent.bg }]}>
                <Ionicons name="medkit-outline" size={22} color={TINTS.urgent.fg} />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('hubMedicalTitle', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.quickBtn} onPress={onShowEmergency} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: TINTS.urgent.bg }]}>
                <Ionicons name="call-outline" size={22} color={TINTS.urgent.fg} />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('menuEmergency', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.quickBtn} onPress={onShowEvents} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: TINTS.lifestyle.bg }]}>
                <Ionicons name="calendar-outline" size={22} color={TINTS.lifestyle.fg} />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('menuEvents', lang)}</Text>
            </TouchableOpacity>
          </View>

          <View style={s.moduleGrid}>
            {MODULES.filter(mod => (mod.id !== 'garages' || garagesTileVisible)
                                && (mod.id !== 'towing'  || MODULE_FLAGS.towing)).map(mod => (
              <TouchableOpacity
                key={mod.id}
                style={s.moduleCard}
                onPress={moduleHandlers[mod.id]}
                activeOpacity={0.8}
              >
                <View style={[s.moduleIcon, { backgroundColor: TINTS[mod.tint].bg }]}>
                  <Ionicons name={mod.icon} size={24} color={TINTS[mod.tint].fg} />
                </View>
                <Text style={s.moduleLabel} numberOfLines={2}>{t(mod.labelKey, lang)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>}
      </ScrollView>
    )
  }

  function renderFacilityList() {
    const specList = activeType
      ? (SPECIALTIES_BY_TYPE[activeType] || []).filter(sp =>
          facilities.some(f => Array.isArray(f.specialty) ? f.specialty.includes(sp) : f.specialty === sp)
        )
      : []

    return (
      <View style={{ flex: 1 }}>
        <MascotIntroCard
          module="health_facilities"
          title={t('medIntroTitle', lang)}
          subtitle={t('medIntroSub', lang)}
          style={s.medIntroCard}
        />
        <View style={s.searchBar}>
          <Feather name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={s.searchInput}
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

        <View style={s.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterBarContent}>
            <TouchableOpacity
              style={[s.toggleChip, openOnly && s.toggleChipOpen]}
              onPress={() => setOpenOnly(v => !v)}
            >
              <Feather name="clock" size={12} color={openOnly ? colors.success : colors.textSecondary} />
              <Text style={[s.toggleChipText, openOnly && { color: colors.success }]}>{t('open', lang)}</Text>
            </TouchableOpacity>
            {activeType && (
              <TouchableOpacity style={s.activeFilterPill} onPress={() => { setActiveType(null); setActiveSpecialty(null) }}>
                <TypeSVGIcon type={activeType} size={11} color={colors.primary} />
                <Text style={s.activeFilterPillText}>{t(activeType, lang)}</Text>
                <Feather name="x" size={10} color={colors.primary} />
              </TouchableOpacity>
            )}
            {activeSpecialty && (
              <TouchableOpacity style={s.activeFilterPill} onPress={() => setActiveSpecialty(null)}>
                <Text style={s.activeFilterPillText}>{t(activeSpecialty, lang)}</Text>
                <Feather name="x" size={10} color={colors.primary} />
              </TouchableOpacity>
            )}
            {langFilter && (
              <TouchableOpacity style={s.activeFilterPill} onPress={() => setLangFilter(false)}>
                <Ionicons name="language-outline" size={11} color={colors.primary} />
                <Text style={s.activeFilterPillText}>{t('myLang', lang)}</Text>
                <Feather name="x" size={10} color={colors.primary} />
              </TouchableOpacity>
            )}
          </ScrollView>
          <TouchableOpacity
            style={[s.filterToggleBtn, showFilters && s.filterToggleBtnActive]}
            onPress={() => setShowFilters(v => !v)}
          >
            <Feather name="sliders" size={14} color={showFilters ? colors.primary : colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {showFilters && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.typeRow}
            contentContainerStyle={s.typeRowContent}
          >
            {/* The pharmacy chip NAVIGATES; every other chip FILTERS (2026-08-28).
                Unclaimed pharmacies left the directory, so filtering by 'pharmacy' would
                now match 0 rows — an empty list under a chip the user just deliberately
                tapped, which reads as broken. ADA's pharmacy offering IS the duty roster,
                so the chip goes there and is labelled for what it opens rather than what
                it would have filtered. It never takes the active/selected style: it is
                not a filter state, so it must not look like one. */}
            {[null, 'pharmacy', 'clinic', 'hospital', 'dentist'].map(type => {
              const isDuty   = type === 'pharmacy'
              const selected = !isDuty && activeType === type
              return (
                <TouchableOpacity
                  key={type ?? 'all'}
                  style={[s.typeChip, selected && s.typeChipActive]}
                  onPress={() => {
                    if (isDuty) { onShowDutyList?.(); return }
                    setActiveType(activeType === type ? null : type)
                    setActiveSpecialty(null)
                  }}
                >
                  {type
                    ? <TypeSVGIcon type={type} size={14} color={selected ? '#fff' : colors.textSecondary} />
                    : <Ionicons name="apps-outline" size={14} color={selected ? '#fff' : colors.textSecondary} />
                  }
                  <Text style={[s.typeChipText, selected && s.typeChipTextActive]}>
                    {isDuty
                      ? t('chipDutyPharmacies', lang)
                      : type
                        ? t({ clinic: 'clinics', hospital: 'hospitals', dentist: 'dentists' }[type] || type, lang)
                        : t('all', lang)
                    }
                  </Text>
                  {isDuty && <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} />}
                </TouchableOpacity>
              )
            })}
            <View style={s.chipDivider} />
            <TouchableOpacity
              style={[s.toggleChip, langFilter && s.toggleChipLang]}
              onPress={() => setLangFilter(v => !v)}
            >
              <Ionicons name="language-outline" size={12} color={langFilter ? colors.accent : colors.textSecondary} />
              <Text style={[s.toggleChipText, langFilter && { color: colors.accent }]}>{t('myLang', lang)}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {specList.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterContent}>
            {specList.map(sp => (
              <TouchableOpacity
                key={sp}
                style={[s.filterChip, activeSpecialty === sp && s.filterChipActive]}
                onPress={() => setActiveSpecialty(prev => prev === sp ? null : sp)}
              >
                <Text style={[s.filterChipText, activeSpecialty === sp && s.filterChipTextActive]}>{t(sp, lang)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* The banner was UNCONDITIONAL, which was worse than silence: with an empty
            roster it invited the user in and the next screen denied them. It now tells
            the truth up front and still opens the list, where the KTEB fallback lives. */}
        {(() => {
          const rosterOk = dutyRosterStatus === DUTY_FRESH
          // THIN, NOT STALE. 'Duty list isn't current' is false on a partial day — the
          // list IS current, it just does not cover the country — and a user who taps
          // through to a notice saying something different trusts neither. Styling stays
          // the alert variant (the point is that it must not read as healthy); only the
          // title changes. The sub, 'Tap for the current list', is a call to action
          // rather than a claim about staleness, so it still reads correctly.
          const rosterPartial = dutyRosterStatus === DUTY_PARTIAL
          return (
            <TouchableOpacity
              style={[s.dutyBanner, !rosterOk && s.dutyBannerStale]}
              onPress={onShowDutyList}
              activeOpacity={0.8}
            >
              <View style={s.dutyBannerLeft}>
                <View style={[s.dutyBannerIconWrap, !rosterOk && s.dutyBannerIconWrapStale]}>
                  <Ionicons
                    name={rosterOk ? 'medical-outline' : 'alert-circle-outline'}
                    size={20}
                    color={rosterOk ? colors.accent : colors.danger}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.dutyBannerTitle, !rosterOk && { color: colors.danger }]}>
                    {t(rosterOk ? 'tonightDuty'
                      : rosterPartial ? 'dutyBannerPartialTitle'
                      : 'dutyBannerStaleTitle', lang)}
                  </Text>
                  <Text style={s.dutyBannerSub}>
                    {t(rosterOk ? 'allRegions' : 'dutyBannerStaleSub', lang)}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={rosterOk ? colors.accent : colors.danger} />
            </TouchableOpacity>
          )
        })()}

        {facilityLoadError && (
          <View style={s.errorRow}>
            <Text style={s.locationNote}>{t('facilityLoadError', lang)}</Text>
            <TouchableOpacity onPress={onRetry} style={s.retryBtn}>
              <Text style={s.retryBtnText}>{t('tryAgain', lang)}</Text>
            </TouchableOpacity>
          </View>
        )}
        {locationDenied && <Text style={s.locationNote}>{t('enableLocation', lang)}</Text>}

        <FlatList
          data={listed}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={(
            <View style={s.emptyWrap}>
              <View style={s.emptyBlurBubble}>
                <BlurView intensity={85} tint="light" style={StyleSheet.absoluteFill} />
                {searchText || activeType || activeSpecialty ? (
                  <>
                    <Ionicons name="search-outline" size={44} color={colors.border} style={{ marginBottom: 16 }} />
                    <Text style={s.emptyTitle}>{t('noResultsTitle', lang)}</Text>
                    <Text style={s.emptyBody}>{t('noResultsBody', lang)}</Text>
                  </>
                ) : (
                  <>
                    <Text style={s.emptyIcon}>🏥</Text>
                    <Text style={s.emptyTitle}>{t('noFacilitiesTitle', lang)}</Text>
                    <Text style={s.emptyBody}>{t('noFacilitiesBody', lang)}</Text>
                  </>
                )}
              </View>
            </View>
          )}
          renderItem={({ item }) => {
            const isOpen = parseIsOpen(item.opening_hours)
            const tc     = typeColors[item.type] || typeColors.clinic
            const isDuty = item.id === dutyFacilityId
            const isFav  = favorites.has(item.id)
            return (
              <TouchableOpacity
                activeOpacity={0.75}
                style={[s.card, isDuty && s.dutyCard, !item.provider_id && s.cardUnclaimed]}
                onPress={() => item.provider_id ? onSelectFacility(item) : onUnclaimedFacility(item)}
              >
                {item.cover_image_url
                  ? <Image source={{ uri: item.cover_image_url }} style={s.cardCover} resizeMode="cover" />
                  : null
                }
                <View style={s.cardBody}>
                  {isDuty && (
                    <View style={s.dutyCardBadge}>
                      <Text style={s.dutyLabel}>{t('onDuty', lang)}</Text>
                    </View>
                  )}
                  <View style={s.cardMain}>
                    <View style={[s.typeIcon, { backgroundColor: tc.bg }]}>
                      {item.logo_url
                        ? <Image source={{ uri: item.logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
                        : <TypeSVGIcon type={item.type} size={22} color={tc.text} />
                      }
                    </View>
                    <View style={s.cardContent}>
                      <View style={s.cardTop}>
                        <View style={s.cardNameRow}>
                          <Text style={s.facilityName} numberOfLines={1}>{item.name}</Text>
                        </View>
                        {item._dist != null && <Text style={s.distanceText}>{item._dist.toFixed(1)} km</Text>}
                      </View>
                      <View style={s.badgeRow}>
                        <View style={[s.typeBadge, { backgroundColor: tc.bg }]}>
                          <Text style={[s.typeBadgeText, { color: tc.text }]}>{t(item.type, lang)}</Text>
                        </View>
                        {item.verified && (
                          <View style={s.verifiedBadge}>
                            <Ionicons name="shield-checkmark" size={10} color="#fff" />
                            <Text style={s.verifiedBadgeText}>{t('verified', lang)}</Text>
                          </View>
                        )}
                        {/* "Not yet on ADA" retired 2026-08-28. Every row that still
                            reaches this list is a subscriber (provider_id) or a state
                            facility (sector='public'), so the badge described nothing.
                            A public hospital simply shows no badge — it has no
                            opening_hours, so isOpen is null. */}
                        {isOpen != null && (
                          <View style={[s.statusBadge, isOpen ? s.openBadge : s.closedBadge]}>
                            <Text style={[s.statusText, isOpen ? s.openText : s.closedText]}>
                              {isOpen ? t('open', lang) : t('closed', lang)}
                            </Text>
                          </View>
                        )}
                        {isAvailableToday(item.availability) && (
                          <View style={s.bookableBadge}>
                            <Feather name="calendar" size={10} color={colors.primary} />
                            <Text style={s.bookableBadgeText}>Bookable</Text>
                          </View>
                        )}
                      </View>
                      {item.specialty?.length ? (
                        <Text style={s.specialtyText} numberOfLines={1}>
                          {Array.isArray(item.specialty)
                            ? item.specialty.map(sp => t(sp, lang)).join(' · ')
                            : t(item.specialty, lang)
                          }
                        </Text>
                      ) : null}
                      {item.address ? <Text style={s.addressText} numberOfLines={1}>{item.address}</Text> : null}
                      {facilityRatings[item.id] && (
                        <View style={s.ratingRow}>
                          <Ionicons name="star" size={11} color="#F5A623" />
                          <Text style={s.ratingText}> {facilityRatings[item.id].avg} ({facilityRatings[item.id].count})</Text>
                        </View>
                      )}
                      {item.phone ? (
                        <TouchableOpacity
                          style={s.callPill}
                          onPress={() => Linking.openURL(`tel:${item.phone.replace(/\s+/g, '')}`)}
                          activeOpacity={0.7}
                        >
                          <Feather name="phone" size={11} color={colors.accent} />
                          <Text style={s.callPillText}>{item.phone}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {isDuty ? (
                        <TouchableOpacity
                          style={s.directionsPill}
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
                          <Text style={s.directionsPillText}>{t('getDirections', lang)}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={s.cardActions}>
                      <TouchableOpacity onPress={() => onToggleFavorite(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
    )
  }

  // ─── THE V2 HUB HAS A SOLID CANVAS; EVERYTHING ELSE KEEPS THE PHOTO ────────
  //
  // V1 and facility-list mode render inside a full-bleed <ImageBackground>. That was
  // fine when the page was white cards on a photo, and it is NOT fine for a bare-icon
  // grid: the lower rows' labels landed over the sea in auth-bg.png and became
  // unreadable — eSIM, Öğrenci Merkezi and Belediyeler worst of all. Photo-behind-text
  // fails hardest in bright outdoor light, which is exactly when somebody is standing in
  // the street looking for the duty pharmacy tile.
  //
  // So under V2 the photograph is confined to the hero band, which owns its own scrim,
  // and the page below it is a solid warm cream (colors.bgWarm). Grid labels are
  // textPrimary on that: 13.56:1, measured.
  //
  // ⚠ THE BRANCH IS ON THE HUB ONLY. `showFacilityList` keeps the ImageBackground in
  //   BOTH flag states, so the profile gate's read-only directory — which is what that
  //   mode renders — is byte-identical to today whatever HOME_V2_LIVE says.
  const v2Hub = HOME_V2_LIVE && !showFacilityList

  // ─── V2's HUB IS ITS OWN TREE, AND IT HAS TO BE ────────────────────────────
  // The other paths wrap their content in a top-edge SafeAreaView and a horizontally
  // padded container. V2's hero must escape BOTH: it runs under the status bar and to
  // the screen edges, and HomeTopBar applies the safe-area inset itself from inside the
  // photograph. A top-edge SafeAreaView here would leave a strip of canvas above the
  // photo — exactly the separate top bar this pass removed.
  //
  // ⚠ THIS IS THE ONLY PLACE THE TWO TREES DIVERGE. Everything else — V1 hub, facility
  //   list, the profile gate's read-only directory — goes through `shell` below and is
  //   untouched whatever the flag says.
  if (v2Hub) {
    return (
      <View style={s.v2Canvas}>
        {renderHubV2()}
      </View>
    )
  }

  const shell = (
    <>
      {/* Facility-list mode swaps the hub's sky for the medical-facilities art (full-bleed). */}
      {showFacilityList && <PageBackground topic="medical_facilities" />}
      <SafeAreaView style={[s.safe, { backgroundColor: 'transparent' }]} edges={['top']}>
        <View style={s.container}>
          {/* ─── THE HEADER IS V1's, UNCONDITIONALLY ──────────────────────────
              It used to be guarded by `showFacilityList || !HOME_V2_LIVE`. The V2 hub now
              returns before this tree is built, so that condition is true on every path
              that reaches here and the guard only made the invariant harder to see. The
              invariant itself is unchanged and is the safety property of this slice: in
              facility-list mode — which is what the profile gate renders, with the
              BackButton and hideHeaderActions — this header is EXACTLY today's whatever
              the flag says. */}
          <View style={[s.header, showFacilityList && { justifyContent: 'space-between' }]}>
            {showFacilityList ? (
              <BackButton lang={lang} onImage onPress={() => {
                // Under the gate there is no hub to go back TO — revealing it would be
                // the leak this whole arrangement exists to prevent.
                if (forceFacilityList) onExitFacilityList?.()
                else setShowFacilityList(false)
              }} />
            ) : (
              <View style={s.headerLogoWrap} pointerEvents="none">
                <Image source={require('../assets/logonobg.png')} style={s.headerIcon} resizeMode="contain" />
              </View>
            )}
            {hideHeaderActions ? <View /> : (
              <View style={s.headerRight}>
                <TouchableOpacity style={s.notifBtn} onPress={onShowNotifs}>
                  <Ionicons name="notifications-outline" size={18} color={colors.textSecondary} />
                  {notifications.some(n => !n.read) && <View style={s.notifDot} />}
                </TouchableOpacity>
                <TouchableOpacity ref={hamburgerRef} style={s.hamburgerBtn} onPress={onOpenMenu}>
                  <Feather name="menu" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* v2Hub returned above, so this is V1's hub or the facility list — never V2. */}
          {showFacilityList ? renderFacilityList() : renderHub()}
        </View>
      </SafeAreaView>
    </>
  )

  return (
    <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      {shell}
    </ImageBackground>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: 16 },
  header:    { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingTop: 16, paddingBottom: 12, position: 'relative' },
  headerLogoWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  headerIcon:     { width: 110, height: 54 },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifBtn:       { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },
  notifDot:       { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.bg },
  hamburgerBtn:   { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },

  // The V2 page canvas. ONE background surface — cards on top of it are cardBg, as
  // everywhere else in the app. Do not add a second.
  v2Canvas:         { flex: 1, backgroundColor: colors.bgWarm },

  // Hub V2 (HOME_V2_LIVE)
  // No `gap` and no horizontal padding: the hero is full-bleed and the Oli row overlaps
  // it with a negative margin of its own, so a container gap would fight both. Horizontal
  // inset belongs to v2Below; spacing between rows is owned by the rows.
  v2Content:        { paddingBottom: 32 },
  // Everything BELOW the hero. This is where the page's horizontal inset lives, because
  // the hero is the one section that must escape it.
  v2Below:          { paddingHorizontal: 16 },
  v2SearchContent:  { paddingHorizontal: 16, paddingBottom: 32 },
  v2SectionTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 24, marginBottom: 4 },
  // A heading that carries an action. The MARGINS move to the row so the title and the
  // button share a centre line; the type spec stays in v2SectionTitle and is reused
  // rather than restated, so all three headings on this screen are one definition.
  v2SectionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      marginTop: 24, marginBottom: 4 },
  v2SectionTitleInRow: { marginTop: 0, marginBottom: 0 },
  // primaryDark rather than primary: this is 13pt text on the warm canvas and primary
  // measures 4.44:1 there, under the 4.5 floor. primaryDark is 6.71:1.
  v2SectionAction:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.primaryDark },
  // The gap between the Oli row and the Nöbetçi row lives HERE, on a wrapper, not inside
  // DutyRow — Slice 2 drops the live strip in between them, and a component that carries
  // its own top margin would have to be edited to move.
  v2DutyWrap:       { marginTop: 16 },

  // Hub
  hubContent:       { paddingBottom: 32, gap: 12 },
  quickRow:         { flexDirection: 'row', gap: 10 },
  quickBtn:         { flex: 1, alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, gap: 8, ...shadow },
  quickIcon:        { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  quickLabel:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  medicalTile:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.primary + '25', ...shadow },
  medicalTileLeft:  { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  medicalTileIcon:  { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  medicalTileTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  medicalTileSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  moduleGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moduleCard:       { width: '47.5%', backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, gap: 10, alignItems: 'center', ...shadow },
  moduleIcon:       { width: 44, height: 44, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  moduleLabel:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },

  // Weather
  weatherCard:        { backgroundColor: colors.cardBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, ...shadow },
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

  // Hub global search
  hubSearchBar:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchResultsWrap:  { backgroundColor: colors.cardBg, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  searchResultRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchResultIcon:   { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  searchResultTitle:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  searchResultSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 1 },
  searchNoResults:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', paddingVertical: 20 },

  // Facility list controls
  medIntroCard:       { marginBottom: 12 },
  searchBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchInput:        { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  filterBar:          { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  filterBarContent:   { gap: 6, alignItems: 'center', paddingRight: 8 },
  activeFilterPill:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  activeFilterPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  filterToggleBtn:    { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginLeft: 6, flexShrink: 0 },
  filterToggleBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toggleChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  toggleChipText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  toggleChipOpen:     { borderColor: colors.success, backgroundColor: colors.successLight },
  toggleChipLang:     { borderColor: colors.accent, backgroundColor: colors.accentLight },
  typeRow:            { flexGrow: 0, marginBottom: 10 },
  typeRowContent:     { gap: 6, paddingRight: 4, alignItems: 'center' },
  chipDivider:        { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2, alignSelf: 'center' },
  typeChip:           { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  typeChipActive:     { borderColor: colors.primary, backgroundColor: colors.primary },
  typeChipText:       { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  typeChipTextActive: { color: '#fff' },
  filterRow:          { marginBottom: 8, flexGrow: 0 },
  filterContent:      { gap: 8, paddingRight: 4, alignItems: 'center' },
  filterChip:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#C8D3DC', backgroundColor: colors.cardBg },
  filterChipActive:   { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#1A2B33' },
  filterChipTextActive: { color: '#FFFFFF' },

  // Duty banner (in facility list view)
  dutyBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.accentLight, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.accent + '30' },
  dutyBannerStale: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  dutyBannerIconWrapStale: { backgroundColor: '#fff' },
  dutyBannerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dutyBannerIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.accent + '20', justifyContent: 'center', alignItems: 'center' },
  dutyBannerTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.accent, marginBottom: 2 },
  dutyBannerSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.accent + 'AA' },

  // Error / location
  errorRow:     { alignItems: 'center', marginBottom: 10 },
  locationNote: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
  retryBtn:     { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 10 },
  retryBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Facility cards
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
  verifiedBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: colors.primary },
  verifiedBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  bookableBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.primaryLight },
  bookableBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  emptyWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyBlurBubble:  { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 28, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  emptyIcon:        { fontSize: 48, marginBottom: 16 },
  emptyTitle:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  emptyBody:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
})
