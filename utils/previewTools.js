import { Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'
import Constants from 'expo-constants'
import { t } from '../constants/i18n'
import { signOutThisDevice } from './signOut'
import {
  KEY_ONBOARDED, KEY_POLICY_SEEN, KEY_PENDING, KEY_DUTY_OFFER, KEY_REOFFER, KEY_TOUR_CHIP,
} from './onboardingState'
import { KEY_HOME, KEY_ASKED } from './cityWelcomeRules'

// ADA Preview test tools. Both halves must hold: the install's update channel AND the bundle's own
// variant (extra.appVariant exists only in APP_VARIANT=preview configs). A production install never
// passes, whatever bundle it runs; a dev bundle has no channel. __tests__/previewTools.test.js pins it.
export const CAN_RESET_ONBOARDING = Updates.channel === 'preview' && Constants.expoConfig?.extra?.appVariant === 'preview'

// Everything Onboarding v2 wrote on this phone except the language. KEY_ASKED goes with the home city:
// Screen 2 writes both (setHomeCity).
export const RESET_ONBOARDING_KEYS = [
  KEY_ONBOARDED, KEY_POLICY_SEEN, KEY_PENDING, KEY_DUTY_OFFER, KEY_REOFFER, KEY_TOUR_CHIP, KEY_HOME, KEY_ASKED,
]

// Profil's "Başlangıcı sıfırla" row. Sign out first (the normal path: clears this device's push token, a
// guest's included), then the keys, so nothing session-bound writes them back; then a fresh launch on Start.
// The OS notification permission survives: clear app storage to test Screen 2 after Giriş yap again.
export function confirmResetOnboarding(lang) {
  if (!CAN_RESET_ONBOARDING) return
  Alert.alert(t('devResetOnboarding', lang), t('devResetOnboardingBody', lang), [
    { text: t('cancel', lang), style: 'cancel' },
    { text: t('devResetOnboarding', lang), style: 'destructive', onPress: () => { resetOnboarding(lang) } },
  ])
}

async function resetOnboarding(lang) {
  if (!CAN_RESET_ONBOARDING) return
  const result = await signOutThisDevice().catch(error => ({ error }))
  if (result?.error) { Alert.alert(t('signOutFailed', lang)); return }
  try { await AsyncStorage.multiRemove(RESET_ONBOARDING_KEYS) } catch {}
  await Updates.reloadAsync().catch(() => {})
}
