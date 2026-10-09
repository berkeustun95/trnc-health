import { View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import HotelsTab from '../components/accommodation/HotelsTab'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import { ScreenHeader as RScreenHeader, ModuleScreen } from '../components/ui'
import { colors } from '../constants/theme'
import { REDESIGN } from '../constants/redesign'
import { t } from '../constants/i18n'

// Oteller, opened from its own Home tile (2026-10-09). It was the first tab of Emlak &
// Konaklama; the list itself is HotelsTab, unchanged. This is only the chrome that module
// gave it (same photo topic, same header), minus the tab bar.
export default function HotelsScreen({ lang, onClose }) {
  const header = REDESIGN
    ? <RScreenHeader onBack={onClose} title={t('accomTabHotels', lang)} lang={lang} />
    : (
      <>
        <PageBackground topic="accommodation" />
        <ScreenHeader onBack={onClose} title={t('accomTabHotels', lang)} lang={lang} />
      </>
    )
  const body = (
    <SafeAreaView style={REDESIGN ? s.safeOnPhoto : s.safe} edges={['top']}>
      {header}
      <View style={s.pane}>
        <View style={StyleSheet.absoluteFill}><HotelsTab lang={lang} /></View>
      </View>
    </SafeAreaView>
  )
  return REDESIGN
    ? <ModuleScreen topic="accommodation">{body}</ModuleScreen>
    : <View style={s.root}>{body}</View>
}

const s = StyleSheet.create({
  root:        { flex: 1 },
  safe:        { flex: 1, backgroundColor: colors.bg },
  safeOnPhoto: { flex: 1, backgroundColor: 'transparent' },
  pane:        { flex: 1 },
})
