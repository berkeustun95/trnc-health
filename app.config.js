export default {
  expo: {
    name: 'ADA',
    slug: 'trnc-health',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/ADAicon.png',
    splash: {
      image: './assets/ADAicon.png',
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
    },
    scheme: 'ada',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.berkeustun95.ada',
      minimumOsVersion: '14.0',
    },
    android: {
      package: 'com.berkeustun95.ada',
      googleServicesFile: './google-services.json',
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
      adaptiveIcon: {
        foregroundImage: './assets/ADAicon.png',
        backgroundColor: '#FFFFFF',
      },
      minSdkVersion: 24,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      '@react-native-community/datetimepicker',
      'expo-font',
      'expo-notifications',
    ],
    extra: {
      eas: {
        projectId: '704d192a-1a80-41f8-ab98-cb3c8f078d7c',
      },
    },
    owner: 'berkeustun95',
  },
}
