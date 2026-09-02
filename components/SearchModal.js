// One searchable bottom-sheet list. Serves the profile wizard (day, month, year,
// nationality, country code, institution, language) and ProfileScreen (the same seven
// again, plus region, resident status and student level).
//
// MOVED OUT OF ProfileSetupScreen VERBATIM when Slice 3a gave ProfileScreen the same ten
// fields the wizard collects. Left where it was, the second screen needed either an
// import from a screen file or a copy — and a copy of a list that renders CHECK-
// constrained vocabularies is the drift this repo keeps paying for: the two screens write
// the same columns, so a divergence between their pickers is a divergence in what reaches
// the database. Same argument as components/DisplayNameCheck.js.
//
// options = [{ value, label }]. `searchable` adds the filter box; a 12-row month list
// does not want one and a 190-row nationality list cannot work without it.
import { useState, useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet, Platform } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'

export default function SearchModal({
  visible, title, searchPlaceholder, options, value, searchable, onSelect, onClose,
}) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    if (!searchable || !q.trim()) return options
    const needle = q.trim().toLocaleLowerCase()
    return options.filter(o => o.label.toLocaleLowerCase().includes(needle))
  }, [options, q, searchable])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {searchable && (
            <TextInput
              style={s.search}
              value={q}
              onChangeText={setQ}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              autoCorrect={false}
            />
          )}
          <FlatList
            data={list}
            keyExtractor={o => String(o.value)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.modalItem}
                onPress={() => { setQ(''); onSelect(item.value) }}
              >
                <Text style={[s.modalItemText, value === item.value && s.modalItemTextOn]}>{item.label}</Text>
                {value === item.value && <Feather name="check" size={15} color={colors.primary} />}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(26,43,51,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 24, maxHeight: '75%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, paddingRight: 10 },
  search: {
    backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8, fontSize: 15, marginBottom: 10,
    color: colors.textPrimary,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalItemText: { fontSize: 15, color: colors.textPrimary, flexShrink: 1, paddingRight: 10 },
  modalItemTextOn: { color: colors.primary, fontWeight: '700' },
})
