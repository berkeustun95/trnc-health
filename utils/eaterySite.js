import { Linking } from 'react-native'
import { logContactEvent } from './logContactEvent'
import { CONTACT_LOGGING } from './eateryBasket'
import { eaterySiteCartUrl, eaterySiteCartLines, eateryBrandInk } from '../constants/eatery'
import { colors } from '../constants/theme'

// "Sipariş ver — <site>": a website partner's basket hand-off (20261157 / 20261159). One door for the basket page.
// lines = basketLines(...) of the VISIBLE menu. Every dish that goes into the cart link is logged once, BEFORE the browser opens
// (action 'order_website', its item_id; utils/logContactEvent never throws); quantities are not stored. A fixture partner has no real id and an
// inactive (Preview-only) row is not live: both log nothing.
// expo-web-browser is require()d INSIDE the function: it is a native module (see lib/connectivity.js openHandoff). Custom Tabs /
// SFSafariViewController keep the real address bar, so the user sees they are on the partner's site; a missing native module
// falls back to the system browser.
export async function openEaterySite(partner, lines = []) {
  const url = eaterySiteCartUrl(partner, lines)
  if (!url) return false
  for (const c of eaterySiteCartLines(lines)) if (CONTACT_LOGGING && !partner.placeholder && partner.is_active !== false) logContactEvent('eatery', partner.id, 'order_website', null, null, c.itemId)
  let WebBrowser = null
  try { WebBrowser = require('expo-web-browser') } catch { WebBrowser = null }
  // The system browser only when the native module is missing (an OTA on an older binary). A refused presentation (a browser
  // already open) is NOT retried in Safari: that would stack a second browser on the first.
  if (!WebBrowser?.openBrowserAsync) {
    try { await Linking.openURL(url); return true } catch { return false }
  }
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: eateryBrandInk(partner.brand_color) || colors.primary,   // the bar: Custom Tabs, SFSafariViewController
      controlsColor: colors.onPrimary,                                         // iOS buttons on that bar (never brand on brand)
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
      createTask: false,   // Android: the tab lives in ADA's task, not a throwaway one (default) that dies when the user leaves it
    })
    return true
  } catch {
    return false
  }
}
