import { useState, useRef, useEffect } from 'react'
import { View, Text, Image, FlatList, ScrollView, TextInput, TouchableOpacity, Pressable, Modal, StyleSheet, Linking, Platform, Dimensions, useWindowDimensions } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import BackButton from '../components/BackButton'
import { Card, ScreenHeader } from '../components/ui'
import { colors, radii, type, TAP } from '../constants/theme'
import { PILL_ALPHA } from '../components/ui/ModuleScreen'
import { REDESIGN } from '../constants/redesign'
import { t, LANG_CODES } from '../constants/i18n'
import { NORTH_HOUSES_FORM } from '../constants/redesign'
import {
  NORTH_HOUSES, nhBuilding, nhWaMessage, nhWaUrl, nhWebsiteUrl,
  nhValidateRequest, nhRequestMessage, nhRequestLimit, NH_MAX_NIGHTS, NH_MIN_GUESTS, NH_MAX_GUESTS,
} from '../constants/dailyRentals'
import { partnerAsset } from '../constants/partnerAssets'
import { logContactEvent } from '../utils/logContactEvent'
import useKeyboardTop from '../utils/useKeyboardTop'
import { supabase } from '../lib/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'

// One North Houses apartment: photo pager, what it is, what it costs (as the site shows it, with the
// site's own "prices vary" note), what is inside, the description, check-in / check-out, its building's
// map link, and two ways out — WhatsApp (primary) and the apartment's own page on their site.
// A free listing: no deal band, no code, no ad slot. Config: constants/dailyRentals.js.
//
// The form at the foot is a prototype, rendered only when NORTH_HOUSES_FORM (constants/redesign.js): NORTH_HOUSES_FORM_LIVE, or ADA Preview. Production never sets appVariant, so never renders it.

const PHOTO_ASPECT = 4 / 3
const eur = n => `€${n}`
const fill = (text, n) => text.replace('{n}', String(n))

// ─── PHOTO PAGER + VIEWER ────────────────────────────────────────────────────
// A fixed 4:3 frame (the files are 1440x1080), cover for EVERY photo, so nothing below the pager
// moves while swiping and no photo sits in bars. Six of the 56 are portraits (1080x1440): the frame
// shows their middle, and a tap opens the viewer, which shows every photo whole (contain, on black).
// Windowed FlatLists, so 8 decoded 1440 px photos are never all in memory at once.
// Saves the request row unless this phone is over its limit (nhRequestLimit; only timestamps of saved
// requests are kept, on the device). Fire-and-forget and NEVER throws: the WhatsApp message opens
// regardless. A storage read failure allows the insert; a write failure only loses the count.
const NH_STAMPS_KEY = 'nh_request_stamps'
async function saveRequest(apartmentSlug, v) {
  try {
    let stamps = []
    try { stamps = JSON.parse(await AsyncStorage.getItem(NH_STAMPS_KEY)) || [] } catch {}
    const lim = nhRequestLimit(stamps, Date.now())
    if (!lim.allowed) return
    try { await AsyncStorage.setItem(NH_STAMPS_KEY, JSON.stringify(lim.stamps)) } catch {}
    supabase.from('partner_booking_requests').insert([{ partner: NORTH_HOUSES.slug, apartment: apartmentSlug, check_in: v.checkIn, check_out: v.checkOut, guests: v.guests }]).then(() => {}, () => {})
  } catch {}
}

function PagerPhoto({ photoKey, width, index, total, lang, onOpen }) {
  const src = partnerAsset(photoKey)
  const h = Math.round(width / PHOTO_ASPECT)
  if (!src) return <View style={{ width, height: h, backgroundColor: colors.soft }} />
  return (
    <Pressable onPress={() => onOpen(index)} accessibilityRole="imagebutton"
      accessibilityLabel={t('eateryPhotoCount', lang).replace('{n}', index + 1).replace('{total}', total)}>
      <Image source={src} style={{ width, height: h, backgroundColor: colors.soft }} resizeMode="cover" />
    </Pressable>
  )
}

function Dots({ count, active, style }) {
  if (count < 2) return null
  return (
    <View style={[s.dots, style]} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => <View key={i} style={[s.dot, i === active && s.dotOn]} />)}
    </View>
  )
}

