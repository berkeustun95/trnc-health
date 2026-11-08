// Araçlar (cars). Plain Node-importable: no react-native, no expo (scripts/validate-i18n-coverage.mjs
// reads the label-key maps below, and scripts/test-cars-ui.mjs the pure helpers).
// Schema: supabase/migrations/20261165_vehicles.sql. Codes are stored and filtered; only the UI translates.

// ─── THE SELECT ─────────────────────────────────────────────────────────────
// vehicles has a COLUMN grant without owner_id, so every read names its columns — select('*'),
// even inside an embed, fails with 42501. Order and filter by these columns only, for the same reason.
export const VEHICLE_COLS = [
  'id, intent, source, dealer_id, make, model, year, km, fuel, gearbox, body_type, colour, steering',
  'price, currency, price_per_day, region, area, description, contact_phone, whatsapp, status, published_at, expires_at',
  'dealers(id, slug, name, logo_path, phone, whatsapp, region, area, website, is_rental_company)',
  'vehicle_images(id, storage_path, sort_order, is_primary)',
].join(', ')

export const DEALER_COLS = 'id, slug, name, logo_path, phone, whatsapp, region, area, website, is_rental_company'

export const VEHICLE_BUCKET = 'vehicle-images'
export const CARS_PAGE = 20

// ─── ENUM LABELS ────────────────────────────────────────────────────────────
export const FUEL_LABEL_KEY = {
  petrol: 'carsFuelPetrol', diesel: 'carsFuelDiesel', hybrid: 'carsFuelHybrid', electric: 'carsFuelElectric', lpg: 'carsFuelLpg',
}
export const GEARBOX_LABEL_KEY = { manual: 'carsGearManual', automatic: 'carsGearAutomatic' }
export const BODY_LABEL_KEY = {
  sedan: 'carsBodySedan', hatchback: 'carsBodyHatchback', suv: 'carsBodySuv', estate: 'carsBodyEstate', coupe: 'carsBodyCoupe',
  convertible: 'carsBodyConvertible', pickup: 'carsBodyPickup', van: 'carsBodyVan', minivan: 'carsBodyMinivan',
}
export const COLOUR_LABEL_KEY = {
  white: 'carsColourWhite', black: 'carsColourBlack', grey: 'carsColourGrey', silver: 'carsColourSilver', blue: 'carsColourBlue',
  red: 'carsColourRed', green: 'carsColourGreen', yellow: 'carsColourYellow', orange: 'carsColourOrange', brown: 'carsColourBrown',
  beige: 'carsColourBeige', gold: 'carsColourGold', purple: 'carsColourPurple', other: 'carsColourOther',
}
export const STEERING_LABEL_KEY = { right: 'carsSteeringRight', left: 'carsSteeringLeft' }
export const INTENT_LABEL_KEY = { sale: 'carsSale', rent: 'carsRent', all: 'carsAll' }
export const CAR_MODES = ['sale', 'rent', 'all']

// ─── PRICE ──────────────────────────────────────────────────────────────────
export const CURRENCY_SYMBOL = { GBP: '£', EUR: '€', USD: '$', TRY: '₺' }
export const CURRENCIES = ['GBP', 'TRY', 'EUR', 'USD']

// Grouped with commas in every language: the app's other price surfaces (Accommodation, Exchange
// rates) do the same, and two number conventions on one phone read as a bug.
export const groupDigits = n => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// The listing's OWN currency, never a converted figure. Rent is per day.
export function carPrice(car) {
  const amount = car.intent === 'rent' ? car.price_per_day : car.price
  if (amount == null) return null
  return `${CURRENCY_SYMBOL[car.currency] || `${car.currency} `}${groupDigits(amount)}`
}

// GBP bands per intent. [lo, hi): hi null = open-ended.
export const PRICE_BANDS = {
  sale: [[0, 5000], [5000, 10000], [10000, 20000], [20000, 35000], [35000, null]],
  rent: [[0, 25], [25, 40], [40, 60], [60, null]],
}
export const bandId = ([lo, hi]) => `${lo}-${hi ?? ''}`

// Units of TRY per one unit of `code`, from a parseKktcFx() payload: the middle of the transfer buy
// and sell rates (a price comparison, not a trade, so neither side's spread belongs in it). null when
// the feed lacks it — the caller must then treat the conversion as unavailable, never guess.
export function tryPerUnit(fx, code) {
  if (code === 'TRY') return 1
  const r = fx?.rates?.[code]
  if (!r) return null
  const { dovizAlis: a, dovizSatis: s } = r
  if (Number.isFinite(a) && Number.isFinite(s) && a > 0 && s > 0) return (a + s) / 2
  return null
}

