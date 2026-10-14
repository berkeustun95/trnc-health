import { useState } from 'react'
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native'
import { colors, radii } from '../../../constants/theme'
import { useHomeLab, setHomeLab, setCalendarDate } from '../../../constants/homeLab'
import { ISLAND_DAYS } from '../../../constants/islandCalendar'

// Dev-only floating control for the Home lab variants (see constants/homeLab.js). Plain
// English on purpose: never rendered in a release build, so no i18n keys.
const ROWS = [
  { key: 'daylight', label: 'A Daylight' },
  { key: 'oli', label: 'B Oli companion' },
  { key: 'calendar', label: 'C Island Calendar' },
  { key: 'polish', label: 'P Polish' },
]

// Steps through today (null) then each ISLAND_DAYS date, wrapping.
const HIT = { top: 8, bottom: 8, left: 12, right: 12 }
const KIND_OF = Object.fromEntries(ISLAND_DAYS.map(d => [d.date, d.kind]))
const DATES = [null, ...ISLAND_DAYS.map(d => d.date)]
function stepDate(cur, dir) {
  const i = Math.max(0, DATES.indexOf(cur))
  setCalendarDate(DATES[(i + dir + DATES.length) % DATES.length])
}

export default function HomeLabPicker({ tabFootprint }) {
  const [open, setOpen] = useState(false)
  const lab = useHomeLab()
  const bottom = (tabFootprint || 0) + 12

  if (!open) {
    return (
      <TouchableOpacity style={[s.pill, { bottom }]} onPress={() => setOpen(true)} activeOpacity={0.8}
        accessibilityRole="button" accessibilityLabel="Open Home lab">
        <Text style={s.pillText}>Lab</Text>
      </TouchableOpacity>
    )
  }
  return (
    <View style={[s.panel, { bottom }]}>
      {ROWS.map(r => [
        <View key={r.key} style={s.row}>
          <Text style={s.label}>{r.label}</Text>
          <Switch value={lab[r.key] === true} onValueChange={v => setHomeLab(r.key, v)}
            trackColor={{ false: colors.border, true: colors.primary }} />
        </View>,
        r.key === 'calendar' && lab.calendar === true && (
          <View key="calDate" style={s.row}>
            <TouchableOpacity onPress={() => stepDate(lab.calendarDate, -1)} style={s.step} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Previous date">
              <Text style={s.label}>◀</Text>
            </TouchableOpacity>
            <Text style={s.date}>{lab.calendarDate ? `${lab.calendarDate} · ${KIND_OF[lab.calendarDate] || '?'}` : 'today'}</Text>
            <TouchableOpacity onPress={() => stepDate(lab.calendarDate, 1)} style={s.step} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Next date">
              <Text style={s.label}>▶</Text>
            </TouchableOpacity>
          </View>
        ),
      ])}
      <TouchableOpacity onPress={() => setOpen(false)} style={s.close} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel="Close Home lab">
        <Text style={s.closeText}>close</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  pill: {
    position: 'absolute', left: 12, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radii.pill, backgroundColor: colors.primary, elevation: 6,
  },
  pillText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 13 },
  panel: {
    position: 'absolute', left: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radii.card, backgroundColor: colors.cardBg, elevation: 8,
    shadowColor: '#1A2B33', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minWidth: 220, paddingVertical: 2 },
  label: { color: colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 14 },
  date: { color: colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 14, minWidth: 190, textAlign: 'center' },
  step: { paddingHorizontal: 10, paddingVertical: 4 },
  close: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4 },
  closeText: { color: colors.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
})
