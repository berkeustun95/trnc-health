import { View, Image, StyleSheet } from 'react-native'
import { radius } from '../constants/theme'

// Alpha PNGs, ~360x360 source, rendered small. No card/backdrop — the art is
// the badge. Rounded-square (not circular) so ears/shells never get clipped.
const MASCOT_CONFIG = {
  accommodation:     require('../assets/mascots/mascot-accommodation.png'),
  events:            require('../assets/mascots/mascot-events.png'),
  exchange:          require('../assets/mascots/mascot-exchange.png'),
  health_facilities: require('../assets/mascots/mascot-health-facilities.png'),
  house_services:    require('../assets/mascots/mascot-house-services.png'),
  pets:              require('../assets/mascots/mascot-pets.png'),
  emergency:         require('../assets/mascots/mascot-emergency-contacts.png'),
  welcome_guide:     require('../assets/mascots/mascot-welcome-guide.png'),
}

export default function ModuleMascotBadge({ module, size = 120, style }) {
  const source = MASCOT_CONFIG[module]
  if (!source) return null

  return (
    <View style={[{ width: size, height: size, borderRadius: radius.xl }, style]}>
      <Image source={source} resizeMode="contain" style={s.image} />
    </View>
  )
}

const s = StyleSheet.create({
  image: { width: '100%', height: '100%' },
})
