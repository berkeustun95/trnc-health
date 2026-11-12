// Bandabuliya (marketplace): users sell their own items to each other. Plan: vault
// 10-ada/2026-11-07_marketplace-plan.md. The database is 20261183 (listings, photos) and 20261184 (chat).
import { HS_DISTRICTS, HS_DISTRICT_LABEL_KEY } from './homeServices'
import { ADULT_AGE } from './profileGate'

// Mirrors marketplace_listings_category_check (20261183). No vehicles (Araçlar) and no real estate (Emlak).
export const MK_CATEGORIES = [
  { key: 'electronics',   labelKey: 'mkCatElectronics',  icon: 'phone-portrait-outline' },
  { key: 'home',          labelKey: 'mkCatHome',         icon: 'bed-outline' },
  { key: 'appliances',    labelKey: 'mkCatAppliances',   icon: 'snow-outline' },
  { key: 'fashion',       labelKey: 'mkCatFashion',      icon: 'shirt-outline' },
  { key: 'baby_kids',     labelKey: 'mkCatBabyKids',     icon: 'happy-outline' },
  { key: 'sports',        labelKey: 'mkCatSports',       icon: 'bicycle-outline' },
  { key: 'books',         labelKey: 'mkCatBooks',        icon: 'book-outline' },
  { key: 'hobby_music',   labelKey: 'mkCatHobbyMusic',   icon: 'musical-notes-outline' },
  { key: 'garden_diy',    labelKey: 'mkCatGardenDiy',    icon: 'leaf-outline' },
  { key: 'vehicle_parts', labelKey: 'mkCatVehicleParts', icon: 'construct-outline' },
  { key: 'pet_supplies',  labelKey: 'mkCatPetSupplies',  icon: 'paw-outline' },
  { key: 'other',         labelKey: 'mkCatOther',        icon: 'cube-outline' },
]
export const MK_CATEGORY = Object.fromEntries(MK_CATEGORIES.map(c => [c.key, c]))

// marketplace_listings_condition_check.
export const MK_CONDITIONS = [
  { key: 'new',      labelKey: 'mkCondNew' },
  { key: 'like_new', labelKey: 'mkCondLikeNew' },
  { key: 'used',     labelKey: 'mkCondUsed' },
]
export const MK_CONDITION = Object.fromEntries(MK_CONDITIONS.map(c => [c.key, c]))

// The six official districts, marketplace_listings_district_check (Karpaz sellers pick İskele).
export const MK_DISTRICTS = HS_DISTRICTS.map(key => ({ key, labelKey: HS_DISTRICT_LABEL_KEY[key] }))

// The table's CHECK bounds; the form validates the same numbers before it sends anything.
export const MK_TITLE_MIN = 5
export const MK_TITLE_MAX = 70
export const MK_DESC_MIN = 10
export const MK_DESC_MAX = 1500
export const MK_PRICE_MAX = 1000000
export const MK_PHOTOS_MAX = 8
export const MK_RENEW_WINDOW_DAYS = 3

export const MK_BUCKET = 'marketplace-photos'
export const MK_SIGNED_URL_TTL = 3600
// The safety notice's version, stamped by accept_marketplace_notice() (YYYY-MM-DD). Bump it when mkNoticeBody changes in
// any language; a user who accepted an older version is asked again before their next chat.
export const MK_NOTICE_VERSION = '2026-11-09'
export const MK_LISTING_COLUMNS =
  'id, owner_id, title, description, price_tl, is_free, category, condition, district, status, sold_at, created_at, bumped_at, expires_at, hidden_at'

// UI only: whether to offer "İlan ver". The boundary is the server (i_am_adult(), 20261183); an unknown
// date of birth is "not adult" there too.
export function isAdultDob(dob, today = new Date()) {
  if (!dob) return false
  const [y, m, d] = String(dob).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return false
  const cutoff = new Date(today.getFullYear() - ADULT_AGE, today.getMonth(), today.getDate())
  return new Date(y, m - 1, d) <= cutoff
}

const NUM = { Turkish: 'tr-TR', English: 'en-GB', German: 'de-DE', French: 'fr-FR', Spanish: 'es-ES',
              Russian: 'ru-RU', Greek: 'el-GR', Arabic: 'ar', Persian: 'fa' }
export function formatPrice(listing, lang, t) {
  if (listing.is_free) return t('mkFree', lang)
  let n
  try { n = new Intl.NumberFormat(NUM[lang] || 'tr-TR').format(listing.price_tl) } catch { n = String(listing.price_tl) }
  return `${n} TL`
}

export function daysUntil(iso, now = Date.now()) {
  return Math.ceil((new Date(iso).getTime() - now) / 86400000)
}
export const isExpired = l => new Date(l.expires_at).getTime() <= Date.now()
export const canRenew = l => daysUntil(l.expires_at) <= MK_RENEW_WINDOW_DAYS

// The seller's own view of a listing: one state, in this order of precedence.
export function listingState(l) {
  if (l.hidden_at) return 'hidden'
  if (l.status === 'sold') return 'sold'
  if (isExpired(l)) return 'expired'
  return 'live'
}

// Maps a server error word to a string; never raw Postgres text on screen.
const ERROR_KEY = {
  NOT_ADULT: 'mkErrNotAdult', NO_DISPLAY_NAME: 'mkErrNoDisplayName', LISTING_RATE_LIMIT: 'mkErrRateLimit',
  ACTIVE_LISTING_LIMIT: 'mkErrActiveLimit', BLOCKED_TERM: 'mkErrBlockedTerm', UGC_BANNED: 'mkErrBanned',
  PHOTO_LIMIT: 'mkErrPhotoLimit', TOO_EARLY_TO_RENEW: 'mkErrTooEarly', NO_SUCH_LISTING: 'mkErrGone',
}
// Chat codes only a listing thread has (20261184). Everything else falls through to the Student Hub mapping.
const CHAT_ERROR_KEY = { OWN_LISTING: 'mkChatOwnListing', NO_SUCH_LISTING: 'mkChatListingGone', NOTICE_REQUIRED: 'mkNoticeRequired' }
export function mkChatErrorKey(err) {
  const msg = String(err?.message || '')
  const hit = Object.keys(CHAT_ERROR_KEY).find(k => msg.includes(k))
  return hit ? CHAT_ERROR_KEY[hit] : null
}

// The server's terms floor (20261190) refused the call. Not an error line: the screens re-open the terms gate.
export const isTermsRequired = err => String(err?.message || err || '').includes('TERMS_REQUIRED')

export function mkErrorKey(err) {
  const msg = String(err?.message || err || '')
  const hit = Object.keys(ERROR_KEY).find(k => msg.includes(k))
  return hit ? ERROR_KEY[hit] : 'mkErrGeneric'
}
