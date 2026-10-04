// Recent check-ins (CHECKINS gate): one place's (inside the place page's scroll) or every
// place's (the Keşfet tab's "Son Check-in'ler"). Who appears is decided by get_checkin_feed()
// in 20261078 — the author's switch, blocks both ways, bans; guests are refused there, so
// they get a sign-in prompt here. Feeds only: no row opens a person, by decision (2026-10-02).
import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase, isGuest } from '../../lib/supabase'
import Avatar, { prefetchAvatars } from '../Avatar'
import { loadFeed, agoParts } from '../../utils/checkins'
import { Button, EmptyState, ErrorState } from '../ui'
import { CARD_BG } from '../ui/ModuleScreen'
import { colors, type, radii, press } from '../../constants/theme'
import { t, tCount, LANG_CODES } from '../../constants/i18n'

function placeLabel(row, lang) {
  const code = LANG_CODES[lang] ?? lang
  const i18n = row.place_name_i18n
  return (i18n && (i18n[code] ?? i18n.en)) || row.place_name || ''
}

function ago(iso, lang) {
  const { key, n } = agoParts(iso)
  if (key === 'checkinAgoNow') return t('checkinAgoNow', lang)
  if (key === 'date') return new Date(iso).toLocaleDateString(LANG_CODES[lang] ?? 'en', { day: 'numeric', month: 'short' })
  return tCount(key, n, lang)
}

function FeedRow({ row, lang, showPlace, onOpenPlace }) {
  const name = row.is_mine ? `${row.display_name} · ${t('checkinYou', lang)}` : row.display_name
  const when = ago(row.created_at, lang)
  const body = (
    <View style={s.row}>
      <Avatar avatarUrl={row.avatar_url} initials={row.display_name?.[0]?.toUpperCase() ?? '?'} size={40} textSize={16} />
      <View style={s.rowText}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        {showPlace && (
          <View style={s.placeLine}>
            <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
            <Text style={s.place} numberOfLines={1}>{placeLabel(row, lang)}</Text>
          </View>
        )}
      </View>
      <Text style={s.when}>{when}</Text>
    </View>
  )
  if (!showPlace || !onOpenPlace) return body
  return (
    <TouchableOpacity onPress={() => onOpenPlace(row.place_id)} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={`${row.display_name}, ${placeLabel(row, lang)}, ${when}`}>
      {body}
    </TouchableOpacity>
  )
}

// Page state shared by both layouts. A page that comes back full may have more behind it.
function useFeed(placeId, enabled, refreshKey) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')   // loading | ready | error
  const [code, setCode] = useState(null)          // the error's code: 'NETWORK' = really offline
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)

  const first = useCallback(async () => {
    setState('loading')
    const res = await loadFeed(supabase, { placeId })
    if (!res.ok) { setCode(res.code); setState('error'); return }
    prefetchAvatars(res.rows.map(r => r.avatar_url))
    setRows(res.rows); setMore(res.more); setState('ready')
  }, [placeId])

  useEffect(() => { if (enabled) first() }, [enabled, first, refreshKey])

  const next = useCallback(async () => {
    if (busy || !more || !rows.length) return
    setBusy(true)
    const res = await loadFeed(supabase, { placeId, before: rows[rows.length - 1] })
    setBusy(false)
    if (!res.ok) return
    prefetchAvatars(res.rows.map(r => r.avatar_url))
    setRows(r => [...r, ...res.rows]); setMore(res.more)
  }, [busy, more, rows, placeId])

  return { rows, state, code, more, busy, first, next }
}

// "Check your connection" (ErrorState's default) only when the request never reached a server.
function FeedError({ code, lang, onRetry }) {
  return <ErrorState lang={lang} onRetry={onRetry} message={code === 'NETWORK' ? undefined : t('checkinFeedFailed', lang)} />
}

