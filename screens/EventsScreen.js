import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Image, Dimensions, ActivityIndicator, RefreshControl, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { openTicketUrl } from '../utils/events'

const { width: SCREEN_W } = Dimensions.get('window')

// Consumer-grade filters. 'other' (legacy/uncategorised) events live under 'all' only.
const CATEGORIES = [
  { key: 'all',       labelKey: 'filterAll' },
  { key: 'concert',   labelKey: 'filterConcerts' },
  { key: 'festival',  labelKey: 'filterFestivals' },
  { key: 'nightlife', labelKey: 'filterNightlife' },
]

function categoryLabel(category, lang) {
  const map = { concert: 'catConcert', festival: 'catFestival', nightlife: 'catNightlife', other: 'catOther' }
  return t(map[category] || 'catOther', lang)
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

function EventCard({ event, lang, onPress }) {
  const img = event.images?.[0]
  const start = new Date(event.start_date)
  const day = start.toLocaleDateString('en-GB', { day: '2-digit' })
  const month = start.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.88}>
      <View style={s.cardImageWrap}>
        {img
          ? <Image source={{ uri: img }} style={s.cardImage} resizeMode="cover" />
          : <View style={[s.cardImage, s.cardImageFallback]}>
              <Ionicons name="calendar-outline" size={36} color={colors.border} />
            </View>
        }
        <View style={s.dateBadge}>
          <Text style={s.dateBadgeDay}>{day}</Text>
          <Text style={s.dateBadgeMonth}>{month}</Text>
        </View>
        {event.category && event.category !== 'other' ? (
          <View style={s.catBadge}>
            <Text style={s.catBadgeText}>{categoryLabel(event.category, lang)}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle} numberOfLines={2}>{event.title}</Text>
        {event.organizer_name ? (
          <View style={s.cardMeta}>
            <Ionicons name="business-outline" size={12} color={colors.textSecondary} />
            <Text style={s.cardMetaText} numberOfLines={1}>{event.organizer_name}</Text>
          </View>
        ) : null}
        {event.location ? (
          <View style={s.cardMeta}>
            <Feather name="map-pin" size={12} color={colors.textSecondary} />
            <Text style={s.cardMetaText} numberOfLines={1}>{event.location}</Text>
          </View>
        ) : null}
        {event.description ? (
          <Text style={s.cardDesc} numberOfLines={2}>{event.description}</Text>
        ) : null}
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

export default function EventsScreen({ lang, onBack }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [category, setCategory] = useState('all')

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

  const filtered = category === 'all' ? events : events.filter(e => e.category === category)

  useEffect(() => { load() }, [load])

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
          contentContainerStyle={s.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              <MascotIntroCard
                module="events"
                subtitle={t('eventsSubtitle', lang)}
                style={s.introCard}
              />
              <View style={s.filterRow}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.chip, category === c.key && s.chipActive]}
                    onPress={() => setCategory(c.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.chipText, category === c.key && s.chipTextActive]}>{t(c.labelKey, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent:        { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },

  // Filter chips
  introCard:          { marginBottom: 16 },
  filterRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  chip:               { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                        backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border },
  chipActive:         { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  chipTextActive:     { fontFamily: 'Inter_700Bold', color: colors.primary },

  // Category badge (on card image)
  catBadge:           { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.55)',
                        borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  catBadgeText:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.3 },

  // Card
  card:               { backgroundColor: colors.cardBg, borderRadius: 20, overflow: 'hidden', ...shadow },
  cardImageWrap:      { position: 'relative' },
  cardImage:          { width: '100%', height: 200 },
  cardImageFallback:  { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  dateBadge:          { position: 'absolute', top: 12, left: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', ...shadow },
  dateBadgeDay:       { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 22 },
  dateBadgeMonth:     { fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.5 },
  cardBody:           { padding: 16 },
  cardTitle:          { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8, lineHeight: 22 },
  cardMeta:           { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  cardMetaText:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flex: 1 },
  cardDesc:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 19, marginTop: 8 },

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
