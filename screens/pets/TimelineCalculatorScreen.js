import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors, shadow, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'

const MS_DAY = 86400000

function addDays(date, n) {
  return new Date(date.getTime() + n * MS_DAY)
}

function formatDate(date, lang) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function calculateTimeline(arrivalDate, petDOB) {
  const today = startOfDay(new Date())
  const arrival = startOfDay(arrivalDate)

  // Earliest the pet can be vaccinated: must be ≥12 weeks old
  const earliest12Weeks = petDOB ? addDays(startOfDay(petDOB), 84) : today
  const earliestVaccine = earliest12Weeks > today ? earliest12Weeks : today

  // Titer blood draw: vaccine + 30 days
  const earliestTiter = addDays(earliestVaccine, 30)

  // Earliest possible TRNC entry: titer + 90 days
  const earliestEntry = addDays(earliestTiter, 90)

  // PIB.01 window: 6 weeks to 4 weeks before arrival
  const pib01Open  = addDays(arrival, -42)
  const pib01Close = addDays(arrival, -28)

  // Health certificate: within 10 days before arrival
  const healthCertFrom = addDays(arrival, -10)

  const feasible = earliestEntry <= arrival

  return { feasible, earliestVaccine, earliestTiter, earliestEntry, pib01Open, pib01Close, healthCertFrom, arrival }
}

function DateField({ label, value, onChange, lang }) {
  const [show, setShow] = useState(false)
  const minDate = new Date(2020, 0, 1)
  const maxDate = addDays(new Date(), 365 * 3)

  return (
    <View style={s.dateField}>
      <Text style={s.dateFieldLabel}>{label}</Text>
      <TouchableOpacity style={s.dateFieldBtn} onPress={() => setShow(true)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={[s.dateFieldValue, !value && s.dateFieldPlaceholder]}>
          {value ? formatDate(value) : t('petsTlSelectDate', lang)}
        </Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={value || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={minDate}
          maximumDate={maxDate}
          onChange={(_, selected) => {
            setShow(Platform.OS === 'ios')
            if (selected) onChange(selected)
          }}
        />
      )}
    </View>
  )
}

