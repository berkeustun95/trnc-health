import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Switch, ActivityIndicator, KeyboardAvoidingView, Platform, BackHandler, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, radius, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

// Fresh copy of the availability sub-block (reference: ProviderScreen.js:783-884).
// Deliberately NOT shared with the health editor — the live health path stays
// untouched. Writes the exact same facilities.availability jsonb shape that
// BookingScreen.generateSlots() reads: { slot_duration, schedule: { mon: {open,close}
// | {closed:true}, … } }.

const AVAIL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABEL_KEYS = {
  mon: 'groomDayMon', tue: 'groomDayTue', wed: 'groomDayWed', thu: 'groomDayThu',
  fri: 'groomDayFri', sat: 'groomDaySat', sun: 'groomDaySun',
}
const SLOT_DURATIONS = [15, 30, 45, 60]
const DEFAULT_AVAIL = {
  slot_duration: 30,
  schedule: {
    mon: { open: '09:00', close: '17:00' },
    tue: { open: '09:00', close: '17:00' },
    wed: { open: '09:00', close: '17:00' },
    thu: { open: '09:00', close: '17:00' },
    fri: { open: '09:00', close: '17:00' },
    sat: { closed: true },
    sun: { closed: true },
  },
}

export default function GroomingAvailabilityEditor({ facility, lang = 'English', onBack, onSaved }) {
  const [avail, setAvail]     = useState(facility.availability ?? null)
  const [saving, setSaving]   = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError]     = useState(null)

  const dirty = JSON.stringify(avail) !== JSON.stringify(facility.availability ?? null)

  // Guard the exit: header back-arrow AND Android hardware-back both route here.
  // If there are unsaved edits, confirm before leaving so a half-entered schedule
  // isn't silently dropped. Returns handled=true for the BackHandler so App.js's
  // overlay-close handler never runs while the editor is open — no App.js changes.
  const confirmLeave = useCallback(() => {
    if (!dirty) { onBack(); return }
    Alert.alert(
      t('groomAvailUnsavedTitle', lang),
      t('groomAvailUnsavedBody', lang),
      [
        { text: t('cancel', lang), style: 'cancel' },
        { text: t('groomAvailDiscard', lang), style: 'destructive', onPress: onBack },
      ],
    )
  }, [dirty, onBack, lang])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { confirmLeave(); return true })
    return () => sub.remove()
  }, [confirmLeave])

  async function save() {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('facilities')
      .update({ availability: avail })
      .eq('id', facility.id)
    setSaving(false)
    if (err) { setError(err.message || t('groomErrorGeneric', lang)); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
    onSaved?.(avail)
  }

  function setDayField(day, field, value) {
    setAvail(prev => ({
      ...prev,
      schedule: { ...prev.schedule, [day]: { ...prev.schedule[day], [field]: value } },
    }))
  }

  function toggleDay(day) {
    setAvail(prev => {
      const cur = prev.schedule[day]
      return cur.closed
        ? { ...prev, schedule: { ...prev.schedule, [day]: { open: '09:00', close: '17:00' } } }
        : { ...prev, schedule: { ...prev.schedule, [day]: { closed: true } } }
    })
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={confirmLeave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('groomAvailTitle', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.intro}>{t('groomAvailIntro', lang)}</Text>

          <View style={s.card}>
            <View style={s.masterRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.masterLabel}>{t('groomAvailSlotBooking', lang)}</Text>
                <Text style={s.masterSub}>{t('groomAvailSlotBookingSub', lang)}</Text>
              </View>
              <Switch
                value={!!avail}
                onValueChange={v => setAvail(v ? DEFAULT_AVAIL : null)}
                trackColor={{ true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            {avail ? (
              <>
                <Text style={[s.sectionLabel, { marginTop: 20 }]}>{t('groomAvailSlotDuration', lang)}</Text>
                <View style={s.durationRow}>
                  {SLOT_DURATIONS.map(d => {
                    const active = avail.slot_duration === d
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[s.durationChip, active && s.durationChipActive]}
                        onPress={() => setAvail(prev => ({ ...prev, slot_duration: d }))}
                      >
                        <Text style={[s.durationChipText, active && s.durationChipTextActive]}>
                          {t('groomAvailMinutes', lang).replace('{n}', d)}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <Text style={[s.sectionLabel, { marginTop: 20 }]}>{t('groomAvailSchedule', lang)}</Text>
                {AVAIL_DAYS.map(day => {
                  const dayData = avail.schedule[day] ?? { closed: true }
                  const isOpen = !dayData.closed
                  return (
                    <View key={day} style={s.dayRow}>
                      <Text style={s.dayLabel}>{t(DAY_LABEL_KEYS[day], lang)}</Text>
                      {isOpen ? (
                        <View style={s.timeRow}>
                          <TextInput
                            style={s.timeInput}
                            value={dayData.open ?? '09:00'}
                            onChangeText={v => setDayField(day, 'open', v)}
                            placeholder="09:00"
                            placeholderTextColor={colors.textSecondary}
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                          />
                          <Text style={s.timeSep}>–</Text>
                          <TextInput
                            style={s.timeInput}
                            value={dayData.close ?? '17:00'}
                            onChangeText={v => setDayField(day, 'close', v)}
                            placeholder="17:00"
                            placeholderTextColor={colors.textSecondary}
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                          />
                        </View>
                      ) : (
                        <Text style={s.closedLabel}>{t('groomAvailClosed', lang)}</Text>
                      )}
                      <Switch
                        value={isOpen}
                        onValueChange={() => toggleDay(day)}
                        trackColor={{ true: colors.primary }}
                        thumbColor="#fff"
                        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                      />
                    </View>
                  )
                })}
              </>
            ) : (
              <Text style={s.offHint}>{t('groomAvailOffHint', lang)}</Text>
            )}
          </View>

          {!!error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.saveBtn, (saving || success) && s.saveBtnDisabled]}
            onPress={save}
            disabled={saving || success}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.saveBtnText}>
                  {success ? t('groomAvailSaved', lang) : (avail ? t('groomAvailSave', lang) : t('groomAvailSaveOff', lang))}
                </Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.bg },

  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                     paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.cardBg,
                     borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:     { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  scrollContent:   { padding: 20, paddingBottom: 48 },
  intro:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                     lineHeight: 21, marginBottom: 16 },

  card:            { backgroundColor: colors.cardBg, borderRadius: radius.card, padding: 16,
                     ...shadow, borderWidth: 1, borderColor: colors.border },

  masterRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  masterLabel:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 3 },
  masterSub:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18 },

  sectionLabel:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                     letterSpacing: 0.5, marginBottom: 10 },

  durationRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                     borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg },
  durationChipActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  durationChipText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  durationChipTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },

  dayRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
                     borderTopWidth: 1, borderTopColor: colors.border },
  dayLabel:        { width: 56, fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  timeRow:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput:       { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm,
                     paddingHorizontal: 10, paddingVertical: 9, fontSize: 15, fontFamily: 'Inter_400Regular',
                     color: colors.textPrimary, backgroundColor: colors.surface, textAlign: 'center' },
  timeSep:         { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  closedLabel:     { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  offHint:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                     lineHeight: 19, marginTop: 14 },

  errorText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger,
                     textAlign: 'center', marginTop: 16 },
  saveBtn:         { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15,
                     alignItems: 'center', marginTop: 20 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
})
