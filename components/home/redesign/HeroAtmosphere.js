import { View, StyleSheet } from 'react-native'
import { HERO_WASH, CALENDAR_WASH, WEATHER_VEIL } from '../../../constants/dayParts'

// Daylight experiment: a colour wash for the time of day, then a weather veil, both flat and
// non-interactive. Rendered by RedesignHero between the photo and the top ramp, so the ramps and
// the chip pills stay on top of it.
export default function HeroAtmosphere({ part, wxGroup, calKind }) {
  // Variant C: a dated day's wash replaces the day-part wash; the weather veil is unaffected.
  const wash = (calKind && CALENDAR_WASH[calKind]) || HERO_WASH[part]
  const veil = WEATHER_VEIL[wxGroup]
  return (
    <>
      {!!wash && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} />}
      {!!veil && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} />}
    </>
  )
}
