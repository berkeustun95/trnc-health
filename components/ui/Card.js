import { View, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, radii, elevation, press } from '../../constants/theme'
import { useOnPhoto, OnPhotoContext } from './onPhoto'
import { CARD_BG } from './ModuleScreen'

// White, radius 20, elevation.card, and never a border AND a shadow together (the audit
// found both on Towing and Ev Hizmetleri cards). Pass onPress to make the whole card a
// target; pass `flat` for a card sitting inside another surface.
export default function Card({
  children, onPress, padding = 16, radius = radii.card, flat = false,
  tone, style, accessibilityLabel, accessibilityHint,
}) {
  const onPhoto = useOnPhoto()   // on a module photo: 93% white, radius 20
  const box = [
    s.card,
    { padding, borderRadius: onPhoto ? radii.card : radius, backgroundColor: tone ?? (onPhoto ? CARD_BG : colors.card) },
    !flat && elevation.card,
    style,
  ]
  // The card is its own white surface: what sits inside it is no longer on the photo.
  const inner = onPhoto ? <OnPhotoContext.Provider value={false}>{children}</OnPhotoContext.Provider> : children
  if (!onPress) return <View style={box}>{inner}</View>
  return (
    <TouchableOpacity
      style={box}
      onPress={onPress}
      activeOpacity={press.card}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {inner}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card: { overflow: 'visible' },
})
