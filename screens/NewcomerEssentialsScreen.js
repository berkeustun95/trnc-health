import { useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

const CARDS = [
  { id: 'driving',   icon: 'car-outline',       color: '#185FA5', bg: '#EAF2FB', labelKey: 'essCardDriving'   },
  { id: 'currency',  icon: 'cash-outline',       color: '#0E7C7B', bg: '#E0F5F4', labelKey: 'essCardCurrency'  },
  { id: 'holidays',  icon: 'flag-outline',       color: '#D1495B', bg: '#FAEAEC', labelKey: 'essCardHolidays'  },
  { id: 'ports',     icon: 'airplane-outline',   color: '#FF8552', bg: '#FFF0EB', labelKey: 'essCardPorts'     },
  { id: 'borders',   icon: 'git-branch-outline', color: '#64748B', bg: '#F1F5F9', labelKey: 'essCardBorders'   },
  { id: 'embassies', icon: 'business-outline',   color: '#5B5BD6', bg: '#EAE8F5', labelKey: 'essCardEmbassies' },
]

// Seeded June 2026 — flag each field for Berke's sign-off before ship.
const CROSSINGS = [
  { id: 'lokmaci',      north: 'Lokmacı',    south: 'Ledra Street',   region: 'Walled city centre, Nicosia',   type: 'pedestrian', hours: 'open24h',  lat: 35.175211,  lng: 33.3614882 },
  { id: 'ledrapalace',  north: 'Ledra Palas', south: null,            region: 'UN buffer zone, Old Nicosia',   type: 'pedestrian', hours: 'open24h',  lat: 35.1795082, lng: 33.3562422, noteKey: 'essBordersLedrapalaceNote' },
  { id: 'metehan',      north: 'Metehan',    south: 'Ayios Dometios', region: 'Northwestern Nicosia',          type: 'vehicle',    hours: 'open24h',  lat: 35.1817756, lng: 33.3232731 },
  { id: 'beyarmudu',    north: 'Beyarmudu',  south: 'Pergamos',       region: 'East of Nicosia',               type: 'vehicle',    hours: 'limited'  },
  { id: 'deryneia',     north: 'Deryneia',   south: null,             region: 'Near Famagusta / east',         type: 'vehicle',    hours: 'limited',  lat: 35.071544,  lng: 33.9604703 },
  { id: 'bostanci',     north: 'Bostancı',   south: 'Astromeritis',   region: 'Northwestern district',         type: 'vehicle',    hours: 'open24h',  lat: 35.1461323, lng: 33.035077  },
  { id: 'yesilirmak',   north: 'Yeşilırmak', south: 'Kato Pyrgos',    region: 'Western coast',                 type: 'vehicle',    hours: 'limited'  },
]

// Coordinates land in step 2 — buttons render only when lat+lng are present.
const AIRPORTS = [
  { id: 'ercan', labelKey: 'essPortsErcan', icon: 'airplane-outline', iconColor: colors.accent, lat: 35.1472558, lng: 33.5037268 },
]

const PORTS = [
  { id: 'girne', labelKey: 'essPortsGirne', icon: 'boat-outline', iconColor: colors.primary },
  { id: 'gazi',  labelKey: 'essPortsGazi',  icon: 'boat-outline', iconColor: colors.primary, lat: 35.1331987, lng: 33.9345815 },
]

// Source: TRNC MFA (mfa.gov.ct.tr) — seeded June 2026, flag for Berke's sign-off.
const OFFICES = [
  { id: 'usa',       name: 'USA',                          address: 'Şerif Arzık Street No:6, Köşklüçiftlik, Lefkoşa',     phone: '+90 392 227 39 30' },
  { id: 'uk',        name: 'UK',                           address: 'Mehmet Akif Avenue No:29, Köşklüçiftlik, Lefkoşa',    phone: '+90 392 228 38 61' },
  { id: 'germany',   name: 'Germany',                      address: '28 Kasım Street No:15, Köşklüçiftlik, Lefkoşa',      phone: '+90 392 227 51 61' },
  { id: 'australia', name: 'Australia',                    address: 'Güner Türkmen Street No:20, Köşklüçiftlik, Lefkoşa', phone: '+90 392 227 73 32' },
  { id: 'france',    name: 'France (cultural/info office)', address: 'Köşklüçiftlik, Lefkoşa',                             phone: '+90 392 228 33 28' },
]

const FIXED_HOLIDAYS = [
  'essHolNewYear', 'essHolChildrenDay', 'essHolLabourDay', 'essHolAtaturkDay',
  'essHolPeaceDay', 'essHolVictoryDay', 'essHolTRDay', 'essHolTRNCDay',
]

const RELIGIOUS_HOLIDAYS = ['essHolRamazan', 'essHolKurban']

function SectionTitle({ text }) {
  return <Text style={s.sectionTitle}>{text}</Text>
}

function BulletRow({ iconName, iconColor, text }) {
  return (
    <View style={s.bulletRow}>
      <Ionicons
        name={iconName || 'checkmark-circle-outline'}
        size={16}
        color={iconColor || colors.primary}
        style={s.bulletIcon}
      />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  )
}

function DrivingCard({ lang }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <SectionTitle text={t('essDrivingRulesTitle', lang)} />
        <BulletRow iconName="alert-circle-outline" iconColor={colors.danger} text={t('essDrivingRule1', lang)} />
        <BulletRow text={t('essDrivingRule2', lang)} />
        <BulletRow text={t('essDrivingRule3', lang)} />
        <BulletRow text={t('essDrivingRule4', lang)} />
        <BulletRow text={t('essDrivingRule5', lang)} />

        <SectionTitle text={t('essDrivingSpeedTitle', lang)} />
        <BulletRow iconName="speedometer-outline" iconColor={colors.accent} text={t('essDrivingSpeed1', lang)} />
        <BulletRow iconName="speedometer-outline" iconColor={colors.accent} text={t('essDrivingSpeed2', lang)} />
        <BulletRow iconName="speedometer-outline" iconColor={colors.accent} text={t('essDrivingSpeed3', lang)} />
        <BulletRow iconName="wine-outline" iconColor={colors.danger} text={t('essDrivingAlcohol', lang)} />

        <SectionTitle text={t('essDrivingPlatesTitle', lang)} />
        <BulletRow iconName="car-outline" iconColor="#185FA5" text={t('essDrivingPlate1', lang)} />
        <BulletRow iconName="car-outline" iconColor="#185FA5" text={t('essDrivingPlate2', lang)} />
        <BulletRow iconName="car-outline" iconColor="#185FA5" text={t('essDrivingPlate3', lang)} />
      </ContentCard>
    </ScrollView>
  )
}

