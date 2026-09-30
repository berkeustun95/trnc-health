import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Linking, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { colors, category, type, radii, press, TAP } from '../../constants/theme'
import { t, LANGUAGES } from '../../constants/i18n'
import { MODULE_FLAGS } from '../../constants/flags'
import { MUNICIPALITIES } from '../../constants/municipalities'
import { BottomSheet, CategoryIcon, IconButton } from '../ui'

// The shell's three popups, now BottomSheets (redesign Slice 2): emergency, municipal and
// language — plus About, which was an English-only Alert.

// ─── Emergency ───────────────────────────────────────────────────────────────
// ⚠ THIS SHEET IS THE ESCAPE FROM THE FORCE-UPDATE BLOCK. App.js derives the block from
//   `showEmergencyModal`, so opening this hides the force modal and closing it brings it
//   back. The state flag is unchanged; only the surface is new. The force tier still needs
//   its device pass on BOTH platforms before blocking is ever switched on (CLAUDE.md).
const EMERGENCY = [
  { key: 'menuPolice',     number: '155', icon: 'shield-outline' },
  { key: 'menuAmbulance',  number: '112', icon: 'medkit-outline' },
  { key: 'menuFire',       number: '199', icon: 'flame-outline' },
  { key: 'menuCoastGuard', number: '158', icon: 'boat-outline' },
  { key: 'menuCWRI',       number: '+905488111190', icon: 'paw-outline', subKey: 'menuCWRISubtitle' },
]

