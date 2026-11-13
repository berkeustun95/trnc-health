import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, Pressable, AppState, Linking, Platform, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { t, dateLocale } from '../constants/i18n'
import { colors, type, font, space, radii, press } from '../constants/theme'
import { Card } from './ui'
import { supabase, isGuest } from '../lib/supabase'
import { registeredPushToken } from '../utils/signOut'
import { REDESIGN } from '../constants/redesign'
import { requestWithPrimer } from '../utils/permissionPrimer'
import { orderStatusShown, orderStatusLive, orderTimeline, formatOrderCode, ORDER_POLL_MS } from '../constants/eatery'

// ─── Yeme-İçme: "Siparişin" — where the customer's recent orders stand (20261193/94) ──────────────────────
// Approved mock-up (dev page v27, item 6): a "Siparişin" card on the restaurant page for 24 h after sending, and a one-line strip
// on the Yeme & İçme list. my_eatery_orders() returns the caller's own orders of the last 24 h; a card shows only where status
// is in use (the verify page's rule, orderStatusShown). Polls every 30 s while on screen, the app is in front and an order can
// still move. Words are the customer's side in "sen" (the reasons = eatery_order_push_text, 20261194).
// "Durum değişince haber ver" attaches this phone's Expo token + the app language to that ONE order (guests too): no profile
// write. Not offered where status pushes already reach this phone: 20261194 falls back to a signed-in customer's profile token.

const EXPO_PROJECT_ID = '704d192a-1a80-41f8-ab98-cb3c8f078d7c'
// Read the caller's own recent orders (the list, and the push tap that opens the order's restaurant). null on any failure.
export async function fetchMyOrders() {
  try {
    const { data, error } = await supabase.rpc('my_eatery_orders')
    return !error && Array.isArray(data) ? data : null
  } catch { return null }
}

// true = eatery_order_set_status already pushes to THIS phone: a signed-in (not guest) account whose profile push_token is the
// token this phone registered, with notifications allowed. Guests and every other case get the button.
async function profilePushReachesThisPhone() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || isGuest(session)) return false
    const [mine, perm] = await Promise.all([registeredPushToken(), Notifications.getPermissionsAsync()])
    if (!mine || perm.status !== 'granted') return false
    const { data } = await supabase.from('profiles').select('push_token').eq('id', session.user.id).maybeSingle()
    return data?.push_token === mine
  } catch { return false }
}

const STEP_KEY = { sent: 'eateryOsSent', received: 'eateryOsReceived', preparing: 'eateryOsPreparing', on_the_way: 'eateryOsOnTheWay', ready: 'eateryOsReady', either: 'eateryOsEither' }
const REASON_KEY = { closed: 'eateryOsReasonClosed', busy: 'eateryOsReasonBusy', item_out: 'eateryOsReasonItemOut', no_delivery_there: 'eateryOsReasonNoDelivery', unreachable: 'eateryOsReasonUnreachable', other: 'eateryOsReasonOther' }

// HH:MM in Cyprus time (the restaurant's clock), in the app language's digits.
function timeText(iso, lang) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(dateLocale(lang), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Nicosia' }).format(d)
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

// Permission (with the ADA explanation first where the redesign is on), then the token, then the order-scoped subscribe.
// -> 'on' | 'off' (the OS will not ask again: settings) | 'later' ("Şimdi değil" or a first OS "No": back to the button, no message)
//    | 'closed' (the order became final meanwhile) | 'fail'
async function subscribeOrder(code, lang) {
  try {
    if (!Device.isDevice) return 'fail'
    const perm = REDESIGN ? await requestWithPrimer('notifications', { auto: false }) : await Notifications.requestPermissionsAsync()
    if (perm.status !== 'granted') return perm.canAskAgain === false ? 'off' : 'later'
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.MAX })
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })
    if (!token) return 'fail'
    const { error } = await supabase.rpc('eatery_order_subscribe', { p_code: code, p_token: token, p_lang: lang })
    if (error) return error.message === 'closed' ? 'closed' : 'fail'
    return 'on'
  } catch {
    return 'fail'
  }
}

