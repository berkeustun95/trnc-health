import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity,
  TextInput, Modal, Alert, Keyboard, Platform,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import ContentReportMenu from '../components/ContentReportMenu'
import KeyboardAwareForm from '../components/KeyboardAwareForm'
import { MESSAGE_MAX_LENGTH, MESSAGE_COUNTER_FROM, sendErrorKey } from '../constants/messaging'
import { moderationErrorKey } from '../utils/profanity'
import { colors, radius, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import { monthNames } from '../constants/months'

// ─── One conversation (slice 6) ─────────────────────────────────────────────
//
// Two modes. With a `conversation` row from list_conversations() this is a thread; with
// `composeWith` it is an empty thread whose first send OPENS one. Both end in the same
// place, which is why they are one screen rather than two.
//
// ─── WHERE LEAVE AND BLOCK LIVE, AND WHY IT IS NOT A STYLE CHOICE ───────────
//
// ► LEAVE IS NOT A DEFENCE. BLOCK IS. Leaving closes THIS conversation and hides it, and
//   that is all it does — the other person is not blocked and can open a new conversation
//   tomorrow (20261029 allows that deliberately: a leave that sealed the pair forever
//   would be a permanent invisible mutual block neither side could see or undo).
//
//   So the menu never offers Leave in a position where Block belongs:
//     • BLOCK IS AVAILABLE IN EVERY STATE, including on an unaccepted request, which is
//       exactly the moment somebody is most likely to need it.
//     • LEAVE IS ABSENT from an incoming request. The verb for a request is DECLINE, and
//       decline is the permanent one.
//     • LEAVE'S OWN CONFIRMATION SAYS IT IS NOT A DEFENCE, and offers Block from inside
//       it. Someone reaching for the softer word at the wrong moment is handed the
//       stronger one in the same breath, rather than discovering the difference later.
//
// ─── THE COMPOSER SITS ON THE ANDROID NAVIGATION BAR ────────────────────────
//
// A bottom-anchored bar inside `edges={['top']}` gets NO bottom inset, so on a
// three-button Android device it renders UNDER the navigation bar: the field is
// overlapped by the nav buttons and cannot be tapped at all. Every other bottom-anchored
// bar in ADA pays `Math.max(insets.bottom, 12)` — PropertyDetailScreen, TowingDetailScreen
// and DormPartnerScreen all do exactly that — so this does too rather than inventing a
// second rule.
//
// ► AND IT COLLAPSES WHEN THE KEYBOARD IS OPEN. app.config.js leaves
//   softwareKeyboardLayoutMode unset, so Android uses adjustResize and the WINDOW shrinks
//   to sit above the keyboard. At that moment the navigation bar is no longer adjacent to
//   the bottom of the window, and still paying its inset would open a visible dead strip
//   between the composer and the keyboard. Keyboard state is read with the same
//   Keyboard.addListener idiom OliGuide and SearchModal already use.
//
// ─── LINKS ARE TEXT, NEVER TAPS ─────────────────────────────────────────────
// Message bodies render in a plain <Text> with data detectors OFF. Phishing arrives as a
// tappable link from a stranger, and there is no version of "open this URL from somebody
// who has not been accepted yet" that is safe enough to be worth the convenience.
// `selectable` stays on: copying an address out of a message is ordinary and useful, and
// selecting text is not following a link.

function dayLabel(iso, lang) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return t('msgToday', lang)
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return t('msgYesterday', lang)
  const months = monthNames(lang)
  return `${d.getDate()} ${months[d.getMonth()]}`
}

