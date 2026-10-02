import { View, Image, StyleSheet } from 'react-native'

const SCRIM_OPACITY = 0.30

const TOPIC_CONFIG = {
  duty_pharmacy:       { asset: require('../assets/backgrounds/ada-bg-duty-pharmacy.jpg') },
  medical_facilities:  { asset: require('../assets/backgrounds/ada-bg-medical-facilities.jpg') },
  emergency:           { asset: require('../assets/backgrounds/ada-bg-emergency.png') },
  events:              { asset: require('../assets/backgrounds/ada-bg-events.jpg') },
  accommodation:       { asset: require('../assets/backgrounds/ada-bg-accommodation.jpg') },
  pets:                { asset: require('../assets/backgrounds/ada-bg-pets.jpg') },
  home_services:       { asset: require('../assets/backgrounds/ada-bg-home-services.jpg') },
  insurance:           { asset: require('../assets/backgrounds/ada-bg-insurance.jpg') },
  beaches_landmarks:   { asset: require('../assets/backgrounds/ada-bg-beaches-landmarks.jpg') },
  transportation:      { asset: require('../assets/backgrounds/ada-bg-transportation.jpg') },
  municipalities:      { asset: require('../assets/backgrounds/ada-bg-municipalities.png') },
  newcomer_essentials: { asset: require('../assets/backgrounds/ada-bg-transportation.jpg') },
  exchange_rates:      { asset: require('../assets/backgrounds/ada-bg-exchange-rates.jpg') },
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