// True only when every listing currency converts. A partial set would silently drop a currency's
// listings from a price-filtered list, which is the wrong-list failure the filter must never have.
export function fxComplete(fx) {
  return CURRENCIES.every(c => tryPerUnit(fx, c) != null)
}

const round2 = n => Math.round(n * 100) / 100

// The PostgREST or() string for one GBP band: each currency gets its own bounds converted at today's
// KKTC rate, so a £10,000 car and a ₺… car at the same value land in the same band. null = no filter
// possible (no band or incomplete rates).
export function priceOrFilter(intent, band, fx) {
  if (!band || (intent !== 'sale' && intent !== 'rent') || !fxComplete(fx)) return null
  const col = intent === 'rent' ? 'price_per_day' : 'price'
  const gbp = tryPerUnit(fx, 'GBP')
  const [lo, hi] = band
  return CURRENCIES.map(c => {
    const k = gbp / tryPerUnit(fx, c)
    const parts = [`currency.eq.${c}`]
    if (lo > 0) parts.push(`${col}.gte.${round2(lo * k)}`)
    if (hi != null) parts.push(`${col}.lt.${round2(hi * k)}`)
    return `and(${parts.join(',')})`
  }).join(',')
}

// ─── YEAR ───────────────────────────────────────────────────────────────────
// [from, to] inclusive; null = open.
export const YEAR_BANDS = [[2022, null], [2018, 2021], [2013, 2017], [2008, 2012], [null, 2007]]

// ─── PHOTOS ─────────────────────────────────────────────────────────────────
// Primary first, then sort_order (Accommodation's comparator).
export function sortedImages(images) {
  return [...(images || [])].sort((a, b) => (!!a.is_primary === !!b.is_primary
    ? (a.sort_order ?? 0) - (b.sort_order ?? 0)
    : (a.is_primary ? -1 : 1)))
}

// ─── CONTACT ────────────────────────────────────────────────────────────────
// The listing's own numbers first; a dealer listing with none falls back to the dealer's.
export function carContact(car) {
  const d = car?.dealers
  return { phone: car?.contact_phone || d?.phone || null, whatsapp: car?.whatsapp || d?.whatsapp || null }
}
// contact_events.region has a CHECK on the seven REGIONS slugs; vehicles.region only a length CHECK.
// Anything else goes as null, so an odd value can never get a tap row refused.
const REGION_SLUGS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz']
export const contactRegion = r => (REGION_SLUGS.includes(r) ? r : null)
export const telUrl = phone => `tel:${phone}`
export const waUrl = num => `https://wa.me/${String(num).replace(/\D/g, '')}`

// ─── THE CARS STACK (App.js) ────────────────────────────────────────────────
// Detail and dealer pages are layers over the list: list → car → dealer → another car. Opening a
// layer that is already in the stack pops back to it instead of stacking a copy, so dealer → car →
// dealer cannot grow without end and back always walks the way the user came.
// 'mine' (İlanlarım) is one page; 'post' is the form, keyed by the listing it edits ('new' for İlan ver).
export const layerKey = l => `${l.kind}:${
  l.kind === 'dealer' ? l.dealer?.id : l.kind === 'mine' ? '' : l.kind === 'post' ? (l.car?.id || 'new') : l.car?.id}`
export function pushCarsLayer(stack, layer) {
  const at = stack.findIndex(l => layerKey(l) === layerKey(layer))
  return at === -1 ? [...stack, layer] : stack.slice(0, at + 1)
}

// ─── POSTING (S3) ───────────────────────────────────────────────────────────
// The owner's own rows come from my_vehicles() (owner_id is not client-readable). Named columns, as everywhere.
export const MY_VEHICLE_COLS = [
  'id, intent, source, make, model, year, km, fuel, gearbox, body_type, colour, steering, price, currency, price_per_day',
  'region, area, description, contact_phone, whatsapp, status, rejection_reason, published_at, expires_at, hidden_at, created_at',
  'vehicle_images(id, storage_path, sort_order, is_primary)',
].join(', ')

export const MAX_PHOTOS = 8
export const OPEN_LISTING_CAP = 3
export const LISTING_DAYS = 30
// Renew shows from this many days before expiry (and on an expired listing). renew_vehicle() accepts any
// active listing; the window only keeps the button from being a reflex tap on a fresh listing.
export const RENEW_WINDOW_DAYS = 7
export const FUELS = Object.keys(FUEL_LABEL_KEY)
export const GEARBOXES = Object.keys(GEARBOX_LABEL_KEY)
export const BODIES = Object.keys(BODY_LABEL_KEY)
export const COLOURS = Object.keys(COLOUR_LABEL_KEY)
export const STEERINGS = Object.keys(STEERING_LABEL_KEY)
export const POST_INTENTS = ['sale', 'rent']

