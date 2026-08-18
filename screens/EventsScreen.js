import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView,
  Image, Dimensions, ActivityIndicator, RefreshControl, Linking,
  Modal, Platform, Animated, PanResponder,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow } from '../constants/theme'
import { t, tCity, LANG_CODES } from '../constants/i18n'
import { resolveRegion } from '../utils/resolveRegion'
import { openTicketUrl } from '../utils/events'
import BackButton from '../components/BackButton'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// Card height AND thumbnail edge — one number, because the thumbnail is a true
// square driven by the card height rather than by a width percentage. A percentage
// resolves against the card (SCREEN_W - 32), so `width: '42%'` + aspectRatio: 1
// yields a ~151pt square inside a ~158pt content column and leaves a white band
// under the image. Sizing from the height instead means the square always fills the
// card exactly. 160 lands at ~45% of the card on a 390pt screen and ~40% on a 430pt
// one. The content column below is tuned to sit just inside it (158pt).
const CARD_H = 160

// The square is a fixed 160pt, but the card is not — on a 375pt screen (iPhone SE)
// that is 47% of the card and on a 320pt one it would eat the title column alive.
// Cap it at 45% of the card width: mainstream devices (>= 390pt) are unaffected and
// stay exactly square, while narrow ones give up a few points of squareness instead
// of the text.
const THUMB_W = Math.min(CARD_H, (SCREEN_W - 32) * 0.45)

// Consumer-grade filters. One label key per category — the chip and the card
// badge share it.
const CATEGORIES = [
  { key: 'all',       labelKey: 'filterAll' },
  { key: 'music',     labelKey: 'catMusic' },
  { key: 'nightlife', labelKey: 'catNightlife' },
  { key: 'sports',    labelKey: 'catSports' },
  { key: 'arts',      labelKey: 'catArts' },
  { key: 'family',    labelKey: 'catFamily' },
  { key: 'other',     labelKey: 'catOther' },
]

// The retired keys still exist in the DB until the narrow migration runs, so
// Music matches them too. Dead once 20260724_events_category_narrow.sql is applied.
const LEGACY_MUSIC = ['concert', 'festival']

function matchesCategory(event, category) {
  if (category === 'all') return true
  if (category === 'music') return event.category === 'music' || LEGACY_MUSIC.includes(event.category)
  return event.category === category
}

function categoryLabel(category, lang) {
  const map = {
    music: 'catMusic', nightlife: 'catNightlife', sports: 'catSports',
    arts: 'catArts', family: 'catFamily', other: 'catOther',
    concert: 'catMusic', festival: 'catMusic',
  }
  return t(map[category] || 'catOther', lang)
}

// ─── Date filters ────────────────────────────────────────────────────────────

const DATE_FILTERS = [
  { key: 'all',     labelKey: 'filterAll' },
  { key: 'today',   labelKey: 'dateToday' },
  { key: 'weekend', labelKey: 'dateThisWeekend' },
  { key: 'week',    labelKey: 'dateThisWeek' },
  { key: 'month',   labelKey: 'dateThisMonth' },
]

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay   = d => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// Every window is anchored at today 00:00 rather than `now`, so an event that
// already started earlier today still matches — consistent with the feed's
// existing 24h grace on start_date.
function dateRange(key, pickedDate) {
  const today = startOfDay(new Date())
  const dow = today.getDay() // 0 = Sunday, 6 = Saturday

  switch (key) {
    case 'today':
      return { from: today, to: endOfDay(today) }

    // If we are already inside the weekend, this is the REMAINDER of it — on a
    // Sunday that means Sunday alone, never spilling into Monday. Otherwise it
    // is the next Sat + Sun.
    case 'weekend':
      if (dow === 6) return { from: today, to: endOfDay(addDays(today, 1)) }
      if (dow === 0) return { from: today, to: endOfDay(today) }
      return { from: addDays(today, 6 - dow), to: endOfDay(addDays(today, 7 - dow)) }

    // Monday-start week (TR convention), so it runs to the upcoming Sunday and
    // is a strict superset of 'weekend'.
    case 'week':
      return { from: today, to: endOfDay(addDays(today, dow === 0 ? 0 : 7 - dow)) }

    case 'month':
      return { from: today, to: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)) }

    case 'picked':
      return pickedDate ? { from: startOfDay(pickedDate), to: endOfDay(pickedDate) } : null

    default:
      return null
  }
}

