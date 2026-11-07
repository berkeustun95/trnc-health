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
export const layerKey = l => `${l.kind}:${l.kind === 'car' ? l.car?.id : l.dealer?.id}`
export function pushCarsLayer(stack, layer) {
  const at = stack.findIndex(l => layerKey(l) === layerKey(layer))
  return at === -1 ? [...stack, layer] : stack.slice(0, at + 1)
}
