import { LANG_CODES, t } from '../constants/i18n.js'

// ─── Amounts on screen — the ONE formatter ───────────────────────────────────
// Digit grouping follows the APP language, never the device and never a hardcoded 'en-GB':
// Turkish UI "£129.000", English "£129,000". Arabic and Persian get their own digits, exactly as
// dates already do (constants/i18n.js dateLocale). Every user-facing price goes through here:
// Konaklama, the property page, the agent dashboard, Döveç, Yeme-İçme, Bağlantı.
// `npm run money:check` pins the output. Plain JS (no React Native import) so Node can test it.

export const numberLocale = lang => (lang === 'English' ? 'en-GB' : LANG_CODES[lang] || 'en-GB')

// decimals: the most fraction digits to show; a whole number always renders bare ("1.499", not "1.499,00").
export function formatAmount(value, lang, { decimals = 0 } = {}) {
  // null / '' BEFORE Number(): Number(null) is 0, and a missing price must never read as free.
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const opts = { minimumFractionDigits: decimals && !Number.isInteger(n) ? decimals : 0, maximumFractionDigits: decimals }
  try {
    return n.toLocaleString(numberLocale(lang), opts)
  } catch {
    // A stripped ICU build: ungrouped digits are still a correct number.
    return decimals && !Number.isInteger(n) ? n.toFixed(decimals) : String(Math.round(n))
  }
}

export const CURRENCY_SYMBOL = { GBP: '£', EUR: '€', USD: '$', TRY: '₺' }

// "£129.000" — symbol first, as every ADA price card has always shown it.
export function moneyText(amount, currency, lang) {
  const body = formatAmount(amount, lang)
  if (body == null) return null
  return `${CURRENCY_SYMBOL[currency] || (currency ? `${currency} ` : '')}${body}`
}

// 'total' has no suffix on purpose; every other period needs one, or a yearly rent reads as a sale price.
const PERIOD_SUFFIX_KEY = {
  monthly: 'accomPerMonth', weekly: 'accomPerWeek', yearly: 'accomPerYear', nightly: 'accomPerNight',
}

// A listing's headline price (properties row shape). price_on_request rows — any source, not only
// Döveç (20261153: price IS NULL exactly when price_on_request) — read "Call for price", never "£null".
export function propertyPriceText(p, lang) {
  if (p?.price_on_request === true) return t('accomPriceOnRequest', lang)
  const money = moneyText(p?.price, p?.currency, lang)
  if (money == null) return null
  const key = PERIOD_SUFFIX_KEY[p?.price_period]
  return `${money}${key ? t(key, lang) : ''}`
}
