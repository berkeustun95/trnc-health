import { useState, useEffect } from 'react'
import { View, Text, ScrollView, Linking, Modal, Pressable, AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import {
  EATERY_CATEGORY_KEY, eateryContacts, eateryMenuUrl, eateryMenuSections, eateryPhotos, eateryWeek,
  eateryOpenStatus, formatPrice,
} from '../constants/eatery'
import { colors, font, type, radii, space, listBottomPad, withAlpha } from '../constants/theme'
import { ScreenHeader, Card, Button, RemoteImage } from '../components/ui'
import { EateryLogo, PlaceholderTag, PlaceholderFrame, PhotoPager, eateryImageUrl } from '../components/EateryBits'
import { logContactEvent } from '../utils/logContactEvent'

// ─── Yeme-İçme: one partner, in full ────────────────────────────────────────
// Contact buttons are stacked full width: Button truncates its label to one line, and a two-column
// grid leaves "Web sitesi" / "Wegbeschreibung" ~68pt at 320dp.
// Everything comes from the row (constants/eatery.js decides what is empty): a section with
// nothing behind it is absent, never degraded. Fixture partners (partner.placeholder) are labelled
// and NEVER log a contact tap. No cart, no order, no checkout: the menu is information.

const CONTACT_UI = {
  call:     { icon: 'call-outline',      labelKey: 'petHotelCall',       variant: 'primary' },
  whatsapp: { icon: 'logo-whatsapp',     labelKey: 'petHotelWhatsApp',   variant: 'secondary' },
  website:  { icon: 'globe-outline',     labelKey: 'petHotelWebsite',    variant: 'secondary' },
  maps:     { icon: 'navigate-outline',  labelKey: 'petHotelDirections', variant: 'secondary' },
}

function HoursBlock({ week, open, lang }) {
  return (
    <View>
      {!!open && (
        <View style={[s.chip, s['chip_' + open.tone]]}>
          <Text style={[s.chipText, s['chipText_' + open.tone]]}>{open.text}</Text>
        </View>
      )}
      {week.map(d => (
        <View key={d.day} style={s.hourRow}>
          <Text style={s.hourDay}>{t(d.labelKey, lang)}</Text>
          <Text style={s.hourVal}>{d.text || t('towingClosed', lang)}</Text>
        </View>
      ))}
    </View>
  )
}

const THUMB = 64

// A dish photo is partner content: shown as sent (contain), never cropped. A file that fails to load
// calls onFail and the row drops back to text-only. A Preview fixture dish draws the labelled frame.
function DishThumb({ item, name, lang, onOpen, onFail }) {
  const uri = eateryImageUrl(item.photoPath)
  return (
    <Pressable style={({ pressed }) => [s.thumb, pressed && { opacity: 0.8 }]} onPress={onOpen}
      accessibilityRole="button" accessibilityLabel={t('eateryDishPhotoOpen', lang).replace('{name}', name)}>
      {uri
        ? <RemoteImage source={{ uri }} resizeMode="contain" style={s.fill} placeholderColor={colors.soft}
            onError={onFail} accessibilityIgnoresInvertColors />
        : <PlaceholderFrame lang={lang} compact style={s.fill} />}
    </Pressable>
  )
}

// Name and price keep their places in every row (name left, price on the right edge); a row with a
// photo only gains a leading thumbnail, a row without one is exactly the text-only row.
function MenuItemRow({ item, lang, onOpenPhoto }) {
  const [failed, setFailed] = useState(false)
  const price = formatPrice(item.price, item.currency, lang)
  const hasPhoto = !failed && (!!item.photoPath || item.photoPlaceholder)
  return (
    <View style={[s.itemRow, hasPhoto && s.itemRowPhoto]}>
      {hasPhoto && <DishThumb item={item} name={item.name} lang={lang} onOpen={() => onOpenPhoto(item)} onFail={() => setFailed(true)} />}
      <View style={s.itemText}>
        <Text style={s.itemName}>{item.name}</Text>
        {!!item.description && <Text style={s.itemDesc}>{item.description}</Text>}
      </View>
      {!!price && <Text style={s.itemPrice}>{price}</Text>}
    </View>
  )
}

// Fade only; none at all when the system asks for reduced motion.
function useReduceMotion() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return on
}

