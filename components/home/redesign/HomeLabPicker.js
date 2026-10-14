import { useState } from 'react'
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native'
import { colors, radii } from '../../../constants/theme'
import { useHomeLab, setHomeLab } from '../../../constants/homeLab'

// Dev-only floating control for the Home lab variants (see constants/homeLab.js). Plain
// English on purpose: never rendered in a release build, so no i18n keys.
const ROWS = [
  { key: 'daylight', label: 'A Daylight' },
  { key: 'oli', label: 'B Oli companion' },
  { key: 'calendar', label: 'C Island Calendar' },
  { key: 'polish', label: 'P Polish' },
]

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
      {ROWS.map(r => (
        <View key={r.key} style={s.row}>
          <Text style={s.label}>{r.label}</Text>
          <Switch value={lab[r.key] === true} onValueChange={v => setHomeLab(r.key, v)}
            trackColor={{ false: colors.border, true: colors.primary }} />
        </View>
      ))}
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
  label: { color: colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 14, marginRight: 16 },
  close: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4 },
  closeText: { color: colors.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
})
