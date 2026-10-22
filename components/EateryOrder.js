import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, TextInput, Keyboard, AccessibilityInfo, AppState, Animated, Dimensions, Easing, Linking, PixelRatio, Platform, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import * as Location from 'expo-location'
import { ORDER_NOTE_MAX, ADDRESS_FIELD_MAX, deliveryReady, withTimeout, locateOutcome, locateNote, LOCATE_TIMEOUT_MS } from '../constants/eatery'
import { REDESIGN } from '../constants/redesign'
import { requestWithPrimer } from '../utils/permissionPrimer'
import { askedFix } from '../utils/locationServices'
import { deleteAddress } from '../utils/eateryAddress'
import { colors, font, type, radii, space, press, motion, TAP } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from './ui'
import { EateryLogo, eateryImageUrl } from './EateryBits'

// ─── Yeme-İçme: order via WhatsApp (the basket is utils/eateryBasket.js, the message constants/eatery.js) ───
// The menu has the quantity stepper and a bar; "Sepetim" (BasketPage) is a full page layered over the partner page.
// Defined outside the screen: these re-render on every tap and must not remount.

const MAX_QTY = 99
// What the Sepetim footer says under the send button (null = nothing). Set by EateryPartnerScreen's sendOrder.
const ORDER_ERR_KEY = { adult: 'eateryOrderAdultOnly', generic: 'eateryOrderErrGeneric', rate: 'eateryOrderErrRate', account: 'eateryOrderErrAccount', prices: 'eateryOrderErrPrices', items: 'eateryOrderErrItems' }

// 0 = a single "Ekle" pill; 1+ = [−] n [+]. Every target is 44pt.
export function QtyStepper({ id, name, qty, onQty, lang }) {
  const sub = key => t(key, lang).replace('{name}', () => name).replace('{qty}', () => String(qty))
  if (qty < 1) {
    return (
      <Pressable onPress={() => onQty(id, 1)} style={({ pressed }) => [st.add, pressed && { opacity: press.small }]}
        accessibilityRole="button" accessibilityLabel={sub('eateryOrderAddA11y')}>
        <Ionicons name="add" size={18} color={colors.primaryDark} />
        <Text style={st.addText} numberOfLines={1}>{t('eateryOrderAdd', lang)}</Text>
      </Pressable>
    )
  }
  return (
    <View style={st.row}>
      <Pressable onPress={() => onQty(id, -1)} style={({ pressed }) => [st.round, st.minus, pressed && { opacity: press.small }]}
        accessibilityRole="button" accessibilityLabel={sub(qty === 1 ? 'eateryOrderRemove' : 'eateryOrderLess')}>
        <Ionicons name={qty === 1 ? 'trash-outline' : 'remove'} size={18} color={colors.primaryDark} />
      </Pressable>
      <Text style={st.qty} accessible accessibilityLiveRegion="polite" accessibilityLabel={sub('eateryOrderQty')}>{qty}</Text>
      <Pressable onPress={() => onQty(id, 1)} disabled={qty >= MAX_QTY} style={({ pressed }) => [st.round, st.plus, pressed && { opacity: press.small }]}
        accessibilityRole="button" accessibilityState={{ disabled: qty >= MAX_QTY }} accessibilityLabel={sub('eateryOrderMore')}>
        <Ionicons name="add" size={18} color={colors.onPrimary} />
      </Pressable>
    </View>
  )
}

// Pinned under the scroll view. Wide enough: "Sepete git · 3 ürün · 1.890,00 TL" on one button; on a narrow phone
// or a large font the count and total move to a line above instead of truncating.
export function OrderBar({ count, totalText, lang, onOpen, partnerName }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const stacked = width < 380 || PixelRatio.getFontScale() > 1.15
  const summary = t('eateryOrderCount', lang).replace('{n}', () => String(count)).replace('{total}', () => totalText)
  const go = t('eateryBasketGo', lang)
  return (
    <View style={[st.bar, { paddingBottom: insets.bottom + space[12] }]}>
      {stacked && <Text style={st.barSummary}>{summary}</Text>}
      <Button fullWidth icon="basket-outline" title={stacked ? go : `${go} · ${summary}`} onPress={onOpen}
        accessibilityLabel={`${partnerName ? partnerName + '. ' : ''}${go}, ${summary}`} />
    </View>
  )
}