function DishPhotoViewer({ item, lang, onClose }) {
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const uri = item ? eateryImageUrl(item.photoPath) : null
  const price = item ? formatPrice(item.price, item.currency, lang) : ''
  return (
    <Modal visible={!!item === true} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}
      statusBarTranslucent supportedOrientations={['portrait']}>
      {!!item && (
        <View style={[s.viewer, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[16] }]}>
          <View style={s.viewerBar}>
            <Pressable style={s.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('uiClose', lang)}>
              <Ionicons name="close" size={20} color={colors.onPrimary} />
              <Text style={s.closeText}>{t('uiClose', lang)}</Text>
            </Pressable>
          </View>
          <View style={s.viewerImg}>
            {uri
              ? <RemoteImage source={{ uri }} resizeMode="contain" style={s.fill} placeholderColor="transparent" accessibilityIgnoresInvertColors />
              : <PlaceholderFrame lang={lang} style={{ width: winW - 32, aspectRatio: item.aspect || 4 / 3, borderRadius: radii.card }} />}
          </View>
          <View style={s.caption}>
            <Text style={s.capName}>{item.name}</Text>
            {!!price && <Text style={s.capPrice}>{price}</Text>}
          </View>
        </View>
      )}
    </Modal>
  )
}

export default function EateryPartnerScreen({ partner, lang, onBack, backRef = null }) {
  const [viewing, setViewing] = useState(null)
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const W = winW - 32

  const contacts = eateryContacts(partner)
  const menuUrl = eateryMenuUrl(partner)
  const sections = eateryMenuSections(partner)
  const gallery = eateryPhotos(partner, 'gallery')
  const menuPhotos = eateryPhotos(partner, 'menu')
  const week = eateryWeek(partner)
  const open = eateryOpenStatus(partner, lang)
  const regionKey = REGION_LABEL_KEY[partner.region]
  const hasMenu = sections.length > 0 || menuPhotos.length > 0 || !!menuUrl

  // App's single back handler asks here first (the dish photo viewer is a layer above the partner page).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (viewing) { setViewing(null); return true }
      return false
    }
    return () => { backRef.current = null }
  })

  // The tap is logged on the line BEFORE the link opens (utils/logContactEvent: it never throws);
  // a placeholder partner has no real id and logs nothing.
  const go = (action, url) => {
    if (!partner.placeholder) logContactEvent('eatery', partner.id, action)
    Linking.openURL(url).catch(() => {})
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader lang={lang} title={t('menuEatery', lang)} onBack={onBack} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={s.head}>
            <EateryLogo partner={partner} width={72} height={72} decorative />
            <View style={s.headText}>
              <Text style={s.name}>{partner.name}</Text>
              <Text style={s.sub}>{t(EATERY_CATEGORY_KEY[partner.category] || 'eateryCatRestaurant', lang)}</Text>
              {!!regionKey && (
                <View style={s.region}>
                  <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                  <Text style={s.regionText}>{t(regionKey, lang)}</Text>
                </View>
              )}
            </View>
          </View>
          {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tag} />}
        </Card>

        {gallery.length > 0 && <PhotoPager photos={gallery} width={W} ratio={4 / 3} fit="contain" lang={lang} />}

        {hasMenu && (
          <Card>
            <Text style={s.h}>{t('eateryMenu', lang)}</Text>
            {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tagGap} />}
            {sections.map(sec => (
              <View key={sec.title} style={s.menuSec}>
                <Text style={s.secTitle}>{sec.title}</Text>
                {sec.items.map(i => <MenuItemRow key={i.id} item={i} lang={lang} onOpenPhoto={setViewing} />)}
              </View>
            ))}
            {menuPhotos.length > 0 && (
              <View style={s.menuSec}>
                <PhotoPager photos={menuPhotos} width={W - 32} ratio={3 / 4} fit="contain" lang={lang} radius={radii.md} />
              </View>
            )}
            {!!menuUrl && (
              <Button style={s.menuBtn} variant="secondary" icon="restaurant-outline"
                title={t('eateryViewMenu', lang)} onPress={() => go('menu', menuUrl)} />
            )}
          </Card>
        )}

        {(!!week || !!partner.address) && (
          <Card>
            {!!week && (
              <>
                <Text style={s.h}>{t('eateryHours', lang)}</Text>
                <HoursBlock week={week} open={open} lang={lang} />
              </>
            )}
            {!!partner.address && (
              <View style={!!week && s.addrGap}>
                <Text style={s.h}>{t('eateryAddress', lang)}</Text>
                <Text style={s.body}>{partner.address}</Text>
              </View>
            )}
          </Card>
        )}

        {contacts.length > 0 && (
          <View style={s.actions}>
            {contacts.map(c => (
              <Button key={c.action} fullWidth variant={CONTACT_UI[c.action].variant}
                icon={CONTACT_UI[c.action].icon} title={t(CONTACT_UI[c.action].labelKey, lang)}
                onPress={() => go(c.action, c.url)} />
            ))}
          </View>
        )}

      </ScrollView>
      <DishPhotoViewer item={viewing} lang={lang} onClose={() => setViewing(null)} />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.canvas },
  content:   { paddingHorizontal: 16, paddingTop: space[8], gap: 14 },
  head:      { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  headText:  { flex: 1 },
  name:      { ...type.detailTitle, color: colors.textPrimary },
  sub:       { ...type.small, color: colors.textSecondary, marginTop: 2 },
  region:    { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  regionText:{ ...type.meta, color: colors.textSecondary },
  tag:       { marginTop: space[12] },
  tagGap:    { marginBottom: space[8] },
  h:         { ...type.sectionHeading, color: colors.textPrimary, marginBottom: space[8] },
  body:      { ...type.body, color: colors.textPrimary },
  addrGap:   { marginTop: space[20] },
  chip:      { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: space[8] },
  chip_ok:      { backgroundColor: colors.primaryLight },
  chip_warn:    { backgroundColor: colors.dangerLight },
  chip_neutral: { backgroundColor: colors.soft },
  chipText:  { ...type.meta },
  chipText_ok:      { color: colors.primaryDark },
  chipText_warn:    { color: colors.dangerInk },
  chipText_neutral: { color: colors.textPrimary },
  hourRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[12], minHeight: 28 },
  hourDay:   { ...type.body, color: colors.textSecondary, flexShrink: 1 },
  hourVal:   { ...type.body, color: colors.textPrimary, flexShrink: 0 },
  actions:   { gap: space[8] },
  menuSec:   { marginTop: space[12] },
  secTitle:  { ...type.rowTitle, color: colors.primaryDark, marginBottom: space[4] },
  itemRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[12], paddingVertical: space[8] },
  itemText:  { flex: 1 },
  itemName:  { ...type.body, color: colors.textPrimary },
  itemDesc:  { ...type.small, color: colors.textSecondary, marginTop: 2 },
  itemPrice: { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.textPrimary, flexShrink: 0 },
  menuBtn:   { marginTop: space[16] },
  fill:      { width: '100%', height: '100%' },
  itemRowPhoto: { alignItems: 'center' },
  thumb:     { width: THUMB, height: THUMB, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  viewer:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  viewerBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space[16], flexShrink: 0 },
  closeBtn:  { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[16], borderRadius: radii.pill, backgroundColor: withAlpha(colors.onPrimary, 0.18) },
  closeText: { ...type.body, fontFamily: font.semibold, color: colors.onPrimary },
  viewerImg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space[12], paddingHorizontal: space[8] },
  caption:   { paddingHorizontal: space[20], gap: space[4], alignItems: 'center', flexShrink: 0 },
  capName:   { ...type.rowTitle, color: colors.onPrimary, textAlign: 'center' },
  capPrice:  { ...type.body, fontFamily: font.semibold, fontVariant: ['tabular-nums'], color: colors.onPrimary },
})
