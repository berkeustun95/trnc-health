import { t } from '../constants/i18n.js'
import { hasOwn, httpsUrl } from './photoAttribution.js'

export const SOURCE_LABEL = {
  commons:  'Wikimedia Commons',
  unsplash: 'Unsplash',
  pexels:   'Pexels',
}

const text = v => (typeof v === 'string' && v ? v : null)

// The exact strings and links PhotoCredit renders for a resolved attribution `a`. Every part is
// a string or null (never an object), a label comes from an own key only, a link is https only.
export function creditParts(a, lang) {
  const credit = text(a?.credit)
  const label  = a?.source === 'own' ? t('photoSourceOwn', lang) : hasOwn(SOURCE_LABEL, a?.source) ? SOURCE_LABEL[a.source] : null
  return {
    line:        credit ? `${t('photoCreditPrefix', lang)}: ${credit}` : null,
    license:     text(a?.license),
    licenseUrl:  httpsUrl(a?.licenseUrl),
    sourceLabel: text(label),
    sourceUrl:   httpsUrl(a?.sourceUrl),
  }
}