// The keyboard's top edge in screen coordinates (null while it is closed). The lift is NOT taken from the reported
// height: BasketPage measures where its footer really ends against this edge (device-tested: the reported height
// and the window's own partial resize disagree).
function useKeyboardTop() {
  const [top, setTop] = useState(null)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', e => {
      const { height, screenY } = e.endCoordinates
      setTop(screenY > 0 ? Math.round(screenY) : Math.round(Dimensions.get('screen').height - height))
    })
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setTop(null))
    return () => { show.remove(); hide.remove() }
  }, [])
  return top
}

// A dish photo is partner content, shown as sent (contain) in the menu's white frame. Always a 56 box so names
// align: a dish with no photo, or one that failed to load, gets a soft tile with an icon.
function LineThumb({ photoPath }) {
  const [failed, setFailed] = useState(false)
  const uri = eateryImageUrl(photoPath)
  const photo = !!uri && !failed
  return (
    <View style={[st.thumb, !photo && st.thumbEmpty]} accessible={false} importantForAccessibility="no-hide-descendants">
      {photo
        ? <RemoteImage source={{ uri }} resizeMode="contain" style={st.fill} placeholderColor={colors.card}
            onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
        : <Ionicons name="restaurant-outline" size={22} color={colors.textSecondary} />}
    </View>
  )
}

function BasketLine({ line, onQty, formatMoney, lang }) {
  return (
    <View style={st.line}>
      <LineThumb photoPath={line.photoPath} />
      <View style={st.lineMain}>
        <Text style={st.lineName}>{line.name}</Text>
        <Text style={st.linePrice}>{formatMoney(line.price)}</Text>
        <View style={st.lineFoot}>
          <QtyStepper id={line.id} name={line.name} qty={line.qty} onQty={onQty} lang={lang} />
          <Text style={st.lineTotal}>{formatMoney(line.qty * line.price)}</Text>
        </View>
      </View>
    </View>
  )
}

// "Teslimat": pick-up or delivery is REQUIRED before sending. The address and the optional location go into the WhatsApp text
// only (constants/eatery.js deliveryLine); nothing here touches the server. Defined outside BasketPage so typing never remounts it.
const FIELDS = [['street', 'eateryDeliveryStreet'], ['building', 'eateryDeliveryBuilding'], ['district', 'eateryDeliveryDistrict']]

function DeliveryOption({ checked, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.opt, checked && st.optOn, pressed && { opacity: press.small }]}
      accessibilityRole="radio" accessibilityState={{ checked }}>
      <Ionicons name={checked ? 'radio-button-on' : 'radio-button-off'} size={22} color={checked ? colors.primaryDark : colors.textSecondary} />
      <Text style={[st.optText, checked && st.optTextOn]}>{label}</Text>
    </Pressable>
  )
}

