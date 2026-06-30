import { View, Image, StyleSheet } from 'react-native'

const SCRIM_OPACITY = 0.30

const TOPIC_CONFIG = {
  duty_pharmacy:       { asset: require('../assets/backgrounds/ada-bg-duty-pharmacy.png') },
  medical_facilities:  { asset: require('../assets/backgrounds/ada-bg-medical-facilities.png') },
  emergency:           { asset: require('../assets/backgrounds/ada-bg-emergency.png') },
  events:              { asset: require('../assets/backgrounds/ada-bg-events.png') },
  accommodation:       { asset: require('../assets/backgrounds/ada-bg-accommodation.png') },
  pets:                { asset: require('../assets/backgrounds/ada-bg-pets.png') },
  home_services:       { asset: require('../assets/backgrounds/ada-bg-home-services.png') },
  beaches_landmarks:   { asset: require('../assets/backgrounds/ada-bg-beaches-landmarks.png') },
  transportation:      { asset: require('../assets/backgrounds/ada-bg-transportation.png') },
  municipalities:      { asset: require('../assets/backgrounds/ada-bg-municipalities.png') },
  quiz:                { asset: require('../assets/backgrounds/ada-bg-quiz.png') },
  newcomer_essentials: { asset: require('../assets/backgrounds/ada-bg-transportation.png') },
  exchange_rates:      { asset: require('../assets/backgrounds/ada-bg-exchange-rates.png') },
}

export default function PageBackground({ topic, scrimOpacity = SCRIM_OPACITY }) {
  const config = TOPIC_CONFIG[topic]
  if (!config) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={config.asset}
        resizeMode="cover"
        style={s.image}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${scrimOpacity})` }]} />
    </View>
  )
}

const s = StyleSheet.create({
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
})