function matchesDate(event, key, pickedDate) {
  const range = dateRange(key, pickedDate)
  if (!range) return true
  const s = new Date(event.start_date)
  return s >= range.from && s <= range.to
}

// Card-level time. Deliberately no all-day heuristic: a 00:00 start is real for
// nightlife, and blanking it would hide the time on exactly the events where it
// matters most. A bare timestamp in admin SQL is a data-entry bug, not a case to
// paper over here — write '2026-08-01 21:00+03', not '2026-08-01 21:00'.
function formatEventTime(start, end) {
  if (!start) return ''
  const opts = { hour: '2-digit', minute: '2-digit' }
  const s = new Date(start)
  const startStr = s.toLocaleTimeString('en-GB', opts)
  if (!end) return startStr
  const e = new Date(end)
  if (s.toDateString() !== e.toDateString()) return startStr
  return `${startStr} – ${e.toLocaleTimeString('en-GB', opts)}`
}

function priceLabel(event, lang) {
  if (event.price_text) return event.price_text
  if (event.price_from != null) return `${t('eventPriceFrom', lang)} ₺${event.price_from}`
  return null
}

function formatEventDate(start, end, lang) {
  if (!start) return ''
  const s = new Date(start)
  const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  const startStr = s.toLocaleString('en-GB', opts)
  if (!end) return startStr
  const e = new Date(end)
  const sameDay = s.toDateString() === e.toDateString()
  if (sameDay) {
    return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  }
  return `${startStr} – ${e.toLocaleString('en-GB', opts)}`
}

// `events` has no venue/city columns — the Gişe Kıbrıs import folds them into a
// single string as "Venue, City" (scripts/import-gisekibris-events.mjs). Split on
// the LAST ", " because the city is always the appended final segment, while a
// venue name may itself contain commas ("Rocks Hotel, Casino & Spa, Girne").
// Display-only; nothing is written back.
function venueCityLabel(location) {
  if (!location) return ''
  const i = location.lastIndexOf(', ')
  return i === -1 ? location : `${location.slice(0, i)} / ${location.slice(i + 2)}`
}

// Long-form card date, e.g. "22 Ağustos 2026". Locale comes from the app language
// rather than a hardcoded 'en-GB' — the month name is spelled out here, so an
// English month on a Turkish screen would read as a bug.
function formatCardDate(start, lang) {
  if (!start) return ''
  return new Date(start).toLocaleDateString(LANG_CODES[lang] || 'en',
    { day: 'numeric', month: 'long', year: 'numeric' })
}

function EventCard({ event, lang, onPress }) {
  const img = event.images?.[0]
  const venue = venueCityLabel(event.location)

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.88}>
      {img
        ? <Image source={{ uri: img }} style={s.thumb} resizeMode="cover" />
        : <View style={[s.thumb, s.thumbFallback]}>
            <Ionicons name="calendar-outline" size={32} color={colors.border} />
          </View>
      }
      <View style={s.cardBody}>
        {event.category ? (
          <>
            <Text style={s.catLabel} numberOfLines={1}>{categoryLabel(event.category, lang)}</Text>
            <View style={s.divider} />
          </>
        ) : null}
        <Text style={s.cardTitle} numberOfLines={2}>{event.title}</Text>
        <View style={s.divider} />
        {venue ? (
          <View style={s.infoRow}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={s.infoText} numberOfLines={1}>{venue}</Text>
          </View>
        ) : null}
        <View style={s.infoRow}>
          <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
          <Text style={s.infoText} numberOfLines={1}>{formatCardDate(event.start_date, lang)}</Text>
        </View>
        <View style={s.infoRow}>
          <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
          <Text style={s.infoText} numberOfLines={1}>
            {formatEventTime(event.start_date, event.end_date)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ─── Fullscreen image viewer ─────────────────────────────────────────────────

// No pinch-zoom: react-native-gesture-handler is not a dependency of this app and
// adding it would force a native build. Tap / swipe-down / Android back all close.
// PanResponder is core RN, so this whole viewer ships over the air.
function ImageViewer({ images, startIndex, onClose }) {
  const insets = useSafeAreaInsets()
  const [page, setPage] = useState(startIndex)
  const dragY = useRef(new Animated.Value(0)).current

  // The PanResponder is built once, so it would capture the first onClose forever.
  // A ref keeps it pointed at the current one.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const responder = useRef(
    PanResponder.create({
      // Axis lock: only claim a clearly vertical drag, so a horizontal swipe still
      // reaches the pager underneath on multi-image events.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) * 1.5 && Math.abs(g.dy) > 10,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy) },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) { closeRef.current(); return }
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start()
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start()
      },
    })
  ).current

  // Backdrop thins out as the poster is dragged away, so the dismiss reads as a
  // gesture rather than a jump cut.
  const backdropOpacity = dragY.interpolate({
    inputRange: [0, 250], outputRange: [1, 0.2], extrapolate: 'clamp',
  })

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[s.viewerBackdrop, { opacity: backdropOpacity }]} />

      <Animated.View
        style={[s.viewerStage, { transform: [{ translateY: dragY }] }]}
        {...responder.panHandlers}
      >
        {images.length > 1 ? (
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, i) => String(i)}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
            onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={1} onPress={onClose}>
                <Image source={{ uri: item }} style={s.viewerImage} resizeMode="contain" />
              </TouchableOpacity>
            )}
          />
        ) : (
          <TouchableOpacity activeOpacity={1} onPress={onClose}>
            <Image source={{ uri: images[0] }} style={s.viewerImage} resizeMode="contain" />
          </TouchableOpacity>
        )}
      </Animated.View>

      <TouchableOpacity
        style={[s.viewerClose, { top: insets.top + 8 }]}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={24} color="#fff" />
      </TouchableOpacity>

      {images.length > 1 && (
        <View style={[s.viewerCounter, { bottom: insets.bottom + 24 }]}>
          <Text style={s.viewerCounterText}>{page + 1} / {images.length}</Text>
        </View>
      )}
    </Modal>
  )
}

