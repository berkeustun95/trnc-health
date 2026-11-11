import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { colors, category as CAT, type, radii } from '../constants/theme'
import { ScreenHeader, BottomSheet, Button, InlineAlert, ModuleScreen } from '../components/ui'
import { mkChatErrorKey, isTermsRequired } from '../constants/marketplace'
import { MARKETPLACE_CHAT, noticeAccepted, acceptNotice } from '../utils/marketplaceApi'
import ConversationsScreen from './ConversationsScreen'
import ConversationScreen from './ConversationScreen'
import StudentHubTermsGate from './StudentHubTermsGate'
import { needsMarketplaceTerms } from '../constants/legal'
import { isGuest } from '../lib/supabase'
import { OnPhotoContext } from '../components/ui/onPhoto'

// ─── Bandabuliya chat: inbox, one thread, or a first message from a listing ─────
// Student Hub's two screens with the listing adapter (utils/marketplaceApi.js MARKETPLACE_CHAT), so block, leave,
// decline and delete behave exactly as they do there. What is Bandabuliya's own: the listing strip over a thread
// (decision 7: a sold listing still shows, marked Satıldı), and the safety notice before a user's first message —
// buyer AND seller, because send_listing_message refuses either without it (NOTICE_REQUIRED, 20261184).

const NOTICE_POINTS = [
  { icon: 'people-outline', key: 'mkNoticePublic' },
  { icon: 'cash-outline', key: 'mkNoticeNoAdvance' },
  { icon: 'shield-checkmark-outline', key: 'mkNoticeReport' },
]

export function MarketplaceNoticeSheet({ visible, lang, onClose, onAccepted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function accept() {
    setBusy(true); setError(null)
    try { await acceptNotice(); onAccepted() } catch { setError(t('mkErrGeneric', lang)) }
    setBusy(false)
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('mkNoticeTitle', lang)} lang={lang}>
      <View style={s.sheet}>
        <Text style={s.sheetLead}>{t('mkNoticeLead', lang)}</Text>
        {NOTICE_POINTS.map(p => (
          <View key={p.key} style={s.point}>
            <Ionicons name={p.icon} size={20} color={CAT.homeLife.ink} />
            <Text style={s.pointText}>{t(p.key, lang)}</Text>
          </View>
        ))}
        {!!error && <InlineAlert message={error} />}
        <Button title={t('mkNoticeAccept', lang)} onPress={accept} loading={busy} fullWidth />
      </View>
    </BottomSheet>
  )
}

// The terms re-ask (decision 6): an absolute-fill layer, NOT a Modal, so Android back reaches it through the backRef chain
// and the screen under it stays mounted (a typed draft survives). Reuses Student Hub's gate with Bandabuliya's own copy.
// OnPhotoContext false: the gate is an opaque light canvas, so over a ModuleScreen (list) its header must not go white,
// and ScreenHeader's status bar then reads dark. accessibilityViewIsModal keeps VoiceOver on the gate (iOS).
export function MarketplaceTermsLayer({ lang, userId, onAccepted, onCancel }) {
  useEffect(() => { Keyboard.dismiss() }, [])
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <OnPhotoContext.Provider value={false}>
        <StudentHubTermsGate lang={lang} userId={userId} onAccepted={onAccepted} onCancel={onCancel}
          titleKey="mkTermsTitle" bodyKey="mkTermsBody" />
      </OnPhotoContext.Provider>
    </View>
  )
}

// The listing a thread is about. listing_id is NULL once the listing is purged (20261185 keeps the chat).
function listingState(row) {
  if (!row?.listing_id) return 'removed'
  if (row.listing_status === 'sold') return 'sold'
  return row.listing_available ? 'live' : 'removed'
}
const STATE_BADGE = { sold: 'mkStateSold', removed: 'mkChatListingRemoved' }

