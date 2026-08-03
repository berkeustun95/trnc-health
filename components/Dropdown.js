import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'

// Lightweight, OTA-safe select: a bordered field that opens a Modal + scrollable list.
// Shared by the city and area dropdowns (no native dep). options = [{ value, label }].
export default function Dropdown({
  value,
  options = [],
  onSelect,
  placeholder = 'Select…',
  disabled = false,
  disabledText,
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)
  const label = disabled ? (disabledText || placeholder) : (selected ? selected.label : placeholder)

  return (
    <>
      <TouchableOpacity
        style={[s.field, disabled && s.fieldDisabled]}
        onPress={() => { if (!disabled) setOpen(true) }}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <Text style={[s.fieldText, !selected && s.placeholder]} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <FlatList
              data={options}
              keyExtractor={o => o.value}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const active = item.value === value
                return (
                  <TouchableOpacity
                    style={s.option}
                    onPress={() => { onSelect?.(item.value); setOpen(false) }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optionText, active && s.optionActive]}>{item.label}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                )
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  field:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: colors.cardBg, borderWidth: 1.5, borderColor: colors.border,
                  borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  fieldDisabled:{ opacity: 0.5 },
  fieldText:    { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  placeholder:  { color: colors.textSecondary },
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 32 },
  sheet:        { backgroundColor: colors.cardBg, borderRadius: 16, maxHeight: '60%', overflow: 'hidden' },
  option:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText:   { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  optionActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
})
