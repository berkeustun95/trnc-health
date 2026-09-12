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
//
// ─── THE KEYBOARD FIX (2026-09-12), AND WHAT WAS ALREADY RIGHT ──────────────
//
// Reported as "typing to search covers the results and they cannot be tapped". Two of the
// three usual causes were ALREADY handled here and were not touched:
//
//   • keyboardShouldPersistTaps="handled" was already on the FlatList. Without it the
//     first tap only dismisses the keyboard and the row never fires — the classic
//     "taps do nothing" report — but that was not this bug.
//   • The search box already sat ABOVE the list, outside it, so it never scrolled away.
//
// The actual cause was the card's own height. `maxHeight: '75%'` is 75% of the WINDOW,
// and the card is pinned to the window's bottom edge — so when the keyboard opens it
// covers the lower part of a card that has not moved or shrunk. The results were not
// unresponsive; they were underneath the keyboard.
//
// So the height is now measured against the space that is actually VISIBLE. Everything
// below follows from that one change.
//
// ⚠ NOT KeyboardAvoidingView. It shifts or pads a view; this card must SHRINK, because it
//   is already bottom-anchored and full-width — padding it up would push the header off
//   the top on a short screen. A measured maxHeight does the right thing on both
//   platforms and needs no per-platform behavior prop.
import { useState, useMemo, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet, Platform,
  Keyboard, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'

export default function SearchModal({
  visible, title, searchPlaceholder, options, value, searchable, onSelect, onClose,
}) {
  const [q, setQ] = useState('')
  const [kbHeight, setKbHeight] = useState(0)
  const { height: winHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  // ─── Keyboard height, measured rather than assumed ────────────────────────
  //
  // `Will` on iOS so the card resizes WITH the keyboard animation instead of jumping
  // after it; Android only emits `Did`, and emitting both there would fire twice.
  //
  // ⚠ The listeners are attached only while the modal is visible and removed on hide, so
  //   a closed picker is not holding a subscription that fires on every keyboard event
  //   anywhere else in the app. Six of these are mounted at once on the wizard.
  useEffect(() => {
    if (!visible) return
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = e => setKbHeight(e?.endCoordinates?.height ?? 0)
    const onHide = () => setKbHeight(0)
    const subs = [Keyboard.addListener(showEvt, onShow), Keyboard.addListener(hideEvt, onHide)]
    return () => {
      subs.forEach(s => s.remove())
      // Reset on close. A stale height would size the NEXT open against a keyboard that
      // is not on screen, giving a card that is mysteriously short on first paint.
      setKbHeight(0)
    }
  }, [visible])

  // Clear the query when the sheet closes. Without this, reopening the same picker shows
  // the previous search still filtering the list, which reads as missing options.
  useEffect(() => { if (!visible) setQ('') }, [visible])

  const list = useMemo(() => {
    if (!searchable || !q.trim()) return options
    const needle = q.trim().toLocaleLowerCase()
    return options.filter(o => o.label.toLocaleLowerCase().includes(needle))
  }, [options, q, searchable])

  // ─── How tall the card may be ─────────────────────────────────────────────
  //
  // Two cases, and the closed-keyboard one is deliberately IDENTICAL to the old behaviour
  // so nothing changes for the four pickers that never open a keyboard (day, month, year,
  // language).
  //
  // With the keyboard UP the card takes everything above it rather than 75% of that:
  // searching is the moment the user most needs rows on screen, and 75% of an already
  // halved space is a list two rows tall. The top gap keeps it from becoming a full-screen
  // sheet, which would lose the "a picker over your form" reading.
  const cardMaxHeight = kbHeight > 0
    ? Math.max(winHeight - kbHeight - insets.top - 24, 220)
    : winHeight * 0.75

  // Dismiss BEFORE the parent unmounts this modal. Selecting a country closes the sheet,
  // and a keyboard whose input has just been unmounted is left hanging over the screen
  // underneath on Android.
  function choose(v) {
    Keyboard.dismiss()
    setQ('')
    onSelect(v)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={[s.modalCard, { maxHeight: cardMaxHeight }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={() => { Keyboard.dismiss(); onClose() }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
              autoCapitalize="none"
              returnKeyType="search"
            />
          )}
          <FlatList
            data={list}
            keyExtractor={o => String(o.value)}
            // flex, NOT a computed height. The alternative was subtracting the header and
            // search box from the card — a hand-counted constant that silently goes wrong
            // the day either grows a line. Letting the list take what remains means the
            // layout answers the question instead of a number in this file.
            style={{ flexGrow: 1, flexShrink: 1 }}
            // Was already here before the keyboard work and is load-bearing: without it
            // the first tap on a row only dismisses the keyboard and the selection never
            // fires. Do not remove it when refactoring this list.
            keyboardShouldPersistTaps="handled"
            // Lets a drag on the rows put the keyboard away, which is what a thumb
            // reaching down the list is usually trying to do.
            keyboardDismissMode="on-drag"
            // The last row must clear the home indicator. Keyboard height is NOT added
            // here — the card has already been shortened by it above, so adding it again
            // would leave a gap the size of the keyboard under the final row.
            contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => choose(item.value)}>
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
  // maxHeight is applied inline from the measurement above — it is the one value here
  // that depends on runtime state, and leaving a static one in this block as well would
  // give two answers to the same question.
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: 16, paddingHorizontal: 18, paddingBottom: 24,
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