// 24h, built by hand rather than through toLocaleTimeString: Hermes' Intl is not
// trustworthy on every device this ships to (see constants/months.js), and the TRNC uses
// a 24-hour clock in every language the app speaks.
const clock = iso => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Bubble({ msg, mine, lang, onDelete }) {
  return (
    <View style={[s.bubbleRow, mine ? s.bubbleRowMine : s.bubbleRowTheirs]}>
      <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
        {mine ? null : <Text style={s.bubbleName}>{msg.sender_display_name}</Text>}
        <Text
          style={[s.bubbleBody, mine && s.bubbleBodyMine]}
          selectable
          dataDetectorType="none"
        >
          {msg.body}
        </Text>
        <Text style={[s.bubbleTime, mine && s.bubbleTimeMine]}>{clock(msg.created_at)}</Text>
      </View>
      {/* ► THE ACTION ON YOUR OWN MESSAGE IS DELETE; ON THEIRS IT IS REPORT. Reporting
          yourself is meaningless, and deleting THEIRS is not withdrawal — it is erasing
          something somebody said to you, and the person most motivated to do that is the
          one who wants it gone before it is reported. delete_message() refuses it
          server-side too; this is the copy, not the boundary. */}
      {mine ? (
        <TouchableOpacity
          onPress={() => onDelete(msg)}
          style={s.bubbleReport}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={t('msgDeleteAction', lang)}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <ContentReportMenu contentType="message" contentId={msg.id} lang={lang} style={s.bubbleReport} />
      )}
    </View>
  )
}