function NotifyRow({ order, lang, onDone }) {
  const [state, setState] = useState('idle')   // idle | busy | later | off | fail
  const busy = state === 'busy'
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  // Back from the phone's settings with notifications now allowed: offer the button again (no automatic ask).
  useEffect(() => {
    if (state !== 'off') return
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active') return
      Notifications.getPermissionsAsync().then(p => { if (mounted.current && p.status === 'granted') setState('idle') }).catch(() => {})
    })
    return () => sub.remove()
  }, [state])
  const onPress = async () => {
    if (busy) return
    setState('busy')
    const r = await subscribeOrder(order.code, lang)
    if (!mounted.current) return
    if (r === 'on' || r === 'closed') { setState('idle'); onDone(); return }
    setState(r)
  }
  if (state === 'off') {
    return (
      <View style={s.note}>
        <Ionicons name="notifications-off-outline" size={18} color={colors.textSecondary} />
        <Text style={s.noteText}>{t('eateryOsNotifyOff', lang)}</Text>
        <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={8} accessibilityRole="button"
          style={({ pressed }) => [s.link, pressed && { opacity: press.small }]}>
          <Text style={s.linkText}>{t('openSettings', lang)}</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View>
      <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ busy, disabled: busy }}
        style={({ pressed }) => [s.notify, (pressed || busy) && { opacity: press.small }]}>
        <Ionicons name="notifications-outline" size={18} color={colors.primaryDark} />
        <Text style={s.notifyText}>{t('eateryOsNotify', lang)}</Text>
      </Pressable>
      {state === 'fail' && <Text style={s.failText} accessibilityLiveRegion="polite">{t('eateryOsNotifyFail', lang)}</Text>}
      {state === 'later' && <Text style={s.laterText}>{t('eateryOsNotifyLater', lang)}</Text>}
    </View>
  )
}

// One step: done = solid primary dot; current = primary dot inside a primaryLight ring (never primary vs primaryDark alone);
// upcoming = a fieldBorder ring. The rail is decoration; the step reads as "<label>, completed / current step / upcoming[, time]".
// Only the current step's text is a live region, so an unchanged row is never re-announced.
function Step({ label, at, done, current, last, lang }) {
  const a11y = t(current ? 'eateryOsStepNowA11y' : done ? 'eateryOsStepDoneA11y' : 'eateryOsStepNextA11y', lang).replace('{label}', () => label) + (at ? `, ${at}` : '')
  return (
    <View style={s.step} accessible accessibilityLabel={a11y}>
      <View style={s.rail} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[s.ring, current && s.ringCur]}>
          <View style={[s.dot, done && s.dotDone]} />
        </View>
        {!last && <View style={[s.bar, done && !current && s.barDone]} />}
      </View>
      <Text style={[s.stepText, done && s.stepDone, current && s.stepCur]} accessibilityLiveRegion={current ? 'polite' : 'none'}>
        {label}{at ? <Text style={s.stepTime}>{'  ' + at}</Text> : null}
      </Text>
    </View>
  )
}

const stepLabel = (order, lang) => {
  const tl = orderTimeline(order)
  return tl.cancelled ? t('eateryOsCancelled', lang) : t(STEP_KEY[tl.steps.find(x => x.current)?.key || 'sent'], lang)
}