function MilestoneRow({ icon, iconBg, iconColor, label, date, note, highlight }) {
  return (
    <View style={[s.milestone, highlight && s.milestoneHighlight]}>
      <View style={[s.milestoneIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={s.milestoneBody}>
        <Text style={s.milestoneLabel}>{label}</Text>
        {date && <Text style={[s.milestoneDate, highlight && s.milestoneDateHighlight]}>{formatDate(date)}</Text>}
        {note && <Text style={s.milestoneNote}>{note}</Text>}
      </View>
    </View>
  )
}

export default function TimelineCalculatorScreen({ lang, onBack }) {
  const [arrivalDate, setArrivalDate] = useState(null)
  const [petDOB, setPetDOB] = useState(null)
  const [result, setResult] = useState(null)

  function calculate() {
    if (!arrivalDate) return
    setResult(calculateTimeline(arrivalDate, petDOB))
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backPill} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={s.backPillText}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('petsTimelineTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        <Text style={s.subtitle}>{t('petsTimelineSub', lang)}</Text>

        {/* Inputs */}
        <View style={s.inputCard}>
          <DateField
            label={t('petsArrivalDate', lang)}
            value={arrivalDate}
            onChange={setArrivalDate}
            lang={lang}
          />
          <View style={s.divider} />
          <DateField
            label={t('petsPetDOB', lang)}
            value={petDOB}
            onChange={setPetDOB}
            lang={lang}
          />
        </View>

        <TouchableOpacity
          style={[s.calcBtn, !arrivalDate && s.calcBtnDisabled]}
          onPress={calculate}
          activeOpacity={arrivalDate ? 0.85 : 1}
        >
          <Ionicons name="calculator-outline" size={18} color="#fff" />
          <Text style={s.calcBtnText}>{t('petsCalculate', lang)}</Text>
        </TouchableOpacity>

        {/* Results */}
        {result && (
          <>
            {!result.feasible && (
              <View style={s.errorBanner}>
                <Ionicons name="warning-outline" size={20} color={colors.danger} style={{ flexShrink: 0 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.errorTitle}>{t('petsTimelineTooSoon', lang)}</Text>
                  <Text style={s.errorBody}>
                    {t('petsTimelineTooSoonSub', lang).replace('{date}', formatDate(result.earliestEntry))}
                  </Text>
                </View>
              </View>
            )}

            {result.feasible && (
              <View style={s.successBanner}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} style={{ flexShrink: 0 }} />
                <Text style={s.successText}>{t('petsTimelineOnTrack', lang)}</Text>
              </View>
            )}

            <Text style={s.resultTitle}>{t('petsTimelineResult', lang)}</Text>

            <View style={s.timelineCard}>
              <MilestoneRow
                icon="hardware-chip-outline"
                iconBg={colors.primaryLight}
                iconColor={colors.primary}
                label={t('petsTimelineMicrochip', lang)}
                note={t('petsTimelineMicrochipNote', lang)}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="shield-checkmark-outline"
                iconBg={colors.primaryLight}
                iconColor={colors.primary}
                label={t('petsTimelineVaccine', lang)}
                date={result.earliestVaccine}
                note={t('petsTimelineVaccineNote', lang)}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="flask-outline"
                iconBg={colors.accentLight}
                iconColor={colors.accent}
                label={t('petsTimelineTiter', lang)}
                date={result.earliestTiter}
                note={t('petsTimelineTiterNote', lang)}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="airplane-outline"
                iconBg={result.feasible ? colors.successLight : colors.dangerLight}
                iconColor={result.feasible ? colors.success : colors.danger}
                label={t('petsTimelineEntry', lang)}
                date={result.earliestEntry}
                note={t('petsTimelineEntryNote', lang)}
                highlight={!result.feasible}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="document-outline"
                iconBg={colors.primaryLight}
                iconColor={colors.primary}
                label={t('petsTlPIBWindow', lang)}
                note={`${formatDate(result.pib01Open)} – ${formatDate(result.pib01Close)}`}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="medkit-outline"
                iconBg={colors.primaryLight}
                iconColor={colors.primary}
                label={t('petsTlHealthCert', lang)}
                note={`${t('petsTlFrom', lang)} ${formatDate(result.healthCertFrom)}`}
              />
              <View style={s.timelineLine} />
              <MilestoneRow
                icon="flag-outline"
                iconBg={colors.successLight}
                iconColor={colors.success}
                label={t('petsTlArrival', lang)}
                date={result.arrival}
              />
            </View>

            <View style={s.disclaimer}>
              <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} style={{ flexShrink: 0, marginTop: 1 }} />
              <Text style={s.disclaimerText}>{t('petsTimelineDisclaimer', lang)}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:                  { flex: 1, backgroundColor: colors.bg },
  header:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  backPill:              { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  backPillText:          { fontSize: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular' },
  headerTitle:           { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:                { flex: 1 },
  scrollContent:         { padding: 16, paddingBottom: 48 },
  subtitle:              { fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 20 },

  inputCard:             { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, marginBottom: 16, ...shadow },
  dateField:             { paddingVertical: 4 },
  dateFieldLabel:        { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  dateFieldBtn:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
  dateFieldValue:        { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  dateFieldPlaceholder:  { color: colors.textSecondary },
  divider:               { height: 1, backgroundColor: colors.border, marginVertical: 14 },

  calcBtn:               { backgroundColor: colors.primary, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginBottom: 24 },
  calcBtnDisabled:       { backgroundColor: colors.border },
  calcBtnText:           { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  errorBanner:           { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 14, flexDirection: 'row', gap: 10, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: colors.danger },
  errorTitle:            { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger, marginBottom: 3 },
  errorBody:             { fontSize: 13, color: colors.danger, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  successBanner:         { backgroundColor: colors.successLight, borderRadius: radius.md, padding: 14, flexDirection: 'row', gap: 10, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: colors.success, alignItems: 'center' },
  successText:           { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.success, flex: 1 },

  resultTitle:           { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 14 },

  timelineCard:          { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16, ...shadow, marginBottom: 16 },
  milestone:             { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  milestoneHighlight:    { backgroundColor: colors.dangerLight, borderRadius: radius.sm, padding: 8, margin: -4 },
  milestoneIcon:         { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  milestoneBody:         { flex: 1, paddingBottom: 2 },
  milestoneLabel:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 2 },
  milestoneDate:         { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 2 },
  milestoneDateHighlight: { color: colors.danger },
  milestoneNote:         { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  timelineLine:          { width: 2, height: 16, backgroundColor: colors.border, marginLeft: 17, marginVertical: 4 },

  disclaimer:            { flexDirection: 'row', gap: 8 },
  disclaimerText:        { fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
})
