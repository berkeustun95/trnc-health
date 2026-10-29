import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, PixelRatio, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import PartnerLogoStrip from '../components/PartnerLogoStrip'
import { Card, OnPhotoLabel } from '../components/ui'
import { colors, radii, type, TAP } from '../constants/theme'
import { t } from '../constants/i18n'
import { NORTH_HOUSES, NH_BUILDINGS, NH_APARTMENTS, NH_FROM_PRICE, nhBuilding } from '../constants/dailyRentals'
import { partnerAsset, partnerLogo } from '../constants/partnerAssets'
import { logContactEvent } from '../utils/logContactEvent'

// The Günlük Kiralık tab body: the partner, its apartments, check-in / check-out, its four buildings.
// A free listing — no deal band, no ADA code, no ad slot, no map of ours (the building maps are the
// partner's own links, opened as-is). Config: constants/dailyRentals.js.
//
// Sections sit on the module photo, so each is a white Card and each heading an OnPhotoLabel.
// Everything that re-renders is defined out here, not inside the screen.

// Every apartment card is the same height: one photo ratio (cover), and text slots of fixed line
// counts. The full name is on the apartment screen; the card holds two lines of it.
const CARD_PHOTO_ASPECT = 16 / 10
// The name's two-line slot grows with the system font scale up to this cap, so it never clips.
const NAME_SCALE_MAX = 1.15
const LOGO = 56

const fill = (text, n) => text.replace('{n}', String(n))