// The vehicles phone CHECK is ^\+?[0-9]{7,15}$. People type spaces, dashes and brackets, and a local 0533…
// number is a TRNC mobile: it becomes +90533…, so Ara and WhatsApp both work from any country. A leading 00
// is the international prefix. null = empty; false = not a number we can store.
export function normalizePhone(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return null
  if (!/^[+0-9()\-.\s]+$/.test(t)) return false
  let d = t.replace(/[^0-9+]/g, '')
  if (d.indexOf('+') > 0 || (d.match(/\+/g) || []).length > 1) return false
  if (d.startsWith('00')) d = `+${d.slice(2)}`
  else if (/^0[0-9]{10}$/.test(d)) d = `+90${d.slice(1)}`
  return /^\+?[0-9]{7,15}$/.test(d) ? d : false
}

// A positive whole number from a typed field ("12,500", "12.500", "12 500" all mean 12500). null = empty or not one.
export function parseAmount(raw) {
  const d = String(raw ?? '').replace(/[\s,.]/g, '')
  if (!/^[0-9]{1,9}$/.test(d)) return null
  const n = Number(d)
  return n > 0 ? n : null
}

export const CURRENT_YEAR = () => new Date().getFullYear()

// The first problem with the form, as an i18n key, or null. Mirrors the vehicles CHECKs so the server never has
// to be the one to say it. photoCount includes photos kept on an edit.
export function carFormError(f, photoCount, year = CURRENT_YEAR()) {
  if (!POST_INTENTS.includes(f.intent)) return 'carsPostErrIntent'
  if (!f.make?.trim()) return 'carsPostErrMake'
  if (!f.model?.trim()) return 'carsPostErrModel'
  const y = Number(f.year)
  if (!/^[0-9]{4}$/.test(String(f.year ?? '').trim()) || y < 1950 || y > year + 1) return 'carsPostErrYear'
  const km = String(f.km ?? '').replace(/[\s,.]/g, '')
  if (!/^[0-9]{1,7}$/.test(km) || Number(km) > 2000000) return 'carsPostErrKm'
  if (!FUELS.includes(f.fuel) || !GEARBOXES.includes(f.gearbox) || !BODIES.includes(f.body_type)
      || !COLOURS.includes(f.colour) || !STEERINGS.includes(f.steering)) return 'carsPostErrSpecs'
  const amount = parseAmount(f.price)
  if (amount == null || amount > (f.intent === 'rent' ? 1000000 : 100000000)) return 'carsPostErrPrice'
  if (!CURRENCIES.includes(f.currency)) return 'carsPostErrPrice'
  if (!f.region) return 'carsPostErrRegion'
  const phone = normalizePhone(f.phone)
  const wa = normalizePhone(f.whatsapp)
  if (phone === false || wa === false) return 'carsPostErrPhoneFormat'
  if (!phone && !wa) return 'carsPostErrContact'
  if ((f.description || '').length > 3000) return 'carsPostErrDescription'
  if (photoCount < 1) return 'carsPostErrPhotos'
  return null
}

// Exactly the 18 granted columns (20261165 INSERT/UPDATE grants). Never status, owner_id or source.
export function carPayload(f) {
  const amount = parseAmount(f.price)
  return {
    intent: f.intent, make: f.make.trim(), model: f.model.trim(), year: Number(f.year),
    km: Number(String(f.km).replace(/[\s,.]/g, '')), fuel: f.fuel, gearbox: f.gearbox, body_type: f.body_type,
    colour: f.colour, steering: f.steering,
    price: f.intent === 'sale' ? amount : null, price_per_day: f.intent === 'rent' ? amount : null,
    currency: f.currency, region: f.region, area: f.area?.trim() || null, description: f.description?.trim() || null,
    contact_phone: normalizePhone(f.phone) || null, whatsapp: normalizePhone(f.whatsapp) || null,
  }
}

// The form's starting values: a listing being edited, or a blank one with the seller's own number.
export function carForm(car, profilePhone = null) {
  if (!car) {
    return { intent: 'sale', make: '', model: '', year: '', km: '', fuel: null, gearbox: null, body_type: null,
      colour: null, steering: 'right', price: '', currency: 'GBP', region: null, area: '', description: '',
      phone: profilePhone || '', whatsapp: profilePhone || '' }
  }
  const amount = car.intent === 'rent' ? car.price_per_day : car.price
  return { intent: car.intent, make: car.make, model: car.model, year: String(car.year), km: String(car.km),
    fuel: car.fuel, gearbox: car.gearbox, body_type: car.body_type, colour: car.colour, steering: car.steering,
    price: amount == null ? '' : String(Math.round(Number(amount))), currency: car.currency, region: car.region,
    area: car.area || '', description: car.description || '', phone: car.contact_phone || '', whatsapp: car.whatsapp || '' }
}