function DeliveryCard({ lang, open, delivery, onDelivery, inputs, wraps, onFocusInput, onBlurInput }) {
  const [locating, setLocating] = useState(false)
  const [locNote, setLocNote] = useState(null)   // { msgKey, action } | null
  const alive = useRef(true)
  const wentToSettings = useRef(false)   // the services-off dialog itself backgrounds the app on Android; only a trip to Settings may clear the note
  const openRef = useRef(open)
  const modeRef = useRef(delivery.mode)
  openRef.current = open
  modeRef.current = delivery.mode
  useEffect(() => () => { alive.current = false }, [])
  const noteHasAction = !!locNote?.action
  useEffect(() => { wentToSettings.current = false }, [locNote])
  useEffect(() => {
    if (!noteHasAction) return
    const sub = AppState.addEventListener('change', s => { if (s === 'active' && wentToSettings.current) { wentToSettings.current = false; setLocNote(null) } })
    return () => sub.remove()
  }, [noteHasAction])
  const isHome = delivery.mode === 'delivery'
  const hasAny = !!(delivery.street || delivery.building || delivery.district || delivery.coords)
  const choose = mode => { setLocNote(null); onDelivery(mode === 'pickup' ? { mode, coords: null } : { mode }) }
  // Last known (2 min) first, else a fresh fix raced against a timeout (indoors it can hang), else an older one.
  const getFix = async () => {
    const last = async maxAge => { try { return await Location.getLastKnownPositionAsync({ maxAge }) } catch { return null } }
    return (await last(120000))
      ?? (await withTimeout(askedFix(Location.Accuracy.Balanced), LOCATE_TIMEOUT_MS))
      ?? (await last(600000))
  }
  const addLocation = async () => {
    if (locating) return
    setLocating(true)
    setLocNote(null)
    let perm = { status: null, canAskAgain: true }
    let fix = null
    try {
      perm = REDESIGN ? await requestWithPrimer('location') : await Location.requestForegroundPermissionsAsync()
      if (perm?.status === 'granted') fix = await getFix()
    } catch { fix = null }
    let servicesOn = true
    try { servicesOn = await Location.hasServicesEnabledAsync() } catch {}
    if (!alive.current) return
    setLocating(false)
    if (!openRef.current || modeRef.current !== 'delivery') return
    const outcome = locateOutcome({ granted: perm?.status === 'granted', canAskAgain: perm?.canAskAgain !== false, servicesOn, fix })
    if (outcome === 'ok') {
      const c = fix.coords
      onDelivery({ coords: { lat: c.latitude, lng: c.longitude } })
      AccessibilityInfo.announceForAccessibility?.(t('eateryDeliveryLocated', lang))
    } else {
      const note = locateNote(outcome)
      setLocNote(note)
      AccessibilityInfo.announceForAccessibility?.(t(note.msgKey, lang))
    }
  }
  const openLocationFix = async action => {
    wentToSettings.current = true
    try {
      if (action === 'locationSettings' && Platform.OS === 'android') {
        try { await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS') } catch { await Linking.openSettings() }
      } else await Linking.openSettings()
    } catch {}
  }
  const clear = () => { setLocNote(null); if (delivery.addressId) deleteAddress(delivery.addressId); onDelivery({ addressId: null, kind: 'home', name: '', street: '', building: '', district: '', floor: '', flat: '', directions: '', coords: null }) }
  return (
    <Card>
      <Text style={st.noteLabel} accessibilityRole="header">{t('eateryDeliveryTitle', lang)}</Text>
      <View accessibilityRole="radiogroup" style={st.opts}>
        <DeliveryOption checked={delivery.mode === 'pickup'} label={t('eateryDeliveryPickup', lang)} onPress={() => choose('pickup')} />
        <DeliveryOption checked={isHome} label={t('eateryDeliveryHome', lang)} onPress={() => choose('delivery')} />
      </View>
      {isHome && (
        <View style={st.addr}>
          {FIELDS.map(([f, key], i) => (
            <View key={f} ref={wraps[f]} collapsable={false}>
              <Text style={st.fieldLabel}>{t(key, lang)}</Text>
              <TextInput ref={inputs[f]} style={st.field} value={delivery[f]} onChangeText={v => onDelivery({ [f]: v })} maxLength={ADDRESS_FIELD_MAX}
                autoCapitalize="words" autoCorrect={false} autoComplete="off" importantForAutofill="no" textContentType="none" accessibilityLabel={t(key, lang)}
                returnKeyType={i < FIELDS.length - 1 ? 'next' : 'done'} blurOnSubmit={i === FIELDS.length - 1}
                onSubmitEditing={() => { if (i < FIELDS.length - 1) inputs[FIELDS[i + 1][0]].current?.focus() }}
                onFocus={() => onFocusInput(inputs[f], wraps[f])} onBlur={() => onBlurInput(inputs[f])} />
            </View>
          ))}
          {delivery.coords ? (
            <View style={st.locRow}>
              <Ionicons name="location" size={18} color={colors.primaryDark} />
              <Text style={st.locText}>{t('eateryDeliveryLocated', lang)}</Text>
              <Button variant="text" title={t('eateryDeliveryLocRemove', lang)} onPress={() => onDelivery({ coords: null })}
                accessibilityLabel={t('eateryDeliveryLocRemoveA11y', lang)} />
            </View>
          ) : (
            <Button variant="secondary" fullWidth icon="locate-outline" title={t('eateryDeliveryLocate', lang)} loading={locating}
              loadingTitle={t('eateryDeliveryLocating', lang)} onPress={addLocation} />
          )}
          {!delivery.coords && (locNote ? (
            <View style={st.locFail}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={st.locFailText}>{t(locNote.msgKey, lang)}</Text>
              {locNote.action && <Button variant="text" title={t('openSettings', lang)} onPress={() => openLocationFix(locNote.action)} />}
            </View>
          ) : <Text style={st.locNote}>{t('eateryDeliveryLocateNote', lang)}</Text>)}
          <Text style={st.hint}>{t('eateryDeliveryPrivacy', lang)}</Text>
          {hasAny && <Button variant="text" icon="trash-outline" title={t('eateryDeliveryClear', lang)} onPress={clear} style={st.clear} />}
        </View>
      )}
    </Card>
  )
}

// "Sepetim": slides in over the partner page and slides out again (reduced motion: no slide either way). The parent
// keeps it mounted until onClosed, so Android back / the iOS edge swipe (EateryPartnerScreen's backRef flips `open`)
// animate out too. The scroll area holds everything but the footer, which stays pinned above the nav bar / keyboard.
export function BasketPage({ partner, lang, open, lines, onQty, formatMoney, totalText, note, onNote, delivery, onDelivery, onClear, onSend, onClose, onClosed, reduce, sending = false, orderError = null, ageGate = null, onSignIn }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const footerRef = useRef(null)
  const rootRef = useRef(null)
  const noteInput = useRef(null)
  const addrInputs = useRef({ street: { current: null }, building: { current: null }, district: { current: null } }).current
  const addrWraps = useRef({ street: { current: null }, building: { current: null }, district: { current: null } }).current
  const focusedWrap = useRef(null)   // the address field's label + input wrapper, measured so the label is revealed too
  const focused = useRef(null)   // the input the keyboard is for (note or an address field)
  const scrollY = useRef(0)
  const hadKb = useRef(false)
  // Back closes the keyboard but leaves the field focused, and the next tap elsewhere is then swallowed: blur with it.
  useEffect(() => {
    if (kbTop == null && hadKb.current) { focused.current?.current?.blur(); noteInput.current?.blur() }
    hadKb.current = kbTop != null
  }, [kbTop])
  const onFocusInput = useCallback((ref, wrap) => { focused.current = ref; focusedWrap.current = wrap || null }, [])
  const onBlurInput = useCallback(ref => { if (focused.current === ref) focused.current = null }, [])
  const [lift, setLift] = useState(0)
  const measureFooter = useCallback(() => {
    if (kbTop == null) { setLift(0); return }
    // measureInWindow is window-relative and the window can start below the screen top (translucent status bar), while
    // the keyboard's screenY is screen-relative: the page root's own y gives the offset (device-diagnosed).
    const root = rootRef.current, footer = footerRef.current
    if (!root || !footer) return
    root.measureInWindow((_rx, ry) => footer.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h - ry - kbTop)))))
  }, [kbTop])
  useEffect(() => { measureFooter(); const id = setTimeout(measureFooter, 250); return () => clearTimeout(id) }, [measureFooter])
  const slide = useRef(new Animated.Value(reduce ? 0 : winW)).current
  const scrollRef = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    const to = open ? 0 : winW
    const done = () => { if (!open) onClosed?.() }
    if (reduce) { slide.setValue(to); done(); return }
    if (first.current && open) slide.setValue(winW)
    first.current = false
    Animated.timing(slide, { toValue: to, duration: open ? motion.sheetIn : motion.sheetOut,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true }).start(done)
  }, [open])
  // Keeps the focused input above the pinned footer: the note scrolls to the end (its counter and hint show), an address
  // field is measured NOW against the footer's top (window coordinates, never cached layout) and the list moves by the gap.
  const reveal = useCallback(() => {
    const ref = focused.current, sv = scrollRef.current, footer = footerRef.current
    if (!ref?.current || !sv) return
    if (ref === noteInput) { sv.scrollToEnd({ animated: !reduce }); return }
    if (!footer) return
    sv.measureInWindow((_sx, sy) => footer.measureInWindow((_fx, fy) => (focusedWrap.current?.current || ref.current)?.measureInWindow((_x, y, _w, h) => {
      const bottom = y + h + space[16], top = y - space[16]
      if (bottom > fy) sv.scrollTo({ y: Math.max(0, scrollY.current + (bottom - fy)), animated: !reduce })
      else if (top < sy) sv.scrollTo({ y: Math.max(0, scrollY.current - (sy - top)), animated: !reduce })
    })))
  }, [reduce])
  useEffect(() => {
    if (kbTop == null) return
    const ids = [setTimeout(reveal, 60), setTimeout(reveal, 320)]   // again once the footer lift has settled
    return () => ids.forEach(clearTimeout)
  }, [kbTop, reveal])
  const focusReveal = useCallback((ref, wrap) => { onFocusInput(ref, wrap); if (hadKb.current) { setTimeout(reveal, 60) } }, [onFocusInput, reveal])
  const empty = lines.length === 0
  const msgKey = ageGate ? 'eateryOrderAdultOnly' : orderError ? ORDER_ERR_KEY[orderError] : null
  const tone = !ageGate && ['generic', 'rate', 'account'].includes(orderError) ? 'bad' : 'calm'   // a state or a refreshed basket is not an alarm
  const ready = deliveryReady(delivery)
  const deliveryKey = ready ? null : delivery.mode === 'delivery' ? 'eateryDeliveryNeedAddress' : 'eateryDeliveryNeedChoose'
  const showSignIn = ageGate === 'guest' || (!ageGate && orderError === 'account')
  useEffect(() => {
    if (msgKey) AccessibilityInfo.announceForAccessibility?.(t(msgKey, lang))   // iOS does not always speak a live region
  }, [msgKey])
  return (
    <Animated.View ref={rootRef} collapsable={false} style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
      <SafeAreaView style={st.page} edges={['top']}>
        <ScreenHeader lang={lang} title={t('eateryBasketTitle', lang)} onBack={onClose} />
        <ScrollView ref={scrollRef} style={st.scroll} contentContainerStyle={[st.content, empty && { paddingBottom: insets.bottom + space[16] }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }} scrollEventThrottle={16}>
          <View style={st.who}>
            <EateryLogo partner={partner} width={36} height={36} radius={radii.pill} decorative />
            <Text style={st.whoName}>{partner.name}</Text>
          </View>
          {empty ? (
            <View style={st.empty}>
              <Ionicons name="basket-outline" size={44} color={colors.textSecondary} />
              <Text style={st.emptyTitle} accessibilityRole="header">{t('eateryBasketEmpty', lang)}</Text>
              <Text style={st.emptyBody}>{t('eateryBasketEmptyBody', lang)}</Text>
              <Button variant="secondary" title={t('eateryBasketBackToMenu', lang)} onPress={onClose} style={st.emptyBtn} />
            </View>
          ) : (
            <>
              <Card padding={space[12]}>
                {lines.map((l, i) => (
                  <View key={l.id} style={i > 0 && st.lineSep}>
                    <BasketLine line={l} onQty={onQty} formatMoney={formatMoney} lang={lang} />
                  </View>
                ))}
              </Card>
              <Button variant="text" icon="trash-outline" title={t('eateryBasketClear', lang)} onPress={onClear} style={st.clear} />
              <DeliveryCard lang={lang} open={open} delivery={delivery} onDelivery={onDelivery} inputs={addrInputs} wraps={addrWraps} onFocusInput={focusReveal} onBlurInput={onBlurInput} />
              <Card>
                <Text style={st.noteLabel}>{t('eateryOrderNote', lang)}</Text>
                <TextInput ref={noteInput} style={st.input} value={note} onChangeText={onNote} maxLength={ORDER_NOTE_MAX} multiline
                  placeholder={t('eateryOrderNotePlaceholder', lang)} placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={t('eateryOrderNote', lang)} textAlignVertical="top"
                  onFocus={() => focusReveal(noteInput)} onBlur={() => onBlurInput(noteInput)} />
                <Text style={st.counter} accessibilityElementsHidden importantForAccessibility="no">{note.length}/{ORDER_NOTE_MAX}</Text>
                <Text style={st.hint}>{t('eateryOrderHint', lang)}</Text>
              </Card>
            </>
          )}
        </ScrollView>
        {!empty && (
          <View ref={footerRef} collapsable={false} onLayout={measureFooter} style={[st.footer, { paddingBottom: (kbTop != null ? lift : insets.bottom) + space[12] }]}>
            <View style={st.totalRow}>
              <Text style={st.totalLabel}>{t('eateryOrderTotal', lang)}</Text>
              <Text style={st.totalVal}>{totalText}</Text>
            </View>
            {ageGate ? null : <Button fullWidth icon="logo-whatsapp" title={t('eateryOrderSend', lang)} loadingTitle={t('eateryOrderSending', lang)} onPress={onSend} loading={sending}
              disabled={!ready} disabledHint={!orderError && deliveryKey && kbTop == null ? t(deliveryKey, lang) : undefined} />}
            <View accessibilityLiveRegion="polite">
              {!!msgKey && msgKey !== 'eateryOrderErrAccount' && <Text style={[st.errText, tone === 'bad' ? st.errBad : ageGate ? st.errCalm : st.errInfo]}>{t(msgKey, lang)}</Text>}
            </View>
            {showSignIn && (
              <Button variant="secondary" fullWidth title={t('eateryOrderErrAccount', lang)} onPress={onSignIn} style={st.errBtn} />
            )}
          </View>
        )}
      </SafeAreaView>
    </Animated.View>
  )
}

