import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, Pressable, AppState, Linking, Platform, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { t, dateLocale } from '../constants/i18n'
import { colors, type, font, space, radii, press } from '../constants/theme'
import { Card } from './ui'
import { supabase } from '../lib/supabase'
import { REDESIGN } from '../constants/redesign'
import { requestWithPrimer } from '../utils/permissionPrimer'
import { orderStatusShown, orderStatusLive, orderTimeline, formatOrderCode, ORDER_POLL_MS } from '../constants/eatery'

// ─── Yeme-İçme: "Siparişin" — where the customer's recent orders stand (20261193/94) ──────────────────────
// my_eatery_orders() returns the caller's own orders of the last 24 h; a card shows only where status is in use (the verify
// page's rule, orderStatusShown). Polls every 30 s while it is on screen, the app is in front and an order can still move;
// a push tap (data { screen: 'eatery_order', code }) opens the module with that card first. The words match the verify page.
// "Durum değişince haber ver" attaches this phone's Expo token + the app language to that ONE order (guests too): no profile write.

const EXPO_PROJECT_ID = '704d192a-1a80-41f8-ab98-cb3c8f078d7c'
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
  const [state, setState] = useState('idle')   // idle | busy | off | fail
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
    setState(r === 'later' ? 'idle' : r)
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
    </View>
  )
}

function Step({ label, at, done, current, last }) {
  return (
    <View style={s.step}>
      <View style={s.rail}>
        <View style={[s.dot, done && s.dotDone, current && s.dotCur]} />
        {!last && <View style={[s.bar, done && !current && s.barDone]} />}
      </View>
      <Text style={[s.stepText, done && s.stepDone, current && s.stepCur]}>
        {label}{at ? <Text style={s.stepTime}>{'  ' + at}</Text> : null}
      </Text>
    </View>
  )
}

export function OrderStatusCard({ order, lang, onChanged }) {
  const tl = orderTimeline(order)
  const code = formatOrderCode(order.code)
  const kind = order.fulfilment === 'pickup' ? t('eateryOsPickup', lang) : order.fulfilment === 'delivery' ? t('eateryOsDelivery', lang) : ''
  return (
    <Card>
      <View style={s.head}>
        <Ionicons name="receipt-outline" size={18} color={colors.primaryDark} />
        <Text style={s.title} accessibilityRole="header">{t('eateryOsTitle', lang)}</Text>
        {order.is_test === true && <View style={s.test}><Text style={s.testText}>{t('eateryOsTest', lang)}</Text></View>}
      </View>
      <Text style={s.partner}>{order.partner_name}</Text>
      <Text style={s.meta}>{[code && t('eateryOsCode', lang).replace('{code}', () => code), kind].filter(Boolean).join(' · ')}</Text>
      {tl.cancelled ? (
        <View style={s.cancel} accessibilityLiveRegion="polite">
          <Text style={s.cancelTitle}>{t('eateryOsCancelled', lang)}{tl.at ? '  ' + timeText(tl.at, lang) : ''}</Text>
          <Text style={s.cancelReason}>{t(REASON_KEY[tl.reason], lang)}</Text>
        </View>
      ) : (
        <View style={s.steps} accessibilityLiveRegion="polite">
          {tl.steps.map((st, i) => (
            <Step key={st.key} label={t(STEP_KEY[st.key], lang)} at={timeText(st.at, lang)} done={st.done} current={st.current} last={i === tl.steps.length - 1} />
          ))}
        </View>
      )}
      {order.status_open === true && (order.notify_set === true
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

// active: the list is on screen (false while a partner page covers it). partnerId: only that restaurant's orders.
// focusCode: a push tap's order, drawn first. refreshKey: bump to re-read (back from the WhatsApp hand-off); onReveal runs once
// per bump when that read has a card to show (the partner page scrolls up to it).
export default function EateryOrderStatusList({ lang, active = true, partnerId = null, focusCode = null, refreshKey = 0, onReveal = null }) {
  const [orders, setOrders] = useState([])
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const alive = useRef(true)
  const loadedKey = useRef(0)   // the refreshKey the rows on screen were read for
  useEffect(() => () => { alive.current = false }, [])

  const keyRef = useRef(refreshKey)
  keyRef.current = refreshKey
  const load = useCallback(async () => {
    const key = keyRef.current
    try {
      const { data, error } = await supabase.rpc('my_eatery_orders')
      if (!alive.current || error || !Array.isArray(data)) return
      loadedKey.current = key
      setOrders(data)
    } catch { /* offline: keep what is on screen */ }
  }, [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setAppActive(st === 'active'))
    return () => sub.remove()
  }, [])
  useEffect(() => { if (active && appActive) load() }, [active, appActive, focusCode, refreshKey, load])

  const shown = orders
    .filter(o => orderStatusShown(o) && (!partnerId || o.partner_id === partnerId))
    .sort((a, b) => (b.code === focusCode) - (a.code === focusCode))
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
      {shown.map(o => <OrderStatusCard key={o.code} order={o} lang={lang} onChanged={load} />)}
    </View>
  )
}

const DOT = 12
const s = StyleSheet.create({
  list:        { gap: 14 },
  head:        { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  title:       { ...type.sectionHeading, color: colors.textPrimary, flexShrink: 1 },
  test:        { marginLeft: 'auto', borderRadius: radii.pill, backgroundColor: colors.dangerLight, paddingHorizontal: space[8], paddingVertical: 2 },
  testText:    { ...type.meta, fontFamily: font.semibold, color: colors.dangerInk },
  partner:     { ...type.rowTitle, color: colors.textPrimary, marginTop: space[8] },
  meta:        { ...type.small, color: colors.textSecondary, marginTop: 2 },
  steps:       { marginTop: space[12] },
  step:        { flexDirection: 'row', gap: space[12], minHeight: 32 },
  rail:        { width: DOT, alignItems: 'center' },
  dot:         { width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: 4, borderWidth: 2, borderColor: colors.border, backgroundColor: 'transparent' },
  dotDone:     { borderColor: colors.primary, backgroundColor: colors.primary },
  dotCur:      { borderColor: colors.primaryDark, backgroundColor: colors.primaryDark },
  bar:         { flex: 1, width: 2, minHeight: 12, backgroundColor: colors.border },
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
  note:        { marginTop: space[12], flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[8], rowGap: space[4] },
  noteText:    { ...type.small, color: colors.textSecondary, flexShrink: 1, flexGrow: 1, flexBasis: 200 },
  link:        { minHeight: 44, justifyContent: 'center' },
  linkText:    { ...type.small, fontFamily: font.semibold, color: colors.primary },
})
