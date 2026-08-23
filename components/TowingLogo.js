import { View, Text, Image, StyleSheet } from 'react-native'
import { colors } from '../constants/theme'

// Firm logo, or an initials monogram when there is no logo yet.
//
// resizeMode 'cover', NOT 'contain', and that is not a style preference — the four real
// firm logos are OPAQUE 512x512 PNGs with NO alpha channel and mixed backgrounds (two
// black, one white, one pale). 'contain' would letterbox a black-background logo inside
// the sand tile and read as broken. 'cover' on a 1:1 source in a 1:1 box fills exactly,
// with no crop. The sand backdrop is therefore visible ONLY behind the monogram.
//
// Backgrounds are deliberately NOT normalised programmatically — stripping them would
// wreck the two logos whose artwork depends on a dark ground.
//
// overflow:'hidden' is REQUIRED for borderRadius to actually clip an Image child on
// Android; without it the square corners of an opaque logo punch through the rounding.

function initials(name) {
  const words = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('tr')
  return (words[0][0] + words[1][0]).toLocaleUpperCase('tr')
}

export default function TowingLogo({ uri, name, size = 64, style }) {
  const boxStyle = [
    s.box,
    { width: size, height: size, borderRadius: Math.round(size * 0.1875) },  // 12 @ 64
    style,
  ]

  if (uri) {
    return (
      <View style={boxStyle}>
        <Image source={{ uri }} style={s.img} resizeMode="cover" />
      </View>
    )
  }

  return (
    <View style={[boxStyle, s.monogram]}>
      <Text style={[s.monogramText, { fontSize: Math.round(size * 0.34) }]} numberOfLines={1}>
        {initials(name)}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    backgroundColor: colors.sand,
    overflow: 'hidden',        // see header — required for Android clipping
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img:           { width: '100%', height: '100%' },
  monogram:      { backgroundColor: colors.primary },
  monogramText:  { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.5 },
})