const st = StyleSheet.create({
  add:       { minHeight: TAP, paddingHorizontal: space[16], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4], borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  addText:   { ...type.body, fontFamily: font.semibold, color: colors.primaryDark },
  row:       { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  round:     { width: TAP, height: TAP, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  minus:     { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  plus:      { backgroundColor: colors.primary },
  qty:       { minWidth: 28, textAlign: 'center', ...type.rowTitle, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  bar:       { flexShrink: 0, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: space[16], paddingTop: space[12], gap: space[8] },
  barSummary:{ ...type.rowTitle, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  page:      { flex: 1, backgroundColor: colors.canvas },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: space[16], paddingTop: space[8], paddingBottom: space[16], gap: space[12] },
  footer:    { flexShrink: 0, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: space[16], paddingTop: space[12], gap: space[8] },
  who:       { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  whoName:   { flex: 1, ...type.rowTitle, color: colors.textPrimary },
  line:      { flexDirection: 'row', alignItems: 'flex-start', gap: space[12], paddingVertical: space[8] },
  lineSep:   { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineMain:  { flex: 1 },
  lineName:  { ...type.body, fontFamily: font.semibold, color: colors.textPrimary },
  linePrice: { ...type.small, fontVariant: ['tabular-nums'], color: colors.textSecondary, marginTop: 2 },
  lineFoot:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: space[12], marginTop: space[4] },
  lineTotal: { ...type.rowTitle, fontVariant: ['tabular-nums'], color: colors.textPrimary, marginLeft: 'auto' },
  thumb:     { width: 56, height: 56, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  thumbEmpty:{ backgroundColor: colors.soft, borderWidth: 0 },
  fill:      { width: '100%', height: '100%' },
  errText:   { ...type.small, textAlign: 'center' },
  errBad:    { color: colors.dangerInk },
  errCalm:   { color: colors.textSecondary },
  errInfo:   { color: colors.textPrimary },
  errBtn:    { marginTop: space[8] },
  opts:      { gap: space[8] },
  opt:       { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[12], paddingHorizontal: space[12], paddingVertical: space[8], borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  optOn:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optText:   { flex: 1, ...type.body, color: colors.textPrimary },
  optTextOn: { fontFamily: font.semibold, color: colors.primaryDark },
  addr:      { marginTop: space[12], gap: space[8] },
  fieldLabel:{ ...type.small, fontFamily: font.semibold, color: colors.textPrimary, marginBottom: space[4] },
  field:     { minHeight: TAP, ...type.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.md, backgroundColor: 'transparent', paddingHorizontal: space[12], paddingVertical: space[8] },
  locRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[8], minHeight: TAP },
  locText:   { flex: 1, ...type.body, color: colors.textPrimary },
  locFail:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[8] },
  locFailText:{ flex: 1, minWidth: 140, ...type.small, color: colors.textPrimary },
  locNote:   { ...type.small, color: colors.textSecondary },
  clear:     { alignSelf: 'flex-start', marginTop: -space[8] },
  totalRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[12] },
  totalLabel:{ ...type.sectionHeading, color: colors.textPrimary },
  totalVal:  { ...type.sectionHeading, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  noteLabel: { ...type.rowTitle, color: colors.textPrimary, marginBottom: space[8] },
  input:     { minHeight: 72, maxHeight: 140, ...type.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.md, backgroundColor: 'transparent', paddingHorizontal: space[12], paddingVertical: space[8] },
  counter:   { ...type.meta, color: colors.textSecondary, alignSelf: 'flex-end', marginTop: space[4] },
  hint:      { ...type.small, color: colors.textSecondary, marginTop: space[8] },
  empty:     { alignItems: 'center', paddingVertical: space[24] * 2, paddingHorizontal: space[16], gap: space[8] },
  emptyTitle:{ ...type.sectionHeading, color: colors.textPrimary, textAlign: 'center', marginTop: space[8] },
  emptyBody: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  emptyBtn:  { marginTop: space[12], alignSelf: 'stretch' },
})
