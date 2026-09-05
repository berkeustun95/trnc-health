import { useState, useEffect } from 'react'
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { HOME_MODULES } from '../../constants/homeModules'
import { FAVOURITE_SLOTS, eligibleModules, resolveFavourites } from '../../constants/homeFavourites'
import ModuleTile from './ModuleTile'

// Düzenle — pin or replace the four favourite slots.
//
// ─── THE INTERACTION, AND WHY IT IS PICK-SLOT-THEN-PICK-MODULE ──────────────
//
// Drag-to-reorder is the obvious design and the wrong one here. It needs a gesture
// handler this repo does not install, it is fiddly on 52pt targets, and it cannot express
// the actual operation — which is not "move this tile" but "put THAT module in THIS box",
// where `that` is usually not on screen yet. Two taps say it exactly, work with
// VoiceOver, and need no library.
//
// A slot is selected (highlighted); tapping any module in the list below assigns it there
// and advances the selection to the next slot, so pinning all four is eight taps in a
// straight line with no mode to understand.
//
// ─── A PIN IS AN OVERRIDE, NOT A SNAPSHOT ───────────────────────────────────
//
// Slots the user never touches stay `null` and keep auto-filling by usage forever. That
// is why the sheet opens showing the RESOLVED row (what they see on Home) while storing
// only what they explicitly chose: taking a snapshot of the current four and calling them
// pins would silently freeze the whole row the first time somebody edited one box.
//
// "Otomatik sırala" clears every pin and hands the row back to usage.

