import { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, Image, TextInput, TouchableOpacity, FlatList, ScrollView, StyleSheet, Keyboard, Alert,
  KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { t, dateLocale } from '../constants/i18n'
import { getIntent, OLI_CHAT_INTENTS } from '../constants/oliIntents'
import { oliProvider } from '../utils/oliAnswers'
import { loadOliHistory, saveOliMessage, deleteOliHistory } from '../utils/oliHistory'
import { localDateKey } from '../utils/dutyStatus'
import { IconButton, ErrorState, RowSkeleton } from './ui'
import { useVoiceInput, MicButton } from './OliMic'

// ─── Ask Oli guided chat (OLI_CHAT) ──────────────────────────────────────────
// Replaces OliSearchSheet when OLI_CHAT is on, with the SAME interface (openRef / closeRef / onOpenChange /
// onNavigate / onOpenResult), so App.js's back chain and oliSheetOpen keep working unchanged.
//
// Answers come from oliProvider (utils/oliAnswers.js): keyword match + tap-chips over ADA's own tables, no AI.
// A signed-in user's chat is saved (oli_messages, 20261163, 90 days) and reloaded on open; a guest's chat lives
// only in this component. Nothing is sent until the user taps Send or a chip; the mic only fills the field.
//
// A stored Oli answer is DATA the client wrote, so it is rendered defensively: unknown kinds read as "no match",
// actions are limited to known navigation targets, search modules and event ids. No URL is ever opened from it.

const CHIPS = [
  { id: 'pharmacy',  labelKey: 'oliChatChipPharmacy' },
  { id: 'events',    labelKey: 'oliChatChipEvents' },
  { id: 'nearby',    labelKey: 'oliChatChipNearby' },
  { id: 'eatery',    labelKey: 'oliChatChipEatery' },
  { id: 'emergency', labelKey: 'oliChipEmergency' },
  { id: 'newcomer',  labelKey: 'oliChipNewcomer' },
]

const NAV_TARGETS = new Set(OLI_CHAT_INTENTS.map(i => i.id))
const RESULT_MODULES = new Set(['medical', 'events', 'beach', 'landmark', 'homeServices', 'transport', 'jobPostings', 'towing'])
const TEXT_KEY = {
  pharmacy: ['oliChatPharmacy', 'oliChatPharmacyNone'],
  events:   ['oliChatEvents', 'oliChatEventsNone'],
  eatery:   ['oliChatEatery', 'oliChatEateryNone'],
  nearby:   ['oliChatNearby', 'oliChatNearbyNone'],
  needLocation: ['oliChatNeedLocation', 'oliChatNeedLocation'],
  search:   ['oliChatSearch', 'oliChatNoMatch'],
  noMatch:  ['oliChatNoMatch', 'oliChatNoMatch'],
  error:    ['oliChatError', 'oliChatError'],
}
// Kinds whose answer ends with a button to the matching ADA screen.
const WITH_BUTTON = new Set(['pharmacy', 'events', 'eatery', 'nearby', 'needLocation', 'route'])

function safeAction(a) {
  if (!a || typeof a !== 'object') return null
  if (typeof a.nav === 'string' && NAV_TARGETS.has(a.nav)) return { nav: a.nav }
  if (a.result && RESULT_MODULES.has(a.result.module) && a.result.id != null) return { result: a.result }
  if (typeof a.event === 'string' || typeof a.event === 'number') return { event: a.event }
  return null
}

function safeAnswer(p) {
  const kind = typeof p?.kind === 'string' ? p.kind : 'noMatch'
  const intent = typeof p?.intent === 'string' ? getIntent(p.intent) : null
  const items = Array.isArray(p?.items)
    ? p.items.filter(i => i && typeof i.t === 'string').slice(0, 10)
        .map(i => ({ t: i.t, s: typeof i.s === 'string' ? i.s : '', a: safeAction(i.a) }))
    : []
  if (kind === 'route') return intent ? { kind, intent, items: [] } : { kind: 'noMatch', intent: null, items: [] }
  if (!TEXT_KEY[kind]) return { kind: 'noMatch', intent: null, items: [] }
  return { kind, intent, items }
}

function dayLabel(iso, lang) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (localDateKey(d) === localDateKey()) return t('oliChatToday', lang)
  try { return d.toLocaleDateString(dateLocale(lang), { weekday: 'short', day: 'numeric', month: 'short' }) }
  catch { return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}` }
}

let localSeq = 0
const localKey = () => `l${Date.now()}-${localSeq++}`

export default function OliChatSheet({ lang, userLocation, userId, isGuest, onNavigate, onOpenResult, onOpenEvent,
  onOpenChange, openRef, closeRef }) {
  const insets = useSafeAreaInsets()
  const canSave = !!userId && !isGuest
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])        // { key, role, body?, payload?, at }
  const [history, setHistory] = useState('idle')      // idle | loading | ok | error (signed-in only)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [notSaved, setNotSaved] = useState(false)
  const listRef = useRef(null)
  const inputRef = useRef('')
  inputRef.current = input
  const voice = useVoiceInput({ lang, getText: () => inputRef.current, onText: setInput })

  // A different account (sign-in, sign-out, guest → account) never sees the previous one's chat.
  useEffect(() => { setMessages([]); setHistory('idle'); setNotSaved(false) }, [userId, isGuest])

  async function loadHistory() {
    setHistory('loading')
    const { rows, error } = await loadOliHistory()
    if (error) { setHistory('error'); return }
    setMessages(rows.map(r => ({ key: r.id, role: r.role, body: r.body, payload: r.payload, at: r.created_at })))
    setHistory('ok')
  }

  const openSheet = () => {
    setInput('')
    setOpen(true)
    if (canSave && history !== 'ok') loadHistory()
  }
  const closeSheet = () => { Keyboard.dismiss(); voice.abort(); setOpen(false) }
  if (openRef) openRef.current = openSheet
  if (closeRef) closeRef.current = closeSheet

  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false) }, [open])

  async function send(text, intentId = null, label = null) {
    const body = (label ?? text).trim()
    if (!body || busy) return
    voice.abort()
    setInput('')
    setBusy(true)
    const now = new Date()
    setMessages(m => [...m, { key: localKey(), role: 'user', body, at: now.toISOString() }])
    const savedUser = canSave ? saveOliMessage({ role: 'user', body: body.slice(0, 500) }) : Promise.resolve(null)
    const answer = await oliProvider.answer({ text: intentId ? '' : body, intentId, lang, userLocation, now })
    const userErr = await savedUser
    setMessages(m => [...m, { key: localKey(), role: 'oli', payload: answer, at: new Date().toISOString() }])
    setBusy(false)
    // An 'error' answer is a moment, not something worth keeping.
    const oliErr = canSave && answer.kind !== 'error' ? await saveOliMessage({ role: 'oli', payload: answer }) : null
    if (canSave && (userErr || oliErr)) setNotSaved(true)
  }

  function confirmDelete() {
    Alert.alert(t('oliChatDeleteTitle', lang), t('oliChatDeleteBody', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      { text: t('oliChatDeleteConfirm', lang), style: 'destructive', onPress: async () => {
        const err = await deleteOliHistory(userId)
        if (err) { Alert.alert(t('oliChatDeleteFailed', lang)); return }
        setMessages([]); setNotSaved(false)
      } },
    ])
  }

  function runAction(a) {
    if (!a) return
    closeSheet()
    if (a.nav) onNavigate?.(a.nav)
    else if (a.result) onOpenResult?.(a.result)
    else if (a.event != null) onOpenEvent?.(a.event)
  }

  // One list: day headers between days, then the messages.
  const items = []
  let lastDay = null
  for (const m of messages) {
    const day = localDateKey(new Date(m.at))
    if (day !== lastDay) { items.push({ kind: 'day', key: `d-${day}-${m.key}`, at: m.at }); lastDay = day }
    items.push({ kind: m.role === 'user' ? 'user' : 'oli', key: m.key, m })
  }
  if (busy) items.push({ kind: 'typing', key: 'typing' })

  function renderOli(m) {
    const a = safeAnswer(m.payload)
    const [withItems, without] = TEXT_KEY[a.kind] ?? []
    const text = a.kind === 'route' ? t(a.intent.msgKey, lang) : t(a.items.length ? withItems : without, lang)
    return (
      <View style={s.oliRow}>
        <Image source={require('../assets/oli-button.png')} style={s.oliAvatar} resizeMode="cover" />
        <View style={[s.oliBubble, elevation.card]}>
          <Text style={s.oliText}>{text}</Text>
          {a.items.map((it, n) => (
            <TouchableOpacity key={n} style={s.item} activeOpacity={press.small} disabled={!it.a}
              accessibilityRole={it.a ? 'button' : 'text'} accessibilityLabel={[it.t, it.s].filter(Boolean).join(', ')}
              onPress={() => runAction(it.a)}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle} numberOfLines={2}>{it.t}</Text>
                {!!it.s && <Text style={s.itemSub} numberOfLines={2}>{it.s}</Text>}
              </View>
              {!!it.a && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
            </TouchableOpacity>
          ))}
          {WITH_BUTTON.has(a.kind) && a.intent && (
            <TouchableOpacity style={s.goBtn} activeOpacity={press.small} accessibilityRole="button"
              onPress={() => runAction({ nav: a.intent.id })}>
              <Text style={s.goText}>{t(a.intent.titleKey, lang)}</Text>
              <Ionicons name="arrow-forward" size={15} color={colors.onPrimary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  function renderItem({ item }) {
    switch (item.kind) {
      case 'day':    return <Text style={s.day}>{dayLabel(item.at, lang)}</Text>
      case 'user':   return <View style={s.userBubble}><Text style={s.userText}>{item.m.body}</Text></View>
      case 'oli':    return renderOli(item.m)
      case 'typing': return <Text style={s.typing} accessibilityLiveRegion="polite">{t('oliChatTyping', lang)}</Text>
    }
    return null
  }

  const empty = !messages.length && history !== 'loading'
  const canSend = !!input.trim() && !busy

  return (
    <Modal visible={open === true} transparent animationType="slide" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={s.backdrop}>
      <KeyboardAvoidingView style={[s.sheet, { marginTop: insets.top + 8 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        accessibilityViewIsModal>
        <View style={s.grabber} />
        <View style={s.head}>
          <Image source={require('../assets/oli-button.png')} style={s.headImg} resizeMode="cover" />
          <Text style={s.headTitle} accessibilityRole="header">{t('homeOliTitle', lang)}</Text>
          {canSave && messages.length > 0 && (
            <IconButton icon="trash-outline" onPress={confirmDelete} accessibilityLabel={t('oliChatDelete', lang)} />
          )}
          <IconButton icon="close" onPress={closeSheet} accessibilityLabel={t('uiClose', lang)} />
        </View>

        {history === 'error' && (
          // A history that would not load never blocks the chat: Oli still answers, the retry is here.
          <View style={s.historyErr}><ErrorState lang={lang} onRetry={loadHistory} /></View>
        )}
        {history === 'loading' ? (
          <View style={s.pad}><RowSkeleton count={4} /></View>
        ) : empty ? (
          <ScrollView contentContainerStyle={s.home} keyboardShouldPersistTaps="handled">
            <Image source={require('../assets/oli-button.png')} style={s.homeImg} resizeMode="cover" />
            <Text style={s.greeting}>{t('oliGreeting', lang)}</Text>
            <Text style={s.notice}>{t(canSave ? 'oliChatNotice' : 'oliChatNoticeGuest', lang)}</Text>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={it => it.key}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          style={s.chipsBar} contentContainerStyle={s.chips}>
          {CHIPS.map(c => (
            <TouchableOpacity key={c.id} style={s.chip} activeOpacity={press.small} accessibilityRole="button" disabled={busy}
              onPress={() => send('', c.id, t(c.labelKey, lang))}>
              <Text style={s.chipText}>{t(c.labelKey, lang)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {notSaved && <Text style={s.notSaved}>{t('oliChatNotSaved', lang)}</Text>}
        {!voice.available && <Text style={s.micHint}>{t('oliVoiceHint', lang)}</Text>}

        <View style={[s.composer, { paddingBottom: insets.bottom + 10 }]}>
          <View style={[s.field, elevation.floating]}>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              maxLength={500}
              placeholder={t(voice.listening ? 'oliListening' : 'oliChatPlaceholder', lang)}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="send"
              onSubmitEditing={() => send(input)}
              accessibilityLabel={t('oliChatPlaceholder', lang)}
            />
            {voice.available && <MicButton lang={lang} listening={voice.listening} onPress={voice.toggle} />}
          </View>
          <TouchableOpacity style={[s.send, !canSend && s.sendOff]} disabled={!canSend} activeOpacity={press.small}
            accessibilityRole="button" accessibilityLabel={t('oliChatSend', lang)} accessibilityState={{ disabled: !canSend }}
            onPress={() => send(input)}>
            <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:      { flex: 1, backgroundColor: colors.canvas, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
                overflow: 'hidden', ...elevation.tabBar },
  grabber:    { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: 10 },
  head:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  headImg:    { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, marginRight: 4 },
  headTitle:  { ...type.sheetTitle, color: colors.textPrimary, flex: 1 },
  pad:        { padding: 16 },
  historyErr: { flexShrink: 0 },
  home:       { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 24 },
  homeImg:    { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight, marginBottom: 14 },
  greeting:   { ...type.sectionHeading, color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  notice:     { ...type.small, color: colors.textSecondary, textAlign: 'center' },
  day:        { ...type.meta, color: colors.textSecondary, textAlign: 'center', marginVertical: 10 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: colors.primary, borderRadius: radii.card,
                borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
  userText:   { ...type.body, color: colors.onPrimary },
  oliRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  oliAvatar:  { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryLight, marginTop: 2 },
  oliBubble:  { flex: 1, backgroundColor: colors.card, borderRadius: radii.card, borderTopLeftRadius: 6, padding: 14 },
  oliText:    { ...type.body, color: colors.textPrimary },
  item:       { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8,
                borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 6 },
  itemTitle:  { ...type.rowTitle, color: colors.textPrimary },
  itemSub:    { ...type.small, color: colors.textSecondary },
  goBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44,
                marginTop: 12, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.primary },
  goText:     { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.onPrimary, flexShrink: 1 },
  typing:     { ...type.small, color: colors.textSecondary, marginLeft: 40, marginBottom: 12 },
  chipsBar:   { flexGrow: 0, flexShrink: 0 },
  chips:      { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  chip:       { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radii.pill,
                backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipText:   { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  notSaved:   { ...type.small, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 16 },
  composer:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 4, flexShrink: 0 },
  field:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 50, borderRadius: radii.pill,
                backgroundColor: colors.card, paddingLeft: 18, paddingRight: 4 },
  input:      { ...type.body, fontSize: 15, color: colors.textPrimary, flex: 1, padding: 0 },
  send:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  sendOff:    { opacity: 0.4 },
  micHint:    { ...type.small, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4 },
})