// The restaurant page's card: "Siparişin" + the code, the timeline (or the cancel reason), the hint and the notify row.
export function OrderStatusCard({ order, lang, onChanged, pushCovered = false, stale = false }) {
  const tl = orderTimeline(order)
  const code = formatOrderCode(order.code)
  const notified = order.notify_set === true || pushCovered
  return (
    <Card>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">{t('eateryOsTitle', lang)}</Text>
        {order.is_test === true && <View style={s.test}><Text style={s.testText}>{t('eateryOsTest', lang)}</Text></View>}
        {!!code && <View style={s.code} accessible accessibilityLabel={t('eateryOsCode', lang).replace('{code}', () => code)}><Text style={s.codeText}>{code}</Text></View>}
      </View>
      {tl.cancelled ? (
        <View style={s.cancel}>
          <Text accessibilityLiveRegion="polite">
            <Text style={s.cancelTitle}>{t('eateryOsCancelled', lang)}{tl.at ? '  ' + timeText(tl.at, lang) : ''}</Text>
            {'\n'}
            <Text style={s.cancelReason}>{t(REASON_KEY[tl.reason], lang)}</Text>
          </Text>
        </View>
      ) : (
        <View style={s.steps}>
          {tl.steps.map((st, i) => (
            <Step key={st.key} label={t(STEP_KEY[st.key], lang)} at={timeText(st.at, lang)} done={st.done} current={st.current} last={i === tl.steps.length - 1} lang={lang} />
          ))}
        </View>
      )}
      {stale && <Text style={s.stale}>{t('eateryOsStale', lang)}</Text>}
      {order.status_open === true && <Text style={s.hint}>{t('eateryOsHint', lang)}</Text>}
      {order.status_open === true && (notified
        ? (
          <View style={s.note}>
            <Ionicons name="notifications" size={18} color={colors.primaryDark} />
            <Text style={s.noteText}>{t('eateryOsNotifyOn', lang)}</Text>
          </View>
        )
        : <NotifyRow order={order} lang={lang} onDone={onChanged} />)}
    </Card>
  )
}

// The list's one-line strip: <restaurant> (shrinks first) · [TEST] · <status> (never pushed off) -> that restaurant's page, where
// the card is. "Siparişin" is spoken, not shown.
function OrderStrip({ order, lang, onOpen }) {
  const status = stepLabel(order, lang)
  const label = [t('eateryOsTitle', lang), order.partner_name, order.is_test === true && t('eateryOsTest', lang), status].filter(Boolean).join(', ')
  return (
    <Pressable onPress={() => onOpen(order)} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.strip, pressed && { opacity: press.small }]}>
      <Ionicons name="receipt-outline" size={18} color={colors.primaryDark} />
      <Text style={s.stripName} numberOfLines={1}>{order.partner_name}</Text>
      {order.is_test === true && <View style={s.testSm}><Text style={s.testText}>{t('eateryOsTest', lang)}</Text></View>}
      <Text style={s.stripStatus} numberOfLines={1}>{status}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.primaryDark} />
    </Pressable>
  )
}

// active: on screen (false while something covers it). partnerId set = the restaurant page: that restaurant's cards; unset = the
// list: one strip per order, onOpen(order) opens its restaurant. refreshKey: bump to re-read (back from the WhatsApp hand-off,
// a push tap); onReveal runs once per bump when that read has a card to show (the restaurant page scrolls up to it).
export default function EateryOrderStatusList({ lang, active = true, partnerId = null, refreshKey = 0, onReveal = null, onOpen = null }) {
  const [orders, setOrders] = useState([])
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const alive = useRef(true)
  const loadedKey = useRef(0)   // the refreshKey the rows on screen were read for
  useEffect(() => () => { alive.current = false }, [])

  const keyRef = useRef(refreshKey)
  keyRef.current = refreshKey
  const [stale, setStale] = useState(false)   // the last read failed: what is on screen may be old
  const load = useCallback(async () => {
    const key = keyRef.current
    const data = await fetchMyOrders()
    if (!alive.current) return
    if (!data) { setStale(true); return }   // offline: keep what is on screen, and say so
    loadedKey.current = key
    setStale(false)
    setOrders(data)
  }, [])
  const [pushCovered, setPushCovered] = useState(false)
  useEffect(() => {
    if (!partnerId) return
    profilePushReachesThisPhone().then(v => { if (alive.current) setPushCovered(v) })
  }, [partnerId])

  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setAppActive(st === 'active'))
    return () => sub.remove()
  }, [])
  useEffect(() => { if (active && appActive) load() }, [active, appActive, refreshKey, load])

  const shown = orders.filter(o => orderStatusShown(o) && (!partnerId || o.partner_id === partnerId))
  const live = shown.some(orderStatusLive)
  const revealed = useRef(0)
  useEffect(() => {
    if (!onReveal || refreshKey === 0 || revealed.current === refreshKey || loadedKey.current !== refreshKey || shown.length === 0) return
    revealed.current = refreshKey
    onReveal()
  })
  useEffect(() => {
    if (!active || !appActive || !live) return
    const id = setInterval(load, ORDER_POLL_MS)
    return () => clearInterval(id)
  }, [active, appActive, live, load])

  if (shown.length === 0) return null
  return (
    <View style={s.list}>
      {shown.map(o => (partnerId
        ? <OrderStatusCard key={o.code} order={o} lang={lang} onChanged={load} pushCovered={pushCovered} stale={stale} />
        : <OrderStrip key={o.code} order={o} lang={lang} onOpen={onOpen} />))}
    </View>
  )
}