function SlotBox({ mod, index, selected, lang, onPress }) {
  return (
    <TouchableOpacity
      style={[s.slot, selected && s.slotSelected]}
      onPress={() => onPress(index)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${index + 1}. ${mod ? t(mod.labelKey, lang) : t('favSlotEmpty', lang)}`}
    >
      {mod
        ? <Ionicons name={mod.icon} size={22} color={selected ? colors.primary : colors.textSecondary} />
        : <Ionicons name="add" size={22} color={colors.textSecondary} />}
      <Text style={[s.slotLabel, selected && s.slotLabelSelected]} numberOfLines={2}>
        {mod ? t(mod.labelKey, lang) : t('favSlotEmpty', lang)}
      </Text>
    </TouchableOpacity>
  )
}

export default function FavouritesEditSheet({ visible, pins, usage, overrides, lang, onSave, onClose }) {
  const [draft, setDraft]       = useState(pins)
  const [selected, setSelected] = useState(0)

  // Re-seed from storage each time the sheet OPENS, not on every prop change: editing is
  // a session with a Bitti at the end, and a pin written elsewhere mid-edit must not
  // reach in and rewrite what the user is looking at.
  useEffect(() => {
    if (visible) { setDraft(pins); setSelected(0) }
  }, [visible])

  // What Home would show given the current draft — so the slot boxes preview the real
  // outcome, auto-filled entries included, rather than showing four holes.
  const resolved = resolveFavourites({ pins: draft, usage, overrides })
  const byId     = new Map(HOME_MODULES.map(m => [m.id, m]))
  const options  = eligibleModules({ overrides }).map(id => byId.get(id)).filter(Boolean)

  function assign(mod) {
    const next = [...draft]
    // No duplicates: a module already pinned elsewhere MOVES rather than appearing twice.
    // Four boxes showing three modules is a bug the user cannot undo without guessing
    // which box to clear.
    for (let i = 0; i < FAVOURITE_SLOTS; i++) if (next[i] === mod.id) next[i] = null
    next[selected] = mod.id
    setDraft(next)
    setSelected(sel => (sel + 1) % FAVOURITE_SLOTS)
  }

  function clearSlot() {
    const next = [...draft]
    next[selected] = null
    setDraft(next)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        {/* The backdrop dismisses WITHOUT saving, and the sheet is its sibling so a tap
            inside it never reaches this. Same arrangement HeroCreditSheet uses. */}
        <TouchableOpacity style={s.backdropTap} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>{t('favEditTitle', lang)}</Text>
            <TouchableOpacity
              onPress={() => onSave(draft)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
            >
              <Text style={s.done}>{t('favDone', lang)}</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.hint}>{t('favEditHint', lang)}</Text>

          <View style={s.slots}>
            {Array.from({ length: FAVOURITE_SLOTS }).map((_, i) => (
              <SlotBox
                key={i}
                index={i}
                mod={byId.get(resolved[i])}
                selected={selected === i}
                lang={lang}
                onPress={setSelected}
              />
            ))}
          </View>

          <View style={s.actions}>
            <TouchableOpacity onPress={clearSlot} style={s.action} accessibilityRole="button">
              <Ionicons name="backspace-outline" size={15} color={colors.textSecondary} />
              <Text style={s.actionText}>{t('favClearSlot', lang)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setDraft(new Array(FAVOURITE_SLOTS).fill(null))}
              style={s.action}
              accessibilityRole="button"
            >
              <Ionicons name="sparkles-outline" size={15} color={colors.textSecondary} />
              <Text style={s.actionText}>{t('favReset', lang)}</Text>
            </TouchableOpacity>
          </View>

          {/* Only ELIGIBLE modules are offered. A sheet that let you pin a dark module
              would be a way to put a Coming Soon tile on Home by hand — the one thing the
              resolver refuses to do on its own, so the editor must refuse it too. */}
          <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
            {options.map(mod => (
              <ModuleTile
                key={mod.id}
                mod={mod}
                lang={lang}
                onPress={assign}
                width="25%"
                trailing={draft.includes(mod.id)
                  ? <View style={s.pinDot}><Ionicons name="pin" size={11} color="#fff" /></View>
                  : null}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  // maxHeight rather than a fixed one: the module list scrolls, and on a short screen the
  // sheet must not push its own Bitti button off the bottom.
  sheet:       { backgroundColor: colors.cardBg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
                 padding: 20, paddingBottom: 30, maxHeight: '78%' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:       { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  done:        { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primary },
  hint:        { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  slots:       { flexDirection: 'row', gap: 8, marginTop: 16 },
  // flex:1 so four boxes share the width evenly in every locale — a content-sized box
  // would make each one a different width as the labels change language.
  slot:        { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4,
                 borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
                 backgroundColor: 'transparent' },
  // Selection is carried by BORDER + BACKGROUND + label colour, not by colour alone —
  // the same requirement the grid's tint families carry, so the selected box is
  // identifiable in greyscale and to a red-green colourblind reader.
  slotSelected:{ borderColor: colors.primary, backgroundColor: colors.primaryLight },
  // TWO lines in a FIXED box, the same trick the grid's label uses and for the same
  // reason twice over: a quarter-width box at 10pt fits ~14 characters, so "Nöbetçi
  // Eczaneler" and "Yeni Gelenler Rehberi" would both ellipse to near-identical stubs on
  // one line — and a preview whose whole job is to say WHICH module is in the slot must
  // not render two different modules as the same string. Fixed height so all four boxes
  // stay the same size whatever the locale does.
  slotLabel:   { fontSize: 10, lineHeight: 13, height: 26, fontFamily: 'Inter_500Medium',
                 color: colors.textSecondary, textAlign: 'center' },
  // primaryDark, not primary: primary on primaryLight is 4.44:1, under the 4.5 floor for
  // 10pt text. primaryDark is 6.71:1 on the same tint.
  slotLabelSelected: { color: colors.primaryDark },
  // flexWrap is the degradation path, not the design. Every locale's pair fits one line
  // at 320dp (measured; the numbers are in the Slice 3 log), but the widest — Greek and
  // German — sat within a few points of the edge on a 0.52em ESTIMATE, and an estimate
  // that close is a coin toss rather than a fit. Wrapping costs a line; overflowing a
  // row pushes a button off the sheet where it cannot be pressed at all.
  actions:     { flexDirection: 'row', flexWrap: 'wrap', gap: 18, rowGap: 8, marginTop: 12, marginBottom: 4 },
  action:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText:  { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  list:        { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  listContent: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 6 },
  // Sits on the icon's top-right corner. `pin`, not a check: a check reads as "selected"
  // and these are already-pinned modules the user may be about to move.
  pinDot:      { position: 'absolute', top: 8, right: 12, width: 18, height: 18, borderRadius: 9,
                 backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
                 borderWidth: 1.5, borderColor: colors.cardBg },
})