function GuestPrompt({ lang, onRequireAccount }) {
  return (
    <View style={s.guest}>
      <Text style={s.guestText}>{t('checkinFeedGuest', lang)}</Text>
      <Button variant="secondary" title={t('checkinSignIn', lang)} onPress={() => onRequireAccount?.('checkinGuestGate')} />
    </View>
  )
}

// Inside the place page's ScrollView: plain Views, a "show more" button instead of endless scroll.
export function PlaceCheckins({ placeId, session, lang, onRequireAccount, refreshKey, style }) {
  const guest = !session || isGuest(session)
  const { rows, state, code, more, busy, first, next } = useFeed(placeId, !guest, refreshKey)
  return (
    <View style={style}>
      <Text style={s.title}>{t('checkinPlaceTitle', lang)}</Text>
      {guest ? <GuestPrompt lang={lang} onRequireAccount={onRequireAccount} />
        : state === 'loading' ? <ActivityIndicator color={colors.primary} style={s.spinner} />
        : state === 'error' ? <FeedError code={code} lang={lang} onRetry={first} />
        : rows.length === 0 ? <Text style={s.empty}>{t('checkinPlaceEmpty', lang)}</Text>
        : (
          <View style={s.card}>
            {rows.map((r, i) => (
              <View key={r.checkin_id} style={i > 0 && s.divider}>
                <FeedRow row={r} lang={lang} showPlace={false} />
              </View>
            ))}
            {more && <Button variant="text" title={t('checkinShowMore', lang)} onPress={next} loading={busy} />}
          </View>
        )}
    </View>
  )
}

// The Keşfet tab's "Son Check-in'ler": every place, endless scroll. Tapping a row opens the place.
export function AllCheckins({ session, lang, onRequireAccount, onOpenPlace, contentStyle }) {
  const guest = !session || isGuest(session)
  const { rows, state, code, more, busy, first, next } = useFeed(null, !guest, 0)
  if (guest) return <View style={contentStyle}><View style={[s.feedCard, s.guestCard]}><GuestPrompt lang={lang} onRequireAccount={onRequireAccount} /></View></View>
  if (state === 'loading') return <ActivityIndicator color={colors.primary} style={s.spinner} />
  if (state === 'error') return <View style={contentStyle}><FeedError code={code} lang={lang} onRetry={first} /></View>
  return (
    <FlatList
      data={rows}
      keyExtractor={r => r.checkin_id}
      contentContainerStyle={contentStyle}
      showsVerticalScrollIndicator={false}
      onEndReached={next}
      onEndReachedThreshold={0.5}
      refreshing={false}
      onRefresh={first}
      ListEmptyComponent={<EmptyState icon="location-outline" category="explore" title={t('checkinFeedEmpty', lang)} />}
      ListFooterComponent={busy ? <ActivityIndicator color={colors.primary} style={s.spinner} /> : null}
      renderItem={({ item }) => (
        <View style={s.feedCard}>
          <FeedRow row={item} lang={lang} showPlace onOpenPlace={onOpenPlace} />
        </View>
      )}
    />
  )
}

const s = StyleSheet.create({
  title:     { ...type.sectionHeading, color: colors.textPrimary, marginBottom: 10 },
  card:      { backgroundColor: colors.card, borderRadius: radii.card, paddingHorizontal: 14, paddingVertical: 4,
               borderWidth: 1, borderColor: colors.border },
  feedCard:  { backgroundColor: CARD_BG, borderRadius: radii.card, paddingHorizontal: 14, marginBottom: 10 },
  divider:   { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 60 },
  rowText:   { flex: 1, gap: 2 },
  name:      { ...type.rowTitle, color: colors.textPrimary },
  placeLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place:     { ...type.small, color: colors.textSecondary, flexShrink: 1 },
  when:      { ...type.meta, color: colors.textSecondary },
  empty:     { ...type.body, color: colors.textSecondary },
  spinner:   { marginVertical: 20 },
  guest:     { gap: 10, alignItems: 'flex-start' },
  guestCard: { paddingVertical: 14 },
  guestText: { ...type.body, color: colors.textPrimary },
})