// ─── Event Detail ────────────────────────────────────────────────────────────

// Hero aspect clamp. 3:4 stops a very tall poster from eating the whole screen
// before the title is reachable; 16/9 stops a panorama from becoming a letterbox
// strip. Real content sits at 1:1 (66 of the 68 measured partner posters), which is
// also the default below — so the adaptive resize is invisible on almost everything
// and only moves for organizer uploads.
const HERO_MIN_RATIO = 3 / 4
const HERO_MAX_RATIO = 16 / 9

function EventDetailScreen({ event, lang, onBack }) {
  const [imgIndex, setImgIndex] = useState(0)
  const [viewerIndex, setViewerIndex] = useState(null)
  const [heroRatio, setHeroRatio] = useState(1)
  const images = event.images ?? []

  // Size the hero to the images themselves so nothing crops AND nothing pillarboxes.
  // The pager is one height, so with several images the container takes the TALLEST
  // (smallest ratio) and the wider ones letterbox inside it — unavoidable with a
  // single-height pager, and moot for partner events, which carry exactly one image.
  // Starting at 1 means the ~97% of events that are square never visibly resize.
  useEffect(() => {
    const urls = event.images ?? []
    if (!urls.length) return
    let cancelled = false
    let smallest = Infinity
    let done = 0
    const settle = () => {
      if (cancelled || ++done < urls.length || !Number.isFinite(smallest)) return
      setHeroRatio(Math.min(HERO_MAX_RATIO, Math.max(HERO_MIN_RATIO, smallest)))
    }
    urls.forEach(uri => {
      Image.getSize(
        uri,
        (w, h) => { if (h > 0) smallest = Math.min(smallest, w / h); settle() },
        settle,   // unreachable image keeps the 1:1 default rather than blocking
      )
    })
    return () => { cancelled = true }
  }, [event.id])

  const hasCoords = event.latitude != null && event.longitude != null
  const price = priceLabel(event, lang)

  function openMaps() {
    if (hasCoords) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`)
      return
    }
    if (event.location_url) { Linking.openURL(event.location_url); return }
    if (event.location) Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(event.location)}`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.detailHeader}>
        <BackButton lang={lang} onPress={onBack} style={s.backPill} />
      </View>

      <FlatList
        data={[{ key: 'detail' }]}
        keyExtractor={i => i.key}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View>
            {images.length > 0 ? (
              <View>
                <FlatList
                  data={images}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(_, i) => String(i)}
                  onMomentumScrollEnd={e => {
                    setImgIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))
                  }}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setViewerIndex(index)}
                      accessibilityRole="imagebutton"
                    >
                      <Image
                        source={{ uri: item }}
                        style={[s.detailImage, { aspectRatio: heroRatio }]}
                        resizeMode="contain"
                      />
                    </TouchableOpacity>
                  )}
                />
                {images.length > 1 && (
                  <View style={s.dotRow}>
                    {images.map((_, i) => (
                      <View key={i} style={[s.dot, i === imgIndex && s.dotActive]} />
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={s.detailImageFallback}>
                <Ionicons name="calendar-outline" size={56} color={colors.border} />
              </View>
            )}

            <View style={s.detailBody}>
              <Text style={s.detailTitle}>{event.title}</Text>

              {event.organizer_name ? (
                <View style={s.detailRow}>
                  <View style={s.detailIconWrap}>
                    <Ionicons name="business-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailRowLabel}>{t('eventOrganiser', lang)}</Text>
                    <Text style={s.detailRowValue}>{event.organizer_name}</Text>
                  </View>
                </View>
              ) : null}

              <View style={s.detailRow}>
                <View style={s.detailIconWrap}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.detailRowLabel}>{t('eventDate', lang)}</Text>
                  <Text style={s.detailRowValue}>{formatEventDate(event.start_date, event.end_date)}</Text>
                </View>
              </View>

              {event.location ? (
                <TouchableOpacity style={s.detailRow} onPress={openMaps} activeOpacity={0.75}>
                  <View style={s.detailIconWrap}>
                    <Feather name="map-pin" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailRowLabel}>{t('eventLocation', lang)}</Text>
                    <Text style={[s.detailRowValue, { color: colors.primary }]}>{event.location}</Text>
                  </View>
                  <Feather name="external-link" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}

              {price ? (
                <View style={s.detailRow}>
                  <View style={s.detailIconWrap}>
                    <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailRowLabel}>{t('eventPrice', lang)}</Text>
                    <Text style={s.detailRowValue}>{price}</Text>
                  </View>
                </View>
              ) : null}

              {event.description ? (
                <View style={s.descBlock}>
                  <Text style={s.descTitle}>{t('aboutThisEvent', lang)}</Text>
                  <Text style={s.descText}>{event.description}</Text>
                </View>
              ) : null}

              {event.ticket_url ? (
                <TouchableOpacity style={s.buyBtn} onPress={() => openTicketUrl(event)} activeOpacity={0.85}>
                  <Ionicons name="ticket-outline" size={18} color="#fff" />
                  <Text style={s.buyBtnText}>{t('eventBuyTicket', lang)}</Text>
                  <Feather name="external-link" size={15} color="#fff" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />

      {viewerIndex != null && (
        <ImageViewer
          images={images}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Events Feed ─────────────────────────────────────────────────────────────

export { EventDetailScreen }

// `initialDistrict` is a canonical region slug, set when the user arrives from a
// city-welcome card. The events table has no district column — only lat/lng — so
// the district is derived from the coordinates with resolveRegion. An event with
// no coordinates cannot be placed, so it drops out while a district filter is on.
export default function EventsScreen({ lang, onBack, initialDistrict = null }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [category, setCategory] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [pickedDate, setPickedDate] = useState(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [district, setDistrict] = useState(initialDistrict)
  const insets = useSafeAreaInsets()

  const load = useCallback(async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('events')
      .select('id, title, description, images, start_date, end_date, location, location_url, organizer_name, category, ticket_url, latitude, longitude, price_from, price_text')
      .eq('status', 'approved')
      .gte('start_date', cutoff)
      .order('start_date', { ascending: true })
    setEvents(data ?? [])
    setLoading(false)
  }, [])

  const filtered = events
    .filter(e => matchesCategory(e, category))
    .filter(e => matchesDate(e, dateFilter, pickedDate))
    .filter(e => !district || resolveRegion(e.latitude, e.longitude) === district)

  useEffect(() => { load() }, [load])

  // Single date step only — unlike the organizer form, filtering to a day has no
  // time component, so there is no date→time chain here. Android keeps the
  // imperative DateTimePickerAndroid.open call; iOS gets the inline sheet.
  function openDatePicker() {
    if (Platform.OS !== 'android') { setShowDatePicker(true); return }
    DateTimePickerAndroid.open({
      value: pickedDate ?? new Date(),
      mode: 'date',
      display: 'spinner',
      minimumDate: startOfDay(new Date()),
      onChange: (_, selected) => {
        if (!selected) return
        setPickedDate(selected)
        setDateFilter('picked')
      },
    })
  }

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <View style={s.root}>
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="events" />
      <ScreenHeader onBack={onBack} title={t('eventsTitle', lang)} lang={lang} />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 96 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              <MascotIntroCard
                module="events"
                subtitle={t('eventsSubtitle', lang)}
                style={s.introCard}
              />
              {district ? (
                <TouchableOpacity
                  style={s.districtPill}
                  onPress={() => setDistrict(null)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Feather name="map-pin" size={13} color={colors.primary} />
                  <Text style={s.districtPillText}>{tCity('cwEventsFiltered', district, lang)}</Text>
                  <Text style={s.districtPillClear}>{t('cwClearFilter', lang)}</Text>
                  <Feather name="x" size={13} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.filterScroll}
                contentContainerStyle={s.filterRow}
              >
                {/* Tapping the active chip clears it. 'all' is the cleared value, not a
                    seventh category — matchesCategory short-circuits on it — so
                    deselecting lands on the All chip rather than an empty state, and
                    tapping All itself stays the no-op it already was. */}
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.chip, category === c.key && s.chipActive]}
                    onPress={() => setCategory(category === c.key ? 'all' : c.key)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[s.chipText, category === c.key && s.chipTextActive]}
                      numberOfLines={1}
                    >
                      {t(c.labelKey, lang)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.filterScrollSecond}
                contentContainerStyle={s.filterRow}
              >
                {/* Same toggle-off as the category row. The picked-date chip below this
                    map is deliberately NOT toggled: tapping it while active re-opens
                    the picker, because changing the date is the likelier intent there
                    and All already clears it in one tap. */}
                {DATE_FILTERS.map(d => (
                  <TouchableOpacity
                    key={d.key}
                    style={[s.chip, dateFilter === d.key && s.chipActive]}
                    onPress={() => setDateFilter(dateFilter === d.key ? 'all' : d.key)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[s.chipText, dateFilter === d.key && s.chipTextActive]}
                      numberOfLines={1}
                    >
                      {t(d.labelKey, lang)}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[s.chip, s.chipWithIcon, dateFilter === 'picked' && s.chipActive]}
                  onPress={openDatePicker}
                  activeOpacity={0.8}
                >
                  <Feather
                    name="calendar"
                    size={12}
                    color={dateFilter === 'picked' ? colors.primary : colors.textSecondary}
                  />
                  <Text
                    style={[s.chipText, dateFilter === 'picked' && s.chipTextActive]}
                    numberOfLines={1}
                  >
                    {dateFilter === 'picked' && pickedDate
                      ? pickedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      : t('datePickDate', lang)}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <View style={s.emptyCard}>
                <Ionicons name="calendar-outline" size={48} color={colors.border} style={{ marginBottom: 12 }} />
                <Text style={s.emptyText}>{t('noUpcomingEvents', lang)}</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <EventCard event={item} lang={lang} onPress={() => setSelectedEvent(item)} />
          )}
        />
      )}

      {/* iOS gets an inline sheet; Android is handled imperatively in
          openDatePicker. This Modal covers the Ask Oli FAB while open, which is
          the accepted trade for a picker (see the SheetOverlay convention). */}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowDatePicker(false)}>
          <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setShowDatePicker(false)} />
          <View style={s.pickerSheet}>
            <View style={s.pickerSheetHeader}>
              <Text style={s.pickerSheetTitle}>{t('datePickDate', lang)}</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={s.pickerDoneText}>{t('done', lang)}</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={pickedDate ?? new Date()}
              mode="date"
              display="spinner"
              minimumDate={startOfDay(new Date())}
              onChange={(_, date) => {
                if (!date) return
                setPickedDate(date)
                setDateFilter('picked')
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        </Modal>
      )}
    </SafeAreaView>

    {/* Sibling of the SafeAreaView, not a child: absolute children offset from the
        parent's PADDING box, so nesting this inside edges={['top']} would apply the
        top inset here and again in EventDetailScreen's own SafeAreaView. Rendering
        the detail over the list instead of in place of it is the whole fix for the
        lost scroll position — the FlatList is never unmounted, so its native scroll
        offset survives the round trip. */}
    {selectedEvent && (
      <View style={s.detailOverlay}>
        <EventDetailScreen event={selectedEvent} lang={lang} onBack={() => setSelectedEvent(null)} />
      </View>
    )}
    </View>
  )
}