export default function ConversationScreen({
  conversation = null,     // a row from list_conversations()
  composeWith = null,      // { userId, displayName } — no thread yet
  myId,
  lang,
  onBack,
  onChanged,               // the inbox refetches; also how a compose becomes a thread
}) {
  const other = conversation
    ? { userId: conversation.other_user_id, displayName: conversation.display_name }
    : composeWith

  const [rows, setRows]       = useState(conversation ? null : [])
  const [failed, setFailed]   = useState(false)
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [errKey, setErrKey]   = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [kbOpen, setKbOpen]   = useState(false)
  const scrollRef = useRef(null)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const subs = [
      Keyboard.addListener(showEvt, () => setKbOpen(true)),
      Keyboard.addListener(hideEvt, () => setKbOpen(false)),
    ]
    return () => subs.forEach(x => x.remove())
  }, [])

  // One number, three bars — composer, request and closed all sit in the same place and
  // must clear the same nav bar.
  const barPad = { paddingBottom: kbOpen ? 10 : Math.max(insets.bottom, 12) }

  const accepted = conversation?.is_accepted === true
  const closed   = conversation?.is_closed === true
  // Only the recipient of an unaccepted thread is ever "awaiting": the initiator is never
  // told that a decline happened, so for them an unanswered thread simply has no reply.
  const awaiting = conversation?.awaiting_me === true
  const composing = !conversation

  const load = useCallback(() => {
    if (!conversation) return undefined
    let cancelled = false
    setFailed(false)
    // RLS is the filter. Soft-deleted and admin-hidden messages are excluded by the
    // policy, not by this query — a client-side `.is('deleted_at', null)` would be a
    // second copy of a rule the database already owns, and the copy that drifts is the
    // one that shows something it should not.
    supabase
      .from('messages')
      .select('id, sender_id, sender_display_name, body, created_at')
      .eq('conversation_id', conversation.conversation_id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setFailed(true); return }
        setRows(data ?? [])
      })
    return () => { cancelled = true }
  }, [conversation])

  useEffect(() => load(), [load])

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setErrKey(null)

    const call = composing
      ? supabase.rpc('start_conversation', { p_recipient_id: other.userId, p_body: text })
      : supabase.rpc('send_message', { p_conversation_id: conversation.conversation_id, p_body: text })

    const { data, error } = await call
    setSending(false)

    if (error) {
      // A live thread already exists for this pair. Not a failure and not a secret — the
      // caller is a participant of it by definition — so the inbox is refetched and the
      // parent opens it rather than showing an error nobody can act on.
      if (composing && error.message?.includes('CONVERSATION_EXISTS')) {
        onChanged?.({ openWith: other.userId })
        return
      }
      // Moderation first, and through the EXISTING helper rather than a second copy of
      // the rule. BLOCKED_TERM has a side effect that must not be lost: it self-reports
      // the rejection in a second transaction, because the RAISE that refused the message
      // rolled the first one back. constants/messaging.js cannot make this call itself —
      // see the note there about staying import-free for the i18n guard.
      setErrKey(
        moderationErrorKey(error, { contentType: 'message', text })
        ?? sendErrorKey(error)
        ?? 'msgSendFailed',
      )
      return
    }

    // start_conversation RETURNS 'refused' rather than raising, because a refusal that
    // raised would roll back the attempt row that the 50-a-day cap counts. So the refusal
    // arrives as DATA and has to be checked here — `!error` is not success.
    if (data === 'refused') { setErrKey('msgRefused'); return }

    setBody('')
    if (composing) { onChanged?.({ openWith: other.userId }); return }
    load()
    onChanged?.()
  }

  async function act(rpc, args, confirmed) {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc(rpc, args)
    setBusy(false)
    setMenuOpen(false)
    if (error) { Alert.alert(t('msgActionFailedTitle', lang), t('msgActionFailedBody', lang)); return }
    confirmed?.()
    onChanged?.()
  }

  function confirmBlock() {
    Alert.alert(
      t('msgBlockTitle', lang).replace('{name}', other?.displayName ?? ''),
      t('msgBlockBody', lang),
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: t('msgBlockConfirm', lang),
          style: 'destructive',
          onPress: () => act('block_user', { p_user_id: other.userId }, onBack),
        },
      ],
    )
  }

  function confirmLeave() {
    Alert.alert(
      t('msgLeaveTitle', lang),
      // ► THE SAFETY SENTENCE. Leaving does not stop them, and saying so here — with
      //   Block offered in the same dialog — is the only place a person is deciding
      //   between the two with both in front of them.
      t('msgLeaveBody', lang),
      [
        { text: t('cancel', lang), style: 'cancel' },
        { text: t('msgLeaveBlockInstead', lang), onPress: () => { setMenuOpen(false); setTimeout(confirmBlock, 350) } },
        {
          text: t('msgLeaveConfirm', lang),
          style: 'destructive',
          onPress: () => act('leave_conversation', { p_conversation_id: conversation.conversation_id }, onBack),
        },
      ],
    )
  }

  // Soft, and for BOTH sides — the row and the text survive so a report still has
  // something to point at. "Delete for everyone" that actually deleted would let somebody
  // erase the evidence a moment after sending it.
  function confirmDelete(msg) {
    Alert.alert(
      t('msgDeleteTitle', lang),
      t('msgDeleteBody', lang),
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: t('msgDeleteConfirm', lang),
          style: 'destructive',
          onPress: () => act('delete_message', { p_message_id: msg.id }, load),
        },
      ],
    )
  }

  function confirmDecline() {
    Alert.alert(
      t('msgDeclineTitle', lang),
      t('msgDeclineBody', lang),
      [
        { text: t('cancel', lang), style: 'cancel' },
        {
          text: t('msgDeclineConfirm', lang),
          style: 'destructive',
          onPress: () => act('decline_conversation', { p_conversation_id: conversation.conversation_id }, onBack),
        },
      ],
    )
  }

  const overLimit = body.length > MESSAGE_MAX_LENGTH
  const canSend = body.trim().length > 0 && !overLimit && !sending
  // The composer is closed while a request is pending in EITHER direction: the recipient
  // answers with Accept or Decline, and the initiator has already had their one message.
  const composerOpen = composing || (accepted && !closed)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader
        onBack={onBack}
        lang={lang}
        title={other?.displayName ?? t('msgTitle', lang)}
        rightElement={
          other ? (
            <TouchableOpacity
              onPress={() => setMenuOpen(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={t('msgThreadMenu', lang)}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : null
        }
      />

      <KeyboardAwareForm>
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {failed ? (
            <ContentCard>
              <Text style={s.notice}>{t('studentLoadError', lang)}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.85} accessibilityRole="button">
                <Ionicons name="refresh" size={17} color={colors.surface} />
                <Text style={s.retryText}>{t('tryAgain', lang)}</Text>
              </TouchableOpacity>
            </ContentCard>
          ) : rows === null ? (
            <ContentCard><ActivityIndicator color={colors.primary} /></ContentCard>
          ) : (
            rows.map((m, i) => {
              const prev = rows[i - 1]
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
              return (
                <View key={m.id}>
                  {newDay ? (
                    <View style={s.dayPill}><Text style={s.dayLabel}>{dayLabel(m.created_at, lang)}</Text></View>
                  ) : null}
                  <Bubble msg={m} mine={m.sender_id === myId} lang={lang} onDelete={confirmDelete} />
                </View>
              )
            })
          )}

          {composing && rows?.length === 0 ? (
            <ContentCard>
              <Text style={s.notice}>
                {t('msgComposeHint', lang).replace('{name}', other?.displayName ?? '')}
              </Text>
            </ContentCard>
          ) : null}
        </ScrollView>

        {/* ── An incoming request: Accept or Decline, and nothing else ──────── */}
        {awaiting && !closed ? (
          <View style={[s.requestBar, barPad]}>
            <Text style={s.requestText}>
              {t('msgRequestPrompt', lang).replace('{name}', other?.displayName ?? '')}
            </Text>
            <View style={s.requestBtns}>
              <TouchableOpacity
                style={[s.declineBtn, busy && { opacity: 0.45 }]}
                onPress={confirmDecline}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={s.declineText}>{t('msgDecline', lang)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.acceptBtn, busy && { opacity: 0.45 }]}
                onPress={() => act('accept_conversation', { p_conversation_id: conversation.conversation_id })}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={s.acceptText}>{t('msgAccept', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : closed ? (
          // ► A BLOCK AND A LEAVE PRODUCE THE SAME LINE. That is the point: anything that
          //   separated them would tell the blocked person they were blocked.
          <View style={[s.closedBar, barPad]}><Text style={s.closedText}>{t('msgConversationClosed', lang)}</Text></View>
        ) : composerOpen ? (
          <View style={[s.composer, barPad]}>
            {errKey ? <Text style={s.error}>{t(errKey, lang)}</Text> : null}
            <View style={s.composerRow}>
              <TextInput
                style={s.input}
                value={body}
                onChangeText={setBody}
                placeholder={t('msgPlaceholder', lang)}
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={MESSAGE_MAX_LENGTH + 1}   // +1 so the limit can be SHOWN, not silently swallowed
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[s.sendBtn, !canSend && { opacity: 0.4 }]}
                onPress={send}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={t('msgSend', lang)}
              >
                {sending
                  ? <ActivityIndicator color={colors.surface} size="small" />
                  : <Ionicons name="send" size={18} color={colors.surface} />}
              </TouchableOpacity>
            </View>
            {body.length >= MESSAGE_COUNTER_FROM ? (
              <Text style={[s.counter, overLimit && s.counterOver]}>
                {body.length} / {MESSAGE_MAX_LENGTH}
              </Text>
            ) : null}
          </View>
        ) : (
          // The initiator, waiting. A DECLINE LOOKS EXACTLY LIKE THIS — the thread is
          // hidden from their list the moment it is declined, so they never reach a state
          // that says "declined", and this line is the only thing they ever see.
          <View style={[s.closedBar, barPad]}><Text style={s.closedText}>{t('msgAwaitingAcceptance', lang)}</Text></View>
        )}
      </KeyboardAwareForm>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <TouchableOpacity style={s.sheet} activeOpacity={1}>
            {/* BLOCK FIRST, AND IN EVERY STATE. On an unaccepted request it is the only
                action in here, because Decline is a button on the request itself. */}
            <TouchableOpacity style={s.actionRow} onPress={confirmBlock} disabled={busy}>
              <Ionicons name="ban-outline" size={18} color={colors.danger} />
              <Text style={s.actionText}>
                {t('msgBlockAction', lang).replace('{name}', other?.displayName ?? '')}
              </Text>
            </TouchableOpacity>

            {/* Leave is absent on an incoming request (Decline is the verb there) and on
                a thread that is already closed (there is nothing left to leave). */}
            {conversation && !awaiting && !closed ? (
              <TouchableOpacity style={s.actionRow} onPress={confirmLeave} disabled={busy}>
                <Ionicons name="exit-outline" size={18} color={colors.textPrimary} />
                <Text style={[s.actionText, s.actionTextNeutral]}>{t('msgLeaveAction', lang)}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={s.cancelBtn} onPress={() => setMenuOpen(false)}>
              <Text style={s.cancelText}>{t('cancel', lang)}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg },
  scroll:  { flex: 1 },
  content: { padding: 16, paddingBottom: 8 },

  notice:    { fontSize: 14, color: colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  retryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
               marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11 },
  retryText: { color: colors.surface, fontSize: 14, fontWeight: '700' },

  // ► ON A SURFACE, NOT ON THE PHOTO. PageBackground paints a photo under a 0.30 black
  //   scrim, and textSecondary grey on that is barely legible. Everywhere else in ADA a
  //   section label of this kind sits inside a ContentCard (see NewcomerEssentialsScreen)
  //   — a chat has no card to put it in, so it gets the same white surface as a pill,
  //   which is the treatment every other badge in this screen already uses.
  dayPill:   { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.sm,
               paddingHorizontal: 10, paddingVertical: 3, marginVertical: 10 },
  dayLabel:  { fontSize: 11, fontWeight: '700', color: colors.textSecondary,
               textTransform: 'uppercase', letterSpacing: 0.6 },

  bubbleRow:       { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 8 },
  bubbleRowMine:   { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble:          { maxWidth: '78%', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine:      { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs:    { backgroundColor: colors.surface, borderBottomLeftRadius: 4, ...shadow },
  bubbleName:      { fontSize: 11, fontWeight: '700', color: colors.primaryDark, marginBottom: 2 },
  bubbleBody:      { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  bubbleBodyMine:  { color: colors.surface },
  bubbleTime:      { fontSize: 10, color: colors.textSecondary, marginTop: 3, alignSelf: 'flex-end' },
  bubbleTimeMine:  { color: 'rgba(255,255,255,0.75)' },
  bubbleReport:    { paddingBottom: 6 },

  requestBar:  { paddingHorizontal: 14, paddingTop: 14, backgroundColor: colors.surface,
                 borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 10 },
  requestText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  requestBtns: { flexDirection: 'row', gap: 10 },
  declineBtn:  { flex: 1, paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.cardBg, alignItems: 'center' },
  declineText: { fontSize: 15, fontWeight: '700', color: colors.danger },
  acceptBtn:   { flex: 1, paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  acceptText:  { fontSize: 15, fontWeight: '700', color: colors.surface },

  closedBar:  { paddingHorizontal: 16, paddingTop: 16, backgroundColor: colors.surface,
                borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  closedText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },

  composer:    { paddingHorizontal: 10, paddingTop: 10, backgroundColor: colors.surface,
                 borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input:       { flex: 1, maxHeight: 120, minHeight: 42, borderRadius: radius.md, borderWidth: 1,
                 borderColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: 12,
                 paddingVertical: 10, fontSize: 15, color: colors.textPrimary },
  sendBtn:     { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary,
                 alignItems: 'center', justifyContent: 'center' },
  counter:     { fontSize: 11, color: colors.textSecondary, textAlign: 'right', marginTop: 4 },
  counterOver: { color: colors.danger, fontWeight: '700' },
  error:       { fontSize: 13, color: colors.danger, marginBottom: 8, lineHeight: 18 },

  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, ...shadow },
  actionRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 4 },
  actionText: { fontSize: 16, fontWeight: '700', color: colors.danger, flex: 1 },
  actionTextNeutral: { color: colors.textPrimary },
  cancelBtn:  { marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.cardBg, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
})