function Pager({ photos, width, lang, onOpen }) {
  const [idx, setIdx] = useState(0)
  const h = Math.round(width / PHOTO_ASPECT)
  return (
    <View style={{ width, height: h }}>
      <FlatList
        data={photos}
        keyExtractor={k => k}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2} windowSize={3} maxToRenderPerBatch={2} removeClippedSubviews
        onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <PagerPhoto photoKey={item} width={width} index={index} total={photos.length} lang={lang} onOpen={onOpen} />
        )}
      />
      <Dots count={photos.length} active={idx} style={s.dotsOnPhoto} />
    </View>
  )
}

// Full screen, black, every photo whole. Android back closes it through onRequestClose (a Modal is
// its own native window, outside the addBackListener chain); iOS closes it with the button.
function PhotoViewer({ photos, start, lang, onClose }) {
  return (
    <Modal visible={start != null} animationType="fade" onRequestClose={onClose}
      statusBarTranslucent supportedOrientations={['portrait']}>
      {start != null && <ViewerBody photos={photos} start={start} lang={lang} onClose={onClose} />}
    </Modal>
  )
}

// Mounted per opening, so its page index starts at the photo that was tapped.
function ViewerBody({ photos, start, lang, onClose }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [idx, setIdx] = useState(start)
  return (
    <View style={s.viewer}>
      <StatusBar style="light" />
      <FlatList
        data={photos}
        keyExtractor={k => k}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={1} windowSize={3} maxToRenderPerBatch={2}
        onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <Image source={partnerAsset(item)} style={{ width, height }} resizeMode="contain"
            accessible accessibilityLabel={t('eateryPhotoCount', lang).replace('{n}', index + 1).replace('{total}', photos.length)} />
        )}
      />
      <View style={[s.viewerBar, { top: insets.top + 8 }]}>
        <View style={s.viewerCount}>
          <Text style={s.viewerCountText}>{idx + 1} / {photos.length}</Text>
        </View>
        <Pressable style={s.viewerClose} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <Dots count={photos.length} active={idx} style={[s.dotsOnPhoto, { bottom: insets.bottom + 24 }]} />
    </View>
  )
}

function Chip({ icon, label }) {
  return (
    <View style={s.chip}>
      <Ionicons name={icon} size={14} color={colors.textSecondary} />
      <Text style={s.chipText}>{label}</Text>
    </View>
  )
}

function IconLine({ icon, children }) {
  return (
    <View style={s.iconLine}>
      <Ionicons name={icon} size={18} color={colors.primaryDark} style={s.iconLineIcon} />
      <Text style={s.iconLineText}>{children}</Text>
    </View>
  )
}

function FormField({ label, children }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── THE REQUEST FORM — PROTOTYPE ────────────────────────────────────────────
//
// Dates come from the native picker (the Events filter's pattern: Android's imperative dialog, an
// inline calendar in a sheet on iOS), so a date is never typed and never malformed: Giriş from today,
// Çıkış from the day after Giriş up to NH_MAX_NIGHTS later. Guests is a stepper that starts at a real 2.
// Under a disabled button the form says, in words, what is still missing: nothing is silently off.
//
// Send builds the Turkish WhatsApp text (with name and phone: for the partner's eyes only) and opens
// it. The row for our own table is sent fire-and-forget, NOT awaited, and carries NO name or phone:
//   - no .select(): the table has no SELECT policy, so RETURNING would make the insert fail;
//   - supabase queries are lazy thenables: the .then() is what actually sends it;
//   - errors are swallowed: a failed insert must never block WhatsApp. ADA Preview talks to the
//     PRODUCTION project, so a Preview send is a real row (20261143 applied 2026-10-28).
const pad2 = n => String(n).padStart(2, '0')
const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const dateOf = iso => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d) }
const dmyOf = iso => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

