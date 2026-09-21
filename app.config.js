export default {
  expo: {
    name: 'ADA',
    slug: 'trnc-health',
    version: '1.2.0',
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
      checkAutomatically: 'ON_LOAD',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.berkeustun95.ada',
      usesAppleSignIn: true,
      minimumOsVersion: '14.0',
      // Usage descriptions are NOT set here. Each has ONE source, its plugin option below:
      // applyPermissions resolves `plugin option || ios.infoPlist || plugin default`, so a
      // copy here is inert while it matches and silently ignored the moment it doesn't.
      // Verify with `npx expo config --type introspect`, never by reading this file.
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        CFBundleDisplayName: 'ADA - North Cyprus Assistant',
        CFBundleName: 'ADANorthCyprus',
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
      ],
      blockedPermissions: [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      '@react-native-community/datetimepicker',
      'expo-font',
      'expo-apple-authentication',
      [
        'expo-image-picker',
        {
          photosPermission:
            'ADA uses your photo library so you can choose photos for your profile, your messages or your business page.',
          // Names MESSAGES ONLY, deliberately: no screen in this build calls launchCameraAsync
          // (profile and business photos are library-only), and a purpose string may not claim
          // a flow the reviewer cannot open. Messages stays because photo sending will arrive
          // by OTA onto this binary, and these strings only change with a native build. Add
          // profile / business page back in the build that gives those flows a camera.
          // If image messaging is dropped, set this to false. See
          // ~/ObsidianVault/10-ada/2026-09-20_native-permission-strings-PARKED.md
          cameraPermission: 'ADA uses your camera so you can take photos for your messages.',
          // false also puts RECORD_AUDIO in blockedPermissions. No audio anywhere in the app.
          microphonePermission: false,
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
            'ADA uses your location to show nearby places, services and duty pharmacies.',
          // Foreground only: nothing calls requestBackgroundPermissionsAsync.
          locationAlwaysPermission: false,
          locationAlwaysAndWhenInUsePermission: false,
        },
      ],
    ],
    // iOS permission-dialog translations. SEVEN left-to-right languages ONLY — never add
    // ar or fa here. Each entry becomes an <lang>.lproj in the bundle, and a bundle with an
    // Arabic/Persian localization is exactly what makes React Native mirror the whole
    // layout for a device in that language (RCTI18nUtil: allowRTL defaults YES). RTL
    // support is a separate, app-wide decision. Without an entry those users get the
    // English strings above, as everyone did before this.
    locales: {
      en: './locales/en.json',
      tr: './locales/tr.json',
      ru: './locales/ru.json',
      el: './locales/el.json',
      fr: './locales/fr.json',
      es: './locales/es.json',
      de: './locales/de.json',
    },
    extra: {
      eas: {
        projectId: '704d192a-1a80-41f8-ab98-cb3c8f078d7c',
      },
    },
    owner: 'berkeustun95',
  },
}
