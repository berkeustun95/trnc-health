import { StatusBar as RNStatusBar } from 'react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, TextInput, Keyboard, Animated, Dimensions, Easing, PixelRatio, Platform, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { ORDER_NOTE_MAX } from '../constants/eatery'
import { colors, font, type, radii, space, press, motion, TAP } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from './ui'
import { EateryLogo, eateryImageUrl } from './EateryBits'

// ─── Yeme-İçme: order via WhatsApp (the basket is utils/eateryBasket.js, the message constants/eatery.js) ───
// The menu has the quantity stepper and a bar; "Sepetim" (BasketPage) is a full page layered over the partner page.
// Defined outside the screen: these re-render on every tap and must not remount.

const MAX_QTY = 99

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
export function OrderBar({ count, totalText, lang, onOpen }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const stacked = width < 380 || PixelRatio.getFontScale() > 1.15
  const summary = t('eateryOrderCount', lang).replace('{n}', () => String(count)).replace('{total}', () => totalText)
  const go = t('eateryBasketGo', lang)
  return (
    <View style={[st.bar, { paddingBottom: insets.bottom + space[12] }]}>
      {stacked && <Text style={st.barSummary}>{summary}</Text>}
      <Button fullWidth icon="basket-outline" title={stacked ? go : `${go} · ${summary}`} onPress={onOpen}
        accessibilityLabel={`${go}, ${summary}`} />
    </View>
  )
}

// The keyboard's top edge in screen coordinates (null while it is closed). The lift is NOT taken from the reported
// height: BasketPage measures where its footer really ends against this edge (device-tested: the reported height
// and the window's own partial resize disagree).
const KBD_DIAG = { ev: null }   // TEMP-DIAG (remove with the logs below)
function useKeyboardTop() {
  const [top, setTop] = useState(null)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', e => {
      const { height, screenY } = e.endCoordinates
      KBD_DIAG.ev = e.endCoordinates   // TEMP-DIAG
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

// "Sepetim": slides in over the partner page and slides out again (reduced motion: no slide either way). The parent
// keeps it mounted until onClosed, so Android back / the iOS edge swipe (EateryPartnerScreen's backRef flips `open`)
// animate out too. The scroll area holds everything but the footer, which stays pinned above the nav bar / keyboard.
export function BasketPage({ partner, lang, open, lines, onQty, formatMoney, totalText, note, onNote, onClear, onSend, onClose, onClosed, reduce }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const footerRef = useRef(null)
  const rootRef = useRef(null)   // TEMP-DIAG
  const [lift, setLift] = useState(0)
  const measureFooter = useCallback(() => {
    if (kbTop == null) { setLift(0); return }
    footerRef.current?.measureInWindow((_x, y, _w, h) => {
      const l = Math.max(0, Math.round(y + h - kbTop))
      setLift(l)
      // TEMP-DIAG: logcat tag [ADA-KBD]
      const w = Dimensions.get('window'), sc = Dimensions.get('screen')
      const rootM = rootRef.current?.measureInWindow ? (cb => rootRef.current.measureInWindow((x2, y2, w2, h2) => cb({ x: x2, y: y2, w: w2, h: h2 }))) : cb => cb(null)
      rootM(root => console.log('[ADA-KBD]', JSON.stringify({ kbTop, ev: KBD_DIAG.ev, window: w, screen: sc, statusBar: RNStatusBar.currentHeight,
        footer: { x: _x, y, w: _w, h }, root, insets: { top: insets.top, bottom: insets.bottom }, lift: l })))
    })
  }, [kbTop, insets.top, insets.bottom])
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
  useEffect(() => {
    if (kbTop != null) { const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduce }), 60); return () => clearTimeout(id) }
  }, [kbTop, reduce])
  const empty = lines.length === 0
  return (
    <Animated.View ref={rootRef} collapsable={false} style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
      <SafeAreaView style={st.page} edges={['top']}>
        <ScreenHeader lang={lang} title={t('eateryBasketTitle', lang)} onBack={onClose} />
        <ScrollView ref={scrollRef} style={st.scroll} contentContainerStyle={[st.content, empty && { paddingBottom: insets.bottom + space[16] }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
              <Card>
                <Text style={st.noteLabel}>{t('eateryOrderNote', lang)}</Text>
                <TextInput style={st.input} value={note} onChangeText={onNote} maxLength={ORDER_NOTE_MAX} multiline
                  placeholder={t('eateryOrderNotePlaceholder', lang)} placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={t('eateryOrderNote', lang)} textAlignVertical="top" />
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
            <Button fullWidth icon="logo-whatsapp" title={t('eateryOrderSend', lang)} onPress={onSend} />
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
