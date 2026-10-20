import { useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, TextInput, Keyboard, Platform, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { ORDER_NOTE_MAX } from '../constants/eatery'
import { colors, font, type, radii, space, press, TAP } from '../constants/theme'
import { BottomSheet, Button } from './ui'

// ─── Yeme-İçme: order via WhatsApp (the basket is utils/eateryBasket.js, the message constants/eatery.js) ───
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
        accessibilityRole="button" accessibilityLabel={sub('eateryOrderLess')}>
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

// Pinned under the scroll view: the summary above a full-width primary button, so the long Turkish label never truncates.
export function OrderBar({ count, totalText, lang, onOpen }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[st.bar, { paddingBottom: insets.bottom + space[12] }]}>
      <Text style={st.barSummary} numberOfLines={1} accessibilityLiveRegion="polite">
        {t('eateryOrderCount', lang).replace('{n}', () => String(count)).replace('{total}', () => totalText)}
      </Text>
      <Button fullWidth icon="logo-whatsapp" title={t('eateryOrderBar', lang)} onPress={onOpen} />
    </View>
  )
}

// iOS: the keyboard covers the bottom of a bottom sheet and nothing resizes a Modal, so the sheet is padded by the
// keyboard height. Android resizes its Modal window itself.
function useKeyboardPad() {
  const [h, setH] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const show = Keyboard.addListener('keyboardWillChangeFrame', e => setH(Math.max(0, Math.round(e.endCoordinates.height))))
    const hide = Keyboard.addListener('keyboardWillHide', () => setH(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return h
}

export function OrderSheet({ visible, lines, onQty, formatMoney, totalText, note, onNote, lang, onClose, onSend }) {
  const insets = useSafeAreaInsets()
  const { height: winH } = useWindowDimensions()
  const kb = useKeyboardPad()
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('eateryOrderSheetTitle', lang)} lang={lang}>
      <ScrollView style={{ maxHeight: winH * (kb ? 0.2 : 0.34), flexGrow: 0 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {lines.map(l => (
          <View key={l.id} style={st.line}>
            <View style={st.lineText}>
              <Text style={st.lineName}>{l.name}</Text>
              <Text style={st.linePrice}>{formatMoney(l.qty * l.price)}</Text>
            </View>
            <QtyStepper id={l.id} name={l.name} qty={l.qty} onQty={onQty} lang={lang} />
          </View>
        ))}
      </ScrollView>
      <Text style={st.noteLabel}>{t('eateryOrderNote', lang)}</Text>
      <TextInput style={st.input} value={note} onChangeText={onNote} maxLength={ORDER_NOTE_MAX} multiline
        placeholder={t('eateryOrderNotePlaceholder', lang)} placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t('eateryOrderNote', lang)} textAlignVertical="top" />
      <Text style={st.counter} accessibilityElementsHidden importantForAccessibility="no">{note.length}/{ORDER_NOTE_MAX}</Text>
      <View style={st.totalRow}>
        <Text style={st.totalLabel}>{t('eateryOrderTotal', lang)}</Text>
        <Text style={st.totalVal}>{totalText}</Text>
      </View>
      <Text style={st.hint}>{t('eateryOrderHint', lang)}</Text>
      <Button fullWidth icon="logo-whatsapp" title={t('eateryOrderSend', lang)} onPress={onSend} style={st.send} />
      {kb > 0 && <View style={{ height: Math.max(0, kb - insets.bottom) }} />}
    </BottomSheet>
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
  line:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[12], paddingVertical: space[4] },
  lineText:  { flex: 1 },
  lineName:  { ...type.body, color: colors.textPrimary },
  linePrice: { ...type.small, fontVariant: ['tabular-nums'], color: colors.textSecondary, marginTop: 2 },
  noteLabel: { ...type.rowTitle, color: colors.textPrimary, marginTop: space[12], marginBottom: space[8] },
  input:     { minHeight: 72, maxHeight: 120, ...type.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.md, backgroundColor: 'transparent', paddingHorizontal: space[12], paddingVertical: space[8] },
  counter:   { ...type.meta, color: colors.textSecondary, alignSelf: 'flex-end', marginTop: space[4] },
  totalRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[12], marginTop: space[8] },
  totalLabel:{ ...type.sheetTitle, color: colors.textPrimary },
  totalVal:  { ...type.sheetTitle, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  hint:      { ...type.small, color: colors.textSecondary, marginTop: space[8] },
  send:      { marginTop: space[16] },
})
