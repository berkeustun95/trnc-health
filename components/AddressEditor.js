import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, TextInput, Keyboard, AccessibilityInfo, ActivityIndicator, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { ADDRESS_FIELD_MAX, ADDRESS_NAME_MAX, ADDRESS_UNIT_MAX, ADDRESS_DIRECTIONS_MAX, PHONE_INPUT_MAX, addressMissing, normalizePhone, formatPhone } from '../constants/eatery'
import { NICOSIA, districtPrefill } from '../constants/deliveryAreas'
import { addAddress, updateAddress, deleteAddress, setLastUsed, ADDRESS_BOOK_MAX } from '../utils/eateryAddress'
import { quietFix, useLocate } from '../utils/deliveryLocate'
import useKeyboardTop from '../utils/useKeyboardTop'
import { colors, font, type, radii, space, elevation, press, motion, TAP } from '../constants/theme'
import { ScreenHeader, Button, ConfirmDialog } from './ui'
import DeliveryPinPicker from './DeliveryPinPicker'

// "Yeni adres / Adresi düzenle": a full page layered over Sepetim (an overlay, not a Modal: the permission explanation screen is
// drawn by App's root host, which a Modal would cover). Three steps — name, location, details — and a map sub-step of step 2.
// The step / picker state belongs to EateryPartnerScreen (its back chain and the header's back share one code path); the draft
// lives here. Nothing is sent anywhere: the entry goes into the address book on this phone (utils/eateryAddress.js).
// Defined outside the screen so typing never remounts it. seed: the delivery state of the entry being edited, or null for a new one.

const KINDS = [['home', 'home-outline', 'eateryAddrKindHome'], ['work', 'briefcase-outline', 'eateryAddrKindWork'], ['other', 'location-outline', 'eateryAddrKindOther']]
const FIELD_KEYS = ['name', 'district', 'street', 'building', 'floor', 'flat', 'directions', 'phone']
const MISSING_LABEL = { name: 'eateryAddrOtherName', district: 'eateryDeliveryDistrict', street: 'eateryDeliveryStreet', building: 'eateryDeliveryBuilding' }
const STEP_TITLE = { 1: 'eateryAddrNameTitle', 2: 'eateryAddrLocTitle', 3: 'eateryAddrDetailsTitle' }
const STEPS = 3

const toDraft = seed => ({
  kind: seed?.kind || 'home', name: seed?.name || '', district: seed?.district || '', street: seed?.street || '', building: seed?.building || '',
  floor: seed?.floor || '', flat: seed?.flat || '', directions: seed?.directions || '', phone: formatPhone(seed?.callPhone), coords: seed?.coords || null,
})
const newReg = () => ({ input: { current: null }, wrap: { current: null } })

function Chip({ checked, icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, checked && s.chipOn, pressed && { opacity: press.small }]}
      accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={checked ? colors.primaryDark : colors.textSecondary} />
      <Text style={[s.chipText, checked && s.chipTextOn]}>{label}</Text>
    </Pressable>
  )
}

function OptionRow({ icon, title, onPress, busy, busyTitle }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [s.option, elevation.card, pressed && { opacity: press.card }]}
      accessibilityRole="button" accessibilityLabel={busy ? busyTitle : title} accessibilityState={{ disabled: !!busy, busy: !!busy }}>
      <View style={s.optionIcon}>
        {busy ? <ActivityIndicator size="small" color={colors.primaryDark} /> : <Ionicons name={icon} size={22} color={colors.primaryDark} />}
      </View>
      <Text style={s.optionText}>{busy ? busyTitle : title}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  )
}

