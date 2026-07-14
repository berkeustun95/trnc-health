import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Switch, Modal, ScrollView } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'
import CityPicker from './CityPicker'
import {
  VISITING, loadCityWelcomeState, setCityWelcomeEnabled, setHomeCity,
} from '../utils/cityWelcome'

// Settings for city welcome, opened from the side drawer.
//
// It lives in the DRAWER, not in ProfileScreen: the profile tab is behind the
// requireAccount gate, so a guest cannot reach it — and a guest tourist is this
// feature's primary user. The drawer is the only guest-reachable settings
// surface (it is where Language already lives).
//
// The toggle writes @trnc_city_welcome, the same key the card's "turn these off"
// action writes. One key, two entry points.
export default function CityWelcomeSettings({ visible, lang, onClose }) {
  const [enabled, setEnabled] = useState(true)
  const [home, setHome] = useState(null)

  useEffect(() => {
    if (!visible) return
    loadCityWelcomeState().then(st => { setEnabled(st.enabled); setHome(st.home) })
  }, [visible])

  const onToggle = value => {
    setEnabled(value)          // optimistic; the write is fire-and-forget
    setCityWelcomeEnabled(value)
  }

  const choose = value => {
    setHome(value)
    setHomeCity(value)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>{t('cwSettingsTitle', lang)}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
            >
              <Feather name="x" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.row}>
              <View style={s.rowText}>
                <Text style={s.rowTitle}>{t('cwSettingsToggle', lang)}</Text>
                <Text style={s.rowSub}>{t('cwSettingsToggleBody', lang)}</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={onToggle}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={s.divider} />

            <Text style={s.sectionTitle}>{t('cwSettingsHome', lang)}</Text>
            <Text style={s.sectionBody}>{t('cwSettingsHomeBody', lang)}</Text>

            <TouchableOpacity
              style={[s.visitingChip, home === VISITING && s.visitingChipActive]}
              onPress={() => choose(VISITING)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: home === VISITING }}
            >
              <Feather
                name="map"
                size={14}
                color={home === VISITING ? colors.primary : colors.textSecondary}
              />
              <Text style={[s.visitingText, home === VISITING && s.visitingTextActive]}>
                {t('cwSettingsVisiting', lang)}
              </Text>
            </TouchableOpacity>

            <CityPicker value={home} onSelect={choose} lang={lang} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: colors.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, maxHeight: '80%', ...shadow },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title:        { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  content:      { paddingTop: 10 },

  row:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText:      { flex: 1 },
  rowTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  rowSub:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  marginTop: 2, lineHeight: 17 },

  divider:      { height: 1, backgroundColor: colors.border, marginVertical: 18 },

  sectionTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
                  textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionBody:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary,
                  marginTop: 4, marginBottom: 12, lineHeight: 18 },

  visitingChip:       { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
                        borderWidth: 1, borderColor: colors.border, borderRadius: 20,
                        backgroundColor: 'transparent',
                        paddingHorizontal: 14, paddingVertical: 9, marginBottom: 10 },
  visitingChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  visitingText:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  visitingTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
})
