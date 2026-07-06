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
import { colors, typeColors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { SPECIALTIES_BY_TYPE } from '../constants/specialties'
import {
  haversineKm, parseIsOpen, uvLevel, weatherIcon, weatherDesc, isAvailableToday,
} from '../utils/facilityUtils'

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

const MODULES = [
  { id: 'exchangeRates',      icon: 'trending-up-outline', color: '#0E7C7B', bg: '#E0F5F4', labelKey: 'menuExchangeRates'      },
  { id: 'newcomerEssentials', icon: 'compass-outline',     color: '#185FA5', bg: '#EEF2F8', labelKey: 'menuNewcomerEssentials' },
  { id: 'events',        icon: 'calendar-outline', color: '#5B5BD6', bg: '#EAE8F5', labelKey: 'menuEvents' },
  { id: 'accommodation', icon: 'home-outline',      color: '#0E7C7B', bg: '#E0F5F4', labelKey: 'menuAccommodations' },
  { id: 'pets',          icon: 'paw-outline',       color: '#D1495B', bg: '#FAEAEC', labelKey: 'menuPets' },
  { id: 'homeServices',  icon: 'hammer-outline',    color: '#FF8552', bg: '#FFF0EB', labelKey: 'menuHomeServices' },
  { id: 'jobPostings',  icon: 'briefcase-outline', color: '#0369A1', bg: '#E0F2FE', labelKey: 'menuJobPostings' },
  { id: 'beaches',       icon: 'umbrella-outline',  color: '#0E7C7B', bg: '#E0F5F4', labelKey: 'menuBeachesLandmarks' },
  { id: 'transport',     icon: 'car-outline',       color: '#5B5BD6', bg: '#EAE8F5', labelKey: 'menuTransportation' },
  { id: 'municipal',     icon: 'business-outline',  color: '#64748B', bg: '#F1F5F9', labelKey: 'menuMunicipalities' },
]

const RESULT_META = {
  medical:      { icon: 'medkit-outline',    color: '#0E7C7B', bg: '#E0F5F4' },
  events:       { icon: 'calendar-outline',  color: '#5B5BD6', bg: '#EAE8F5' },
  beach:        { icon: 'umbrella-outline',  color: '#0E7C7B', bg: '#E0F5F4' },
  landmark:     { icon: 'flag-outline',      color: '#FF8552', bg: '#FFF0EB' },
  homeServices: { icon: 'hammer-outline',    color: '#FF8552', bg: '#FFF0EB' },
  transport:    { icon: 'car-outline',       color: '#5B5BD6', bg: '#EAE8F5' },
  jobPostings:  { icon: 'briefcase-outline', color: '#0E7C7B', bg: '#E0F5F4' },
}

export default function HomeScreen({
  lang,
  facilities,
  dutyFacilityId,
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
  onShowBeachesLandmarks,
  onShowTransport,
  onShowEmergency,
  onShowMunicipal,
  onSelectPlace,
  onShowNewcomerEssentials,
  onShowExchangeRates,
}) {
  const [showFacilityList, setShowFacilityList] = useState(false)
  const [searchText, setSearchText]             = useState('')
  const [activeType, setActiveType]             = useState(null)
  const [activeSpecialty, setActiveSpecialty]   = useState(null)
  const [openOnly, setOpenOnly]                 = useState(false)
  const [showAll, setShowAll]                   = useState(false)
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
      user_lat: userLocation?.latitude  ?? null,
      user_lon: userLocation?.longitude ?? null,
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
      case 'beach': {
        const { data } = await supabase.from('beaches').select('*').eq('id', result.id).maybeSingle()
        if (data) onSelectPlace({ ...data, _type: 'beach' })
        break
      }
      case 'landmark': {
        const { data } = await supabase.from('landmarks').select('*').eq('id', result.id).maybeSingle()
        if (data) onSelectPlace({ ...data, _type: 'landmark' })
        break
      }
    }
  }

  const moduleHandlers = {
    exchangeRates:      onShowExchangeRates,
    newcomerEssentials: onShowNewcomerEssentials,
    events:             onShowEvents,
    accommodation:      onShowAccommodation,
    pets:               onShowPets,
    homeServices:       onShowHomeServices,
    jobPostings:        onShowJobPostings,
    beaches:            onShowBeachesLandmarks,
    transport:          onShowTransport,
    municipal:          onShowMunicipal,
  }

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
          const meta = RESULT_META[item.module] ?? { icon: 'search-outline', color: colors.textSecondary, bg: colors.cardBg }
          return (
            <TouchableOpacity key={item.id + idx} style={s.searchResultRow} onPress={() => handleResultPress(item)} activeOpacity={0.75}>
              <View style={[s.searchResultIcon, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon} size={18} color={meta.color} />
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
              <View style={[s.medicalTileIcon, { backgroundColor: colors.accentLight }]}>
                <Ionicons name="medical-outline" size={26} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.medicalTileTitle}>{t('tonightDuty', lang)}</Text>
                <Text style={s.medicalTileSub} numberOfLines={1}>{t('hubDutySub', lang)}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.accent} />
          </TouchableOpacity>

          <View style={s.quickRow}>
            <TouchableOpacity style={s.quickBtn} onPress={() => setShowFacilityList(true)} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="medkit-outline" size={22} color={colors.primary} />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('hubMedicalTitle', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.quickBtn} onPress={onShowEmergency} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: '#FAEAEC' }]}>
                <Ionicons name="call-outline" size={22} color={colors.danger} />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('menuEmergency', lang)}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.quickBtn} onPress={onShowEvents} activeOpacity={0.8}>
              <View style={[s.quickIcon, { backgroundColor: '#EAE8F5' }]}>
                <Ionicons name="calendar-outline" size={22} color="#5B5BD6" />
              </View>
              <Text style={s.quickLabel} numberOfLines={2}>{t('menuEvents', lang)}</Text>
            </TouchableOpacity>
          </View>

          <View style={s.moduleGrid}>
            {MODULES.map(mod => (
              <TouchableOpacity
                key={mod.id}
                style={s.moduleCard}
                onPress={moduleHandlers[mod.id]}
                activeOpacity={0.8}
              >
                <View style={[s.moduleIcon, { backgroundColor: mod.bg }]}>
                  <Ionicons name={mod.icon} size={24} color={mod.color} />
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
            {showAll && (
              <TouchableOpacity style={s.activeFilterPill} onPress={() => setShowAll(false)}>
                <Text style={s.activeFilterPillText}>{t('allFacilities', lang)}</Text>
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
          {!showAll && !searchText.trim() && facilities.some(f => !f.provider_id && (!activeType || f.type === activeType)) && (
            <TouchableOpacity style={s.hiddenFacHint} onPress={() => setShowAll(true)} activeOpacity={0.75}>
              <Ionicons name="eye-off-outline" size={11} color={colors.textSecondary} />
              <Text style={s.hiddenFacHintText} numberOfLines={1}>{t('hiddenFacilitiesHint', lang)}</Text>
            </TouchableOpacity>
          )}
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
            {[null, 'pharmacy', 'clinic', 'hospital', 'dentist'].map(type => (
              <TouchableOpacity
                key={type ?? 'all'}
                style={[s.typeChip, activeType === type && s.typeChipActive]}
                onPress={() => { setActiveType(type); setActiveSpecialty(null) }}
              >
                {type
                  ? <TypeSVGIcon type={type} size={14} color={activeType === type ? '#fff' : colors.textSecondary} />
                  : <Ionicons name="apps-outline" size={14} color={activeType === type ? '#fff' : colors.textSecondary} />
                }
                <Text style={[s.typeChipText, activeType === type && s.typeChipTextActive]}>
                  {type
                    ? t({ pharmacy: 'pharmacies', clinic: 'clinics', hospital: 'hospitals', dentist: 'dentists' }[type] || type, lang)
                    : t('all', lang)
                  }
                </Text>
              </TouchableOpacity>
            ))}
            <View style={s.chipDivider} />
            <TouchableOpacity
              style={[s.toggleChip, showAll && s.toggleChipShowAll]}
              onPress={() => setShowAll(v => !v)}
            >
              <Ionicons name={showAll ? 'eye' : 'eye-outline'} size={12} color={showAll ? colors.primary : colors.textSecondary} />
              <Text style={[s.toggleChipText, showAll && { color: colors.primary }]}>
                {showAll ? t('adaOnly', lang) : t('showAll', lang)}
              </Text>
            </TouchableOpacity>
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

        <TouchableOpacity style={s.dutyBanner} onPress={onShowDutyList} activeOpacity={0.8}>
          <View style={s.dutyBannerLeft}>
            <View style={s.dutyBannerIconWrap}>
              <Ionicons name="medical-outline" size={20} color={colors.accent} />
            </View>
            <View>
              <Text style={s.dutyBannerTitle}>{t('tonightDuty', lang)}</Text>
              <Text style={s.dutyBannerSub}>{t('allRegions', lang)}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.accent} />
        </TouchableOpacity>

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
                        {item.provider_id ? (
                          isOpen != null && (
                            <View style={[s.statusBadge, isOpen ? s.openBadge : s.closedBadge]}>
                              <Text style={[s.statusText, isOpen ? s.openText : s.closedText]}>
                                {isOpen ? t('open', lang) : t('closed', lang)}
                              </Text>
                            </View>
                          )
                        ) : (
                          <View style={s.notOnAdaBadge}>
                            <Text style={s.notOnAdaBadgeText}>{t('notOnAda', lang)}</Text>
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
      <SafeAreaView style={[s.safe, { backgroundColor: 'transparent' }]} edges={['top']}>
        <View style={s.container}>
          <View style={[s.header, showFacilityList && { justifyContent: 'space-between' }]}>
            {showFacilityList ? (
              <TouchableOpacity style={s.backPill} onPress={() => setShowFacilityList(false)}>
                <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
                <Text style={s.backPillText}>{t('back', lang)}</Text>
              </TouchableOpacity>
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
  backPill:       { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  backPillText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

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
  searchBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: colors.border },
  searchInput:        { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
  filterBar:          { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  filterBarContent:   { gap: 6, alignItems: 'center', paddingRight: 8 },
  activeFilterPill:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  activeFilterPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  filterToggleBtn:    { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', marginLeft: 6, flexShrink: 0 },
  filterToggleBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  hiddenFacHint:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, marginHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)', flexShrink: 1, maxWidth: 180 },
  hiddenFacHintText:  { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flexShrink: 1 },
  toggleChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  toggleChipText:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  toggleChipOpen:     { borderColor: colors.success, backgroundColor: colors.successLight },
  toggleChipShowAll:  { borderColor: colors.primary, backgroundColor: colors.primaryLight },
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
  notOnAdaBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.border },
  notOnAdaBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
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