const s = StyleSheet.create({
  root:               { flex: 1, backgroundColor: colors.bg },
  safe:               { flex: 1, backgroundColor: colors.bg },
  // zIndex AND elevation: Android can draw by elevation instead of paint order, and
  // the list underneath is full of elevation-3 cards that would punch through.
  detailOverlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg,
                        zIndex: 10, elevation: 10 },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // paddingBottom is applied inline from the safe-area inset — see the FlatList.
  listContent:        { paddingHorizontal: 16, gap: 16 },

  // Filter chips
  introCard:          { marginBottom: 16 },
  districtPill:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                        backgroundColor: colors.primaryLight, borderRadius: 20,
                        paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10 },
  districtPillText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  districtPillClear:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  // Negative margin cancels listContent's 16pt inset so the row bleeds to the
  // screen edge — the half-cut chip is what signals there is more to scroll.
  filterScroll:       { flexGrow: 0, flexShrink: 0, marginHorizontal: -16 },
  filterScrollSecond: { flexGrow: 0, flexShrink: 0, marginHorizontal: -16, marginTop: 8 },
  filterRow:          { flexDirection: 'row', gap: 8, paddingTop: 4, paddingHorizontal: 16 },
  chip:               { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                        backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipWithIcon:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipActive:         { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:     { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Date picker sheet (iOS) — mirrors the OrganizerScreen picker.
  pickerBackdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet:        { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.cardBg,
                        borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  pickerSheetHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                        paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerSheetTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  pickerDoneText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },

  // Card — horizontal: square poster flush left, content column right.
  // minHeight keeps every card the same height in the list even when a row is
  // missing its category or location, so the thumbnail column stays even and
  // square. Content sums to 158 (20 padding + 16 label + 11 rule + 40 title
  // + 11 rule + 60 rows), 2pt inside CARD_H.
  card:               { flexDirection: 'row', backgroundColor: colors.cardBg, borderRadius: 20,
                        overflow: 'hidden', minHeight: CARD_H, ...shadow },
  // Square container to match the sources. MEASURED, not assumed: 66 of the 68
  // readable Gişe Kıbrıs posters are exactly 1:1, two are 3:4 — none are portrait,
  // so a stretched non-square container would cover-crop ~15% off each side of
  // almost every poster, and poster text runs edge to edge.
  // alignSelf: 'stretch' rather than a fixed height, so if accessibility font
  // scaling pushes the content past CARD_H the thumbnail grows with the card and
  // crops slightly instead of leaving a white gap under itself.
  thumb:              { width: THUMB_W, alignSelf: 'stretch' },
  thumbFallback:      { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  cardBody:           { flex: 1, paddingHorizontal: 13, paddingVertical: 10, justifyContent: 'center' },
  // No textTransform: 'uppercase' — it mangles Turkish ("Diğer" → "DIĞER", not
  // "DİĞER") and Greek accents. letterSpacing carries the same small-label read
  // across all nine locales.
  catLabel:           { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_700Bold',
                        color: colors.primary, letterSpacing: 0.6 },
  divider:            { height: 1, backgroundColor: colors.border, marginVertical: 5 },
  // minHeight reserves both lines so a one-line title does not shorten the card.
  cardTitle:          { fontSize: 14, lineHeight: 20, minHeight: 40,
                        fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  infoRow:            { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  infoText:           { fontSize: 11.5, lineHeight: 17, fontFamily: 'Inter_400Regular',
                        color: colors.textSecondary, flex: 1 },

  // Detail
  detailHeader:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  backPill:           { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFFFFF',
                        borderRadius: 22, paddingHorizontal: 10, paddingVertical: 6 },
  // No fixed height — aspectRatio is set inline from the measured image, and
  // resizeMode is contain, so the poster is never cropped. backgroundColor is the
  // ground for the residual letterbox when a pager holds mixed ratios.
  detailImage:        { width: SCREEN_W, backgroundColor: colors.bg },
  detailImageFallback:{ height: 200, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  dotRow:             { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  dot:                { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive:          { backgroundColor: colors.primary, width: 18 },
  detailBody:         { padding: 20 },
  detailTitle:        { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5, marginBottom: 20, lineHeight: 30 },
  detailRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  detailIconWrap:     { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  detailRowLabel:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  detailRowValue:     { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },
  descBlock:          { marginTop: 8, padding: 16, backgroundColor: colors.bg, borderRadius: 14 },
  descTitle:          { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  descText:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },

  // Fullscreen viewer
  viewerBackdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.94)' },
  viewerStage:        { flex: 1, justifyContent: 'center' },
  viewerImage:        { width: SCREEN_W, height: SCREEN_H },
  viewerClose:        { position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
                        backgroundColor: 'rgba(255,255,255,0.16)', justifyContent: 'center', alignItems: 'center' },
  viewerCounter:      { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)',
                        borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  viewerCounterText:  { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Buy Ticket CTA
  buyBtn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                        backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, marginTop: 20, ...shadow },
  buyBtnText:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.2 },

  // Empty
  emptyWrap:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyCard:          { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyText:          { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
