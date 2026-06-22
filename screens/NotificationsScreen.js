import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function NotificationsScreen({ notifications, loading, lang, onBack, onMarkAllRead, onClearAll, onNotifPress, onMarkRead }) {
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backText}>{t('back', lang)}</Text>
        </TouchableOpacity>
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
          data={notifications}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          renderItem={({ item }) => {
            const title = item.title ?? ''
            const isDuty = ['duty', 'nöbetçi', 'مناوبة', 'дежурн', 'εφημερεύ', 'garde', 'guardia', 'notdienst', 'نوبتی'].some(kw => title.toLowerCase().includes(kw))
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
  backText:    { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
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