function CurrencyCard({ lang, onShowExchangeRates }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <BulletRow iconName="cash-outline" iconColor={colors.primary} text={t('essCurrPrimary', lang)} />
        <BulletRow text={t('essCurrAccepted', lang)} />
        <BulletRow iconName="cart-outline" iconColor={colors.accent} text={t('essCurrCash', lang)} />
        <BulletRow iconName="location-outline" iconColor={colors.textSecondary} text={t('essCurrATM', lang)} />
        <BulletRow iconName="swap-horizontal-outline" iconColor={colors.textSecondary} text={t('essCurrBureaux', lang)} />

        <TouchableOpacity style={s.fxButton} onPress={onShowExchangeRates} activeOpacity={0.8}>
          <Ionicons name="trending-up-outline" size={18} color={colors.surface} />
          <Text style={s.fxButtonText}>{t('essCurrRatesBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    </ScrollView>
  )
}

function HolidaysCard({ lang }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <SectionTitle text={t('essHolFixedTitle', lang)} />
        {FIXED_HOLIDAYS.map(key => (
          <BulletRow key={key} iconName="flag-outline" iconColor={colors.danger} text={t(key, lang)} />
        ))}

        <SectionTitle text={t('essHolReligiousTitle', lang)} />
        {RELIGIOUS_HOLIDAYS.map(key => (
          <BulletRow key={key} iconName="moon-outline" iconColor="#5B5BD6" text={t(key, lang)} />
        ))}

        <Text style={s.yearNote}>{t('essHolYearNote', lang)}</Text>
      </ContentCard>
    </ScrollView>
  )
}

