import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import { colors, shadow, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'
import BackButton from '../../components/BackButton'
import PetsRegulatoryNotice from '../../components/PetsRegulatoryNotice'
import PetsStaleNotice from '../../components/PetsStaleNotice'
import VetDeptActions from '../../components/VetDeptActions'
import { verifiedLabel } from '../../constants/petsContent'
import { PETS_TIMELINE_LIVE } from '../../constants/flags'

// Upload the PIB.01 PDF to Supabase Storage (bucket: documents, path: pib01.pdf) then
// replace null with the public object URL. NOTHING ELSE CHANGES when it arrives — the
// button already opens whatever is here, and the fallback below simply stops rendering.
const PIB01_URL = null

const COUNTRIES = [
  { id: 'UK',      labelKey: 'petsCountryUK' },
  { id: 'EU',      labelKey: 'petsCountryEU' },
  { id: 'Turkiye', labelKey: 'petsCountryTurkiye' },
  { id: 'Other',   labelKey: 'petsCountryOther' },
]

// Per-country step definitions. Keys reference i18n.
const STEPS_BY_COUNTRY = {
  UK: [
    { num: 1, titleKey: 'petsStep1Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep1Body' },
    { num: 2, titleKey: 'petsStep2Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep2Body' },
    { num: 3, titleKey: 'petsStep3Title', waitKey: 'petsStep3Sub',  isMandatoryWait: true,  bodyKey: 'petsStep3Body' },
    { num: 4, titleKey: 'petsStep4Title', waitKey: 'petsStep4Sub',  isMandatoryWait: true,  bodyKey: 'petsStep4Body' },
    { num: 5, titleKey: 'petsStep5Title', waitKey: 'petsStep5Sub',  isMandatoryWait: false, bodyKey: 'petsStep5Body' },
    { num: 6, titleKey: 'petsStep6Title', waitKey: 'petsStep6Sub',  isMandatoryWait: false, bodyKey: 'petsStep6Body' },
  ],
  EU: [
    { num: 1, titleKey: 'petsStep1Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep1Body' },
    { num: 2, titleKey: 'petsStep2Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep2Body' },
    { num: 3, titleKey: 'petsStep3Title', waitKey: 'petsStep3Sub',  isMandatoryWait: true,  bodyKey: 'petsStep3BodyEU' },
    { num: 4, titleKey: 'petsStep4Title', waitKey: 'petsStep4Sub',  isMandatoryWait: true,  bodyKey: 'petsStep4Body' },
    { num: 5, titleKey: 'petsStep5Title', waitKey: 'petsStep5Sub',  isMandatoryWait: false, bodyKey: 'petsStep5Body' },
    { num: 6, titleKey: 'petsStep6Title', waitKey: 'petsStep6Sub',  isMandatoryWait: false, bodyKey: 'petsStep6BodyEU' },
  ],
  Turkiye: [
    { num: 1, titleKey: 'petsStep1Title',    waitKey: null,           isMandatoryWait: false, bodyKey: 'petsStep1Body' },
    { num: 2, titleKey: 'petsStep2Title',    waitKey: null,           isMandatoryWait: false, bodyKey: 'petsStep2Body' },
    { num: 3, titleKey: 'petsTrStep3Title',  waitKey: null,           isMandatoryWait: false, bodyKey: 'petsTrStep3Body' },
    { num: 4, titleKey: 'petsStep5Title',    waitKey: 'petsStep5Sub', isMandatoryWait: false, bodyKey: 'petsStep5Body' },
    { num: 5, titleKey: 'petsStep6Title',    waitKey: 'petsStep6Sub', isMandatoryWait: false, bodyKey: 'petsTrStep5Body' },
  ],
  Other: [
    { num: 1, titleKey: 'petsStep1Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep1Body' },
    { num: 2, titleKey: 'petsStep2Title', waitKey: null,            isMandatoryWait: false, bodyKey: 'petsStep2Body' },
    { num: 3, titleKey: 'petsStep3Title', waitKey: 'petsStep3Sub',  isMandatoryWait: true,  bodyKey: 'petsStep3Body' },
    { num: 4, titleKey: 'petsStep4Title', waitKey: 'petsStep4Sub',  isMandatoryWait: true,  bodyKey: 'petsStep4Body' },
    { num: 5, titleKey: 'petsStep5Title', waitKey: 'petsStep5Sub',  isMandatoryWait: false, bodyKey: 'petsStep5Body' },
    { num: 6, titleKey: 'petsStep6Title', waitKey: 'petsStep6Sub',  isMandatoryWait: false, bodyKey: 'petsOtherStep6Body' },
  ],
}

// Country-specific callout notes shown above the steps
const NOTES_BY_COUNTRY = {
  UK:      [],
  EU:      ['petsEUNote'],
  Turkiye: ['petsTurkiyeNote1', 'petsTurkiyeNote2'],
  Other:   ['petsOtherNote'],
}

function StepCard({ step, lang }) {
  return (
    <View style={s.stepCard}>
      <View style={s.stepNumWrap}>
        <Text style={s.stepNum}>{step.num}</Text>
      </View>
      <View style={s.stepBody}>
        <View style={s.stepTitleRow}>
          <Text style={s.stepTitle}>{t(step.titleKey, lang)}</Text>
          {step.waitKey && (
            <View style={[s.waitPill, step.isMandatoryWait ? s.waitMandatory : s.waitTiming]}>
              <Text style={[s.waitPillText, step.isMandatoryWait ? s.waitMandatoryText : s.waitTimingText]}>
                {t(step.waitKey, lang)}
              </Text>
            </View>
          )}
        </View>
        <Text style={s.stepBodyText}>{t(step.bodyKey, lang)}</Text>
      </View>
    </View>
  )
}

function CountryNote({ noteKey, lang }) {
  return (
    <View style={s.countryNote}>
      <Ionicons name="information-circle-outline" size={16} color={colors.primary} style={{ flexShrink: 0, marginTop: 1 }} />
      <Text style={s.countryNoteText}>{t(noteKey, lang)}</Text>
    </View>
  )
}

function SectionHeader({ title }) {
  return <Text style={s.sectionHeader}>{title}</Text>
}

function PetsDisclaimer({ lang }) {
  return (
    <View style={s.disclaimer}>
      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} style={{ marginTop: 1, flexShrink: 0 }} />
      <Text style={s.disclaimerText}>
        {t('petsDisclaimerText', lang).replace('{date}', verifiedLabel(lang))}
      </Text>
    </View>
  )
}

