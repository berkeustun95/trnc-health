import { View, Image } from 'react-native'

// Döveç wordmark, shown as delivered: never tinted, cropped or stretched. Padding = clear space (25% of height).
// Navy on light grounds only; the white file is for dark grounds and is not rendered anywhere yet.
const SOURCES = {
  navy: require('../../assets/partners/dovec/dovec-logo-navy.png'),
  white: require('../../assets/partners/dovec/dovec-logo-white.png'),
}
const ASPECT = 2781 / 1022

export default function DovecLogo({ variant = 'navy', height }) {
  return (
    <View style={{ padding: Math.ceil(height * 0.25), alignSelf: 'flex-start' }}>
      <Image source={SOURCES[variant] ?? SOURCES.navy} style={{ height, aspectRatio: ASPECT }} resizeMode="contain"
        accessibilityRole="image" accessibilityLabel="Döveç" accessibilityIgnoresInvertColors />
    </View>
  )
}
