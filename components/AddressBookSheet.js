import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { ADDRESS_NAME_MAX, addressKind, oneLine, shortAddress, canAddMore, ADDRESS_BOOK_MAX } from '../constants/eatery'
import { colors, font, type, radii, space, press, TAP } from '../constants/theme'
import { BottomSheet, Button, IconButton } from './ui'

// "Teslimat adresi": the saved addresses of this phone (utils/eateryAddress.js) in a bottom sheet. Tapping a row chooses it; the pencil
// edits it. Rows carry icons, never map thumbnails (only the selected card in Sepetim has a map). Defined outside the screen: re-renders.
// book: { items, lastUsedId } as loaded when the sheet opened; selectedId: the entry the card shows.

export const KIND_ICON = { home: 'home-outline', work: 'briefcase-outline', other: 'location-outline' }
const KIND_KEY = { home: 'eateryAddrKindHome', work: 'eateryAddrKindWork' }
// What the card and the rows call an entry (UI only; the message line has its own rule): Ev / İş, else the name, else "Adresim".
export const addressLabel = (e, lang) => { const k = addressKind(e.kind); return KIND_KEY[k] ? t(KIND_KEY[k], lang) : oneLine(e.name, ADDRESS_NAME_MAX) || t('eateryAddrUnnamed', lang) }

export function KindWell({ kind, onTint = false }) {
  return (
    <View style={[s.well, onTint && s.wellOnTint]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Ionicons name={KIND_ICON[addressKind(kind)]} size={22} color={colors.primaryDark} />
    </View>
  )
}

function Row({ entry, selected, lang, onChoose, onEdit }) {
  const label = addressLabel(entry, lang)
  const text = shortAddress(entry) || t('eateryAddrIncomplete', lang)
  return (
    <View style={s.rowWrap}>
      <Pressable onPress={() => onChoose(entry)} style={({ pressed }) => [s.row, selected && s.rowOn, pressed && { opacity: press.small }]}
        accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label}. ${text}`}>
        <KindWell kind={entry.kind} onTint={selected} />
        <View style={s.main}>
          <Text style={s.label} numberOfLines={1}>{label}</Text>
          <Text style={[s.text, selected && s.textOn]} numberOfLines={2}>{text}</Text>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={22} color={colors.primaryDark} />}
      </Pressable>
      <IconButton icon="pencil-outline" onPress={() => onEdit(entry)} accessibilityLabel={t('eateryAddrEditA11y', lang).replace('{name}', () => label)} />
    </View>
  )
}

export default function AddressBookSheet({ visible, lang, book, selectedId, onClose, onChoose, onEdit, onNew }) {
  const items = book?.items || []
  const more = canAddMore(items.length)
  return (
    <BottomSheet visible={visible === true} onClose={onClose} title={t('eateryAddrSheetTitle', lang)} lang={lang}>
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false} accessibilityRole="radiogroup">
        {items.map(e => <Row key={e.id} entry={e} selected={e.id === selectedId} lang={lang} onChoose={onChoose} onEdit={onEdit} />)}
      </ScrollView>
      <View style={s.foot}>
        <Button variant="secondary" fullWidth icon="add" title={t('eateryAddrNew', lang)} onPress={onNew} disabled={!more} />
        {!more && <Text style={s.note}>{t('eateryAddrFullNote', lang).replace('{n}', () => String(ADDRESS_BOOK_MAX))}</Text>}
      </View>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  list:      { flexGrow: 0, flexShrink: 1 },
  listContent:{ gap: space[8], paddingBottom: space[12] },
  foot:      { flexShrink: 0, gap: space[8] },
  rowWrap:   { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  row:       { flex: 1, minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[12], paddingHorizontal: space[12], paddingVertical: space[8], borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  rowOn:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  well:      { width: TAP, height: TAP, borderRadius: radii.tile, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  wellOnTint:{ backgroundColor: colors.card },
  main:      { flex: 1, gap: 2 },   // label and address read as one line pair: closer than space[4]
  label:     { ...type.rowTitle, color: colors.textPrimary },
  text:      { ...type.small, color: colors.textSecondary },
  textOn:    { color: colors.textPrimary },
  note:      { ...type.small, color: colors.textSecondary, textAlign: 'center' },
})
