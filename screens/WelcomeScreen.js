import { View, Text, Image, ImageBackground, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

export default function WelcomeScreen({ lang, onContinue }) {
  return (
    <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      <View style={s.overlay} />
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.container}>
          <View style={s.logoWrap}>
            <Image source={require('../assets/logonobg.png')} style={s.logo} resizeMode="contain" />
          </View>
          <Text style={s.tagline}>{t('welcomeTagline', lang)}</Text>
          <TouchableOpacity style={s.btn} onPress={onContinue} activeOpacity={0.85}>
            <Text style={s.btnText}>{t('getStarted', lang)}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ImageBackground>
  )
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: 'transparent' },
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.52)' },
  container:{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingBottom: 56 },
  logoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo:     { width: 320, height: 240 },
  tagline:  { fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', marginBottom: 48, lineHeight: 24 },
  btn:      { width: '100%', backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center',
               shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  btnText:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.3 },
})