export default function BringingPetScreen({ lang, onBack, onNavigate }) {
  const [country, setCountry] = useState('UK')

  const steps = STEPS_BY_COUNTRY[country]
  const notes = NOTES_BY_COUNTRY[country]

  // ⚠ NO "COMING SOON" ALERT. This shipped in a LIVE module: tapping the only route to the
  //   import licence form produced a modal promising a PDF "shortly" — a promise nobody
  //   was keeping, in a flow where the user needs the form to travel. An honest dead end
  //   with a way through beats a cheerful one with none, so when there is no URL the card
  //   below renders the Veterinary Department's own contacts and the button is not drawn
  //   at all. A button that cannot do its job should not be on screen.
  function openPIB01() {
    if (!PIB01_URL) return
    Linking.openURL(PIB01_URL).catch(() => {})
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.headerTitle}>{t('petsBringTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Notices FIRST: the reader meets the explanation before the English, and the
            staleness warning before any rule it might apply to. Both render nothing when
            they do not apply — the regulatory one only for the seven fallback locales,
            the stale one only past 180 days. */}
        <PetsStaleNotice lang={lang} />
        <PetsRegulatoryNotice lang={lang} />

        {/* Critical Green Line warning */}
        <View style={s.criticalBanner}>
          <Ionicons name="warning-outline" size={22} color={colors.danger} style={{ marginTop: 1, flexShrink: 0 }} />
          <View style={s.criticalBannerBody}>
            <Text style={s.criticalBannerTitle}>{t('petsGreenLineTitle', lang)}</Text>
            <Text style={s.criticalBannerText}>{t('petsGreenLineText', lang)}</Text>
          </View>
        </View>

        {/* Country selector */}
        <View style={s.countryTabsWrap}>
          {COUNTRIES.map(c => {
            const active = c.id === country
            return (
              <TouchableOpacity
                key={c.id}
                style={[s.countryTab, active && s.countryTabActive]}
                onPress={() => setCountry(c.id)}
                activeOpacity={0.75}
              >
                <Text style={[s.countryTabText, active && s.countryTabTextActive]}>
                  {t(c.labelKey, lang)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Country-specific notes */}
        {notes.map(key => <CountryNote key={key} noteKey={key} lang={lang} />)}

        {/* Steps */}
        <SectionHeader title={t('petsRequirements', lang)} />
        {steps.map(step => <StepCard key={step.num} step={step} lang={lang} />)}

        {/* ─── Timeline calculator ────────────────────────────────────────
            HERE, not on PetsHomeScreen, and the placement is the argument: the
            calculator turns THESE steps into dates, so it only means anything to
            somebody who has just read them. On the module landing it would have been a
            fourth journey competing with the three, offered before the reader knows
            what an interval is.

            Gated on PETS_TIMELINE_LIVE, which ships false — its intervals are the same
            unverified regulatory content the staleness guard is red about, and a
            calculator turns an unverified interval into a confident date. */}
        {PETS_TIMELINE_LIVE && !!onNavigate && (
          <TouchableOpacity style={s.timelineBtn} onPress={() => onNavigate('timeline')} activeOpacity={0.85}>
            <View style={s.timelineIcon}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </View>
            <View style={s.timelineBody}>
              <Text style={s.timelineTitle}>{t('petsTimelineTitle', lang)}</Text>
              <Text style={s.timelineSub}>{t('petsTimelineOpenSub', lang)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* Banned breeds */}
        <SectionHeader title={t('petsBannedBreeds', lang)} />
        <View style={s.infoCard}>
          <View style={s.infoCardHeaderRow}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={[s.infoCardTitle, { color: colors.danger }]}>{t('petsBannedBreeds', lang)}</Text>
          </View>
          <Text style={s.infoCardBody}>{t('petsBannedBreedsBody', lang)}</Text>
        </View>

        {/* Fees */}
        <SectionHeader title={t('petsFees', lang)} />
        <View style={s.infoCard}>
          <Text style={[s.infoCardBody, { marginTop: 0 }]}>{t('petsFeesBody', lang)}</Text>
        </View>

        {/* At Ercan */}
        <SectionHeader title={t('petsAtErcan', lang)} />
        <View style={s.infoCard}>
          <View style={s.infoCardHeaderRow}>
            <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
            <Text style={s.infoCardTitle}>{t('petsAtErcan', lang)}</Text>
          </View>
          <Text style={s.infoCardBody}>{t('petsAtErcanBody', lang)}</Text>
        </View>

        {/* PIB.01 form */}
        <SectionHeader title={t('petsPIBForm', lang)} />
        <View style={s.infoCard}>
          <Text style={[s.infoCardBody, { marginTop: 0, marginBottom: 14 }]}>{t('petsPIBFormSub', lang)}</Text>
          {PIB01_URL ? (
            <TouchableOpacity style={s.pibBtn} onPress={openPIB01} activeOpacity={0.85}>
              <Ionicons name="document-text-outline" size={18} color="#fff" />
              <Text style={s.pibBtnText}>{t('petsPIBBtn', lang)}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={s.infoCardBody}>{t('petsPIBRequestFromVet', lang)}</Text>
              <VetDeptActions lang={lang} />
            </>
          )}
        </View>

        {/* Vet Department contact */}
        <SectionHeader title={t('petsVetDept', lang)} />
        <View style={s.contactCard}>
          <View style={s.contactRow}>
            <Feather name="map-pin" size={14} color={colors.textSecondary} style={{ flexShrink: 0 }} />
            <Text style={s.contactText}>{t('petsVetDeptAddress', lang)}</Text>
          </View>
          <VetDeptActions lang={lang} />
        </View>

        <PetsDisclaimer lang={lang} />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  timelineBtn:   { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                   flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 4, ...shadow },
  timelineIcon:  { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryLight,
                   justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  timelineBody:  { flex: 1 },
  timelineTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  timelineSub:   { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular' },
  safe:                 { flex: 1, backgroundColor: colors.bg },
  header:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:               { flex: 1 },
  scrollContent:        { padding: 16, paddingBottom: 48 },

  criticalBanner:       { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 14, flexDirection: 'row', gap: 10, marginBottom: 20, borderLeftWidth: 3, borderLeftColor: colors.danger },
  criticalBannerBody:   { flex: 1 },
  criticalBannerTitle:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger, marginBottom: 3 },
  criticalBannerText:   { fontSize: 13, color: colors.danger, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  countryTabsWrap:      { flexDirection: 'row', gap: 8, marginBottom: 16 },
  countryTab:           { flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: colors.cardBg, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  countryTabActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  countryTabText:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  countryTabTextActive: { color: '#fff', fontFamily: 'Inter_700Bold' },

  countryNote:          { flexDirection: 'row', gap: 8, backgroundColor: colors.primaryLight, borderRadius: radius.sm, padding: 12, marginBottom: 12 },
  countryNoteText:      { fontSize: 13, color: colors.primary, fontFamily: 'Inter_400Regular', lineHeight: 18, flex: 1 },

  sectionHeader:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, marginBottom: 10, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.6 },

  stepCard:             { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, flexDirection: 'row', gap: 12, marginBottom: 8, ...shadow },
  stepNumWrap:          { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1 },
  stepNum:              { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  stepBody:             { flex: 1 },
  stepTitleRow:         { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 5 },
  stepTitle:            { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  waitPill:             { borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 },
  waitMandatory:        { backgroundColor: colors.accentLight },
  waitTiming:           { backgroundColor: colors.border },
  waitPillText:         { fontSize: 11, fontFamily: 'Inter_400Regular' },
  waitMandatoryText:    { color: colors.accent },
  waitTimingText:       { color: colors.textSecondary },
  stepBodyText:         { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  infoCard:             { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, marginBottom: 4, ...shadow },
  infoCardHeaderRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoCardTitle:        { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  infoCardBody:         { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19, marginTop: 4 },

  pibBtn:               { backgroundColor: colors.primary, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  pibBtnText:           { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  contactCard:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, marginBottom: 4, ...shadow },
  contactRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  contactText:          { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 18 },
  contactActions:       { flexDirection: 'row', gap: 10 },
  contactBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10 },
  contactBtnText:       { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  disclaimer:           { flexDirection: 'row', gap: 8, marginTop: 24, paddingHorizontal: 4 },
  disclaimerText:       { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
})
