import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, StyleSheet, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── FilterDropdown — the app's one filter control (replaces chip rows) ─────────
//
//   <FilterDropdown label={t('ddCategory', lang)} options={[{ value, label, count?, color? }]}
//     value={x} onChange={setX} lang={lang} />                      single-select
//   … multi values={[…]} onChange={arr => …}                        multi-select
//
// Trigger: a compact pill. It reads the SELECTION ("Konser ▾"; multi: "Girne +2 ▾") and is
// accented while set; on "Tümü" it reads the filter's name. Sheet: "Tümü" first (the reset),
// check marks, search when there are more than 10 options, optional count / colour dot per
// option, and an optional extra row (Events' "Tarih seç…") whose action runs AFTER the
// sheet has closed — iOS cannot present a second modal while this one is dismissing.
// Android back closes only the sheet (onRequestClose). `null` is "Tümü" in single mode;
// an empty array in multi mode.
//
// variant="field" — a full-width form field instead of a pill (forms: always with
// allowAll={false}); an empty field reads "Seçiniz…". `open` + `onOpenChange` make the sheet
// controlled, for a screen that chains one sheet into another (Accommodation's area → district).
// FilterPill is exported for a pill whose sheet is not a list (Accommodation's price, plot).

export default function FilterDropdown({
  label, title, options, lang,
  value = null, values = null, multi = false, onChange,
  selectedLabel = null,          // overrides the trigger text (e.g. a picked date)
  extraAction = null,            // { label, icon, onPress }
  allowAll = true,               // false: a required choice — no "Tümü" row (Towing's region)
  variant = 'pill',              // 'field': full-width form field
  open: openProp, onOpenChange,  // optional controlled open state
  style,
}) {
  const insets = useSafeAreaInsets()
  const [openState, setOpenState] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const setOpen = v => (controlled ? onOpenChange?.(v) : setOpenState(v))
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(null)

  const picked = multi ? (values ?? []) : (value == null ? [] : [value])
  const active = picked.length > 0 || !!selectedLabel
  const first = options.find(o => o.value === picked[0])
  const field = variant === 'field'
  const triggerText = selectedLabel
    ?? (picked.length === 0 ? (field ? t('dropdownSelect', lang) : label)
      : picked.length === 1 ? (first?.label ?? label)
      : `${first?.label ?? label} +${picked.length - 1}`)

  useEffect(() => {
    if (open || !pending || Platform.OS === 'ios') return
    const run = pending; setPending(null); run()
  }, [open, pending])

  const close = () => { setOpen(false); setQuery('') }
  const choose = v => {
    if (!multi) { onChange(v); close(); return }
    if (v == null) { onChange([]); return }
    onChange(picked.includes(v) ? picked.filter(x => x !== v) : [...picked, v])
  }
  const shown = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  return (
    <>
      {field ? (
        <TouchableOpacity
          style={[st.field, style]}
          onPress={() => setOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${triggerText}`}
        >
          <Text style={[st.fieldText, !active && st.fieldPlaceholder]} numberOfLines={1}>{triggerText}</Text>
          <Feather name="chevron-down" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <FilterPill label={label} text={triggerText} active={active} style={style} onPress={() => setOpen(true)} />
      )}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
        onDismiss={() => { if (pending) { const run = pending; setPending(null); run() } }}
      >
        <TouchableOpacity style={st.backdrop} activeOpacity={1} onPress={close} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={st.handle} />
          <Text style={st.title}>{title ?? label}</Text>
          {options.length > 10 && (
            <View style={st.searchWrap}>
              <Feather name="search" size={15} color={colors.textSecondary} />
              <TextInput style={st.search} value={query} onChangeText={setQuery}
                placeholder={t('searchPlaceholder', lang)} placeholderTextColor={colors.textSecondary} />
            </View>
          )}
          <ScrollView style={st.list} keyboardShouldPersistTaps="handled">
            {allowAll && <Row label={t('filterAll', lang)} selected={picked.length === 0 && !selectedLabel} onPress={() => choose(null)} />}
            {shown.map(o => (
              <Row key={String(o.value)} label={o.label} count={o.count} color={o.color}
                selected={picked.includes(o.value)} multi={multi} onPress={() => choose(o.value)} />
            ))}
            {extraAction && (
              <TouchableOpacity style={st.row} activeOpacity={0.7}
                onPress={() => { setPending(() => extraAction.onPress); close() }}>
                <Feather name={extraAction.icon ?? 'calendar'} size={16} color={colors.primary} style={{ marginRight: 10 }} />
                <Text style={[st.rowText, { color: colors.primary }]}>{extraAction.label}</Text>
                {selectedLabel ? <Feather name="check" size={18} color={colors.primary} /> : null}
              </TouchableOpacity>
            )}
          </ScrollView>
          {multi && (
            <TouchableOpacity style={st.done} onPress={close} activeOpacity={0.85}>
              <Text style={st.doneText}>{t('ddDone', lang)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </>
  )
}

export function FilterPill({ label, text, active, style, onPress }) {
  return (
    <TouchableOpacity
      style={[st.pill, active && st.pillActive, style]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label && label !== text ? `${label}: ${text}` : text}
    >
      <Text style={[st.pillText, active && st.pillTextActive]} numberOfLines={1}>{text}</Text>
      <Feather name="chevron-down" size={14} color={active ? colors.primary : colors.textSecondary} />
    </TouchableOpacity>
  )
}

function Row({ label, count, color, selected, multi, onPress }) {
  return (
    <TouchableOpacity style={st.row} onPress={onPress} activeOpacity={0.7}>
      {color ? <View style={[st.dot, { backgroundColor: color }]} /> : null}
      <Text style={[st.rowText, selected && st.rowTextOn]} numberOfLines={1}>{label}</Text>
      {count != null ? <Text style={st.count}>{count}</Text> : null}
      <Feather name={multi ? (selected ? 'check-square' : 'square') : 'check'} size={18}
        color={selected ? colors.primary : (multi ? colors.border : 'transparent')} />
    </TouchableOpacity>
  )
}

const st = StyleSheet.create({
  pill:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
                    borderColor: colors.border, backgroundColor: colors.cardBg, minWidth: 0 },
  pillActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  pillText:       { flexShrink: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  pillTextActive: { color: colors.primary },
  field:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.cardBg,
                    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
                    paddingHorizontal: 14, paddingVertical: 12 },
  fieldText:      { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  fieldPlaceholder: { color: colors.textSecondary },
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet:          { backgroundColor: colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
                    paddingHorizontal: 16, paddingTop: 8, maxHeight: '75%' },
  handle:         { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 },
  title:          { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 8 },
  searchWrap:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
                    borderRadius: radius.md, paddingHorizontal: 10, marginBottom: 6 },
  search:         { flex: 1, paddingVertical: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  list:           { flexGrow: 0 },
  row:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 13,
                    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText:        { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  rowTextOn:      { fontFamily: 'Inter_700Bold', color: colors.primary },
  count:          { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary, marginRight: 10 },
  dot:            { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  done:           { marginTop: 12, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  doneText:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
