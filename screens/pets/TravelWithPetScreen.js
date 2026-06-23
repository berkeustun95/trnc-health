import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'

const LAST_VERIFIED = 'June 2026'

const AIRLINES = [
  { key: 'pegasus', titleKey: 'petsPegasusTitle', url: 'https://www.flypgs.com' },
  { key: 'ajet',    titleKey: 'petsAjetTitle',    url: 'https://www.ajet.com' },
]

const AIRLINE_ROWS = {
  pegasus: [
    { icon: 'person-outline',    labelKey: 'petsCabinTitle',   bodyKey: 'petsPegasusCabinBody' },
    { icon: 'cube-outline',      labelKey: 'petsHoldTitle',    bodyKey: 'petsPegasusHoldBody' },
  ],
  ajet: [
    { icon: 'information-circle-outline', labelKey: null, bodyKey: 'petsAjetBody' },
  ],
}

function SectionHeader({ title }) {
  return <Text style={s.sectionHeader}>{title}</Text>
}

function AirlineCard({ airlineKey, lang }) {
  const airline = AIRLINES.find(a => a.key === airlineKey)
  const rows = AIRLINE_ROWS[airlineKey]
  return (
    <View style={s.airlineCard}>
      <View style={s.airlineCardHeader}>
        <Text style={s.airlineCardTitle}>{t(airline.titleKey, lang)}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(airline.url)} activeOpacity={0.8}>
          <Text style={s.airlineLink}>{t('visitWebsite', lang)}</Text>
        </TouchableOpacity>
      </View>
      {rows.map((row, i) => (
        <View key={i} style={[s.airlineRow, i < rows.length - 1 && s.airlineRowBorder]}>
          {row.labelKey && (
            <View style={s.airlineRowLabel}>
              <Ionicons name={row.icon} size={14} color={colors.primary} />
              <Text style={s.airlineRowLabelText}>{t(row.labelKey, lang)}</Text>
            </View>
          )}
          <Text style={s.airlineRowBody}>{t(row.bodyKey, lang)}</Text>
        </View>
      ))}
    </View>
  )
}

function WarningCard({ icon, iconColor, titleKey, bodyKey, lang }) {
  return (
    <View style={s.warningCard}>
      <View style={s.warningCardHeader}>
        <Ionicons name={icon} size={18} color={iconColor} />
        <Text style={[s.warningCardTitle, { color: iconColor }]}>{t(titleKey, lang)}</Text>
      </View>
      <Text style={s.warningCardBody}>{t(bodyKey, lang)}</Text>
    </View>
  )
}

function InfoCard({ titleKey, bodyKey, lang }) {
  return (
    <View style={s.infoCard}>
      <Text style={s.infoCardTitle}>{t(titleKey, lang)}</Text>
      <Text style={s.infoCardBody}>{t(bodyKey, lang)}</Text>
    </View>
  )
}

function PetsDisclaimer({ lang }) {
  return (
    <View style={s.disclaimer}>
      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} style={{ marginTop: 1, flexShrink: 0 }} />
      <Text style={s.disclaimerText}>
        {t('petsDisclaimerText', lang).replace('{date}', LAST_VERIFIED)}
      </Text>
    </View>
  )
}

export default function TravelWithPetScreen({ lang, onBack }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('petsTravelTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Airlines */}
        <SectionHeader title={t('petsAirlinesTitle', lang)} />
        <AirlineCard airlineKey="pegasus" lang={lang} />
        <AirlineCard airlineKey="ajet"    lang={lang} />

        <View style={s.airlineNote}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} style={{ flexShrink: 0 }} />
          <Text style={s.airlineNoteText}>{t('petsAirlineVerifyNote', lang)}</Text>
        </View>

        {/* Warnings */}
        <SectionHeader title={t('petsTravelWarningsTitle', lang)} />
        <WarningCard
          icon="thermometer-outline"
          iconColor={colors.danger}
          titleKey="petsSummerHeatTitle"
          bodyKey="petsSummerHeatBody"
          lang={lang}
        />
        <WarningCard
          icon="alert-circle-outline"
          iconColor={colors.accent}
          titleKey="petsSnubNosedTitle"
          bodyKey="petsSnubNosedBody"
          lang={lang}
        />

        {/* Re-entry rule */}
        <SectionHeader title={t('petsReentryTitle', lang)} />
        <InfoCard titleKey="petsReentryTitle" bodyKey="petsReentryBody" lang={lang} />

        {/* Pet-friendly places */}
        <SectionHeader title={t('petsFriendlyVenuesTitle', lang)} />
        <View style={[s.infoCard, s.comingSoonCard]}>
          <Ionicons name="map-outline" size={28} color={colors.border} style={{ marginBottom: 8 }} />
          <Text style={s.comingSoonTitle}>{t('petsFriendlyVenuesTitle', lang)}</Text>
          <Text style={s.comingSoonSub}>{t('petsFriendlyVenuesSub', lang)}</Text>
        </View>

        <PetsDisclaimer lang={lang} />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  backPillText:      { fontSize: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular' },
  headerTitle:       { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:            { flex: 1 },
  scrollContent:     { padding: 16, paddingBottom: 48 },
  sectionHeader:     { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 10, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.6 },

  airlineCard:       { backgroundColor: colors.cardBg, borderRadius: radius.card, marginBottom: 10, ...shadow, overflow: 'hidden' },
  airlineCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  airlineCardTitle:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  airlineLink:       { fontSize: 13, color: colors.primary, fontFamily: 'Inter_400Regular' },
  airlineRow:        { padding: 14 },
  airlineRowBorder:  { borderBottomWidth: 1, borderBottomColor: colors.border },
  airlineRowLabel:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  airlineRowLabelText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  airlineRowBody:    { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  airlineNote:       { flexDirection: 'row', gap: 6, marginBottom: 4, paddingHorizontal: 2 },
  airlineNoteText:   { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },

  warningCard:       { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, marginBottom: 10, ...shadow },
  warningCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  warningCardTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold' },
  warningCardBody:   { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  infoCard:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, marginBottom: 4, ...shadow },
  infoCardTitle:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  infoCardBody:      { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  comingSoonCard:    { alignItems: 'center', paddingVertical: 28 },
  comingSoonTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 6 },
  comingSoonSub:     { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },

  disclaimer:        { flexDirection: 'row', gap: 8, marginTop: 24, paddingHorizontal: 4 },
  disclaimerText:    { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
})
