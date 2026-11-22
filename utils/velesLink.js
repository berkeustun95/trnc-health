import { AppState, Linking, Platform } from 'react-native'
import { logContactEvent } from './logContactEvent'
import { colors } from '../constants/theme'
import { openWithFallback } from './browserFallback'

// Veles Bit Postası Home banner tap. Logged FIRST (utils/logContactEvent never throws; an insert the server refuses is dropped
// quietly, so this works before contact_events accepts module 'news'), then the site opens.
// iOS: the Safari app (Berke's Apple decision), and expo-web-browser is never touched there.
// Android: in-app Custom Tab; expo-web-browser is require()d INSIDE the function (native module, see utils/eaterySite.js), a missing
// module opens the system browser. Never throws.
export const VELES_URL = 'https://velesbitpostasi.com/'
// Identifies the link, not a person: one fixed UUID so the monthly counts group under one entity.
export const VELES_ENTITY_ID = '3b3f075c-4a8d-4470-8f65-8ec5cabe0a0e'

export async function openVeles(lang) {
  try {
    logContactEvent('news', VELES_ENTITY_ID, 'website', null, lang)
    if (Platform.OS !== 'android') { await Linking.openURL(VELES_URL); return true }
    let WebBrowser = null
    try { WebBrowser = require('expo-web-browser') } catch { WebBrowser = null }
    if (!WebBrowser?.openBrowserAsync) { await Linking.openURL(VELES_URL); return true }
    await openWithFallback({ platform: Platform.OS, appState: AppState, openSystem: u => Linking.openURL(u), url: VELES_URL, open: () => WebBrowser.openBrowserAsync(VELES_URL, {
      toolbarColor: colors.primary,
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
      createTask: false,
    }) })
    return true
  } catch {
    return false
  }
}
