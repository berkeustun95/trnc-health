import { Platform, NativeModules, TurboModuleRegistry } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

// Home-screen widgets (1.4.3). Every native call is behind a presence check: Expo Go and
// binaries before 1.4.3 have neither module (scripts/check-native-import-safety.mjs).
//
// iOS: App Group shared with targets/widgets (app.config.js IOS_APP_GROUP). Android: the
// react-native-android-widget headless task (widgets/android/taskHandler.js).
const ANDROID_WIDGETS = ['Shortcuts']

function hasAndroidWidgets() {
  return Platform.OS === 'android' && !!(TurboModuleRegistry.get('AndroidWidget') ?? NativeModules.AndroidWidget)
}

export function registerWidgets() {
  if (!hasAndroidWidgets()) return
  const { registerWidgetTaskHandler } = require('react-native-android-widget')
  registerWidgetTaskHandler(require('../widgets/android/taskHandler').widgetTaskHandler)
}

// The widgets read ADA's language; call on every language change (and once at launch).
export async function syncWidgets(langCode) {
  try {
    if (Platform.OS === 'ios') {
      const appGroup = require('expo-constants').default.expoConfig?.extra?.widgetAppGroup
      if (!appGroup || !requireOptionalNativeModule('ExtensionStorage')) return
      const { ExtensionStorage } = require('@bacons/apple-targets')
      new ExtensionStorage(appGroup).set('lang', langCode)
      ExtensionStorage.reloadWidget()
    } else if (hasAndroidWidgets()) {
      const { requestWidgetUpdate } = require('react-native-android-widget')
      const { renderNamed } = require('../widgets/android/taskHandler')
      for (const widgetName of ANDROID_WIDGETS) {
        await requestWidgetUpdate({ widgetName, renderWidget: () => renderNamed(widgetName, langCode) })
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('widgets: sync skipped', e?.message)
  }
}