const DOT = 12
const RING = DOT + 6
const s = StyleSheet.create({
  list:        { gap: space[8] },
  head:        { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  title:       { ...type.sectionHeading, color: colors.textPrimary, flex: 1 },
  test:        { borderRadius: radii.pill, backgroundColor: colors.dangerLight, paddingHorizontal: space[8], paddingVertical: 2 },
  testSm:      { borderRadius: radii.pill, backgroundColor: colors.dangerLight, paddingHorizontal: 6, paddingVertical: 1, flexShrink: 0 },
  testText:    { ...type.meta, fontFamily: font.semibold, color: colors.dangerInk },
  code:        { borderRadius: radii.pill, backgroundColor: colors.soft, paddingHorizontal: space[8], paddingVertical: 2, flexShrink: 0 },
  codeText:    { ...type.meta, fontFamily: font.semibold, color: colors.textPrimary, fontVariant: ['tabular-nums'], letterSpacing: 0.5 },
  hint:        { ...type.small, color: colors.textSecondary, marginTop: space[4] },
  strip:       { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space[8], borderRadius: radii.md, backgroundColor: colors.primaryLight, paddingHorizontal: space[12], paddingVertical: space[8] },
  stripName:   { ...type.body, fontFamily: font.semibold, color: colors.primaryDark, flex: 1, minWidth: 0 },
  stripStatus: { ...type.small, fontFamily: font.semibold, color: colors.primaryDark, flexShrink: 0, maxWidth: '60%' },
  steps:       { marginTop: space[12] },
  step:        { flexDirection: 'row', gap: space[12], minHeight: 32 },
  rail:        { width: RING, alignItems: 'center' },
  ring:        { width: RING, height: RING, borderRadius: RING / 2, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  ringCur:     { backgroundColor: colors.primaryLight },
  dot:         { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  dotDone:     { borderColor: colors.primary, backgroundColor: colors.primary },
  bar:         { flex: 1, width: 2, minHeight: 12, backgroundColor: colors.fieldBorder },
  barDone:     { backgroundColor: colors.primary },
  stepText:    { ...type.body, color: colors.textSecondary, flex: 1, paddingBottom: space[8] },
  stepDone:    { color: colors.textPrimary },
  stepCur:     { fontFamily: font.semibold, color: colors.primaryDark },
  stepTime:    { ...type.small, fontFamily: font.regular, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  cancel:      { marginTop: space[12], borderRadius: radii.md, backgroundColor: colors.dangerLight, padding: space[12], gap: space[4] },
  cancelTitle: { ...type.rowTitle, color: colors.dangerInk },
  cancelReason:{ ...type.body, color: colors.textPrimary },
  notify:      { marginTop: space[12], minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space[8], borderRadius: radii.md, backgroundColor: colors.primaryLight, paddingHorizontal: space[12], paddingVertical: space[8] },
  notifyText:  { ...type.body, fontFamily: font.semibold, color: colors.primaryDark, flex: 1 },
  failText:    { ...type.small, color: colors.dangerInk, marginTop: space[4] },
  laterText:   { ...type.small, color: colors.textSecondary, marginTop: space[4] },
  stale:       { ...type.meta, color: colors.textSecondary, marginTop: space[4] },
  note:        { marginTop: space[12], flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[8], rowGap: space[4] },
  noteText:    { ...type.small, color: colors.textSecondary, flexShrink: 1, flexGrow: 1, flexBasis: 200 },
  link:        { minHeight: 44, justifyContent: 'center' },
  linkText:    { ...type.small, fontFamily: font.semibold, color: colors.primary },
})