function SectionTitle({ children }) {
  return (
    <OnPhotoLabel style={s.sectionLabel} textStyle={s.sectionTitle} numberOfLines={0} accessibilityRole="header">
      {children}
    </OnPhotoLabel>
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

function ApartmentCard({ apartment, lang, width, onPress }) {
  // Numbers, not width:'100%' + aspectRatio: on Android that pair let the 1440 px source size the
  // box (a 16:10 slot rendered taller than wide, showing a zoomed slice). DormRoomRow sizes the same way.
  const photo = { width, height: Math.round(width / CARD_PHOTO_ASPECT) }
  const cover = partnerAsset(apartment.photos[0])
  const building = nhBuilding(apartment.buildingId)
  const typeLabel = apartment.kind === 'studio' ? t('nhTypeStudio', lang) : '2+1'
  return (
    <Card padding={0} onPress={onPress} style={s.aptCard} accessibilityLabel={`${t(apartment.nameKey, lang)}, ${building?.name}, ${fill(t('nhGuestsUpTo', lang), apartment.guests)}, ${fill(t('nhFromNight', lang), apartment.price)}`}>
      {cover
        ? <Image source={cover} style={[s.aptPhoto, photo]} resizeMode="cover" accessible={false} />
        : <View style={[s.aptPhoto, photo]} />}
      <View style={s.aptBody}>
        <Text style={[s.aptName, { height: Math.ceil(type.sheetTitle.lineHeight * 2 * Math.min(PixelRatio.getFontScale(), NAME_SCALE_MAX)) }]}
          numberOfLines={2} maxFontSizeMultiplier={NAME_SCALE_MAX}>{t(apartment.nameKey, lang)}</Text>
        <View style={s.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={s.metaText} numberOfLines={1}>{building?.name} · {typeLabel}</Text>
        </View>
        <View style={s.metaRow}>
          <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
          <Text style={s.metaText} numberOfLines={1}>{fill(t('nhGuestsUpTo', lang), apartment.guests)}</Text>
        </View>
        <Text style={s.aptPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{fill(t('nhFromNight', lang), apartment.price)}</Text>
      </View>
    </Card>
  )
}

function LocationRow({ building, lang, last, onOpenMap }) {
  return (
    <View style={[s.locRow, !last && s.locRowDivider]}>
      <Text style={s.locName}>{building.name}</Text>
      <Text style={s.locBlurb}>{t(building.blurbKey, lang)}</Text>
      <TouchableOpacity style={s.mapBtn} onPress={() => onOpenMap(building)} activeOpacity={0.6}
        accessibilityRole="link" accessibilityLabel={`${building.name} — ${t('nhOpenMaps', lang)}`}>
        <Ionicons name="navigate-outline" size={16} color={colors.primary} />
        <Text style={s.mapBtnText}>{t('nhOpenMaps', lang)}</Text>
        <Ionicons name="open-outline" size={14} color={colors.primary} />
      </TouchableOpacity>
    </View>
  )
}

export default function NorthHousesTab({ lang, onOpenApartment, bottomPad = 24 }) {
  const partner = NORTH_HOUSES
  const { width: winW } = useWindowDimensions()

  // logContactEvent first, then the link: it is fire-and-forget and cannot throw, so it can never
  // cost the tap. 'maps' is permitted by the contact_events CHECK (20261046).
  const openMap = building => {
    logContactEvent('accommodation', partner.id, 'maps', null)
    Linking.openURL(building.mapUrl).catch(() => {})
  }

  return (
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
      <Card padding={16} style={s.block}>
        <View style={s.head}>
          <PartnerLogoStrip source={partnerLogo(partner)} name={partner.name} width={LOGO} height={LOGO} />
          <View style={s.headText}>
            <Text style={s.partnerName}>{partner.name}</Text>
            <Text style={s.tagline}>{t(partner.taglineKey, lang)}</Text>
          </View>
        </View>
        <Text style={s.heroSub}>{t(partner.heroSubKey, lang)}</Text>
        <Text style={s.fromPrice}>{fill(t('nhFromNight', lang), NH_FROM_PRICE)}</Text>
        <IconLine icon="logo-whatsapp">{t(partner.waHoursKey, lang)}</IconLine>
        <Text style={s.note}>{t('nhDirectNote', lang)}</Text>
      </Card>

      <SectionTitle>{t('nhApartmentsTitle', lang)}</SectionTitle>
      {NH_APARTMENTS.map(a => (
        <ApartmentCard key={a.slug} apartment={a} lang={lang} width={winW - 32} onPress={() => onOpenApartment(a)} />
      ))}
      <Card padding={12} style={s.block}>
        <IconLine icon="information-circle-outline">{t(partner.priceNoteKey, lang)}</IconLine>
      </Card>

      <Card padding={16} style={s.block}>
        <Text style={s.blockTitle} accessibilityRole="header">{t(partner.checkTitleKey, lang)}</Text>
        <IconLine icon="log-in-outline">{t(partner.checkInKey, lang)}</IconLine>
        <IconLine icon="log-out-outline">{t(partner.checkOutKey, lang)}</IconLine>
        <Text style={s.note}>{t(partner.checkLateKey, lang)}</Text>
      </Card>

      <SectionTitle>{t('nhLocationsTitle', lang)}</SectionTitle>
      <Card padding={16} style={s.block}>
        {NH_BUILDINGS.map((b, i) => (
          <LocationRow key={b.id} building={b} lang={lang} last={i === NH_BUILDINGS.length - 1} onOpenMap={openMap} />
        ))}
      </Card>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  content:      { paddingHorizontal: 16, paddingTop: 4 },
  block:        { marginBottom: 14 },
  sectionLabel: { alignSelf: 'flex-start', marginTop: 4, marginBottom: 10 },
  sectionTitle: { ...type.sectionHeading },

  head:         { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  headText:     { flex: 1 },
  partnerName:  { ...type.detailTitle, color: colors.textPrimary },
  tagline:      { ...type.body, color: colors.textSecondary, marginTop: 2 },
  heroSub:      { ...type.body, color: colors.textPrimary, marginBottom: 8 },
  fromPrice:    { ...type.sheetTitle, color: colors.primaryDark, marginBottom: 10 },
  note:         { ...type.meta, color: colors.textSecondary, marginTop: 8 },
  blockTitle:   { ...type.sheetTitle, color: colors.textPrimary, marginBottom: 10 },

  iconLine:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  iconLineIcon: { marginTop: 1 },
  iconLineText: { flex: 1, ...type.body, color: colors.textPrimary },

  aptCard:      { marginBottom: 12, overflow: 'hidden' },
  aptPhoto:     { backgroundColor: colors.soft },
  aptBody:      { padding: 14, gap: 6 },
  aptName:      { ...type.sheetTitle, color: colors.textPrimary },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:     { flex: 1, ...type.small, color: colors.textSecondary },
  // Its own line, so it never competes with other text for width (one line in all nine locales).
  aptPrice:     { ...type.rowTitle, color: colors.primaryDark, marginTop: 4 },

  locRow:       { paddingVertical: 12 },
  locRowDivider:{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  locName:      { ...type.rowTitle, color: colors.textPrimary },
  locBlurb:     { ...type.small, color: colors.textSecondary, marginTop: 4 },
  mapBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, alignSelf: 'flex-start' },
  mapBtnText:   { ...type.body, fontFamily: 'Inter_700Bold', color: colors.primary },
})
