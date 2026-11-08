// Explore landing, sectioned (stage 3, 2026-11-07): Bu hafta · Yakınımda · Müzeler & Ören Yerleri ·
// Plajlar · Yürüyüş Rotaları, then the category tiles. A section with nothing in it is not drawn.
// Places come from ExploreScreen (already loaded, RLS-filtered); events and routes are read here.
import { useState, useEffect, useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { GROUP_META, categoryToGroup } from '../constants/exploreCategories'
import { eventsInRange, eventIcon } from '../constants/mapEvents'
import { maybeListedFilter } from '../utils/eventVisibility'
import { haversineKm } from '../utils/facilityUtils'
import { officialVisitView } from '../utils/officialVisit'
import { formatPetDate } from '../constants/petsContent'
import { EXPLORE_ROUTES_LIVE } from '../constants/flags'
import { SectionHeader, RemoteImage } from './ui'
import { useScrollMemory } from '../utils/scrollMemory'
import { EVENT_INK } from './MapEvents'
import { routeName } from './WalkingRoutes'
import { withReadableTitle } from '../utils/readableTitle'

const ROW_MAX = 10
const NEAR_KM = 25

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const km = (d, lang) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0).replace('.', lang === 'en' ? '.' : ',')} km`)

function Tile({ photo, icon, iconInk, title, meta, metaInk, onPress }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={press.card} accessibilityRole="button" accessibilityLabel={title}>
      {photo
        ? <RemoteImage source={{ uri: photo }} style={s.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
        : <View style={[s.photo, s.photoIcon]}><Ionicons name={icon} size={28} color={iconInk || colors.textSecondary} /></View>}
      <View style={s.body}>
        <Text style={s.title} numberOfLines={2}>{title}</Text>
        {!!meta && <Text style={[s.meta, metaInk && { color: metaInk }]} numberOfLines={1}>{meta}</Text>}
      </View>
    </TouchableOpacity>
  )
}

function Row({ title, action, children }) {
  return (
    <View>
      <View style={s.headPad}><SectionHeader title={title} action={action} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>{children}</ScrollView>
    </View>
  )
}

export default function ExploreSections({ places, userLocation, lang, placeName, categoryLabel, onSelectPlace,
  onSelectEvent, onOpenMapEvents, onOpenRoutes, onOpenOfficial, onOpenGroup, children }) {
  const [events, setEvents] = useState([])
  const [routes, setRoutes] = useState([])
  useEffect(() => {
    let active = true
    if (onSelectEvent) {
      supabase.from('events')
        .select('id, title, description, images, start_date, end_date, location, location_url, organizer_name, category, ticket_url, latitude, longitude, price_from, price_text')
        .eq('status', 'approved').or(maybeListedFilter(new Date())).order('start_date', { ascending: true })
        .then(({ data, error }) => { if (active && !error) setEvents((data ?? []).map(withReadableTitle)) })
    }
    if (EXPLORE_ROUTES_LIVE && onOpenRoutes) {
      supabase.from('walking_routes').select('id, region, name_i18n, sort_order, walking_route_stops(place_id)')
        .eq('is_active', true).order('sort_order', { ascending: true })
        .then(({ data, error }) => { if (active && !error) setRoutes(data ?? []) })
    }
    return () => { active = false }
  }, [])

  // Bu hafta: every listed event this week, pinnable or not (the list is not the map).
  const week = useMemo(() => {
    const withCoords = events.map(e => (Number.isFinite(e.latitude) ? e : { ...e, latitude: 0, longitude: 0 }))
    const ids = new Set(eventsInRange(withCoords, 'week').map(e => e.id))
    return events.filter(e => ids.has(e.id)).slice(0, ROW_MAX)
  }, [events])

  const near = useMemo(() => {
    if (!userLocation) return []
    return places
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => ({ p, d: haversineKm(userLocation.latitude, userLocation.longitude, p.latitude, p.longitude) }))
      .filter(x => x.d <= NEAR_KM)
      .sort((a, b) => a.d - b.d)
      .slice(0, ROW_MAX)
  }, [places, userLocation])

  const museums = useMemo(() => places.filter(p => p.official_visit && p.official_visit.status !== 'closed').slice(0, ROW_MAX), [places])
  const beaches = useMemo(() => places.filter(p => p.category === 'beach').slice(0, ROW_MAX), [places])
  const photoOf = p => p.cover_image_url || p.photos?.[0] || null
  const iconOf = p => GROUP_META[categoryToGroup(p.category)]?.icon || 'location-outline'
  const seeAll = onPress => ({ label: t('filterAll', lang), onPress })
  // The landing keeps its place when a place, event or category opened from it closes (as GroupTiles did).
  const mem = useScrollMemory('explore:tiles')

  return (
    <ScrollView {...mem} contentContainerStyle={s.wrap} showsVerticalScrollIndicator={false}>
      {week.length > 0 && (
        <Row title={t('dateThisWeek', lang)} action={onOpenMapEvents ? { label: t('exploreViewMap', lang), onPress: onOpenMapEvents } : undefined}>
          {week.map(e => {
            const st = new Date(e.start_date)
            return (
              <Tile key={e.id} photo={e.images?.[0]} icon={eventIcon(e.category)} iconInk={EVENT_INK} title={e.title}
                meta={`${formatPetDate(st, lang)} · ${hhmm(st)}`} metaInk={EVENT_INK} onPress={() => onSelectEvent(e)} />
            )
          })}
        </Row>
      )}
      {near.length > 0 && (
        <Row title={t('exploreSecNear', lang)}>
          {near.map(({ p, d }) => (
            <Tile key={p.id} photo={photoOf(p)} icon={iconOf(p)} title={placeName(p, lang)}
              meta={`${km(d, lang)} · ${categoryLabel(p.category, lang)}`} onPress={() => onSelectPlace(p)} />
          ))}
        </Row>
      )}
      {museums.length > 0 && (
        <Row title={t('exploreSecMuseums', lang)} action={onOpenOfficial ? seeAll(onOpenOfficial) : undefined}>
          {museums.map(p => {
            const fee = officialVisitView(p.official_visit)?.fee
            const feeText = fee ? (fee.full === 0 && fee.student === 0 ? t('ovFree', lang) : `${fee.full} TL`) : categoryLabel(p.category, lang)
            return <Tile key={p.id} photo={photoOf(p)} icon={iconOf(p)} title={placeName(p, lang)} meta={feeText} onPress={() => onSelectPlace(p)} />
          })}
        </Row>
      )}
      {beaches.length > 0 && (
        <Row title={t('blFilterBeaches', lang)} action={onOpenGroup ? seeAll(() => onOpenGroup('nature')) : undefined}>
          {beaches.map(p => (
            <Tile key={p.id} photo={photoOf(p)} icon={iconOf(p)} title={placeName(p, lang)}
              meta={p.blue_flag ? t('blBlueFlagLabel', lang) : categoryLabel(p.category, lang)} onPress={() => onSelectPlace(p)} />
          ))}
        </Row>
      )}
      {routes.length > 0 && (
        <Row title={t('routesChip', lang)} action={{ label: t('exploreViewMap', lang), onPress: () => onOpenRoutes() }}>
          {routes.map(r => (
            <Tile key={r.id} icon="walk" iconInk={colors.primaryDark} title={routeName(r, lang)}
              meta={t('exploreRouteStops', lang).replace('{n}', r.walking_route_stops?.length ?? 0)} onPress={() => onOpenRoutes()} />
          ))}
        </Row>
      )}
      <View style={s.headPad}><SectionHeader title={t('exploreSecCategories', lang)} /></View>
      {children}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap:      { paddingBottom: 32 },
  headPad:   { paddingHorizontal: 16 },
  row:       { paddingHorizontal: 16, gap: 10 },
  tile:      { width: 168, backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden', ...elevation.card },
  photo:     { width: '100%', height: 104, backgroundColor: colors.border },
  photoIcon: { backgroundColor: colors.pageBase, alignItems: 'center', justifyContent: 'center' },
  body:      { padding: 10, gap: 3, minHeight: 66 },
  title:     { ...type.rowTitle, fontSize: 14, color: colors.textPrimary },
  meta:      { ...type.small, color: colors.textSecondary },
})
