import { Linking } from 'react-native'
import { logContactEvent } from './logContactEvent'
import { CONTACT_LOGGING } from './eateryBasket'
import { eaterySiteOrderUrl, eateryBrandInk } from '../constants/eatery'
import { colors } from '../constants/theme'

// "Sitede sipariş ver": a website partner's order hand-off (20261157). One door for the partner page and the quiz.
// The tap is logged BEFORE the browser opens (action 'order_website', the dish when there is one; utils/logContactEvent never
// throws). A fixture partner has no real id and an inactive (Preview-only) row is not live: both log nothing.
// expo-web-browser is require()d INSIDE the function: it is a native module (see lib/connectivity.js openHandoff). Custom Tabs /
// SFSafariViewController keep the real address bar, so the user sees they are on the partner's site; a missing native module
// falls back to the system browser.
export async function openEaterySite(partner, itemId = null) {
  const url = eaterySiteOrderUrl(partner)
  if (!url) return false
  if (CONTACT_LOGGING && !partner.placeholder && partner.is_active !== false) logContactEvent('eatery', partner.id, 'order_website', null, null, itemId)
  try {
    const WebBrowser = require('expo-web-browser')
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: eateryBrandInk(partner.brand_color) || colors.primary,   // the bar: Custom Tabs, SFSafariViewController
      controlsColor: colors.onPrimary,                                         // iOS buttons on that bar (never brand on brand)
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
    })
    return true
  } catch {
    try {
      await Linking.openURL(url)
      return true
    } catch {
      return false
    }
  }
}
