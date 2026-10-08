import { useEffect, useRef, useState } from 'react'
import { requireOptionalNativeModule } from 'expo'
import { VOICE_INPUT } from '../constants/flags'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import { IconButton } from './ui'

// ─── Ask Oli voice input (VOICE_INPUT) ───────────────────────────────────────
// Speech becomes text in the existing field; Oli's routing is unchanged and nothing is sent
// until the user taps. expo-speech-recognition is NATIVE and absent from every binary built
// before it, so it is require()d only when the binary has the module (check-native-import-safety).
// No audio is kept: recordingOptions.persist is false. Where the locale's model is installed
// the recognizer is told to stay on-device; otherwise the OS speech service may process it.
//
// available === false is the fallback signal: OliSearchSheet then shows KeyboardMicHint. It
// goes false for a missing module/flag, an unsupported language, or a denied permission —
// and stays false for the session (no nagging).
const RECOGNIZER_LOCALE = {
  English: 'en-GB', Turkish: 'tr-TR', Arabic: 'ar-SA', Russian: 'ru-RU', Greek: 'el-GR',
  French: 'fr-FR', Spanish: 'es-ES', German: 'de-DE', Persian: 'fa-IR',
}

let Speech
function loadSpeech() {
  if (Speech === undefined) {
    Speech = VOICE_INPUT && requireOptionalNativeModule('ExpoSpeechRecognition')
      ? require('expo-speech-recognition').ExpoSpeechRecognitionModule
      : null
  }
  return Speech
}

// Exact tag first, then same language (a device may list tr-TR as tr_TR, or only ar-EG).
function matchLocale(list, tag) {
  const norm = s => s.replace('_', '-').toLowerCase()
  const want = norm(tag)
  return list.find(l => norm(l) === want) ?? list.find(l => norm(l).split('-')[0] === want.split('-')[0]) ?? null
}

export function useVoiceInput({ lang, getText, onText }) {
  const [available, setAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const session = useRef({ locale: null, onDevice: false, base: '' })

  useEffect(() => {
    const mod = loadSpeech()
    const tag = RECOGNIZER_LOCALE[lang] ?? RECOGNIZER_LOCALE.English
    if (!mod || !mod.isRecognitionAvailable()) return
    let alive = true
    ;(async () => {
      const perm = await mod.getPermissionsAsync().catch(() => null)
      if (perm && !perm.granted && perm.canAskAgain === false) return
      // getSupportedLocales is unavailable on Android 12 and below: try the tag and let a
      // language-not-supported error fall back to the hint.
      const supported = await mod.getSupportedLocales({}).catch(() => null)
      let locale = tag
      let onDevice = false
      if (supported?.locales?.length) {
        locale = matchLocale(supported.locales, tag)
        if (!locale) return
        onDevice = !!matchLocale(supported.installedLocales ?? [], locale)
      }
      session.current = { ...session.current, locale, onDevice }
      if (alive) setAvailable(true)
    })()

    const subs = [
      mod.addListener('start', () => setListening(true)),
      mod.addListener('end', () => setListening(false)),
      mod.addListener('result', e => {
        const said = e.results?.[0]?.transcript ?? ''
        const { base } = session.current
        onText(base && said ? `${base} ${said}` : base || said)
      }),
      mod.addListener('error', e => {
        setListening(false)
        if (['not-allowed', 'language-not-supported', 'service-not-allowed'].includes(e.error)) setAvailable(false)
      }),
    ]
    return () => { alive = false; subs.forEach(s => s.remove()); mod.abort() }
  }, [lang])

  async function toggle() {
    const mod = loadSpeech()
    if (!mod) return
    if (listening) { mod.stop(); return }
    const perm = await mod.requestPermissionsAsync()
    if (!perm.granted) { setAvailable(false); return }
    session.current.base = getText().trim()
    mod.start({
      lang: session.current.locale,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: session.current.onDevice,
      recordingOptions: { persist: false },
    })
  }

  return { available, listening, toggle }
}

export function MicButton({ lang, listening, onPress }) {
  return (
    <IconButton icon={listening ? 'stop-circle' : 'mic-outline'} iconSize={20}
      color={listening ? colors.primary : colors.textSecondary} onPress={onPress}
      accessibilityLabel={t(listening ? 'oliMicStop' : 'oliMicStart', lang)} />
  )
}
