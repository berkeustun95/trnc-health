import { AppState, Linking, Platform } from 'react-native'
import { AD_HOUSE_URL_TR, AD_HOUSE_URL_EN } from '../constants/ads'
import { colors } from '../constants/theme'
import { openWithFallback } from './browserFallback'

// "ADA ile çalışın": the advertise / partner page on getadaapp.com, Turkish for Turkish, English for every other language.
// `lang` is the FULL English language name ('Turkish'), never an ISO code.
export const workWithAdaUrl = lang => (lang === 'Turkish' ? AD_HOUSE_URL_TR : AD_HOUSE_URL_EN)

// Opened like utils/eaterySite.js: expo-web-browser is require()d INSIDE the function (native module), a missing module falls back
// to the system browser, a refused presentation (a browser already open) is not retried. Never throws; resolves true when opened.
export async function openWorkWithAda(lang) {
  const url = workWithAdaUrl(lang)
  let WebBrowser = null
  try { WebBrowser = require('expo-web-browser') } catch { WebBrowser = null }
  if (!WebBrowser?.openBrowserAsync) {
    try { await Linking.openURL(url); return true } catch { return false }
  }
  try {
    await openWithFallback({ platform: Platform.OS, appState: AppState, openSystem: u => Linking.openURL(u), url, open: () => WebBrowser.openBrowserAsync(url, {
      toolbarColor: colors.primary,
      controlsColor: colors.onPrimary,
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
      createTask: false,
    }) })
    return true
  } catch {
    return false
  }
}