function Field({ label, value, onChange, max, reg, onFocusField, onBlurField, error, tag, multiline, placeholder, next, autoCapitalize = 'words', hint, onBlurValue, inputProps }) {
  return (
    <View ref={reg.wrap} collapsable={false}>
      <View style={s.labelRow}>
        <Text style={s.fieldLabel}>{label}</Text>
        {!!tag && <Text style={s.tag}>{tag}</Text>}
      </View>
      <TextInput ref={reg.input} style={[s.field, multiline && s.fieldMulti, !!error && s.fieldBad]} value={value} onChangeText={onChange} maxLength={max}
        multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} placeholder={placeholder} placeholderTextColor={colors.textSecondary}
        autoCapitalize={autoCapitalize} autoCorrect={false} autoComplete="off" importantForAutofill="no" textContentType="none" accessibilityLabel={label} accessibilityHint={hint}
        returnKeyType={next ? 'next' : 'done'} blurOnSubmit={!next} onSubmitEditing={() => next?.input.current?.focus()}
        onFocus={() => onFocusField(reg)} onBlur={() => { onBlurField(reg); onBlurValue?.() }} {...inputProps} />
      {!!hint && !error && <Text style={s.hint}>{hint}</Text>}
      {!!error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  )
}

export default function AddressEditor({ lang, open, step, pickerOpen, seed, reduce, onStep, onPicker, onBack, onClosed, onSaved, onDeleted }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const editing = !!seed?.addressId
  const [draft, setDraft] = useState(() => toDraft(seed))
  const [mapDistrict, setMapDistrict] = useState('')   // the Mahalle the map filled in: its "Haritadan" tag shows until it is edited
  const [nameTried, setNameTried] = useState(false)
  const [tried, setTried] = useState(false)
  const [phoneTried, setPhoneTried] = useState(false)   // the phone is checked on blur and on save, not on every keystroke
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [opening, setOpening] = useState(false)
  const [pickerStart, setPickerStart] = useState(null)
  const gps = useLocate(lang)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const where = useRef({ open, step })   // read after an await: Back during the wait must not open the picker on a page the user already left
  where.current = { open, step }
  const onStep2 = () => alive.current && where.current.open && where.current.step === 2
  useEffect(() => { if (!open || step !== 2) gps.cancel() }, [open, step])   // Back / close while the GPS is still listening: stop it
  const set = patch => setDraft(d => ({ ...d, ...patch }))
  const reg = useRef(Object.fromEntries(FIELD_KEYS.map(k => [k, newReg()]))).current

  // ─── slide in / out (reduced motion: neither) ───
  const slide = useRef(new Animated.Value(reduce ? 0 : winW)).current
  useEffect(() => {
    const to = open ? 0 : winW
    const done = () => { if (!open) onClosed?.() }
    if (reduce) { slide.setValue(to); done(); return }
    Animated.timing(slide, { toValue: to, duration: open ? motion.sheetIn : motion.sheetOut,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true }).start(done)
  }, [open])

  // ─── announce each step (iOS does not always speak a changed screen) ───
  const progress = t('eateryAddrProgress', lang).replace('{n}', () => String(step)).replace('{total}', () => String(STEPS))
  const first = useRef(true)
  useEffect(() => {
    if (!open) return
    const msg = pickerOpen ? t('eateryAddrPickMap', lang) : `${progress}. ${t(STEP_TITLE[step], lang)}`
    if (first.current) { first.current = false; return }
    AccessibilityInfo.announceForAccessibility?.(msg)
  }, [step, pickerOpen])

  // ─── Mahalle / köy from the pin, on this phone: only into an EMPTY field ───
  useEffect(() => {
    if (step !== 3) return
    const p = districtPrefill({ district: draft.district, lat: draft.coords?.lat, lng: draft.coords?.lng })
    if (p) { set({ district: p }); setMapDistrict(p) }
  }, [step])

  // ─── keyboard: the pinned footer rides above it; the focused field (label included) is scrolled into view ───
  const rootRef = useRef(null)
  const footerRef = useRef(null)
  const scrollRef = useRef(null)
  const scrollY = useRef(0)
  const focused = useRef(null)
  const hadKb = useRef(false)
  const [lift, setLift] = useState(0)
  useEffect(() => {
    if (kbTop == null && hadKb.current) focused.current?.input.current?.blur()   // Back closes the keyboard but leaves the field focused; the next tap would be swallowed
    hadKb.current = kbTop != null
  }, [kbTop])
  const onFocusField = useCallback(r => { focused.current = r }, [])
  const onBlurField = useCallback(r => { if (focused.current === r) focused.current = null }, [])
  const measureFooter = useCallback(() => {
    if (kbTop == null) { setLift(0); return }
    // measureInWindow is window-relative and the window can start below the screen top; the keyboard's screenY is
    // screen-relative: the page root's own y gives the offset (device-diagnosed in BasketPage).
    const root = rootRef.current, footer = footerRef.current
    if (!root || !footer) return
    root.measureInWindow((_rx, ry) => footer.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h - ry - kbTop)))))
  }, [kbTop])
  useEffect(() => { measureFooter(); const id = setTimeout(measureFooter, 250); return () => clearTimeout(id) }, [measureFooter])
  const reveal = useCallback(() => {
    const r = focused.current, sv = scrollRef.current, footer = footerRef.current
    if (!r?.input.current || !sv || !footer) return
    sv.measureInWindow((_sx, sy) => footer.measureInWindow((_fx, fy) => (r.wrap.current || r.input.current)?.measureInWindow((_x, y, _w, h) => {
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
  const focusField = useCallback(r => { onFocusField(r); if (hadKb.current) setTimeout(reveal, 60) }, [onFocusField, reveal])

  // ─── step 1 ───
  const pickKind = kind => {
    set({ kind })
    setNameTried(false)
    if (kind === 'other') setTimeout(() => reg.name.input.current?.focus(), 50)
  }
  const nameMissing = draft.kind === 'other' && addressMissing(draft).includes('name')
  const toLocation = () => {
    if (nameMissing) {
      setNameTried(true)
      AccessibilityInfo.announceForAccessibility?.(t('eateryAddrNameMissing', lang))
      reg.name.input.current?.focus()
      return
    }
    Keyboard.dismiss()
    onStep(2)
  }

  // ─── step 2 ───
  // at: a GPS fix to CONFIRM on the map ({ lat, lng, accuracy }); without it the picker opens on the saved pin, a quiet fix or Lefkoşa.
  const openPicker = async at => {
    if (opening) return
    let start = at ? { lat: at.lat, lng: at.lng, accuracy: at.accuracy, gps: true, delta: 0.002 } : draft.coords ? { ...draft.coords, delta: 0.004 } : null
    if (!start) {
      setOpening(true)
      const q = await quietFix()   // only when location is already allowed; never asks
      if (!alive.current) return
      setOpening(false)
      if (!onStep2()) return
      start = q ? { ...q, delta: 0.006 } : { ...NICOSIA, delta: 0.06 }
    }
    setPickerStart(start)
    onPicker(true)
  }
  const useCurrent = async () => {
    const p = await gps.locate()
    if (p && onStep2()) openPicker(p)
  }
  const pinChosen = pin => {
    set({ coords: pin })
    onPicker(false)
    onStep(3)
    AccessibilityInfo.announceForAccessibility?.(t('eateryAddrPinSet', lang))
  }

  // ─── step 3 ───
  const missing = addressMissing(draft)
  const missingText = tried && missing.length ? t('eateryAddrMissing', lang).replace('{fields}', () => missing.map(k => t(MISSING_LABEL[k], lang)).join(', ')) : null
  const phoneBad = phoneTried && !normalizePhone(draft.phone).ok
  const phoneBlur = () => {
    const r = normalizePhone(draft.phone)
    if (r.ok) { set({ phone: formatPhone(r.value) }); return }
    setPhoneTried(true)
    AccessibilityInfo.announceForAccessibility?.(t('eateryAddrPhoneInvalid', lang))
  }
  const errFor = k => (tried && missing.includes(k) ? t('eateryAddrFieldMissing', lang) : null)
  const save = async () => {
    if (saving) return
    const phone = normalizePhone(draft.phone)
    if (!phone.ok) setPhoneTried(true)
    if (missing.length) {
      setTried(true)
      setSaveErr(null)
      if (missing.includes('name')) { onStep(1); setNameTried(true); AccessibilityInfo.announceForAccessibility?.(t('eateryAddrNameMissing', lang)); return }
      AccessibilityInfo.announceForAccessibility?.(t('eateryAddrMissing', lang).replace('{fields}', () => missing.map(k => t(MISSING_LABEL[k], lang)).join(', ')))
      reg[missing[0]].input.current?.focus()
      return
    }
    if (!phone.ok) {
      setSaveErr(null)
      AccessibilityInfo.announceForAccessibility?.(t('eateryAddrPhoneInvalid', lang))
      reg.phone.input.current?.focus()
      return
    }
    Keyboard.dismiss()
    setSaving(true)
    setSaveErr(null)
    const entry = {
      kind: draft.kind, name: draft.kind === 'other' ? draft.name : '', district: draft.district, street: draft.street, building: draft.building,
      floor: draft.floor, flat: draft.flat, directions: draft.directions, lat: draft.coords?.lat ?? null, lng: draft.coords?.lng ?? null, callPhone: phone.value,
    }
    const r = editing ? await updateAddress(seed.addressId, entry) : await addAddress(entry)
    if (r.ok) await setLastUsed(r.item.id)
    if (!alive.current) return
    setSaving(false)
    if (r.ok) { onSaved(r.item); return }
    const key = r.reason === 'full' ? 'eateryAddrFull' : 'eateryAddrSaveErr'
    const msg = t(key, lang).replace('{n}', () => String(ADDRESS_BOOK_MAX))
    setSaveErr(msg)
    AccessibilityInfo.announceForAccessibility?.(msg)
  }
  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    const r = await deleteAddress(seed.addressId)
    if (!alive.current) return
    setDeleting(false)
    setConfirmDel(false)
    if (!r.ok) { setSaveErr(t('eateryAddrSaveErr', lang)); return }
    onDeleted(r.book.items.find(i => i.id === r.book.lastUsedId) || null)
  }

  const title = t(editing ? 'eateryAddrEditTitle' : 'eateryAddrNewTitle', lang)
  const footerPad = (kbTop != null ? lift : insets.bottom) + space[12]
  const hasPin = !!draft.coords
  const showMap = step === 2 && pickerOpen && !!pickerStart
  return (
    <Animated.View ref={rootRef} collapsable={false} style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
      <SafeAreaView style={s.page} edges={['top']}>
        <ScreenHeader lang={lang} title={title} onBack={onBack} />
        <View style={s.progress} accessible accessibilityRole="progressbar" accessibilityLabel={progress} accessibilityValue={{ min: 1, max: STEPS, now: step }}>
          <Text style={s.progressText}>{progress}</Text>
          <View style={s.segs}>
            {[1, 2, 3].map(n => <View key={n} style={[s.seg, n <= step && s.segOn]} />)}
          </View>
        </View>
        {showMap ? (
          <DeliveryPinPicker lang={lang} start={pickerStart} reduce={reduce} onUse={pinChosen} />
        ) : (
          <>
            <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
              onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }} scrollEventThrottle={16}>
              <Text style={s.stepTitle} accessibilityRole="header">{t(STEP_TITLE[step], lang)}</Text>
              {step === 1 && (
                <>
                  <View accessibilityRole="radiogroup" style={s.chips}>
                    {KINDS.map(([k, icon, key]) => <Chip key={k} checked={draft.kind === k} icon={icon} label={t(key, lang)} onPress={() => pickKind(k)} />)}
                  </View>
                  {draft.kind === 'other' && (
                    <Field label={t('eateryAddrOtherName', lang)} value={draft.name} onChange={v => set({ name: v })} max={ADDRESS_NAME_MAX} reg={reg.name}
                      onFocusField={focusField} onBlurField={onBlurField} placeholder={t('eateryAddrOtherPlaceholder', lang)}
                      error={nameTried && nameMissing ? t('eateryAddrNameMissing', lang) : null} />
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <OptionRow icon="locate-outline" title={t('eateryAddrUseCurrent', lang)} busyTitle={t(gps.refining ? 'eateryDeliveryRefining' : 'eateryDeliveryLocating', lang)} busy={gps.locating} onPress={useCurrent} />
                  <OptionRow icon="map-outline" title={t('eateryAddrPickMap', lang)} busyTitle={t('eateryDeliveryLocating', lang)} busy={opening} onPress={() => openPicker()} />
                  {gps.note && (
                    <View style={s.locFail} accessibilityLiveRegion="polite">
                      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                      <Text style={s.locFailText}>{t(gps.note.msgKey, lang)}</Text>
                      {gps.note.action && <Button variant="text" title={t('openSettings', lang)} onPress={() => gps.openFix(gps.note.action)} />}
                    </View>
                  )}
                  {hasPin ? (
                    <View style={s.pinRow}>
                      <Ionicons name="location" size={18} color={colors.primaryDark} />
                      <Text style={s.pinText}>{t('eateryAddrPinSet', lang)}</Text>
                      <Button variant="text" title={t('eateryAddrPinChange', lang)} onPress={() => openPicker()} accessibilityLabel={t('eateryAddrPinChangeA11y', lang)} />
                      <Button variant="text" title={t('eateryDeliveryLocRemove', lang)} onPress={() => set({ coords: null })} accessibilityLabel={t('eateryDeliveryLocRemoveA11y', lang)} />
                    </View>
                  ) : <Text style={s.note}>{t('eateryDeliveryLocateNote', lang)}</Text>}
                  <Text style={s.note}>{t('eateryDeliveryPrivacy', lang)}</Text>
                </>
              )}
              {step === 3 && (
                <>
                  <Field label={t('eateryDeliveryDistrict', lang)} value={draft.district} onChange={v => set({ district: v })} max={ADDRESS_FIELD_MAX} reg={reg.district}
                    onFocusField={focusField} onBlurField={onBlurField} error={errFor('district')} next={reg.street}
                    tag={mapDistrict && draft.district === mapDistrict ? t('eateryAddrFromMap', lang) : null} />
                  <Field label={t('eateryDeliveryStreet', lang)} value={draft.street} onChange={v => set({ street: v })} max={ADDRESS_FIELD_MAX} reg={reg.street}
                    onFocusField={focusField} onBlurField={onBlurField} error={errFor('street')} next={reg.building} />
                  <Field label={t('eateryDeliveryBuilding', lang)} value={draft.building} onChange={v => set({ building: v })} max={ADDRESS_FIELD_MAX} reg={reg.building}
                    onFocusField={focusField} onBlurField={onBlurField} error={errFor('building')} next={reg.floor} autoCapitalize="characters" />
                  <View style={s.pair}>
                    <View style={s.half}>
                      <Field label={t('eateryAddrFloor', lang)} value={draft.floor} onChange={v => set({ floor: v })} max={ADDRESS_UNIT_MAX} reg={reg.floor}
                        onFocusField={focusField} onBlurField={onBlurField} next={reg.flat} autoCapitalize="characters" />
                    </View>
                    <View style={s.half}>
                      <Field label={t('eateryAddrFlat', lang)} value={draft.flat} onChange={v => set({ flat: v })} max={ADDRESS_UNIT_MAX} reg={reg.flat}
                        onFocusField={focusField} onBlurField={onBlurField} next={reg.directions} autoCapitalize="characters" />
                    </View>
                  </View>
                  <Field label={t('eateryAddrDirections', lang)} value={draft.directions} onChange={v => set({ directions: v })} max={ADDRESS_DIRECTIONS_MAX} reg={reg.directions} multiline
                    onFocusField={focusField} onBlurField={onBlurField} placeholder={t('eateryAddrDirectionsPlaceholder', lang)} autoCapitalize="sentences" />
                  <Field label={t('eateryAddrPhone', lang)} value={draft.phone} onChange={v => { setPhoneTried(false); set({ phone: v }) }} max={PHONE_INPUT_MAX} reg={reg.phone}
                    onFocusField={focusField} onBlurField={onBlurField} onBlurValue={phoneBlur} hint={t('eateryAddrPhoneHint', lang)} autoCapitalize="none"
                    error={phoneBad ? t('eateryAddrPhoneInvalid', lang) : null}
                    inputProps={{ keyboardType: 'phone-pad', textContentType: 'telephoneNumber', autoComplete: 'tel', importantForAutofill: 'yes' }} />
                  {editing && <Button variant="text" icon="trash-outline" title={t('eateryDeliveryClear', lang)} onPress={() => { setSaveErr(null); setConfirmDel(true) }} style={s.del} />}
                </>
              )}
            </ScrollView>
            <View ref={footerRef} collapsable={false} onLayout={measureFooter} style={[s.footer, { paddingBottom: footerPad }]}>
              {step === 3 && (
                <View accessibilityLiveRegion="polite">
                  {!!missingText && <Text style={s.err}>{missingText}</Text>}
                  {!!saveErr && <Text style={s.err}>{saveErr}</Text>}
                </View>
              )}
              {step === 1 && <Button fullWidth title={t('eateryAddrContinue', lang)} onPress={toLocation} />}
              {step === 2 && (hasPin
                ? <Button fullWidth title={t('eateryAddrContinue', lang)} onPress={() => onStep(3)} />
                : <Button variant="text" fullWidth title={t('eateryAddrNoMap', lang)} onPress={() => onStep(3)} />)}
              {step === 3 && <Button fullWidth icon="checkmark" title={t('eateryAddrSave', lang)} loadingTitle={t('eateryAddrSaving', lang)} loading={saving} onPress={save} />}
            </View>
          </>
        )}
      </SafeAreaView>
      <ConfirmDialog visible={confirmDel === true} lang={lang} destructive title={t('eateryAddrDeleteTitle', lang)} confirmLabel={t('eateryAddrDeleteYes', lang)}
        loading={deleting} error={confirmDel ? saveErr : null} onConfirm={remove} onCancel={() => setConfirmDel(false)} />
    </Animated.View>
  )
}

const s = StyleSheet.create({
  page:      { flex: 1, backgroundColor: colors.canvas },
  progress:  { flexShrink: 0, gap: space[8], paddingHorizontal: space[16], paddingVertical: space[8] },
  progressText:{ ...type.meta, color: colors.textSecondary },
  segs:      { flexDirection: 'row', gap: space[8] },
  seg:       { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.fieldBorder },   // 4pt: a hairline rail, not a control; fieldBorder (colors.border is 1.18:1 on canvas)
  segOn:     { backgroundColor: colors.primary },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: space[16], paddingTop: space[8], paddingBottom: space[16], gap: space[12] },
  stepTitle: { ...type.sectionHeading, color: colors.textPrimary },
  footer:    { flexShrink: 0, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: space[16], paddingTop: space[12], gap: space[8] },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: space[8] },
  chip:      { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[8], paddingHorizontal: space[16], paddingVertical: space[8], borderRadius: radii.pill, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  chipOn:    { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText:  { ...type.body, color: colors.textPrimary },
  chipTextOn:{ fontFamily: font.semibold, color: colors.primaryDark },
  option:    { minHeight: TAP + space[8] * 2,   // the TAP-sized well plus the row's vertical padding
                 flexDirection: 'row', alignItems: 'center', gap: space[12], paddingHorizontal: space[12], paddingVertical: space[8], borderRadius: radii.card, backgroundColor: colors.card },
  optionIcon:{ width: TAP, height: TAP, borderRadius: radii.tile, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  optionText:{ flex: 1, ...type.rowTitle, color: colors.textPrimary },
  locFail:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[8] },
  locFailText:{ flex: 1, minWidth: 140, ...type.small, color: colors.textPrimary },
  pinRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[8], minHeight: TAP },
  pinText:   { flex: 1, minWidth: 120, ...type.body, color: colors.textPrimary },
  note:      { ...type.small, color: colors.textSecondary },
  labelRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[8], marginBottom: space[4] },
  fieldLabel:{ flexShrink: 1, ...type.small, fontFamily: font.semibold, color: colors.textPrimary },
  tag:       { ...type.caption, color: colors.primaryDark, backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: space[8], paddingVertical: 2, overflow: 'hidden' },   // 2pt: a caption pill is shorter than the smallest space token
  field:     { minHeight: TAP, ...type.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.fieldBorder, borderRadius: radii.md, backgroundColor: 'transparent', paddingHorizontal: space[12], paddingVertical: space[8] },
  fieldMulti:{ minHeight: 72, maxHeight: 140 },
  fieldBad:  { borderColor: colors.dangerInk },
  hint:      { ...type.small, color: colors.textSecondary, marginTop: space[4] },
  error:     { ...type.small, color: colors.dangerInk, marginTop: space[4] },
  err:       { ...type.small, color: colors.dangerInk, textAlign: 'center' },
  pair:      { flexDirection: 'row', gap: space[12] },
  half:      { flex: 1 },
  del:       { alignSelf: 'flex-start' },
})