export function EmergencySheet({ visible, onClose, lang, onShowTowing }) {
  const call = number => { onClose(); Linking.openURL(`tel:${number}`).catch(() => {}) }
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('menuEmergency', lang)} lang={lang}>
      <Text style={s.sub}>{t('emergencySubtitle', lang)}</Text>
      {EMERGENCY.map(e => {
        const label = t(e.key, lang)
        return (
          <View key={e.number} style={s.row}>
            <CategoryIcon icon={e.icon} category="health" size={40} />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{label}</Text>
              {!!e.subKey && <Text style={s.rowSub}>{t(e.subKey, lang)}</Text>}
              <Text style={s.number}>{e.number}</Text>
            </View>
            <TouchableOpacity style={s.callBtn} activeOpacity={press.small} onPress={() => call(e.number)}
              accessibilityRole="button"
              accessibilityLabel={t('hrCallA11y', lang).replace('{label}', label).replace('{number}', e.number)}>
              <Ionicons name="call" size={20} color={colors.onPrimary} />
            </TouchableOpacity>
          </View>
        )
      })}
      {/* Towing sits AFTER the state numbers, never among them: 155/112/199/158 are
          life-safety lines and nothing commercial may appear above them. */}
      {MODULE_FLAGS.towing && (
        <TouchableOpacity style={[s.row, s.towRow]} activeOpacity={press.small}
          onPress={() => { onClose(); onShowTowing?.() }} accessibilityRole="button">
          <CategoryIcon icon="car-outline" category="city" size={40} />
          <View style={s.rowText}>
            <Text style={s.rowTitle}>{t('menuTowing', lang)}</Text>
            <Text style={s.rowSub}>{t('towingFromEmergencySub', lang)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </BottomSheet>
  )
}

// ─── Municipalities ──────────────────────────────────────────────────────────
export function MunicipalSheet({ visible, onClose, lang }) {
  const { height } = useWindowDimensions()
  const [open, setOpen] = useState(null)
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('menuMunicipalities', lang)} lang={lang}>
      <Text style={s.sub}>{t('hrMuniUnion', lang)}</Text>
      <ScrollView style={{ maxHeight: height * 0.6 }} showsVerticalScrollIndicator={false}>
        {MUNICIPALITIES.map(({ name, phone, mapQuery }) => {
          const expanded = open === name
          return (
            <View key={name} style={s.muniItem}>
              <View style={s.row}>
                <TouchableOpacity style={[s.rowText, s.muniName]} activeOpacity={press.small}
                  onPress={() => setOpen(expanded ? null : name)} accessibilityRole="button"
                  accessibilityState={{ expanded }} accessibilityLabel={t('hrMuniHoursA11y', lang).replace('{name}', name)}>
                  <Text style={s.rowTitle}>{name}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
                </TouchableOpacity>
                <IconButton icon="map-outline" variant="soft" color={colors.textPrimary}
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`).catch(() => {})}
                  accessibilityLabel={t('hrMuniMapA11y', lang).replace('{name}', name)} />
                <IconButton icon="call" variant="soft" color={colors.primaryDark}
                  onPress={() => { onClose(); Linking.openURL(`tel:${phone}`).catch(() => {}) }}
                  accessibilityLabel={t('hrMuniCallA11y', lang).replace('{name}', name)} />
              </View>
              {expanded && (
                <View style={s.hours}>
                  <Ionicons name="time-outline" size={14} color={colors.primaryDark} style={{ marginTop: 2 }} />
                  <View>
                    <Text style={s.hoursText}>{t('hrMuniHoursWeek', lang)}</Text>
                    <Text style={s.hoursText}>{t('hrMuniHoursThu', lang)}</Text>
                    <Text style={s.hoursText}>{t('hrMuniHoursWeekend', lang)}</Text>
                  </View>
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
    </BottomSheet>
  )
}

// ─── Language ────────────────────────────────────────────────────────────────
// One setting, one behaviour: onSelect is App.js's selectLang, which applies immediately
// (AsyncStorage + profile row), whether opened from Profil or anywhere else.
export function LanguageSheet({ visible, onClose, lang, onSelect }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('menuLanguage', lang)} lang={lang}>
      {LANGUAGES.map(({ key, label }) => {
        const active = lang === key
        return (
          <TouchableOpacity key={key} style={[s.row, s.langRow]} activeOpacity={press.small} onPress={() => onSelect(key)}
            accessibilityRole="radio" accessibilityState={{ selected: active }}>
            <Text style={[s.rowTitle, active && { color: colors.primaryDark }]}>{label}</Text>
            {active && <Ionicons name="checkmark" size={20} color={colors.primaryDark} />}
          </TouchableOpacity>
        )
      })}
    </BottomSheet>
  )
}

// ─── About ───────────────────────────────────────────────────────────────────
// The real version and the PLATFORM update id (first 8 chars — the one the About screen has
// always quoted, never the EAS group id), or "Built-in" when running the embedded bundle.
export function AboutSheet({ visible, onClose, lang }) {
  const version = Constants.expoConfig?.version ?? '—'
  const update = !Updates.isEmbeddedLaunch && Updates.updateId ? Updates.updateId.slice(0, 8) : t('hrAboutEmbedded', lang)
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('menuAbout', lang)} lang={lang}>
      <Text style={s.aboutBody}>{t('aboutDescription', lang)}</Text>
      <View style={s.kv}><Text style={s.k}>{t('hrAboutVersion', lang)}</Text><Text style={s.v} selectable>{version}</Text></View>
      <View style={s.kv}><Text style={s.k}>{t('hrAboutUpdate', lang)}</Text><Text style={s.v} selectable>{update}</Text></View>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sub:       { ...type.small, color: colors.textSecondary, marginBottom: 8 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP + 12, paddingVertical: 6 },
  towRow:    { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, paddingTop: 12 },
  rowText:   { flex: 1 },
  rowTitle:  { ...type.rowTitle, color: colors.textPrimary },
  rowSub:    { ...type.small, color: colors.textSecondary },
  number:    { ...type.body, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginTop: 1 },
  // 48pt filled call button: the primary action of every row, labelled for screen readers.
  callBtn:   { width: 48, height: 48, borderRadius: 24, backgroundColor: category.health.ink,
               justifyContent: 'center', alignItems: 'center' },
  muniItem:  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  muniName:  { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP },
  hours:     { flexDirection: 'row', gap: 8, backgroundColor: colors.primaryLight, borderRadius: radii.md,
               padding: 10, marginBottom: 10 },
  hoursText: { ...type.small, color: colors.primaryDark },
  langRow:   { justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  aboutBody: { ...type.body, color: colors.textSecondary, marginBottom: 16 },
  kv:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12,
               borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  k:         { ...type.body, color: colors.textSecondary },
  v:         { ...type.body, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
})
