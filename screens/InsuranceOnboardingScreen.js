// STUB — replaced with the full self-serve onboarding form in slice 3.
// Exists now so InsuranceScreen's import resolves and the bundle builds.
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

export default function InsuranceOnboardingScreen({ lang, onClose }) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.center}>
        <Text style={s.text}>{t('insRegisterCTA', lang)}</Text>
        <TouchableOpacity onPress={onClose}><Text style={s.link}>{t('back', lang)}</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  text:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  link:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary },
})