function DateField({ label, value, placeholder, onPress }) {
  return (
    <FormField label={label}>
      <TouchableOpacity style={s.dateBtn} onPress={onPress} activeOpacity={0.7} accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? dmyOf(value) : placeholder}`}>
        <Ionicons name="calendar-outline" size={18} color={value ? colors.primaryDark : colors.textSecondary} />
        <Text style={[s.dateText, !value && s.datePh]} numberOfLines={1}>{value ? dmyOf(value) : placeholder}</Text>
      </TouchableOpacity>
    </FormField>
  )
}

function GuestStepper({ value, onChange, lang }) {
  const less = value > NH_MIN_GUESTS, more = value < NH_MAX_GUESTS
  return (
    <View style={s.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={t('nhFormGuests', lang)}
      accessibilityValue={{ min: NH_MIN_GUESTS, max: NH_MAX_GUESTS, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onChange(e.nativeEvent.actionName === 'increment' ? Math.min(NH_MAX_GUESTS, value + 1) : Math.max(NH_MIN_GUESTS, value - 1))}>
      <TouchableOpacity style={[s.stepBtn, !less && s.stepBtnOff]} onPress={() => less && onChange(value - 1)} disabled={!less}
        activeOpacity={0.7} accessibilityLabel={t('nhFormGuestsLess', lang)}>
        <Ionicons name="remove" size={20} color={colors.primaryDark} />
      </TouchableOpacity>
      <Text style={s.stepValue}>{value}</Text>
      <TouchableOpacity style={[s.stepBtn, !more && s.stepBtnOff]} onPress={() => more && onChange(value + 1)} disabled={!more}
        activeOpacity={0.7} accessibilityLabel={t('nhFormGuestsMore', lang)}>
        <Ionicons name="add" size={20} color={colors.primaryDark} />
      </TouchableOpacity>
    </View>
  )
}

function RequestForm({ apartment, building, lang, onFieldFocus }) {
  const [ci, setCi] = useState(null)
  const [co, setCo] = useState(null)
  const [guests, setGuests] = useState(2)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [iosPicker, setIosPicker] = useState(null)
  const insets = useSafeAreaInsets()
  const footerRef = useRef(null)
  const phoneRef = useRef(null)

  const v = nhValidateRequest({ checkInText: dmyOf(ci), checkOutText: dmyOf(co), guestsText: String(guests), name, phone })
  const phoneDigits = phone.replace(/\D/g, '').length
  const missing = [
    !ci && t('nhFormMissCheckIn', lang),
    !co && t('nhFormMissCheckOut', lang),
    name.trim().length < 2 && t('nhFormMissName', lang),
    phoneDigits === 0 ? t('nhFormMissPhone', lang) : phoneDigits < 7 ? t('nhFormMissPhoneShort', lang) : null,
  ].filter(Boolean)
  const missingText = t('nhFormMissing', lang).replace('{items}', () => missing.join(lang === 'Arabic' || lang === 'Persian' ? '، ' : ', '))

  // Çıkış is kept only while it is still after Giriş and within the stay limit.
  const pickCheckIn = iso => {
    setCi(iso)
    if (co && (co <= iso || co > addDays(iso, NH_MAX_NIGHTS))) setCo(null)
  }
  const bounds = which => which === 'ci'
    ? { min: isoOf(new Date()), max: null }
    : { min: ci ? addDays(ci, 1) : addDays(isoOf(new Date()), 1), max: ci ? addDays(ci, NH_MAX_NIGHTS) : null }
  const apply = (which, date) => {
    const iso = isoOf(date)
    if (which === 'ci') pickCheckIn(iso)
    else setCo(iso)
  }

  const openPicker = which => {
    if (Platform.OS !== 'android') { setIosPicker(which); return }
    const { min, max } = bounds(which)
    const cur = which === 'ci' ? ci : co
    DateTimePickerAndroid.open({
      value: dateOf(cur && cur >= min ? cur : min),
      mode: 'date',
      minimumDate: dateOf(min),
      ...(max ? { maximumDate: dateOf(max) } : {}),
      onChange: (e, date) => { if (e.type === 'set' && date) apply(which, date) },
    })
  }

  const send = () => {
    if (!v.ok) return
    logContactEvent('accommodation', NORTH_HOUSES.id, 'whatsapp', null)
    saveRequest(apartment.slug, v)
    const text = nhRequestMessage({
      aptNameTr: t(apartment.nameKey, 'Turkish'), buildingName: building?.name || '',
      checkIn: v.checkIn, checkOut: v.checkOut, guests: v.guests, name, phone,
    })
    Linking.openURL(nhWaUrl(text)).catch(() => {})
  }

  // Name and phone both lift the FOOTER (missing line + button) above the keyboard, so the field
  // being typed in and the button it unlocks are on screen together.
  const revealFooter = () => onFieldFocus(footerRef)
  const ph = t('nhFormDatePh', lang)
  const ios = iosPicker ? bounds(iosPicker) : null
  // The inline calendar highlights a day before any tap: Done keeps that day rather than leaving the field empty.
  const closeIosPicker = () => {
    if (iosPicker && !(iosPicker === 'ci' ? ci : co)) apply(iosPicker, dateOf(ios.min))
    setIosPicker(null)
  }
  return (
    <Card padding={16} style={s.block}>
      <Text style={s.blockTitle} accessibilityRole="header">{t('nhFormTitle', lang)}</Text>
      <View style={s.fieldRow}>
        <DateField label={t('nhFormCheckIn', lang)} value={ci} placeholder={ph} onPress={() => openPicker('ci')} />
        <DateField label={t('nhFormCheckOut', lang)} value={co} placeholder={ph} onPress={() => openPicker('co')} />
      </View>
      <FormField label={t('nhFormGuests', lang)}>
        <GuestStepper value={guests} onChange={setGuests} lang={lang} />
      </FormField>
      <FormField label={t('nhFormName', lang)}>
        <TextInput style={s.input} value={name} onChangeText={setName} onFocus={revealFooter}
          autoCapitalize="words" autoCorrect={false} returnKeyType="next"
          blurOnSubmit={false} onSubmitEditing={() => phoneRef.current?.focus()} />
      </FormField>
      <FormField label={t('nhFormPhone', lang)}>
        <TextInput ref={phoneRef} style={s.input} value={phone} onChangeText={setPhone} onFocus={revealFooter} keyboardType="phone-pad" />
      </FormField>
      <View ref={footerRef} collapsable={false}>
        {missing.length > 0 && (
          <Text style={s.formMissing} accessibilityLiveRegion="polite">
            {missingText}
          </Text>
        )}
        <TouchableOpacity style={[s.sendBtn, !v.ok && s.sendBtnOff]} onPress={send} disabled={!v.ok} activeOpacity={0.85}
          accessibilityRole="button" accessibilityState={{ disabled: !v.ok }} accessibilityHint={missing.length ? missingText : undefined}>
          <Ionicons name="logo-whatsapp" size={18} color="#fff" />
          <Text style={s.sendBtnText}>{t('nhFormSend', lang)}</Text>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'ios' && (
        <Modal visible={!!iosPicker} transparent animationType="fade" onRequestClose={() => setIosPicker(null)}>
          <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setIosPicker(null)} />
          {!!ios && (
            <View style={[s.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={s.pickerSheetHeader}>
                <Text style={s.pickerSheetTitle}>{t(iosPicker === 'ci' ? 'nhFormCheckIn' : 'nhFormCheckOut', lang)}</Text>
                <TouchableOpacity style={s.pickerDone} onPress={closeIosPicker} accessibilityRole="button">
                  <Text style={s.pickerDoneText}>{t('done', lang)}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={dateOf((iosPicker === 'ci' ? ci : co) || ios.min)}
                mode="date"
                display="inline"
                locale={LANG_CODES[lang] || 'en'}
                minimumDate={dateOf(ios.min)}
                {...(ios.max ? { maximumDate: dateOf(ios.max) } : {})}
                onChange={(_, date) => { if (date) apply(iosPicker, date) }}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
          )}
        </Modal>
      )}
    </Card>
  )
}

export default function NorthHousesApartmentScreen({ apartment, lang, onBack }) {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const scrollRef = useRef(null)
  const scrollY = useRef(0)
  const kbTopRef = useRef(null)
  kbTopRef.current = kbTop
  const [viewerAt, setViewerAt] = useState(null)

  // Lifts the focused part of the form above the keyboard. measureInWindow is window-relative and the window can start
  // below the screen top, while the keyboard's top is screen-relative: the page root's own window y is the offset
  // (AddressEditor's device-diagnosed fix). Runs again once the keyboard has measured itself, since focus can come first.
  const rootRef = useRef(null)
  const pending = useRef(null)
  const reveal = () => {
    const top = kbTopRef.current, target = pending.current?.current, root = rootRef.current
    if (top == null || !target || !root) return
    root.measureInWindow((_rx, ry) => target.measureInWindow((_x, y, _w, h) => {
      const over = Math.round(y - ry + h + 16 - top)
      if (over > 0) scrollRef.current?.scrollTo({ y: scrollY.current + over, animated: true })
    }))
  }
  const revealField = ref => {
    pending.current = ref
    setTimeout(reveal, 60)
    setTimeout(reveal, 320)
  }
  // pending is kept when the keyboard closes: Back (or a keyboard switch) hides it but leaves the field focused, and the
  // tap that reopens it fires no new onFocus.
  useEffect(() => {
    if (kbTop == null) return
    const ids = [setTimeout(reveal, 60), setTimeout(reveal, 320)]
    return () => ids.forEach(clearTimeout)
  }, [kbTop])

  if (!apartment) return null

  const partner = NORTH_HOUSES
  const building = nhBuilding(apartment.buildingId)
  const langCode = LANG_CODES[lang] || 'en'
  const typeLabel = apartment.kind === 'studio' ? t('nhTypeStudio', lang) : '2+1'

  // Each tap is logged on the line BEFORE the link (fire-and-forget, cannot throw), so a metrics
  // failure can never cost the guest the handoff. Module 'accommodation' and these four actions
  // already pass contact_events' live CHECKs ('call' is the pair DormPartnerScreen logs).
  const openWhatsApp = () => {
    logContactEvent('accommodation', partner.id, 'whatsapp', null)
    Linking.openURL(nhWaUrl(nhWaMessage(t(apartment.nameKey, 'Turkish'), building?.name || ''))).catch(() => {})
  }
  const call = () => {
    logContactEvent('accommodation', partner.id, 'call', null)
    Linking.openURL(`tel:${partner.phone}`).catch(() => {})
  }
  const openWebsite = () => {
    logContactEvent('accommodation', partner.id, 'website', null)
    Linking.openURL(nhWebsiteUrl(apartment, langCode)).catch(() => {})
  }
  const openMap = () => {
    logContactEvent('accommodation', partner.id, 'maps', null)
    Linking.openURL(building.mapUrl).catch(() => {})
  }

  // Screen height, not window height: kbTop is screen-relative, and the window here is shorter than the screen by the
  // system bars, which left the scroll too short for the footer to clear the keyboard (device-tested).
  const kbPad = kbTop != null ? Math.max(0, Dimensions.get('screen').height - kbTop) : 0
  const chips = []
  if (apartment.kind === 'twoPlusOne') chips.push(['bed-outline', fill(t('nhBedrooms', lang), apartment.bedrooms)])
  if (apartment.beds.double > 0) chips.push(['moon-outline', fill(t('nhBedsDouble', lang), apartment.beds.double)])
  if (apartment.beds.single > 0) chips.push(['moon-outline', fill(t('nhBedsSingle', lang), apartment.beds.single)])
  chips.push(['people-outline', fill(t('nhGuestsUpTo', lang), apartment.guests)])
  if (apartment.minNights > 1) chips.push(['calendar-outline', fill(t('nhMinStay', lang), apartment.minNights)])

  return (
    <SafeAreaView ref={rootRef} collapsable={false} style={s.safe} edges={['top']}>
      {REDESIGN ? (
        <ScreenHeader title={partner.name} onBack={onBack} lang={lang} />
      ) : (
        <View style={s.navbar}>
          <BackButton lang={lang} onPress={onBack} />
          <Text style={s.navTitle} numberOfLines={1}>{partner.name}</Text>
          <View style={s.navSpacer} />
        </View>
      )}

      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        scrollEventThrottle={16} onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }}
        contentContainerStyle={{ paddingBottom: (kbTop != null ? kbPad : 96 + insets.bottom) + 16 }}>
        <Pager photos={apartment.photos} width={winW} lang={lang} onOpen={setViewerAt} />

        <View style={s.body}>
          <View style={s.titleBlock}>
            <Text style={s.kicker}>{building?.name} · {typeLabel}</Text>
            <Text style={s.title}>{t(apartment.nameKey, lang)}</Text>
          </View>
          <View style={s.chipWrap}>
            {chips.map(([icon, label]) => <Chip key={label} icon={icon} label={label} />)}
          </View>

          <Card padding={16} style={s.block}>
            <Text style={s.price}>{fill(t('nhFromNight', lang), apartment.price)}</Text>
            <IconLine icon="sparkles-outline">{t('nhCleaning', lang)}: {eur(apartment.cleaningFee)}</IconLine>
            <IconLine icon="shield-checkmark-outline">{fill(t('nhDeposit', lang), apartment.deposit)}</IconLine>
            <Text style={s.note}>{t(partner.priceNoteKey, lang)}</Text>
          </Card>

          {apartment.amenityKeys.length > 0 && (
            <Card padding={16} style={s.block}>
              <Text style={s.blockTitle} accessibilityRole="header">{t('nhAmenitiesTitle', lang)}</Text>
              {apartment.amenityKeys.map(k => <IconLine key={k} icon="checkmark-circle-outline">{t(k, lang)}</IconLine>)}
            </Card>
          )}

          <Card padding={16} style={s.block}>
            <Text style={s.blockTitle} accessibilityRole="header">{t('nhDescTitle', lang)}</Text>
            <Text style={s.desc}>{t(apartment.descKey, lang)}</Text>
          </Card>

          <Card padding={16} style={s.block}>
            <Text style={s.blockTitle} accessibilityRole="header">{t(partner.checkTitleKey, lang)}</Text>
            <IconLine icon="log-in-outline">{t(partner.checkInKey, lang)}</IconLine>
            <IconLine icon="log-out-outline">{t(partner.checkOutKey, lang)}</IconLine>
            <Text style={s.note}>{t(partner.checkLateKey, lang)}</Text>
          </Card>

          <Card padding={16} style={s.block}>
            <Text style={s.blockTitle} accessibilityRole="header">{t('nhLocationTitle', lang)}</Text>
            <Text style={s.buildingName}>{building?.name}</Text>
            <TouchableOpacity style={s.mapBtn} onPress={openMap} activeOpacity={0.6} accessibilityRole="link"
              accessibilityLabel={`${building?.name} — ${t('nhOpenMaps', lang)}`}>
              <Ionicons name="navigate-outline" size={16} color={colors.primary} />
              <Text style={s.mapBtnText}>{t('nhOpenMaps', lang)}</Text>
              <Ionicons name="open-outline" size={14} color={colors.primary} />
            </TouchableOpacity>
          </Card>

          {NORTH_HOUSES_FORM && (
            <RequestForm apartment={apartment} building={building} lang={lang} onFieldFocus={revealField} />
          )}

          <Text style={s.directNote}>{t('nhDirectNote', lang)}</Text>
        </View>
      </ScrollView>

      {kbTop == null && (
        <View style={[s.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.85} accessibilityRole="button"
            accessibilityLabel={t('accomWhatsApp', lang)}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={[s.barBtnText, s.waBtnText]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{t('accomWhatsApp', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.webBtn} onPress={call} activeOpacity={0.7} accessibilityRole="button"
            accessibilityLabel={`${t('accomCall', lang)} ${partner.phone}`}>
            <Ionicons name="call-outline" size={20} color={colors.primary} />
            <Text style={s.barBtnText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{t('accomCall', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.webBtn} onPress={openWebsite} activeOpacity={0.7} accessibilityRole="link"
            accessibilityLabel={t('dormWebsite', lang)}>
            <Ionicons name="open-outline" size={20} color={colors.primary} />
            <Text style={s.barBtnText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{t('dormWebsite', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

      <PhotoViewer photos={apartment.photos} start={viewerAt} lang={lang} onClose={() => setViewerAt(null)} />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.canvas },
  navbar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  navTitle:    { flex: 1, textAlign: 'center', ...type.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:   { width: 40 },

  dots:        { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
                 paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: `rgba(0,0,0,${PILL_ALPHA})` },
  dotsOnPhoto: { bottom: 12 },
  dot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.75)' },
  dotOn:       { width: 16, backgroundColor: '#FFFFFF' },

  // Pure black behind the photo, as every photo viewer does: no theme token is a photo backdrop.
  viewer:      { flex: 1, backgroundColor: '#000000' },
  viewerBar:   { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerCount: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: `rgba(0,0,0,${PILL_ALPHA})` },
  viewerCountText: { ...type.meta, color: '#FFFFFF' },
  viewerClose: { width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: `rgba(0,0,0,${PILL_ALPHA})` },

  body:        { paddingHorizontal: 16, paddingTop: 16 },
  titleBlock:  { marginBottom: 12 },
  kicker:      { ...type.caption, fontFamily: 'Inter_700Bold', color: colors.primaryDark, letterSpacing: 0.3, marginBottom: 4 },
  title:       { ...type.detailTitle, color: colors.textPrimary },
  chipWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.sm, backgroundColor: colors.card },
  chipText:    { ...type.meta, color: colors.textPrimary },

  block:       { marginBottom: 14 },
  blockTitle:  { ...type.sheetTitle, color: colors.textPrimary, marginBottom: 10 },
  price:       { ...type.sectionHeading, color: colors.primaryDark, marginBottom: 8 },
  note:        { ...type.meta, color: colors.textSecondary, marginTop: 8 },
  desc:        { ...type.body, lineHeight: 22, color: colors.textPrimary },
  iconLine:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  iconLineIcon:{ marginTop: 1 },
  iconLineText:{ flex: 1, ...type.body, color: colors.textPrimary },
  buildingName:{ ...type.rowTitle, color: colors.textPrimary },
  mapBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, alignSelf: 'flex-start' },
  mapBtnText:  { ...type.body, fontFamily: 'Inter_700Bold', color: colors.primary },
  directNote:  { ...type.meta, color: colors.textSecondary, textAlign: 'center', marginTop: 2, marginBottom: 8 },

  contactBar:  { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12,
                 backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // Icon above the label: three labels side by side fit every locale at 360 dp only this way. Beside the icon,
  // ru 'Позвонить' broke mid-word and ar 'الموقع الإلكتروني' shrank to unreadable (Android ignores minimumFontScale).
  waBtn:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56, paddingHorizontal: 4, paddingVertical: 6,
                 borderRadius: radii.md, backgroundColor: '#075E54' },
  webBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56, paddingHorizontal: 4, paddingVertical: 6,
                 borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  barBtnText:  { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.primary, textAlign: 'center' },
  waBtnText:   { color: '#FFFFFF' },

  fieldRow:    { flexDirection: 'row', gap: 10 },
  field:       { flex: 1, marginBottom: 12 },
  fieldLabel:  { ...type.meta, color: colors.textSecondary, marginBottom: 4 },
  input:       { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder,
                 backgroundColor: 'transparent', ...type.body, fontSize: 15, color: colors.textPrimary },
  formMissing: { ...type.small, color: colors.textSecondary, marginBottom: 10 },
  dateBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md,
                 borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  dateText:    { flex: 1, ...type.body, fontSize: 15, color: colors.textPrimary },
  datePh:      { color: colors.textSecondary },
  stepper:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 5,
                 borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  stepBtn:     { width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  stepBtnOff:  { opacity: 0.35 },
  stepValue:   { flex: 1, textAlign: 'center', ...type.sectionHeading, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  pickerBackdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet:       { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card,
                       borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  pickerSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                       paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerSheetTitle:  { ...type.rowTitle, color: colors.textPrimary },
  pickerDone:        { minHeight: TAP, justifyContent: 'center', paddingHorizontal: 4 },
  pickerDoneText:    { ...type.rowTitle, color: colors.primary },
  sendBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: radii.md, backgroundColor: '#075E54' },
  sendBtnOff:  { opacity: 0.4 },
  sendBtnText: { ...type.rowTitle, color: '#FFFFFF' },
})
