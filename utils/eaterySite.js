import { Linking } from 'react-native'
import { logContactEvent } from './logContactEvent'
import { CONTACT_LOGGING } from './eateryBasket'
import { eaterySiteCartUrl, eateryBrandInk } from '../constants/eatery'
import { colors } from '../constants/theme'

// "Sipariş ver — <site>": a website partner's basket hand-off (20261157 / 20261159). One door for the basket page.
// lines = basketLines(...) of the VISIBLE menu. Every line is logged BEFORE the browser opens (action 'order_website', the
// dish's item_id; utils/logContactEvent never throws); quantities are not stored. A fixture partner has no real id and an
// inactive (Preview-only) row is not live: both log nothing.
// expo-web-browser is require()d INSIDE the function: it is a native module (see lib/connectivity.js openHandoff). Custom Tabs /
// SFSafariViewController keep the real address bar, so the user sees they are on the partner's site; a missing native module
// falls back to the system browser.
export async function openEaterySite(partner, lines = []) {
  const url = eaterySiteCartUrl(partner, lines)
  if (!url) return false
  for (const l of lines) if (CONTACT_LOGGING && !partner.placeholder && partner.is_active !== false) logContactEvent('eatery', partner.id, 'order_website', null, null, l.id)
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
