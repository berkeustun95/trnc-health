import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView,
  Image, Dimensions, ActivityIndicator, RefreshControl, Linking,
  Modal, Platform,
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

const { width: SCREEN_W } = Dimensions.get('window')

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

// ─── Event Detail ────────────────────────────────────────────────────────────

function EventDetailScreen({ event, lang, onBack }) {
  const [imgIndex, setImgIndex] = useState(0)
  const images = event.images ?? []

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
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
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
                  renderItem={({ item }) => (
                    <Image source={{ uri: item }} style={s.detailImage} resizeMode="cover" />
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

  if (selectedEvent) {
    return <EventDetailScreen event={selectedEvent} lang={lang} onBack={() => setSelectedEvent(null)} />
  }

  return (
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
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.chip, category === c.key && s.chipActive]}
                    onPress={() => setCategory(c.key)}
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
                {DATE_FILTERS.map(d => (
                  <TouchableOpacity
                    key={d.key}
                    style={[s.chip, dateFilter === d.key && s.chipActive]}
                    onPress={() => setDateFilter(d.key)}
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
  )
}

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
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
  detailImage:        { width: SCREEN_W, height: 280 },
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

  // Buy Ticket CTA
  buyBtn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                        backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, marginTop: 20, ...shadow },
  buyBtnText:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.2 },

  // Empty
  emptyWrap:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyCard:          { backgroundColor: colors.cardBg, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', ...shadow },
  emptyText:          { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center' },
})