function ListingStrip({ row, lang, onOpen }) {
  const state = listingState(row)
  const canOpen = state !== 'removed'
  return (
    <TouchableOpacity style={s.strip} onPress={() => onOpen(row.listing_id)} disabled={!canOpen} activeOpacity={0.8}
      accessibilityRole={canOpen ? 'button' : 'text'} accessibilityLabel={`${row.listing_title ?? t('mkChatListingRemoved', lang)}`}>
      <Ionicons name="pricetag-outline" size={18} color={CAT.homeLife.ink} />
      <Text style={s.stripTitle} numberOfLines={1}>{row.listing_title ?? t('mkChatListingRemoved', lang)}</Text>
      {STATE_BADGE[state] && row.listing_title ? <Text style={s.badge}>{t(STATE_BADGE[state], lang)}</Text> : null}
      {canOpen && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
    </TouchableOpacity>
  )
}

function InboxExtra({ row, lang }) {
  const state = listingState(row)
  return (
    <View style={s.extra}>
      <Ionicons name="pricetag-outline" size={12} color={colors.textSecondary} />
      <Text style={s.extraText} numberOfLines={1}>{row.listing_title ?? t('mkChatListingRemoved', lang)}</Text>
      {STATE_BADGE[state] && row.listing_title ? <Text style={s.extraBadge}>{t(STATE_BADGE[state], lang)}</Text> : null}
    </View>
  )
}

// compose: { userId, displayName, listingId, listingTitle } — a buyer's first message from a listing page.
export default function MarketplaceChatScreen({ lang, session, onBack, onOpenListing, compose = null, initialConversationId = null, backRef = null, termsVersion = null, onTermsAccepted, onTermsRefused }) {
  const myId = session?.user?.id
  const [thread, setThread]   = useState(null)          // a list_conversations row
  const [composing, setComposing] = useState(compose)
  const [refreshKey, setRefreshKey] = useState(0)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const noticeOk = useRef(false)
  const resolveNotice = useRef(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const termsOk = useRef(false)          // set on accept: the resumed send runs before App's profile re-renders
  const termsForced = useRef(false)      // the server refused with TERMS_REQUIRED: due whatever the profile says, until an accept
  const resolveTerms = useRef(null)

  const findThread = useCallback(async match => {
    const { data } = await MARKETPLACE_CHAT.list()
    return (data ?? []).find(match) ?? null
  }, [])

  useEffect(() => {
    if (!initialConversationId) return
    findThread(r => r.conversation_id === initialConversationId).then(r => r && setThread(r))
  }, [initialConversationId, findThread])

  // Back: thread → inbox (unless the chat was opened for one thread) → whoever opened us.
  const leaveThread = useCallback(() => {
    if ((compose && composing) || (compose && thread)) { onBack(); return }
    setThread(null); setComposing(null); setRefreshKey(k => k + 1)
  }, [compose, composing, thread, onBack])
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => { if (termsOpen) { answerTerms(false); return true } if (thread || composing) { leaveThread(); return true } return false }
    return () => { backRef.current = null }
  })

  // Terms gate first (decision 6), then the notice, then the send. Like the notice, a second Send tap while it is open is not a second send.
  // termsVersion null (profile not loaded) asks: never let an unchecked account through. A guest is never asked
  // (it must not write profiles): the send's AUTH_REQUIRED refusal handles it as before.
  const beforeSend = useCallback(async () => {
    if (resolveTerms.current) return false
    if (!isGuest(session) && (termsForced.current || (!termsOk.current && needsMarketplaceTerms(termsVersion)))) {
      setTermsOpen(true)
      if (!(await new Promise(resolve => { resolveTerms.current = resolve }))) return false
    }
    if (noticeOk.current) return true
    try { if (await noticeAccepted(myId)) { noticeOk.current = true; return true } } catch { /* ask */ }
    // A second tap on Send while the sheet is open is not a second send.
    if (resolveNotice.current) return false
    setNoticeOpen(true)
    return new Promise(resolve => { resolveNotice.current = resolve })
  }, [myId, termsVersion, session])
  const answerTerms = ok => {
    setTermsOpen(false)
    resolveTerms.current?.(ok); resolveTerms.current = null
  }
  const answerNotice = ok => {
    setNoticeOpen(false)
    if (ok) noticeOk.current = true
    resolveNotice.current?.(ok); resolveNotice.current = null
  }
  // The server is the backstop: a NOTICE_REQUIRED (an older accepted version) clears the cache so the next send asks.
  // TERMS_REQUIRED does the same for the terms gate, but opens it at once (the draft stays in the composer; the user taps Send again).
  // false = no error line (ConversationScreen shows only a truthy key).
  const errorKey = useCallback(e => {
    if (isTermsRequired(e)) { termsOk.current = false; termsForced.current = true; onTermsRefused?.(); setTermsOpen(true); return false }
    const k = mkChatErrorKey(e)
    if (k === 'mkNoticeRequired') noticeOk.current = false
    return k
  }, [onTermsRefused])

  const onChanged = useCallback(async change => {
    setRefreshKey(k => k + 1)
    if (!change?.openWith) return
    const listingId = composing?.listingId ?? thread?.listing_id
    const row = await findThread(r => r.other_user_id === change.openWith && r.listing_id === listingId && !r.is_closed)
    if (row) { setComposing(null); setThread(row) }
  }, [composing, thread, findThread])

  const termsLayer = termsOpen ? (
    <MarketplaceTermsLayer lang={lang} userId={myId} onCancel={() => answerTerms(false)}
      onAccepted={d => { termsOk.current = true; termsForced.current = false; onTermsAccepted?.(d); answerTerms(true) }} />
  ) : null
  const notice = <MarketplaceNoticeSheet visible={noticeOpen} lang={lang} onClose={() => answerNotice(false)} onAccepted={() => answerNotice(true)} />

  if (thread || composing) {
    const strip = thread
      ? <ListingStrip row={thread} lang={lang} onOpen={onOpenListing} />
      : <ListingStrip row={{ listing_id: composing.listingId, listing_title: composing.listingTitle, listing_status: 'active', listing_available: true }}
          lang={lang} onOpen={onOpenListing} />
    return (
      <>
        <ConversationScreen
          key={thread?.conversation_id ?? 'compose'}
          conversation={thread}
          composeWith={thread ? null : { userId: composing.userId, displayName: composing.displayName, listingId: composing.listingId }}
          myId={myId} lang={lang} onBack={leaveThread} onChanged={onChanged}
          api={MARKETPLACE_CHAT} header={strip} beforeSend={beforeSend} errorKey={errorKey}
        />
        {notice}
        {termsLayer}
      </>
    )
  }

  return (
    <ModuleScreen topic="marketplace">
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader onBack={onBack} title={t('mkInboxTitle', lang)} subtitle={t('menuMarketplace', lang)} lang={lang} />
        <ConversationsScreen lang={lang} canSee={true} refreshKey={refreshKey} api={MARKETPLACE_CHAT}
          onOpen={setThread} renderExtra={row => <InboxExtra row={row} lang={lang} />} />
      </SafeAreaView>
      {notice}
    </ModuleScreen>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: 'transparent' },
  sheet:      { gap: 14, paddingBottom: 8 },
  sheetLead:  { ...type.body, color: colors.textPrimary },
  point:      { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: CAT.homeLife.bg, borderRadius: radii.card, padding: 12 },
  pointText:  { flex: 1, ...type.meta, color: colors.textPrimary },
  strip:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 12,
                minHeight: 44, borderRadius: radii.card, backgroundColor: colors.surface },
  stripTitle: { flex: 1, ...type.rowTitle, color: colors.textPrimary },
  badge:      { ...type.caption, fontFamily: 'Inter_700Bold', color: CAT.homeLife.ink, backgroundColor: CAT.homeLife.bg,
                borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  extra:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  extraText:  { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
  extraBadge: { fontSize: 11, fontFamily: 'Inter_700Bold', color: CAT.homeLife.ink },
})
