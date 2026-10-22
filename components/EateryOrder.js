import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, TextInput, AccessibilityInfo, Animated, Easing, PixelRatio, Platform, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { ORDER_NOTE_MAX, deliveryReady, cardState, shortAddress, deliveryFromEntry } from '../constants/eatery'
import MapView from 'react-native-maps'
import { MAP_PROVIDER } from '../utils/googleMap'
import { loadBook, setLastUsed } from '../utils/eateryAddress'
import AddressBookSheet, { KindWell, addressLabel } from './AddressBookSheet'
import useKeyboardTop from '../utils/useKeyboardTop'
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

// "Teslimat": pick-up or delivery is REQUIRED before sending. The address comes from the address book on this phone (components/AddressEditor.js
// adds and edits it); it and its optional map pin go into the WhatsApp text only (constants/eatery.js deliveryLine). Nothing here touches the
// server. Defined outside BasketPage so it never remounts.
function DeliveryOption({ checked, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.opt, checked && st.optOn, pressed && { opacity: press.small }]}
      accessibilityRole="radio" accessibilityState={{ checked }}>
      <Ionicons name={checked ? 'radio-button-on' : 'radio-button-off'} size={22} color={checked ? colors.primaryDark : colors.textSecondary} />
      <Text style={[st.optText, checked && st.optTextOn]}>{label}</Text>
    </Pressable>
  )
}

const PIN = 32
// The card's map strip: full card width. 112 is no token: tall enough that Google's logo / Apple's "Legal" label are never clipped, short
// enough to leave the basket page light. A picture only (liteMode on Android = a static image, no gestures); the pin is an overlay at its centre.
const MAP_H = 112
const MAP_DELTA = 0.004
function PinMap({ lat, lng, live }) {
  return (
    <View style={st.map} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden accessible={false}>
      {live && (
        <MapView key={`${lat},${lng}`} style={StyleSheet.absoluteFill} provider={MAP_PROVIDER} liteMode={Platform.OS === 'android'}
          initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: MAP_DELTA, longitudeDelta: MAP_DELTA }}
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} zoomControlEnabled={false}
          showsUserLocation={false} />
      )}
      {live && <View style={st.mapPin}><Ionicons name="location" size={PIN} color={colors.primary} style={st.mapPinIcon} /></View>}
    </View>
  )
}

// open: the basket page is on screen; the map view mounts only then (delivery mode, with a pin), its empty frame stays through the slide-out.
function DeliveryCard({ lang, delivery, onDelivery, onAddress, open }) {
  const isHome = delivery.mode === 'delivery'
  const state = cardState(delivery.addressId ? delivery : null)
  const has = state !== 'none'
  const label = has ? addressLabel(delivery, lang) : ''
  const text = has ? shortAddress(delivery) : ''
  const alive = useRef(true)
  const timer = useRef(null)
  useEffect(() => () => { alive.current = false; clearTimeout(timer.current) }, [])
  const [sheet, setSheet] = useState({ open: false, book: null })
  const openSheet = async () => {
    const book = await loadBook()   // read again each time: no stale list after an edit or a delete
    if (alive.current) setSheet({ open: true, book })
  }
  // BottomSheet's onClose fires only for the user's own dismissal; a close we ask for slides out unannounced. So anything that opens the
  // editor waits out the slide: the editor is an overlay of the partner page, and a Modal still on screen would cover it.
  const closeThen = fn => {
    if (timer.current) return
    setSheet(sh => ({ ...sh, open: false }))
    if (!fn) return
    timer.current = setTimeout(() => { timer.current = null; if (alive.current) fn() }, motion.sheetOut + 60)
  }
  const choose = e => { setLastUsed(e.id); onDelivery(deliveryFromEntry(e)); closeThen() }
  const pickHome = async () => {
    onDelivery({ mode: 'delivery' })
    if (delivery.addressId || isHome) return
    const book = await loadBook()
    const a = book.items.find(i => i.id === book.lastUsedId)
    if (!alive.current) return
    if (a) onDelivery(deliveryFromEntry(a)); else onAddress(null)   // an empty book goes straight into the editor
  }
  const a11y = `${label}. ${state === 'incomplete' ? t('eateryAddrIncomplete', lang) : text}${state === 'pin' ? `. ${t('eateryAddrPinSet', lang)}` : ''}`
  return (
    <Card>
      <Text style={st.noteLabel} accessibilityRole="header">{t('eateryDeliveryTitle', lang)}</Text>
      <View accessibilityRole="radiogroup" style={st.opts}>
        <DeliveryOption checked={delivery.mode === 'pickup'} label={t('eateryDeliveryPickup', lang)} onPress={() => onDelivery({ mode: 'pickup' })} />
        <DeliveryOption checked={isHome} label={t('eateryDeliveryHome', lang)} onPress={pickHome} />
      </View>
      {isHome && (
        <View style={st.addr}>
          {has && (
            <View style={st.sum}>
              <View style={st.sumHead} accessible accessibilityLabel={a11y}>
                <KindWell kind={delivery.kind} onTint />
                <View style={st.sumMain}>
                  <Text style={st.sumLabel} numberOfLines={1}>{label}</Text>
                  <Text style={st.sumText} numberOfLines={2}>{state === 'incomplete' ? t('eateryAddrIncomplete', lang) : text}</Text>
                </View>
              </View>
              {state === 'pin' && <PinMap lat={delivery.coords.lat} lng={delivery.coords.lng} live={open === true} />}
              {state === 'noPin' && (
                <Pressable onPress={() => onAddress(delivery, 2)} style={({ pressed }) => [st.markPin, pressed && { opacity: press.small }]}
                  accessibilityRole="button" accessibilityLabel={t('eateryAddrMarkOnMap', lang)}>
                  <Ionicons name="map-outline" size={20} color={colors.primaryDark} />
                  <Text style={st.markPinText}>{t('eateryAddrMarkOnMap', lang)}</Text>
                </Pressable>
              )}
            </View>
          )}
          {state === 'none' && <Button fullWidth icon="add" title={t('eateryAddrAdd', lang)} onPress={() => onAddress(null)} />}
          {state === 'incomplete' && <Button fullWidth icon="alert-circle-outline" title={t('eateryAddrComplete', lang)} onPress={() => onAddress(delivery)} />}
          {has && <Button variant="secondary" fullWidth icon="swap-horizontal" title={t('eateryAddrChange', lang)} onPress={openSheet} />}
          <Text style={st.hint}>{t('eateryDeliveryPrivacy', lang)}</Text>
        </View>
      )}
      <AddressBookSheet visible={sheet.open === true} lang={lang} book={sheet.book} selectedId={delivery.addressId}
        onClose={() => setSheet(sh => ({ ...sh, open: false }))} onChoose={choose}
        onEdit={e => closeThen(() => onAddress(deliveryFromEntry(e)))} onNew={() => closeThen(() => onAddress(null))} />
    </Card>
  )
}

