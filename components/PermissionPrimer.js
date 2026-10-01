import { useEffect, useRef, useSyncExternalStore } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import PhotoFade from './ui/PhotoFade'
import Button from './ui/Button'
import { t } from '../constants/i18n'
import { addBackListener } from '../utils/backHandler'
import { primerStore, registerHost, answerPrimer } from '../utils/permissionPrimer'

// The permission explanation screen (utils/permissionPrimer.js), in the Welcome/onboarding
// style: photo, Oli & Maki on the line, white text on solid teal (12.54:1). Mounted in App's
// final return and inside any RN Modal that asks (MapPinPicker); the newest host draws it.
// Back = "Şimdi değil".
const KIND = {
  location: {
    photo: require('../assets/backgrounds/ada-bg-duty-pharmacy.jpg'),
    focus: { x: 0.55, y: 0.64, zoom: 1.15 },
    scene: require('../assets/oli-scenes/health.png'),
    title: 'permLocationTitle', body: 'permLocationBody',
  },
  notifications: {
    photo: require('../assets/backgrounds/ada-bg-transportation.jpg'),
    focus: { x: 0.5, y: 0.64, zoom: 1.25 },
    scene: require('../assets/oli-scenes/emergency.png'),
    title: 'permNotifTitle', body: 'permNotifBody',
  },
}

let nextId = 1

export default function PermissionPrimer({ lang }) {
  const id = useRef(nextId++).current
  useEffect(() => registerHost(id), [id])
  const { request, top } = useSyncExternalStore(primerStore.subscribe, primerStore.get, primerStore.get)
  const visible = !!request && top === id
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (!visible) return
    const sub = addBackListener(() => { answerPrimer('later'); return true })
    return () => sub.remove()
  }, [visible])

  if (!visible) return null
  const k = KIND[request.kind]
  return (
    <View style={s.root} accessibilityViewIsModal>
      <PhotoFade photo={k.photo} focus={k.focus} mascot={k.scene}>
        <View style={[s.content, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={s.title} accessibilityRole="header">{t(k.title, lang)}</Text>
          <Text style={s.body}>{t(k.body, lang)}</Text>
          <Button size="lg" variant="inverse" fullWidth style={s.go}
            title={t('permPrimerContinue', lang)} onPress={() => answerPrimer('continue')} />
          <Button variant="onDarkText" fullWidth style={s.later}
            title={t('permPrimerNotNow', lang)} onPress={() => answerPrimer('later')} />
        </View>
      </PhotoFade>
    </View>
  )
}

const s = StyleSheet.create({
  root:    { ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 10000 },
  content: { paddingHorizontal: 24, paddingTop: 4 },
  title:   { fontSize: 26, lineHeight: 32, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 8, textAlign: 'center' },
  body:    { fontSize: 16, lineHeight: 23, fontFamily: 'Inter_400Regular', color: '#FFFFFF', textAlign: 'center' },
  go:      { marginTop: 24 },
  later:   { marginTop: 8 },
})
