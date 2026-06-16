import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet, Switch } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow } from '../constants/theme'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEFAULT_OPEN  = '08:00'
const DEFAULT_CLOSE = '18:00'

const TIMES = []
for (let h = 6; h <= 23; h++) {
  TIMES.push(`${String(h).padStart(2, '0')}:00`)
  TIMES.push(`${String(h).padStart(2, '0')}:30`)
}
TIMES.push('00:00')

function initSchedule(value) {
  const base = {}
  DAYS.forEach(d => { base[d] = { open: false, openTime: DEFAULT_OPEN, closeTime: DEFAULT_CLOSE } })
  if (!value) return base
  try {
    const parsed = JSON.parse(value)
    DAYS.forEach(d => {
      if (parsed[d]) base[d] = { open: true, openTime: parsed[d].o || DEFAULT_OPEN, closeTime: parsed[d].c || DEFAULT_CLOSE }
    })
  } catch {}
  return base
}

function buildOutput(schedule) {
  const result = {}
  DAYS.forEach(d => { if (schedule[d].open) result[d] = { o: schedule[d].openTime, c: schedule[d].closeTime } })
  return Object.keys(result).length ? JSON.stringify(result) : ''
}

export function formatHoursDisplay(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    const openDays = DAYS.filter(d => parsed[d])
    if (!openDays.length) return value
    const groups = []
    let i = 0
    while (i < openDays.length) {
      const hours = `${parsed[openDays[i]].o}–${parsed[openDays[i]].c}`
      let j = i + 1
      while (
        j < openDays.length &&
        DAYS.indexOf(openDays[j]) === DAYS.indexOf(openDays[j - 1]) + 1 &&
        `${parsed[openDays[j]].o}–${parsed[openDays[j]].c}` === hours
      ) j++
      groups.push(j - i === 1 ? `${openDays[i]} ${hours}` : `${openDays[i]}–${openDays[j - 1]} ${hours}`)
      i = j
    }
    return groups.join('\n')
  } catch {
    return value
  }
}

export default function HoursPicker({ value, onChange }) {
  const [schedule, setSchedule] = useState(() => initSchedule(value))
  const [editing, setEditing]   = useState(null) // { day, slot: 'open'|'close' }

  function update(day, patch) {
    setSchedule(prev => {
      const next = { ...prev, [day]: { ...prev[day], ...patch } }
      onChange(buildOutput(next))
      return next
    })
  }

  function toggleDay(day) {
    update(day, { open: !schedule[day].open })
  }

  function applyWeekdays() {
    setSchedule(prev => {
      const next = { ...prev }
      ;['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(d => {
        next[d] = { open: true, openTime: DEFAULT_OPEN, closeTime: DEFAULT_CLOSE }
      })
      onChange(buildOutput(next))
      return next
    })
  }

  function selectTime(time) {
    if (!editing) return
    update(editing.day, { [editing.slot === 'open' ? 'openTime' : 'closeTime']: time })
    setEditing(null)
  }

  const anyOpen = DAYS.some(d => schedule[d].open)

  return (
    <View style={s.wrap}>
      <TouchableOpacity style={s.shortcut} onPress={applyWeekdays} activeOpacity={0.8}>
        <Ionicons name="flash-outline" size={13} color={colors.primary} />
        <Text style={s.shortcutText}>Mon–Fri defaults</Text>
      </TouchableOpacity>

      {DAYS.map(day => {
        const { open, openTime, closeTime } = schedule[day]
        return (
          <View key={day} style={[s.row, !open && s.rowClosed]}>
            <Text style={[s.dayLabel, !open && s.dayLabelClosed]}>{day}</Text>

            <TouchableOpacity
              style={[s.statusChip, open && s.statusChipOpen]}
              onPress={() => toggleDay(day)}
              activeOpacity={0.7}
            >
              <Text style={[s.statusText, open && s.statusTextOpen]}>
                {open ? 'Open' : 'Closed'}
              </Text>
            </TouchableOpacity>

            {open ? (
              <View style={s.times}>
                <TouchableOpacity
                  style={s.timeChip}
                  onPress={() => setEditing({ day, slot: 'open' })}
                  activeOpacity={0.8}
                >
                  <Text style={s.timeChipText}>{openTime}</Text>
                </TouchableOpacity>
                <Text style={s.dash}>–</Text>
                <TouchableOpacity
                  style={s.timeChip}
                  onPress={() => setEditing({ day, slot: 'close' })}
                  activeOpacity={0.8}
                >
                  <Text style={s.timeChipText}>{closeTime}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.times} />
            )}
          </View>
        )
      })}

      {anyOpen && (
        <View style={s.previewWrap}>
          <Ionicons name="time-outline" size={13} color={colors.primary} />
          <Text style={s.previewText}>{formatHoursDisplay(buildOutput(schedule))}</Text>
        </View>
      )}

      <Modal visible={!!editing} transparent animationType="slide">
        <TouchableOpacity style={s.backdrop} onPress={() => setEditing(null)} activeOpacity={1} />
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>
            {editing?.day} · {editing?.slot === 'open' ? 'Opens at' : 'Closes at'}
          </Text>
          <FlatList
            data={TIMES}
            keyExtractor={item => item}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 300 }}
            renderItem={({ item }) => {
              const current = editing?.slot === 'open'
                ? schedule[editing?.day]?.openTime
                : schedule[editing?.day]?.closeTime
              const active = item === current
              return (
                <TouchableOpacity
                  style={[s.timeItem, active && s.timeItemActive]}
                  onPress={() => selectTime(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.timeItemText, active && s.timeItemTextActive]}>{item}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              )
            }}
          />
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  wrap:           { gap: 2 },
  shortcut:       { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, marginBottom: 10 },
  shortcutText:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },

  row:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.cardBg, marginBottom: 4, gap: 10, ...shadow },
  rowClosed:      { backgroundColor: colors.bg },
  dayLabel:       { width: 30, fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dayLabelClosed: { color: colors.textSecondary },

  statusChip:     { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusChipOpen: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  statusText:     { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  statusTextOpen: { color: colors.primary },

  times:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  timeChip:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  timeChipText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dash:           { fontSize: 13, color: colors.textSecondary },

  previewWrap:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 8 },
  previewText:    { flex: 1, fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary, lineHeight: 18 },

  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  sheetHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 12 },
  timeItem:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.bg },
  timeItemActive: { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 8 },
  timeItemText:   { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  timeItemTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
})