function PortsCard({ lang }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <SectionTitle text={t('essPortsAirTitle', lang)} />
        {AIRPORTS.map(entry => (
          <View key={entry.id} style={s.portEntry}>
            <View style={[s.bulletRow, { marginBottom: 0 }]}>
              <Ionicons name={entry.icon} size={16} color={entry.iconColor} style={s.bulletIcon} />
              <Text style={s.bulletText}>{t(entry.labelKey, lang)}</Text>
            </View>
            {entry.lat != null && entry.lng != null && (
              <TouchableOpacity
                style={[s.directionsBtn, { alignSelf: 'flex-start', marginLeft: 24, marginTop: 8 }]}
                onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${entry.lat},${entry.lng}`)}
                activeOpacity={0.7}
              >
                <Feather name="navigation" size={13} color={colors.primary} />
                <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <BulletRow iconName="arrow-forward-outline" iconColor={colors.textSecondary} text={t('essPortsLarnacaNote', lang)} />

        <SectionTitle text={t('essPortsSeaTitle', lang)} />
        {PORTS.map(entry => (
          <View key={entry.id} style={s.portEntry}>
            <View style={[s.bulletRow, { marginBottom: 0 }]}>
              <Ionicons name={entry.icon} size={16} color={entry.iconColor} style={s.bulletIcon} />
              <Text style={s.bulletText}>{t(entry.labelKey, lang)}</Text>
            </View>
            {entry.lat != null && entry.lng != null && (
              <TouchableOpacity
                style={[s.directionsBtn, { alignSelf: 'flex-start', marginLeft: 24, marginTop: 8 }]}
                onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${entry.lat},${entry.lng}`)}
                activeOpacity={0.7}
              >
                <Feather name="navigation" size={13} color={colors.primary} />
                <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ContentCard>
    </ScrollView>
  )
}

function LastReviewedTag({ text }) {
  return (
    <View style={s.lastReviewedTag}>
      <Ionicons name="alert-circle-outline" size={13} color={colors.accent} />
      <Text style={s.lastReviewedText}>{text}</Text>
    </View>
  )
}

function BordersCard({ lang }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <LastReviewedTag text={t('essBordersLastReviewed', lang)} />

      {CROSSINGS.map(c => {
        const hoursKey = c.hours === 'open24h' ? 'essBordersOpen24h' : 'essBordersLimitedHours'
        const typeKey  = c.type === 'pedestrian' ? 'essBordersPedestrian' : 'essBordersVehiclePed'
        const typeColor = c.type === 'pedestrian' ? '#5B5BD6' : '#0E7C7B'
        const typeBg    = c.type === 'pedestrian' ? '#EAE8F5' : '#E0F5F4'
        return (
          <View key={c.id} style={s.crossingCard}>
            <Text style={s.crossingName}>
              {c.north}{c.south != null ? <Text> <Text style={s.crossingSlash}>/</Text> {c.south}</Text> : null}
            </Text>
            <Text style={s.crossingRegion}>{c.region}</Text>
            <View style={s.crossingBadges}>
              <View style={[s.badge, { backgroundColor: typeBg }]}>
                <Text style={[s.badgeText, { color: typeColor }]}>{t(typeKey, lang)}</Text>
              </View>
              <View style={[s.badge, { backgroundColor: colors.bg }]}>
                <Ionicons name="time-outline" size={11} color={colors.textSecondary} />
                <Text style={[s.badgeText, { color: colors.textSecondary }]}>{t(hoursKey, lang)}</Text>
              </View>
            </View>
            {c.noteKey && (
              <View style={s.crossingNote}>
                <Ionicons name="information-circle-outline" size={13} color={colors.accent} style={{ marginTop: 1, flexShrink: 0 }} />
                <Text style={s.crossingNoteText}>{t(c.noteKey, lang)}</Text>
              </View>
            )}
            {c.lat != null && c.lng != null && (
              <View style={s.crossingActions}>
                <TouchableOpacity
                  style={s.directionsBtn}
                  onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`)}
                  activeOpacity={0.7}
                >
                  <Feather name="navigation" size={13} color={colors.primary} />
                  <Text style={s.directionsBtnText}>{t('getDirections', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )
      })}

      <ContentCard style={{ marginTop: 8 }}>
        <Text style={s.hoursNote}>{t('essBordersHoursNote', lang)}</Text>

        <SectionTitle text={t('essBordersInsTitle', lang)} />
        <BulletRow iconName="shield-checkmark-outline" iconColor={colors.danger} text={t('essBordersIns1', lang)} />
        <BulletRow iconName="close-circle-outline"     iconColor={colors.danger} text={t('essBordersIns2', lang)} />
        <BulletRow iconName="information-circle-outline" iconColor={colors.textSecondary} text={t('essBordersIns3', lang)} />

        <SectionTitle text={t('essBordersDocTitle', lang)} />
        <BulletRow text={t('essBordersDocEU', lang)} />
        <BulletRow text={t('essBordersDocStamp', lang)} />
        <BulletRow text={t('essBordersDocRoC', lang)} />
        <BulletRow iconName="alert-circle-outline" iconColor={colors.accent} text={t('essBordersDocEntryRoute', lang)} />
      </ContentCard>
    </ScrollView>
  )
}

function OfficeRow({ office }) {
  return (
    <View style={s.embassyBlock}>
      <Text style={s.embassyTitle}>{office.name}</Text>
      <View style={s.embassyRow}>
        <Ionicons name="location-outline" size={15} color={colors.textSecondary} style={{ marginTop: 1 }} />
        <Text style={s.embassyDetail}>{office.address}</Text>
      </View>
      <View style={s.embassyRow}>
        <Ionicons name="call-outline" size={15} color={colors.textSecondary} style={{ marginTop: 1 }} />
        <Text style={s.embassyDetail}>{office.phone}</Text>
      </View>
    </View>
  )
}

function EmbassiesCard({ lang }) {
  return (
    <ScrollView style={s.cardScroll} contentContainerStyle={s.cardContent} showsVerticalScrollIndicator={false}>
      <LastReviewedTag text={t('essEmbLastReviewed', lang)} />

      <View style={s.embassyBlock}>
        <Text style={s.embassyTitle}>{t('essEmbTurkeyTitle', lang)}</Text>
        <View style={s.embassyRow}>
          <Ionicons name="location-outline" size={15} color={colors.textSecondary} style={{ marginTop: 1 }} />
          <Text style={s.embassyDetail}>{t('essEmbTurkeyAddress', lang)}</Text>
        </View>
        <View style={s.embassyRow}>
          <Ionicons name="call-outline" size={15} color={colors.textSecondary} style={{ marginTop: 1 }} />
          <Text style={[s.embassyDetail, { fontStyle: 'italic', color: colors.textSecondary }]}>{t('essEmbTurkeyPhoneNote', lang)}</Text>
        </View>
        <Text style={s.embassyNote}>{t('essEmbTurkeyNote', lang)}</Text>
      </View>

      <SectionTitle text={t('essEmbOtherTitle', lang)} />
      {OFFICES.map(o => <OfficeRow key={o.id} office={o} />)}
      <ContentCard style={{ marginTop: 4 }}>
        <Text style={s.embassyOtherNote}>{t('essEmbOtherNote', lang)}</Text>
      </ContentCard>

      <Text style={s.embassyCaveat}>{t('essEmbCaveat', lang)}</Text>
    </ScrollView>
  )
}

function PendingCard({ lang, msgKey }) {
  return (
    <View style={s.pendingWrap}>
      <Ionicons name="time-outline" size={36} color={colors.border} />
      <Text style={s.pendingText}>{t(msgKey, lang)}</Text>
    </View>
  )
}

function renderCardContent(cardId, lang, onShowExchangeRates) {
  switch (cardId) {
    case 'driving':   return <DrivingCard lang={lang} />
    case 'currency':  return <CurrencyCard lang={lang} onShowExchangeRates={onShowExchangeRates} />
    case 'holidays':  return <HolidaysCard lang={lang} />
    case 'ports':     return <PortsCard lang={lang} />
    case 'borders':   return <BordersCard lang={lang} />
    case 'embassies': return <EmbassiesCard lang={lang} />
    default: return null
  }
}

export default function NewcomerEssentialsScreen({ lang, onBack, onShowExchangeRates }) {
  const [activeCard, setActiveCard] = useState(null)

  const card = CARDS.find(c => c.id === activeCard)

  if (activeCard && card) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <PageBackground topic="newcomer_essentials" />
        <ScreenHeader
          onBack={() => setActiveCard(null)}
          lang={lang}
          titleIcon={
            <View style={[s.cardHeaderIcon, { backgroundColor: card.bg }]}>
              <Ionicons name={card.icon} size={22} color={card.color} />
            </View>
          }
          title={t(card.labelKey, lang)}
        />
        {renderCardContent(activeCard, lang, onShowExchangeRates)}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} />
      <ScrollView contentContainerStyle={s.hubContent} showsVerticalScrollIndicator={false}>
        <View style={s.hubCard}>
          <Text style={s.hubTitle}>{t('essHubTitle', lang)}</Text>
          <Text style={s.hubSubtitle}>{t('essHubSubtitle', lang)}</Text>
        </View>
        <View style={s.grid}>
          {CARDS.map(c => (
            <TouchableOpacity
              key={c.id}
              style={s.tile}
              onPress={() => setActiveCard(c.id)}
              activeOpacity={0.8}
            >
              <View style={[s.tileIcon, { backgroundColor: c.bg }]}>
                <Ionicons name={c.icon} size={26} color={c.color} />
              </View>
              <Text style={s.tileLabel} numberOfLines={2}>{t(c.labelKey, lang)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  hubCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 24,
    ...shadow,
  },
  hubContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  hubTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  hubSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    alignItems: 'flex-start',
    ...shadow,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  cardHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardScroll: { flex: 1 },
  cardContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    backgroundColor: colors.bg,
    minHeight: '100%',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  bulletIcon: { marginTop: 2, flexShrink: 0 },
  bulletText: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  fxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 24,
    gap: 8,
  },
  fxButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.surface,
  },
  yearNote: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
  },
  lastReviewedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.accentLight,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  lastReviewedText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '500',
  },
  crossingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    ...shadow,
  },
  crossingName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  crossingSlash: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  crossingRegion: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  crossingBadges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  crossingNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 8,
  },
  crossingNoteText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  crossingActions:  { marginTop: 10 },
  directionsBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primaryLight, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  directionsBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  portEntry:        { marginBottom: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  hoursNote: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 4,
  },
  embassyBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 4,
    ...shadow,
  },
  embassyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  embassyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
  },
  embassyDetail: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  embassyNote: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 6,
  },
  embassyOtherNote: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: 12,
  },
  embassyCaveat: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
    padding: 12,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    marginTop: 8,
  },
  pendingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  pendingText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
})
