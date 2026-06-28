import { View, Image, StyleSheet } from 'react-native'

const MOTIF_OPACITY = 0.12

const TOPIC_CONFIG = {
  duty_pharmacy: {
    wash:  '#EFF6E4',
    tint:  '#3B6D11',
    asset: require('../assets/backgrounds/ada-bg-duty-pharmacy.png'),
  },
  medical_facilities: {
    wash:  '#EAF2FB',
    tint:  '#185FA5',
    asset: require('../assets/backgrounds/ada-bg-medical-facilities.png'),
  },
  emergency: {
    wash:  '#FCEEEE',
    tint:  '#A32D2D',
    asset: require('../assets/backgrounds/ada-bg-emergency.png'),
  },
  events: {
    wash:  '#EEEDFE',
    tint:  '#534AB7',
    asset: require('../assets/backgrounds/ada-bg-events.png'),
  },
  accommodation: {
    wash:  '#FBF3E6',
    tint:  '#854F0B',
    asset: require('../assets/backgrounds/ada-bg-accommodation.png'),
  },
  pets: {
    wash:  '#FAECE7',
    tint:  '#993C1D',
    asset: require('../assets/backgrounds/ada-bg-pets.png'),
  },
  home_services: {
    wash:  '#F1EFE8',
    tint:  '#5F5E5A',
    asset: require('../assets/backgrounds/ada-bg-home-services.png'),
  },
  beaches_landmarks: {
    wash:  '#EAF6F1',
    tint:  '#0F6E56',
    asset: require('../assets/backgrounds/ada-bg-beaches-landmarks.png'),
  },
  transportation: {
    wash:  '#EAF2FB',
    tint:  '#185FA5',
    asset: require('../assets/backgrounds/ada-bg-transportation.png'),
  },
  municipalities: {
    wash:  '#F1EFE8',
    tint:  '#5F5E5A',
    asset: require('../assets/backgrounds/ada-bg-municipalities.png'),
  },
  quiz: {
    wash:  '#FBEAF0',
    tint:  '#993556',
    asset: require('../assets/backgrounds/ada-bg-quiz.png'),
  },
}

export default function PageBackground({ topic }) {
  const config = TOPIC_CONFIG[topic]
  if (!config) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: config.wash }]} />
      <Image
        source={config.asset}
        tintColor={config.tint}
        resizeMode="stretch"
        style={s.band}
      />
    </View>
  )
}

const s = StyleSheet.create({
  band: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    aspectRatio: 5,
    opacity: MOTIF_OPACITY,
  },
})
