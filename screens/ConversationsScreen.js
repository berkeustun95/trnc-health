import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Image,
  RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import ContentCard from '../components/ContentCard'
import Avatar, { prefetchAvatars } from '../components/Avatar'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import { monthNames } from '../constants/months'

// ─── The inbox (slice 6) ────────────────────────────────────────────────────
//
// Renders exactly what list_conversations() returns — nine columns, one row per thread.
// Nothing here reads `profiles`: the other person's name and face cross the RLS boundary
// through that column-limited DEFINER function and nowhere else, which is the same
// instrument slices 4 and 5 use and for the same reason (RLS has no column dimension, so
// a policy that exposed a display name would expose the phone number beside it).
//
// NO UNREAD COUNT AND NO READ STATE, anywhere. There are no read receipts in v1 —
// "seen and ignored" is a pressure a stranger should not be able to apply to somebody who
// has not accepted them — and an unread badge is that same fact wearing a number.
//
// ► A DECLINED THREAD IS SIMPLY ABSENT for the person who was declined, because the
//   SELECT policy hides the row from its initiator. There is no "declined" state to
//   render here and there must not be one: it reads as no reply, which is what it should.

function stamp(iso, lang) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const months = monthNames(lang)
  return `${d.getDate()} ${months[d.getMonth()]}`
}

function Row({ row, lang, onOpen }) {
  return (
    <TouchableOpacity
      style={s.row}
      onPress={() => onOpen(row)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={row.display_name ?? t('msgDeletedUser', lang)}
    >
      <Avatar
        avatarUrl={row.avatar_url}
        initials={row.display_name?.[0]?.toUpperCase() ?? '?'}
        size={46}
        textSize={18}
      />

      <View style={s.body}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>
            {/* The other participant deleted their account. list_conversations joins
                profiles, so the row disappears entirely in that case — this is here for
                the window where the join still resolves but the name has gone. */}
            {row.display_name ?? t('msgDeletedUser', lang)}
          </Text>
          <Text style={s.time}>{stamp(row.last_message_at, lang)}</Text>
        </View>

        <Text style={[s.preview, row.is_closed && s.previewMuted]} numberOfLines={1}>
          {row.last_body ?? ''}
        </Text>

        {/* ► CLOSED IS ONE BADGE FOR BOTH CAUSES. Somebody left, or somebody blocked —
            the same word, because a badge that distinguished them would tell the blocked
            person they were blocked. */}
        {row.is_closed ? (
          <View style={s.closedPill}><Text style={s.closedText}>{t('msgClosedBadge', lang)}</Text></View>
        ) : row.awaiting_me ? (
          <View style={s.requestPill}><Text style={s.requestText}>{t('msgRequestBadge', lang)}</Text></View>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  )
}

export default function ConversationsScreen({ lang, canSee, onOpen, onGoToProfile, refreshKey = 0 }) {
  const [rows, setRows]         = useState(null)
  const [failed, setFailed]     = useState(false)
  const [refreshing, setRefresh] = useState(false)
  // This list renders inside StudentHubScreen's SafeAreaView, which claims only the TOP
  // edge — so nothing here pays the Android navigation bar and the last conversation row
  // ends up underneath it. Same fix and same Math.max as every other bottom-reaching
  // surface in ADA.
  const insets = useSafeAreaInsets()

  const load = useCallback(() => {
    if (canSee !== true) return undefined
    let cancelled = false
    setFailed(false)
    supabase.rpc('list_conversations').then(({ data, error }) => {
      if (cancelled) return
      // AUTH_REQUIRED and NOT_LISTED are the server restating what this screen already
      // checked through canSee, so they are a load failure here rather than a state with
      // its own copy. The raw message never reaches the user either way.
      if (error) { setFailed(true); return }
      // One signing round trip for the whole inbox, not one per row.
      prefetchAvatars((data ?? []).map(r => r.avatar_url)).finally(() => setRows(data ?? []))
    })
    return () => { cancelled = true }
  }, [canSee, refreshKey])

  useEffect(() => load(), [load])

  // No realtime subscription: putting `messages` in a publication is a migration, and the
  // schema is settled. Pull-to-refresh plus a refetch after every send is what this has.
  async function onRefresh() {
    setRefresh(true)
    await new Promise(r => { const c = load(); setTimeout(() => { c?.(); r() }, 400) })
    setRefresh(false)
  }

  // The reciprocity gate, in the same words the student list uses. Messaging is the same
  // bargain: you are reachable because you are listed.
  if (canSee === false) {
    return (
      <ContentCard style={s.card}>
        <Text style={s.lockedTitle}>{t('msgLockedTitle', lang)}</Text>
        <Text style={s.lockedBody}>{t('msgLockedBody', lang)}</Text>
        <TouchableOpacity style={s.lockedBtn} onPress={onGoToProfile} activeOpacity={0.85} accessibilityRole="button">
          <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
          <Text style={s.lockedBtnText}>{t('studentListLockedCta', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    )
  }

  if (canSee === null) {
    return <ContentCard style={s.card}><ActivityIndicator color={colors.primary} /></ContentCard>
  }

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {failed ? (
        <ContentCard>
          <Text style={s.empty}>{t('studentLoadError', lang)}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.85} accessibilityRole="button">
            <Ionicons name="refresh" size={17} color={colors.surface} />
            <Text style={s.retryText}>{t('tryAgain', lang)}</Text>
          </TouchableOpacity>
        </ContentCard>
      ) : rows === null ? (
        <ContentCard><ActivityIndicator color={colors.primary} /></ContentCard>
      ) : rows.length === 0 ? (
        // Empty is this feature's DEFAULT state at launch and must not read as broken.
        <ContentCard>
          <Ionicons name="chatbubbles-outline" size={28} color={colors.textSecondary} style={s.emptyIcon} />
          <Text style={s.empty}>{t('msgEmpty', lang)}</Text>
        </ContentCard>
      ) : (
        <ContentCard>
          {rows.map((row, i) => (
            <View key={row.conversation_id} style={i ? s.divider : null}>
              <Row row={row} lang={lang} onOpen={onOpen} />
            </View>
          ))}
        </ContentCard>
      )}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll:  { flex: 1 },
  content: { padding: 16 },
  card:    { margin: 16 },

  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 12, paddingTop: 12 },


  body:    { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name:    { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  time:    { fontSize: 11, color: colors.textSecondary },
  preview: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  previewMuted: { fontStyle: 'italic' },

  requestPill: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.sm,
                 paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  requestText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  closedPill:  { alignSelf: 'flex-start', backgroundColor: colors.cardBg, borderRadius: radius.sm,
                 paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  closedText:  { fontSize: 11, fontWeight: '700', color: colors.textSecondary },

  empty:     { fontSize: 14, color: colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  emptyIcon: { alignSelf: 'center', marginBottom: 8 },
  retryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
               marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11 },
  retryText: { color: colors.surface, fontSize: 14, fontWeight: '700' },

  lockedTitle:  { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  lockedBody:   { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  lockedBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14,
                  borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, paddingVertical: 11 },
  lockedBtnText:{ fontSize: 14, fontWeight: '700', color: colors.primary },
})
