import AsyncStorage from '@react-native-async-storage/async-storage'
import { LANG_CODES } from '../../constants/i18n'
import { ShortcutsWidget } from './ShortcutsWidget'

// Content follows ADA's language (the app's '@trnc_lang'), not the phone's — same rule as
// the screens. The gallery name/description are the OS's, from values-<lang>/strings.xml.
export async function widgetLangCode() {
  try { return LANG_CODES[await AsyncStorage.getItem('@trnc_lang')] ?? 'en' } catch { return 'en' }
}

// `code` is passed by the app on a language change: AsyncStorage may not hold the new value yet.
export async function renderNamed(widgetName, code) {
  code = code ?? await widgetLangCode()
  switch (widgetName) {
    case 'Shortcuts': return <ShortcutsWidget code={code} />
    default: return null
  }
}

// Runs headless (app may be closed). Taps are OPEN_URI, handled natively, so they never land here.
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }) {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return
  const el = await renderNamed(widgetInfo.widgetName)
  if (el) renderWidget(el)
}
