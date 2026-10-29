import { useState, useRef } from 'react'
import { View, Text, Image, FlatList, ScrollView, TextInput, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
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
  nhValidateRequest, nhRequestMessage, nhFormatDateInput,
} from '../constants/dailyRentals'
import { partnerAsset } from '../constants/partnerAssets'
import { logContactEvent } from '../utils/logContactEvent'
import useKeyboardTop from '../utils/useKeyboardTop'
import { supabase } from '../lib/supabase'

// One North Houses apartment: photo pager, what it is, what it costs (as the site shows it, with the
// site's own "prices vary" note), what is inside, the description, check-in / check-out, its building's
// map link, and two ways out — WhatsApp (primary) and the apartment's own page on their site.
// A free listing: no deal band, no code, no ad slot. Config: constants/dailyRentals.js.
//
// The form at the foot is a prototype, rendered only when NORTH_HOUSES_FORM (constants/redesign.js): dev with
// NORTH_HOUSES_FORM_PROTO flipped, or ADA Preview. Production never sets appVariant, so never renders it.

const PHOTO_ASPECT = 4 / 3
const eur = n => `€${n}`
const fill = (text, n) => text.replace('{n}', String(n))

// ─── PHOTO PAGER ─────────────────────────────────────────────────────────────
// A fixed 4:3 frame (the files are 1024x768), so nothing below the pager moves while swiping. Six of
// the 56 photos are portraits (768x1024): those are shown WHOLE (contain, on the soft well) rather
// than cropped to a landscape slice, because a bathroom cropped to its middle third shows nothing.
// A windowed FlatList, so 8 decoded 1024 px photos are never all in memory at once.
function PagerPhoto({ photoKey, width }) {
  const src = partnerAsset(photoKey)
  if (!src) return <View style={{ width, height: Math.round(width / PHOTO_ASPECT), backgroundColor: colors.soft }} />
  const meta = Image.resolveAssetSource(src)
  const portrait = !!meta && meta.height > meta.width
  return (
    <View style={{ width, height: Math.round(width / PHOTO_ASPECT), backgroundColor: colors.soft }}>
      <Image source={src} style={StyleSheet.absoluteFill} resizeMode={portrait ? 'contain' : 'cover'} accessible={false} />
    </View>
  )
}

