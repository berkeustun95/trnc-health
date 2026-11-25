import { View, Image } from 'react-native'

// Döveç wordmark, shown as delivered: never tinted, cropped or stretched. Clear space = 25% of height on top, right and bottom;
// none on the left: the screen's 16 px gutter is the left clear space, so the logo lines up with the cards and title.
// Navy on light grounds only; the white file is for dark grounds and is not rendered anywhere yet.
const SOURCES = {
  navy: require('../../assets/partners/dovec/dovec-logo-navy.png'),
  white: require('../../assets/partners/dovec/dovec-logo-white.png'),
}
const ASPECT = 2781 / 1022

export default function DovecLogo({ variant = 'navy', height }) {
  const pad = Math.ceil(height * 0.25)
  return (
    <View style={{ paddingTop: pad, paddingRight: pad, paddingBottom: pad, paddingLeft: 0, alignSelf: 'flex-start' }}>
      <Image source={SOURCES[variant] ?? SOURCES.navy} style={{ height, aspectRatio: ASPECT }} resizeMode="contain"
        accessibilityRole="image" accessibilityLabel="Döveç" accessibilityIgnoresInvertColors />
    </View>
  )
}
