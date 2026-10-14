import * as Haptics from 'expo-haptics'

// Light impact on primary actions only. A device without a haptic engine rejects quietly.
export function haptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

// Selection tick: a state change that already happened (a space committed at the colour peak).
export function hapticSelect() {
  Haptics.selectionAsync().catch(() => {})
}
