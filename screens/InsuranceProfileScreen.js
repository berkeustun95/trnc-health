// STUB — replaced with the full company profile in slice 5.
// Exists now so InsuranceScreen's import resolves and the bundle builds.
import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from '../components/ScreenHeader'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

export default function InsuranceProfileScreen({ company, lang, onBack }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader onBack={onBack} title={company?.name || ''} lang={lang} />
      <View style={s.center}>
        <Text style={s.text}>{company?.name}</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
})