// What İlanlarım shows. Hidden (reported) wins over every status but removed; an active row past its expiry reads as
// expired before the 02:40 cron sweeps it (the public read already hides it).
export function myCarState(car, now = Date.now()) {
  if (car.status === 'removed') return 'removed'
  if (car.hidden_at) return 'hidden'
  if (car.status === 'active' && car.expires_at && Date.parse(car.expires_at) <= now) return 'expired'
  return car.status
}
export const MY_STATE_LABEL_KEY = {
  pending: 'carsMinePending', active: 'carsMineActive', expired: 'carsMineExpired', rejected: 'carsMineRejected',
  removed: 'carsMineRemoved', hidden: 'carsMineHidden',
}
export const daysLeft = (car, now = Date.now()) =>
  car.expires_at ? Math.max(0, Math.ceil((Date.parse(car.expires_at) - now) / 86400000)) : null
export function canRenew(car, now = Date.now()) {
  const st = myCarState(car, now)
  if (st === 'expired') return true
  return st === 'active' && daysLeft(car, now) != null && daysLeft(car, now) <= RENEW_WINDOW_DAYS
}
export const canEdit = (car, now = Date.now()) => !['removed', 'hidden'].includes(myCarState(car, now))
export const openListingCount = (cars, now = Date.now()) =>
  cars.filter(c => c.source === 'private' && (c.status === 'pending' || (c.status === 'active' && myCarState(c, now) === 'active'))).length

// Server refusals (vehicles_guard, renew_vehicle, the photo guard, the word filters) → i18n keys.
export const CAR_ERROR_KEY = {
  VEHICLE_LIMIT: 'carsErrLimit', NO_DOB: 'carsErrNoDob', UNDER_18: 'carsErrUnder18', UGC_BANNED: 'contentBannedUser',
  NOT_SIGNED_IN: 'carsErrSignIn', VEHICLE_PHOTO_LIMIT: 'carsErrPhotoLimit', VEHICLE_REMOVED: 'carsErrGone',
  VEHICLE_NOT_FOUND: 'carsErrGone', VEHICLE_STATUS: 'carsErrStatus', VEHICLE_FIELD_LOCKED: 'carsErrStatus',
  BLOCKED_TERM: 'contentBlockedTerm', BLOCKED_PAYMENT: 'contentPaymentBlocked',
}
export function carErrorKey(error) {
  const m = String(error?.message || '')
  const code = Object.keys(CAR_ERROR_KEY).find(k => m.includes(k))
  return code ? CAR_ERROR_KEY[code] : 'carsErrGeneric'
}
// The message itself: carsErrLimit names the cap as {n}, so it can never drift from OPEN_LISTING_CAP.
export const carErrorText = (error, tr) => tr(carErrorKey(error)).replace('{n}', String(OPEN_LISTING_CAP))

// ─── PHOTO CLEANUP (scripts/cleanup-vehicle-photos.mjs) ─────────────────────
// When a private listing's photo files are deleted. removed is final (the owner cannot undo it); rejected can be
// fixed and resubmitted, and a hidden listing restored by an admin, so both keep their photos for a grace period.
// Expired listings are renewable and keep theirs. Dealer and imported listings are not touched (partner/… files).
export const CLEANUP_GRACE_DAYS = { removed: 3, rejected: 14, hidden: 30 }
// Files in a listing folder that no vehicle_images row points at (an upload whose row insert failed) go after a day.
export const ORPHAN_GRACE_HOURS = 24
export function photoCleanupReason(v, now = Date.now()) {
  if (v.source !== 'private') return null
  const older = (iso, days) => iso && now - Date.parse(iso) >= days * 86400000
  if (v.status === 'removed' && older(v.updated_at, CLEANUP_GRACE_DAYS.removed)) return 'removed'
  if (v.hidden_at && older(v.hidden_at, CLEANUP_GRACE_DAYS.hidden)) return 'hidden'
  if (v.status === 'rejected' && older(v.updated_at, CLEANUP_GRACE_DAYS.rejected)) return 'rejected'
  return null
}

// ─── REJECTION REASONS (admin Cars tab → İlanlarım) ─────────────────────────
// The admin picks a reason; the code is stored in rejection_reason and the seller reads it in their own language.
// A typed note is stored instead, verbatim. Anything that is not a known code is shown as written.
export const REJECT_REASON_KEY = {
  photos: 'carsRejectPhotos', price: 'carsRejectPrice', details: 'carsRejectDetails',
  duplicate: 'carsRejectDuplicate', contact: 'carsRejectContact', rules: 'carsRejectRules',
}
export const rejectionText = (reason, tr) => (REJECT_REASON_KEY[reason] ? tr(REJECT_REASON_KEY[reason]) : reason)
