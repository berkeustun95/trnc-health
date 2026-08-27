import { useState, useEffect, useCallback } from 'react'
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
import { MODULE_FLAGS } from '../constants/flags'
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
}) {
  const [showFacilityList, setShowFacilityList] = useState(false)
  const [searchText, setSearchText]             = useState('')
  const [activeType, setActiveType]             = useState(null)
  const [activeSpecialty, setActiveSpecialty]   = useState(null)
  const [openOnly, setOpenOnly]                 = useState(false)
  const [langFilter, setLangFilter]             = useState(false)
  const [showFilters, setShowFilters]           = useState(false)
  const [weatherExpanded, setWeatherExpanded]   = useState(false)

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
        const { data } = await supabase.from('places')
          // Mirrors ExploreScreen's BROWSE_COLS — photo_attribution INCLUDED. This is the
          // production path to a landmark's detail screen (search_content's landmark arm
          // reads the legacy table and resolves the hit here), so an omission would drop
          // the attribution source link on the one route real users take today.
          .select('id, category, name, name_i18n, description_i18n, region, latitude, longitude, cover_image_url, photos, photo_credits, photo_attribution, blue_flag, access_type, amenities, provider_id, featured_until')
          .eq('id', result.id).eq('status', 'active').maybeSingle()
        if (data) onSelectExplorePlace(data)
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
          const rosterOk = dutyRosterStatus === 'fresh'
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
                    {t(rosterOk ? 'tonightDuty' : 'dutyBannerStaleTitle', lang)}
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

  return (
    <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      {/* Facility-list mode swaps the hub's sky for the medical-facilities art (full-bleed). */}
      {showFacilityList && <PageBackground topic="medical_facilities" />}
      <SafeAreaView style={[s.safe, { backgroundColor: 'transparent' }]} edges={['top']}>
        <View style={s.container}>
          <View style={[s.header, showFacilityList && { justifyContent: 'space-between' }]}>
            {showFacilityList ? (
              <BackButton lang={lang} onImage onPress={() => setShowFacilityList(false)} />
            ) : (
              <View style={s.headerLogoWrap} pointerEvents="none">
                <Image source={require('../assets/logonobg.png')} style={s.headerIcon} resizeMode="contain" />
              </View>
            )}
            <View style={s.headerRight}>
              <TouchableOpacity style={s.notifBtn} onPress={onShowNotifs}>
                <Ionicons name="notifications-outline" size={18} color={colors.textSecondary} />
                {notifications.some(n => !n.read) && <View style={s.notifDot} />}
              </TouchableOpacity>
              <TouchableOpacity ref={hamburgerRef} style={s.hamburgerBtn} onPress={onOpenMenu}>
                <Feather name="menu" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {showFacilityList ? renderFacilityList() : renderHub()}
        </View>
      </SafeAreaView>
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
