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
          <View style={s.taglineBand}>
            <Text style={s.tagline}>{t('welcomeTagline', lang)}</Text>
          </View>
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
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  container:{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 0, paddingBottom: 56 },
  logoWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  logo:     { width: 320, height: 240 },
  taglineBand: { width: '100%', backgroundColor: 'rgba(0,0,0,0.28)', paddingVertical: 14, paddingHorizontal: 32, marginBottom: 48 },
  tagline:  { fontSize: 22, fontFamily: 'PlayfairDisplay_400Regular', color: '#fff', textAlign: 'center', lineHeight: 32, letterSpacing: 0.5 },
  btn:      { alignSelf: 'stretch', marginHorizontal: 32, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center',
               shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  btnText:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.3 },
})
