import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'

const LAST_VERIFIED = 'June 2026'

// Verify contact details with TRNC Veterinary Department before shipping
const VET_DEPT_PHONE = '03922283795'
const VET_DEPT_EMAIL = 'veteriner@gov.ct.tr'

function SectionHeader({ title }) {
  return <Text style={s.sectionHeader}>{title}</Text>
}

function InfoCard({ children }) {
  return <View style={s.infoCard}>{children}</View>
}

function VaccineSection({ animalKey, titleKey, bodyKey, lang }) {
  return (
    <View style={s.vaccineSection}>
      <View style={s.vaccineSectionHeader}>
        <Ionicons name={animalKey === 'dogs' ? 'paw-outline' : 'paw-outline'} size={16} color={colors.primary} />
        <Text style={s.vaccineSectionTitle}>{t(titleKey, lang)}</Text>
      </View>
      <Text style={s.vaccineSectionBody}>{t(bodyKey, lang)}</Text>
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

export default function OwningPetScreen({ lang, onBack, onNavigate }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('petsOwningTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* TRNC law / registration */}
        <SectionHeader title={t('petsRegistrationTitle', lang)} />
        <InfoCard>
          <Text style={s.infoCardBody}>{t('petsRegistrationBody', lang)}</Text>
          <View style={s.lawNote}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.accent} style={{ flexShrink: 0, marginTop: 1 }} />
            <Text style={s.lawNoteText}>{t('petsTrncLawNote', lang)}</Text>
          </View>
        </InfoCard>

        {/* Vaccination schedule */}
        <SectionHeader title={t('petsVaccineScheduleTitle', lang)} />
        <View style={s.vaccineCard}>
          <VaccineSection animalKey="dogs" titleKey="petsVaccineDogsTitle" bodyKey="petsVaccineDogsBody" lang={lang} />
          <View style={s.vaccineDivider} />
          <VaccineSection animalKey="cats" titleKey="petsVaccineCatsTitle" bodyKey="petsVaccineCatsBody" lang={lang} />
        </View>

        {/* Find a vet CTA */}
        <SectionHeader title={t('petsVetDirectoryTitle', lang)} />
        <TouchableOpacity style={s.findVetBtn} onPress={() => onNavigate('vetdirectory')} activeOpacity={0.85}>
          <View style={s.findVetBtnIcon}>
            <Ionicons name="search-outline" size={20} color={colors.primary} />
          </View>
          <View style={s.findVetBtnBody}>
            <Text style={s.findVetBtnTitle}>{t('petsFindVet', lang)}</Text>
            <Text style={s.findVetBtnSub}>{t('petsVetDirectorySub', lang)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Cruelty reporting */}
        <SectionHeader title={t('petsCrueltyTitle', lang)} />
        <InfoCard>
          <Text style={s.infoCardBody}>{t('petsCrueltyBody', lang)}</Text>
          <View style={s.contactActions}>
            <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL(`tel:${VET_DEPT_PHONE}`)} activeOpacity={0.8}>
              <Ionicons name="call-outline" size={16} color={colors.primary} />
              <Text style={s.contactBtnText}>{t('call', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL(`mailto:${VET_DEPT_EMAIL}`)} activeOpacity={0.8}>
              <Ionicons name="mail-outline" size={16} color={colors.primary} />
              <Text style={s.contactBtnText}>Email</Text>
            </TouchableOpacity>
          </View>
        </InfoCard>

        {/* Apartment rules */}
        <SectionHeader title={t('petsApartmentTitle', lang)} />
        <InfoCard>
          <Text style={s.infoCardBody}>{t('petsApartmentBody', lang)}</Text>
        </InfoCard>

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

  infoCard:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 14, marginBottom: 4, ...shadow },
  infoCardBody:      { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  lawNote:           { flexDirection: 'row', gap: 8, backgroundColor: colors.accentLight, borderRadius: radius.sm, padding: 10, marginTop: 12 },
  lawNoteText:       { fontSize: 12, color: colors.accent, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },

  vaccineCard:       { backgroundColor: colors.cardBg, borderRadius: radius.card, ...shadow, marginBottom: 4, overflow: 'hidden' },
  vaccineSection:    { padding: 14 },
  vaccineSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  vaccineSectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  vaccineSectionBody: { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  vaccineDivider:    { height: 1, backgroundColor: colors.border },

  findVetBtn:        { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4, ...shadow },
  findVetBtnIcon:    { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  findVetBtnBody:    { flex: 1 },
  findVetBtnTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  findVetBtnSub:     { fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular' },

  contactActions:    { flexDirection: 'row', gap: 10, marginTop: 14 },
  contactBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10 },
  contactBtnText:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },

  disclaimer:        { flexDirection: 'row', gap: 8, marginTop: 24, paddingHorizontal: 4 },
  disclaimerText:    { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
})
