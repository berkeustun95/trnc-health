import { useScrollMemory } from '../utils/scrollMemory'
import { useEffect, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, AppState, Linking } from 'react-native'
import * as Notifications from 'expo-notifications'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import { REDESIGN } from '../constants/redesign'
import { ScreenHeader, Button, EmptyState, RowSkeleton } from '../components/ui'
import { colors as C, type, radii, elevation, press } from '../constants/theme'

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// ⚠ THE ROWS ARE NOT TAPPABLE, AND NOTHING HERE NAVIGATES ANYWHERE.
//
// Recorded 2026-09-19 because it is easy to assume otherwise: every row is rendered by a
// plain View, and the only touchables on this screen are back, mark-all-read and clear-all.
// `notifications` rows carry a title and a body and nothing to route on — no type, no
// target id — so even a tap handler would have nowhere to send anybody.
//
// The PUSH path does route, as of 20261031: its payload carries
// { screen: 'conversation', conversation_id } and App.js's two notification handlers act
// on it. This in-app list is a separate path and did not gain that. So a message
// notification is actionable from the lock screen and inert from inside the app, which is
// a real inconsistency and not an oversight to be fixed casually — giving these rows a
// destination means putting a target on the notifications table, which is a schema change
// and a decision about every notification type, not just messages.

// Redesign: localised "time ago" (was hardcoded m / h / d in every language).
function timeAgoLocal(isoString, lang) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 60000))
  if (mins < 1) return t('hrAgoNow', lang)
  if (mins < 60) return t('hrAgoMin', lang).replace('{n}', String(mins))
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('hrAgoHour', lang).replace('{n}', String(hrs))
  return t('hrAgoDay', lang).replace('{n}', String(Math.floor(hrs / 24)))
}

// Duty notices are still recognised by title keywords: notifications has no type column
// (checked live, 2026-09-30 — every candidate name is 42703), and adding one is a migration,
// which this branch may not make. Listed for Berke; shared by both layouts.
const DUTY_KEYWORDS = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی']
const isDutyNotice = item => DUTY_KEYWORDS.some(kw => (item.title ?? '').toLowerCase().includes(kw))

// Notifications are not allowed: one quiet row, no nagging. The OS will still ask → "Bildirimleri
// aç" (the explanation, then the OS pop-up); it will not → "Ayarları aç". Re-read on return.
function PushOffRow({ lang, onEnablePush }) {
  const [perm, setPerm] = useState(null)
  useEffect(() => {
    let gone = false
    const check = () => Notifications.getPermissionsAsync().then(p => { if (!gone) setPerm(p) }).catch(() => {})
    check()
    const sub = AppState.addEventListener('change', st => { if (st === 'active') check() })
    return () => { gone = true; sub.remove() }
  }, [])
  if (!perm || perm.status === 'granted') return null
  const settings = perm.canAskAgain === false
  return (
    <View style={r.pushOff}>
      <Ionicons name="notifications-off-outline" size={18} color={C.textSecondary} />
      <Text style={r.pushOffText}>{t('permNotifOff', lang)}</Text>
      <Button variant="text" title={t(settings ? 'openSettings' : 'permNotifTurnOn', lang)}
        onPress={() => (settings ? Linking.openSettings().catch(() => {}) : onEnablePush?.())} />
    </View>
  )
}

