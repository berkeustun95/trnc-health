export default {
  expo: {
    name: 'ADA',
    slug: 'trnc-health',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
    },
    scheme: 'ada',
    updates: {
      url: 'https://u.expo.dev/704d192a-1a80-41f8-ab98-cb3c8f078d7c',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.berkeustun95.ada',
      minimumOsVersion: '14.0',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'ADA uses your location to show nearby pharmacies, clinics, and hospitals.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'ADA uses your location to show nearby pharmacies, clinics, and hospitals.',
        NSPhotoLibraryUsageDescription:
          'ADA needs access to your photos to let you set a profile picture.',
      },
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
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundColor: '#FFFFFF',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      minSdkVersion: 24,
      permissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.VIBRATE',
        'android.permission.READ_MEDIA_IMAGES',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      '@react-native-community/datetimepicker',
      'expo-font',
      [
        'expo-image-picker',
        {
          photosPermission: 'ADA needs access to your photos to let you set a profile picture.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/android-icon-monochrome.png',
          color: '#ffffff',
          defaultChannel: 'default',
          sounds: [],
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'ADA uses your location to show nearby pharmacies, clinics, and hospitals.',
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '704d192a-1a80-41f8-ab98-cb3c8f078d7c',
      },
    },
    owner: 'berkeustun95',
  },
}