function Pager({ photos, width }) {
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
        renderItem={({ item }) => <PagerPhoto photoKey={item} width={width} />}
      />
      <View style={s.counter} pointerEvents="none">
        <Text style={s.counterText}>{idx + 1} / {photos.length}</Text>
      </View>
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

// ─── THE REQUEST FORM — DEV-ONLY PROTOTYPE ───────────────────────────────────
//
// Check-in / check-out are free-entry 'DD.MM.YYYY' (dots inserted as the digits are typed, a number
// pad), not a calendar widget: the picker is a native module with an iOS / Android split that cannot
// be device-tested yet, and free entry maps 1:1 onto the validator and the DB's dates.
//
// Send builds the Turkish WhatsApp text (with name and phone: for the partner's eyes only) and opens
// it. The row for our own table is sent fire-and-forget, NOT awaited, and carries NO name or phone:
//   - no .select(): the table has no SELECT policy, so RETURNING would make the insert fail;
//   - supabase queries are lazy thenables: the .then() is what actually sends it;
//   - errors are swallowed: a failed insert must never block WhatsApp. ADA Preview talks to the
//     PRODUCTION project, so a Preview send is a real row (20261143 applied 2026-10-28).
function RequestForm({ apartment, building, lang, onFieldFocus }) {
  const [ci, setCi] = useState('')
  const [co, setCo] = useState('')
  const [guests, setGuests] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const refs = { ci: useRef(null), co: useRef(null), guests: useRef(null), name: useRef(null), phone: useRef(null) }

  const v = nhValidateRequest({ checkInText: ci, checkOutText: co, guestsText: guests, name, phone })
  const datesFilled = ci.length === 10 && co.length === 10
  const contactTouched = name.trim().length > 0 || phone.trim().length > 0
  const err = (datesFilled && !v.datesOk) ? t('nhFormErrDates', lang)
    : (guests.length > 0 && !v.guestsOk) ? t('nhFormErrGuests', lang)
    : (contactTouched && !v.contactOk) ? t('nhFormErrContact', lang)
    : null

  const send = () => {
    if (!v.ok) return
    logContactEvent('accommodation', NORTH_HOUSES.id, 'whatsapp', null)
    supabase.from('partner_booking_requests').insert([{ partner: NORTH_HOUSES.slug, apartment: apartment.slug, check_in: v.checkIn, check_out: v.checkOut, guests: v.guests }]).then(() => {}, () => {})
    const text = nhRequestMessage({
      aptNameTr: t(apartment.nameKey, 'Turkish'), buildingName: building?.name || '',
      checkIn: v.checkIn, checkOut: v.checkOut, guests: v.guests, name, phone,
    })
    Linking.openURL(nhWaUrl(text)).catch(() => {})
  }

  const focus = key => () => onFieldFocus(refs[key])
  const ph = t('nhFormDatePh', lang)
  return (
    <Card padding={16} style={s.block}>
      <Text style={s.blockTitle} accessibilityRole="header">{t('nhFormTitle', lang)}</Text>
      <View style={s.fieldRow}>
        <FormField label={t('nhFormCheckIn', lang)}>
          <TextInput ref={refs.ci} style={s.input} value={ci} onChangeText={x => setCi(nhFormatDateInput(x))}
            onFocus={focus('ci')} placeholder={ph} placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad" maxLength={10} returnKeyType="next" />
        </FormField>
        <FormField label={t('nhFormCheckOut', lang)}>
          <TextInput ref={refs.co} style={s.input} value={co} onChangeText={x => setCo(nhFormatDateInput(x))}
            onFocus={focus('co')} placeholder={ph} placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad" maxLength={10} />
        </FormField>
      </View>
      <FormField label={t('nhFormGuests', lang)}>
        <TextInput ref={refs.guests} style={s.input} value={guests} onChangeText={x => setGuests(x.replace(/\D/g, '').slice(0, 2))}
          onFocus={focus('guests')} placeholder="2" placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad" maxLength={2} />
      </FormField>
      <FormField label={t('nhFormName', lang)}>
        <TextInput ref={refs.name} style={s.input} value={name} onChangeText={setName}
          onFocus={focus('name')} autoCapitalize="words" autoCorrect={false} />
      </FormField>
      <FormField label={t('nhFormPhone', lang)}>
        <TextInput ref={refs.phone} style={s.input} value={phone} onChangeText={setPhone}
          onFocus={focus('phone')} keyboardType="phone-pad" />
      </FormField>
      {!!err && <Text style={s.formError} accessibilityLiveRegion="polite">{err}</Text>}
      <TouchableOpacity style={[s.sendBtn, !v.ok && s.sendBtnOff]} onPress={send} disabled={!v.ok} activeOpacity={0.85}
        accessibilityRole="button" accessibilityState={{ disabled: !v.ok }}>
        <Ionicons name="logo-whatsapp" size={18} color="#fff" />
        <Text style={s.sendBtnText}>{t('nhFormSend', lang)}</Text>
      </TouchableOpacity>
    </Card>
  )
}

export default function NorthHousesApartmentScreen({ apartment, lang, onBack }) {
  const insets = useSafeAreaInsets()
  const { width: winW, height: winH } = useWindowDimensions()
  const kbTop = useKeyboardTop()
  const scrollRef = useRef(null)
  const scrollY = useRef(0)
  const kbTopRef = useRef(null)
  kbTopRef.current = kbTop
  if (!apartment) return null

  const partner = NORTH_HOUSES
  const building = nhBuilding(apartment.buildingId)
  const langCode = LANG_CODES[lang] || 'en'
  const typeLabel = apartment.kind === 'studio' ? t('nhTypeStudio', lang) : '2+1'

  // Each tap is logged on the line BEFORE the link (fire-and-forget, cannot throw), so a metrics
  // failure can never cost the guest the handoff. Module 'accommodation' and these three actions
  // already pass contact_events' live CHECKs.
  const openWhatsApp = () => {
    logContactEvent('accommodation', partner.id, 'whatsapp', null)
    Linking.openURL(nhWaUrl(nhWaMessage(t(apartment.nameKey, 'Turkish'), building?.name || ''))).catch(() => {})
  }
  const openWebsite = () => {
    logContactEvent('accommodation', partner.id, 'website', null)
    Linking.openURL(nhWebsiteUrl(apartment, langCode)).catch(() => {})
  }
  const openMap = () => {
    logContactEvent('accommodation', partner.id, 'maps', null)
    Linking.openURL(building.mapUrl).catch(() => {})
  }

  // Lifts a focused field above the keyboard once the keyboard has measured itself.
  const revealField = ref => {
    setTimeout(() => {
      ref.current?.measureInWindow((x, y, w, h) => {
        const top = kbTopRef.current
        if (top == null) return
        const over = y + h + 24 - top
        if (over > 0) scrollRef.current?.scrollTo({ y: scrollY.current + over, animated: true })
      })
    }, 350)
  }

  const kbPad = kbTop != null ? Math.max(0, winH - kbTop) : 0
  const chips = []
  if (apartment.kind === 'twoPlusOne') chips.push(['bed-outline', fill(t('nhBedrooms', lang), apartment.bedrooms)])
  if (apartment.beds.double > 0) chips.push(['moon-outline', fill(t('nhBedsDouble', lang), apartment.beds.double)])
  if (apartment.beds.single > 0) chips.push(['moon-outline', fill(t('nhBedsSingle', lang), apartment.beds.single)])
  chips.push(['people-outline', fill(t('nhGuestsUpTo', lang), apartment.guests)])
  if (apartment.minNights > 1) chips.push(['calendar-outline', fill(t('nhMinStay', lang), apartment.minNights)])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
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
        <Pager photos={apartment.photos} width={winW} />

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
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.waBtnText} numberOfLines={1}>{t('accomWhatsApp', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.webBtn} onPress={openWebsite} activeOpacity={0.7} accessibilityRole="link"
            accessibilityLabel={t('dormWebsite', lang)}>
            <Ionicons name="open-outline" size={16} color={colors.primary} />
            <Text style={s.webBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('dormWebsite', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.canvas },
  navbar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  navTitle:    { flex: 1, textAlign: 'center', ...type.body, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:   { width: 40 },

  counter:     { position: 'absolute', right: 12, bottom: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: `rgba(0,0,0,${PILL_ALPHA})` },
  counterText: { ...type.meta, color: '#FFFFFF' },

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

  contactBar:  { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
                 backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  waBtn:       { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: radii.md, backgroundColor: '#075E54' },
  waBtnText:   { ...type.rowTitle, color: '#FFFFFF' },
  webBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, paddingHorizontal: 8,
                 borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  webBtnText:  { ...type.rowTitle, color: colors.primary, flexShrink: 1 },

  fieldRow:    { flexDirection: 'row', gap: 10 },
  field:       { flex: 1, marginBottom: 12 },
  fieldLabel:  { ...type.meta, color: colors.textSecondary, marginBottom: 4 },
  input:       { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder,
                 backgroundColor: 'transparent', ...type.body, fontSize: 15, color: colors.textPrimary },
  formError:   { ...type.small, color: colors.dangerInk, marginBottom: 10 },
  sendBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: radii.md, backgroundColor: '#075E54' },
  sendBtnOff:  { opacity: 0.4 },
  sendBtnText: { ...type.rowTitle, color: '#FFFFFF' },
})
