import * as Haptics from 'expo-haptics'

// Light impact on primary actions only. A device without a haptic engine rejects quietly.
export function haptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}