function NotificationsRedesign({ notifications, loading, lang, onBack, onMarkAllRead, onClearAll, onNotifPress, onMarkRead, onEnablePush }) {
  const listMem = useScrollMemory('notifs')
  const unread = notifications.filter(n => !n.read).length
  return (
    <SafeAreaView style={r.safe} edges={['top']}>
      <ScreenHeader title={t('notifications', lang)} onBack={onBack} lang={lang} />
      <PushOffRow lang={lang} onEnablePush={onEnablePush} />
      {notifications.length > 0 && (
        <View style={r.actions}>
          {unread > 0
            ? <Button variant="text" icon="checkmark-done-outline" title={t('markAllRead', lang)} onPress={onMarkAllRead} />
            : <Button variant="text" icon="trash-outline" title={t('clearAll', lang)} onPress={onClearAll} />}
        </View>
      )}
      {loading ? (
        <View style={r.list}><RowSkeleton count={5} /></View>
      ) : notifications.length === 0 ? (
        <EmptyState icon="notifications-outline" category="city" title={t('noNewNotifications', lang)} />
      ) : (
        <FlatList
          {...listMem}
          data={notifications}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={r.list}
          renderItem={({ item }) => {
            const duty = isDutyNotice(item)
            return (
              <TouchableOpacity
                style={[r.card, elevation.card]}
                activeOpacity={press.card}
                accessibilityRole="button"
                accessibilityState={{ selected: !item.read }}
                onPress={() => { onMarkRead?.(item); if (duty) onNotifPress?.(item) }}
              >
                {/* One unread colour app-wide: dangerInk, the same as the bell's badge. */}
                <View style={[r.dot, item.read && r.dotRead]} />
                <View style={{ flex: 1 }}>
                  <View style={r.top}>
                    <Text style={[r.title, !item.read && r.titleUnread]} numberOfLines={2}>{item.title}</Text>
                    <Text style={r.time}>{timeAgoLocal(item.created_at, lang)}</Text>
                  </View>
                  <Text style={r.body}>{item.body}</Text>
                  {duty && <Text style={r.hint}>{t('tapViewDuty', lang)}</Text>}
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

export default function NotificationsScreen(props) {
  return REDESIGN ? <NotificationsRedesign {...props} /> : <NotificationsLegacy {...props} />
}

function NotificationsLegacy({ notifications, loading, lang, onBack, onMarkAllRead, onClearAll, onNotifPress, onMarkRead }) {
  // Back from the duty list (opened from a notification, on top of this screen) lands at the
  // same scroll; App forgets it when notifications close (slice 10).
  const listMem = useScrollMemory('notifs')
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
        <Text style={s.title}>{t('notifications', lang)}</Text>
        {notifications.length > 0 ? (
          unreadCount > 0 ? (
            <TouchableOpacity onPress={onMarkAllRead} style={s.actionBtn}>
              <Text style={s.markRead}>{t('markAllRead', lang)}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onClearAll} style={s.actionBtn}>
              <Text style={s.clearAll}>{t('clearAll', lang)}</Text>
            </TouchableOpacity>
          )
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIconWrap}>
            <Ionicons name="notifications-outline" size={32} color={colors.textSecondary} />
          </View>
          <Text style={s.emptyText}>{t('noNewNotifications', lang)}</Text>
        </View>
      ) : (
        <FlatList
          {...listMem}
          data={notifications}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          renderItem={({ item }) => {
            const title = item.title ?? ''
            const isDuty = isDutyNotice(item)
            return (
              <TouchableOpacity
                style={[s.card, !item.read && s.cardUnread]}
                activeOpacity={0.75}
                onPress={() => { onMarkRead?.(item); if (isDuty) onNotifPress?.(item) }}
              >
                {!item.read && <View style={s.unreadDot} />}
                <View style={s.cardBody}>
                  <View style={s.cardTop}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={s.cardTime}>{timeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={s.cardBodyText}>{item.body}</Text>
                  {isDuty && (
                    <Text style={s.tapHint}>{t('tapViewDuty', lang)}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  title:       { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionBtn:   { width: 80, alignItems: 'flex-end' },
  markRead:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, textAlign: 'right' },
  clearAll:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger, textAlign: 'right' },
  empty:       { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80, gap: 12 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center', ...shadow },
  emptyText:   { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  list:        { paddingHorizontal: 16, paddingBottom: 32 },
  card:        { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 10, ...shadow },
  cardUnread:  { backgroundColor: colors.primaryLight },
  unreadDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 5, flexShrink: 0 },
  cardBody:    { flex: 1 },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  cardTitle:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, marginRight: 8 },
  cardTime:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  cardBodyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },
  tapHint:      { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, marginTop: 6 },
})

const r = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.canvas },
  actions:     { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 },
  pushOff:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
                 paddingLeft: 14, paddingRight: 4, minHeight: 48, borderRadius: radii.md, backgroundColor: C.card, ...elevation.card },
  pushOffText: { ...type.small, color: C.textSecondary, flex: 1 },
  list:        { paddingHorizontal: 16, paddingBottom: 32 },
  card:        { backgroundColor: C.card, borderRadius: radii.md, padding: 14, marginBottom: 8,
                 flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot:         { width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.dangerInk, marginTop: 6 },
  dotRead:     { backgroundColor: 'transparent' },
  top:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  title:       { ...type.rowTitle, fontFamily: 'Inter_500Medium', color: C.textPrimary, flex: 1 },
  titleUnread: { fontFamily: 'Inter_600SemiBold' },
  time:        { ...type.caption, color: C.textSecondary },
  body:        { ...type.small, color: C.textSecondary },
  hint:        { ...type.meta, fontFamily: 'Inter_600SemiBold', color: C.primaryDark, marginTop: 6 },
})