// "Sepetim": slides in over the partner page and slides out again (reduced motion: no slide either way). The parent
// keeps it mounted until onClosed, so Android back / the iOS edge swipe (EateryPartnerScreen's backRef flips `open`)
// animate out too. The scroll area holds everything but the footer, which stays pinned above the nav bar / keyboard.
export function BasketPage({ partner, lang, open, lines, onQty, formatMoney, totalText, note, onNote, delivery, onDelivery, onAddress, covered = false, onClear, onSend, onClose, onClosed, reduce, sending = false, orderError = null, ageGate = null, onSignIn }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const footerRef = useRef(null)
  const rootRef = useRef(null)
  const noteInput = useRef(null)
  const focused = useRef(null)   // the input the keyboard is for (the note)
  const scrollY = useRef(0)
  const hadKb = useRef(false)
  // Back closes the keyboard but leaves the field focused, and the next tap elsewhere is then swallowed: blur with it.
  useEffect(() => {
    if (kbTop == null && hadKb.current) noteInput.current?.blur()
    hadKb.current = kbTop != null
  }, [kbTop])
  const onFocusInput = useCallback(ref => { focused.current = ref }, [])
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
  // Keeps the note above the pinned footer: it scrolls to the end (its counter and hint show).
  const reveal = useCallback(() => {
    if (focused.current && scrollRef.current) scrollRef.current.scrollToEnd({ animated: !reduce })
  }, [reduce])
  useEffect(() => {
    if (kbTop == null) return
    const ids = [setTimeout(reveal, 60), setTimeout(reveal, 320)]   // again once the footer lift has settled
    return () => ids.forEach(clearTimeout)
  }, [kbTop, reveal])
  const focusReveal = useCallback(ref => { onFocusInput(ref); if (hadKb.current) { setTimeout(reveal, 60) } }, [onFocusInput, reveal])
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
      <SafeAreaView style={st.page} edges={['top']} {...(covered ? { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } : null)}>
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
              <DeliveryCard lang={lang} delivery={delivery} onDelivery={onDelivery} onAddress={onAddress} open={open === true} />
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
  sum:       { padding: space[12], gap: space[12], borderRadius: radii.md, backgroundColor: colors.soft, overflow: 'hidden' },
  sumHead:   { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  sumMain:   { flex: 1, gap: 2 },
  sumLabel:  { ...type.rowTitle, color: colors.textPrimary },
  sumText:   { ...type.body, color: colors.textPrimary },
  map:       { height: MAP_H, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.border },
  mapPin:    { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  mapPinIcon:{ marginBottom: PIN },
  markPin:   { minHeight: TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[8], paddingHorizontal: space[12], borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  markPinText:{ ...type.body, fontFamily: font.semibold, color: colors.primaryDark },
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
