import { View, StyleSheet } from 'react-native'
import { HERO_WASH, WEATHER_VEIL } from '../../../constants/dayParts'

// Daylight experiment: a colour wash for the time of day, then a weather veil, both flat and
// non-interactive. Rendered by RedesignHero between the photo and the top ramp, so the ramps and
// the chip pills stay on top of it.
export default function HeroAtmosphere({ part, wxGroup }) {
  const wash = HERO_WASH[part]
  const veil = WEATHER_VEIL[wxGroup]
  return (
    <>
      {!!wash && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} />}
      {!!veil && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} />}
    </>
  )
}
