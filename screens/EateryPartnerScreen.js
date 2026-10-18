import { View, Text, ScrollView, Linking, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import {
  EATERY_CATEGORY_KEY, eateryContacts, eateryMenuUrl, eateryMenuSections, eateryPhotos, eateryWeek,
  eateryOpenStatus, formatPrice,
} from '../constants/eatery'
import { colors, type, radii, space, listBottomPad } from '../constants/theme'
import { ScreenHeader, Card, Button } from '../components/ui'
import { EateryLogo, PlaceholderTag, PhotoPager } from '../components/EateryBits'
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
        <View style={[s.chip, open.tone === 'ok' ? s.chipOk : s.chipWarn]}>
          <Text style={[s.chipText, open.tone === 'ok' ? s.chipOkText : s.chipWarnText]}>{open.text}</Text>
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

function MenuItemRow({ item, lang }) {
  const price = formatPrice(item.price, item.currency, lang)
  return (
    <View style={s.itemRow}>
      <View style={s.itemText}>
        <Text style={s.itemName}>{item.name}</Text>
        {!!item.description && <Text style={s.itemDesc}>{item.description}</Text>}
      </View>
      {!!price && <Text style={s.itemPrice}>{price}</Text>}
    </View>
  )
}

export default function EateryPartnerScreen({ partner, lang, onBack }) {
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

  // The tap is logged on the line BEFORE the link opens (utils/logContactEvent: it never throws);
  // a placeholder partner has no real id and logs nothing.
  const go = (action, url) => {
    if (!partner.placeholder) logContactEvent('eatery', partner.id, action)
    Linking.openURL(url).catch(() => {})
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader lang={lang} title={partner.name} onBack={onBack} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={s.head}>
            <EateryLogo partner={partner} width={72} height={72} lang={lang} />
            <View style={s.headText}>
              <Text style={s.name} accessibilityRole="header">{partner.name}</Text>
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

        {gallery.length > 0 && <PhotoPager photos={gallery} width={W} ratio={4 / 3} fit="cover" lang={lang} />}

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

        {hasMenu && (
          <Card>
            <Text style={s.h}>{t('eateryMenu', lang)}</Text>
            {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tagGap} />}
            {sections.map(sec => (
              <View key={sec.title} style={s.menuSec}>
                <Text style={s.secTitle}>{sec.title}</Text>
                {sec.items.map(i => <MenuItemRow key={i.id} item={i} lang={lang} />)}
              </View>
            ))}
            {menuPhotos.length > 0 && (
              <View style={s.menuSec}>
                <PhotoPager photos={menuPhotos} width={W - 32} ratio={3 / 4} fit="contain" lang={lang} />
              </View>
            )}
            {!!menuUrl && (
              <Button style={s.menuBtn} variant="secondary" icon="restaurant-outline"
                title={t('eateryViewMenu', lang)} onPress={() => go('menu', menuUrl)} />
            )}
          </Card>
        )}
      </ScrollView>
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
  chipOk:    { backgroundColor: colors.primaryLight },
  chipWarn:  { backgroundColor: colors.dangerLight },
  chipText:  { ...type.meta },
  chipOkText:{ color: colors.primaryDark },
  chipWarnText: { color: colors.dangerInk },
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
  itemPrice: { ...type.rowTitle, color: colors.textPrimary, flexShrink: 0 },
  menuBtn:   { marginTop: space[16] },
})
