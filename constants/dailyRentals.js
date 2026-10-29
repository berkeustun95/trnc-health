// Günlük Kiralık (daily rentals) — the third top tab of Emlak & Konaklama, and its one partner:
// North Houses (northcyprusbnb.com), four buildings in Lefkoşa, seven apartment types.
//
// A COPY OF THE DORM SHAPE, NOT A PARAMETRIZATION OF IT (decided 2026-10-28). Alasia's screens
// stay byte-untouched: dormWaMessage always appends a "Kaynak: ADA · Kod: ADA-…" line, the dorm
// screen draws a MapView from coordinates, and check-dorms.mjs asserts Alasia-only invariants
// over DORM_PARTNERS. North Houses has no code, no discount and no coordinates, so none of that
// applies; this module carries only what it needs.
//
// FREE LISTING, NO DEAL. There is no ADA code, no deal band and no ad slot. The WhatsApp text
// says where the guest came from and which apartment they mean, nothing else.
//
// NO COORDINATES, EVER, UNLESS THE PARTNER SENDS THEM. The building map links are their own
// Google short links (maps.app.goo.gl / share.google) opened as-is. A pin we resolved ourselves
// would be our guess at where they mean, shown on a partner's own listing. scripts/check-dorms.mjs
// walks this whole module and fails on any key named lat/lng/latitude/longitude/coords.
//
// Every displayable string is an i18n KEY (constants/i18n.js, `nh*`), except proper nouns:
// building names ('Tezer Plaza') are brand names and stay literal in all nine locales.
//
// Content is the site's own wording (EN and /tr verbatim, 2026-10-28); the other seven locales
// are faithful translations. Nothing was selected or edited: every apartment type, every
// amenity, every description and the check-in / check-out terms are as the site writes them.
//
// No react-native import and NO require(): plain data, so a Node guard can import it. Photo
// keys are resolved by constants/partnerAssets.js.

export const NORTH_HOUSES = {
  // ─── THE UUID IS THE CONTRACT, AND HERE NOTHING VERIFIES IT ─────────────
  // contact_events.entity_id is `uuid NOT NULL` with no foreign key, and a config-only partner
  // has no seed migration, so no verify_schema token asserts this value.
  //
  // ⚠ ONCE TAPS HAVE LANDED THIS MUST NEVER CHANGE. A new id does not fail — it silently
  //   orphans every row already counted against the old one, and the partner report restarts
  //   from zero.
  id:   'ee91c8c4-3c18-4ae2-9094-76c83c66e12a',
  // ⚠ THIS EXACT VALUE IS THE DB CHECK in partner_booking_requests (20261143) AND utm_campaign.
  slug: 'north_houses',

  name:    'North Houses',
  website: 'https://www.northcyprusbnb.com',
  email:   'book@northcyprusbnb.com',
  // ONE number for WhatsApp and calls (partner, 2026-10-29); wa.me takes its digits, Ara dials it as is.
  phone:   '+905338470666',

  logo:       'northhouses/logo',
  logoOnDark: null,

  taglineKey:  'nhTagline',
  heroSubKey:  'nhHeroSub',
  waHoursKey:  'nhWaHours',
  // The site's own price caveat, shown wherever a figure is.
  priceNoteKey: 'nhPriceNote',
  checkTitleKey: 'nhCheckTitle',
  checkInKey:    'nhCheckIn',
  checkOutKey:   'nhCheckOut',
  checkLateKey:  'nhCheckLate',
}

// ─── THE FOUR BUILDINGS, in the site's order ─────────────────────────────────
// `mapUrl` is THEIR link, opened as-is. `name` is a proper noun and is never translated.
export const NH_BUILDINGS = [
  { id: 'tezer',    name: 'Tezer Plaza',          blurbKey: 'nhBldTezer',    mapUrl: 'https://maps.app.goo.gl/6Ejg8MtNPTbRWPNu8' },
  { id: 'yasemin',  name: 'Yasemin Residens',     blurbKey: 'nhBldYasemin',  mapUrl: 'https://maps.app.goo.gl/to8CfXwjGYXZPoK87' },
  { id: 'mine',     name: 'Mine Apt',             blurbKey: 'nhBldMine',     mapUrl: 'https://maps.app.goo.gl/s6unWTFjT9nxptZY7' },
  { id: 'kaymakli', name: 'North Houses Kaymaklı', blurbKey: 'nhBldKaymakli', mapUrl: 'https://share.google/n86C6uuTgJerjpF3o' },
]
export const nhBuilding = id => NH_BUILDINGS.find(b => b.id === id)

// ─── THE SEVEN APARTMENT TYPES, in the site's order ──────────────────────────
//
// `slug` = the site's own path segment AND the partner_booking_requests.apartment CHECK, so it
// can never be renamed here without a migration. `key` is the short id used in i18n keys and
// asset keys (`nhAptY1Name`, `northhouses/y1-01`).
//
// kind 'studio' shows the Studio type and NO bedroom count. The Mine studio's JSON-LD says one
// bedroom while the page badges it Studio; the page is reproduced, not the JSON-LD.
//
// price = the nightly rate in the site's booking panel, shown as "from" next to the site's own
// "prices may vary" note. cleaningFee / deposit / minNights are the same panel's figures.
// amenityKeys are the site's list in the site's order (Kaymaklı's list is empty on the site in
// both languages: it shows none, nothing is invented).
const photos = key => Array.from({ length: 8 }, (_, i) => `northhouses/${key}-${String(i + 1).padStart(2, '0')}`)

export const NH_APARTMENTS = [
  {
    key: 'y1', slug: 'yasemin-2plus1', buildingId: 'yasemin', kind: 'twoPlusOne',
    nameKey: 'nhAptY1Name', descKey: 'nhAptY1Desc',
    bedrooms: 2, beds: { double: 2, single: 0 }, guests: 4,
    price: 60, cleaningFee: 50, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmDoubleEachRoom', 'nhAmAllRoomsAc', 'nhAmWorkArea', 'nhAmHotWater247', 'nhAmKitchen', 'nhAmSmartTv', 'nhAmWifiY1'],
    photos: photos('y1'),
  },
  {
    key: 'y2', slug: 'yasemin-2plus1-plus', buildingId: 'yasemin', kind: 'twoPlusOne',
    nameKey: 'nhAptY2Name', descKey: 'nhAptY2Desc',
    bedrooms: 2, beds: { double: 2, single: 0 }, guests: 4,
    price: 60, cleaningFee: 50, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmWifiNetflix', 'nhAmInverterAc', 'nhAmKitchen', 'nhAmWasher', 'nhAmParking', 'nhAmHotWater'],
    photos: photos('y2'),
  },
  {
    key: 'ys', slug: 'lefkosa-gunluk-kiralik-studio-daire', buildingId: 'yasemin', kind: 'studio',
    nameKey: 'nhAptYSName', descKey: 'nhAptYSDesc',
    bedrooms: null, beds: { double: 1, single: 0 }, guests: 2,
    price: 35, cleaningFee: 40, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmWifiNetflix', 'nhAmAc', 'nhAmKitchen', 'nhAmWasher', 'nhAmParking', 'nhAmHotWater'],
    photos: photos('ys'),
  },
  {
    key: 'ms', slug: 'lefkosa-gunluk-kiralik-studio-daire-dereboyu', buildingId: 'mine', kind: 'studio',
    nameKey: 'nhAptMSName', descKey: 'nhAptMSDesc',
    bedrooms: null, beds: { double: 1, single: 0 }, guests: 2,
    price: 40, cleaningFee: 40, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmFastWifiNetflix', 'nhAmAc', 'nhAmKitchen', 'nhAmWasher', 'nhAmParking', 'nhAmHotWater', 'nhAmAirport'],
    photos: photos('ms'),
  },
  {
    key: 't1', slug: 'lefkosa-gunluk-kiralik-daire-2-yatak-odali', buildingId: 'tezer', kind: 'twoPlusOne',
    nameKey: 'nhAptT1Name', descKey: 'nhAptT1Desc',
    bedrooms: 2, beds: { double: 2, single: 0 }, guests: 4,
    price: 60, cleaningFee: 50, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmWifiT1', 'nhAmNetflix', 'nhAmInverterAc', 'nhAmKitchen', 'nhAmWasher', 'nhAmParking', 'nhAmHotWater', 'nhAmKitchenEquip', 'nhAmLinen'],
    photos: photos('t1'),
  },
  {
    key: 'm1', slug: 'lefkosa-gunluk-kiralik-daire-iki-yatak-odali', buildingId: 'mine', kind: 'twoPlusOne',
    nameKey: 'nhAptM1Name', descKey: 'nhAptM1Desc',
    bedrooms: 2, beds: { double: 1, single: 2 }, guests: 4,
    price: 50, cleaningFee: 50, deposit: 100, minNights: 1,
    amenityKeys: ['nhAmWifiNetflix', 'nhAmAc', 'nhAmKitchen', 'nhAmWasher', 'nhAmParking', 'nhAmHotWater'],
    photos: photos('m1'),
  },
  {
    key: 'a4', slug: 'north-houses-aladag-sk-kucuk-kaymakli-lefkosa', buildingId: 'kaymakli', kind: 'twoPlusOne',
    nameKey: 'nhAptA4Name', descKey: 'nhAptA4Desc',
    bedrooms: 2, beds: { double: 2, single: 0 }, guests: 4,
    price: 45, cleaningFee: 50, deposit: 100, minNights: 2,
    amenityKeys: [],
    photos: photos('a4'),
  },
]

export const NH_SLUGS = NH_APARTMENTS.map(a => a.slug)

// "From €35 a night" (the site's hero line) is the cheapest apartment, derived so it cannot
// drift from the cards below it.
export const NH_FROM_PRICE = Math.min(...NH_APARTMENTS.map(a => a.price))

// ─── WHATSAPP ────────────────────────────────────────────────────────────────
//
// ⚠ ALWAYS TURKISH, whatever the app language: the partner reads it, not the guest (the
//   Sepetim convention, constants/eatery.js). The caller resolves the apartment's TURKISH name
//   with t(nameKey, 'Turkish') and passes it in, so this module stays i18n-free.
// ⚠ NO CODE, NO "Kaynak/Kod" LINE, NO DISCOUNT: this is a free listing, not a deal.
// Not in i18n.js, for the same reason dorms.js keeps its WA text out of it: it is not UI.
export const NH_WA_NUMBER = NORTH_HOUSES.phone.replace(/\D/g, '')

export const nhWaUrl = message => `https://wa.me/${NH_WA_NUMBER}?text=${encodeURIComponent(message)}`

const nhWaLead = (aptNameTr, buildingName) =>
  `Merhaba, ADA uygulamasından yazıyorum. "${aptNameTr}" (${buildingName})`

export function nhWaMessage(aptNameTr, buildingName) {
  return `${nhWaLead(aptNameTr, buildingName)} için rezervasyon hakkında bilgi almak istiyorum.`
}

// The apartment's page on their site. Turkish gets /tr/daireler/<slug> (the site 307s that to
// its canonical /tr/apartments/<slug>), everyone else the English page. utm_campaign is the
// partner slug and utm_content the apartment, so their own analytics can see ADA as a source
// and which apartment was opened — a query string, no SDK, nothing stored on our side.
export function nhWebsiteUrl(apartment, langCode) {
  if (!apartment) return null
  const path = langCode === 'tr' ? `/tr/daireler/${apartment.slug}` : `/apartments/${apartment.slug}`
  const u = new URL(NORTH_HOUSES.website + path)
  u.searchParams.set('utm_source', 'ada')
  u.searchParams.set('utm_medium', 'app')
  u.searchParams.set('utm_campaign', NORTH_HOUSES.slug)
  u.searchParams.set('utm_content', apartment.slug)
  return u.toString()
}

// ─── THE REQUEST FORM (gated by NORTH_HOUSES_FORM_LIVE) ──────────
//
// Bounds are the database's (partner_booking_requests, 20261143): check_out > check_in, at most
// 90 nights, guests 1..12. The client refuses what the table would refuse, so the form's
// disabled state and the DB agree.
export const NH_MAX_NIGHTS = 90
export const NH_MIN_GUESTS = 1
export const NH_MAX_GUESTS = 12

// 'DD.MM.YYYY' (separators . / - or none after the digits are formatted) -> 'YYYY-MM-DD', or
// null when it is not a REAL calendar date (31.02 is refused, not rolled into March).
export function nhParseDate(text) {
  const m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(String(text || '').trim())
  if (!m) return null
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Per-device throttle on SAVED requests (the WhatsApp message is never throttled). `stamps` = ms
// timestamps of earlier saved requests, kept on the phone only. -> { allowed, stamps }, where
// `stamps` is the pruned list (<= 24 h old, capped) with `now` appended when allowed.
export const NH_LIMIT_HOUR = 3
export const NH_LIMIT_DAY = 10
export function nhRequestLimit(stamps, now) {
  const day = 24 * 3600 * 1000, hour = 3600 * 1000
  const kept = (Array.isArray(stamps) ? stamps : [])
    .filter(x => Number.isFinite(x) && x <= now && now - x < day).slice(-NH_LIMIT_DAY)
  const allowed = kept.filter(x => now - x < hour).length < NH_LIMIT_HOUR && kept.length < NH_LIMIT_DAY
  return { allowed, stamps: allowed ? [...kept, now] : kept }
}

export const nhNights = (checkInIso, checkOutIso) =>
  Math.round((Date.parse(`${checkOutIso}T00:00:00Z`) - Date.parse(`${checkInIso}T00:00:00Z`)) / 86400000)

// -> { checkIn, checkOut, guests, datesOk, guestsOk, contactOk, ok }. `checkIn` / `checkOut` are
// ISO or null. A phone needs 7+ digits and a name 2+ characters: enough to be reachable, not a
// validation of who they are.
export function nhValidateRequest({ checkInText, checkOutText, guestsText, name, phone }) {
  const checkIn = nhParseDate(checkInText)
  const checkOut = nhParseDate(checkOutText)
  const nights = checkIn && checkOut ? nhNights(checkIn, checkOut) : null
  const datesOk = nights != null && nights >= 1 && nights <= NH_MAX_NIGHTS
  const guests = /^\d{1,2}$/.test(String(guestsText || '').trim()) ? Number(guestsText) : null
  const guestsOk = guests != null && guests >= NH_MIN_GUESTS && guests <= NH_MAX_GUESTS
  const contactOk = String(name || '').trim().length >= 2 && String(phone || '').replace(/\D/g, '').length >= 7
  return { checkIn, checkOut, guests, datesOk, guestsOk, contactOk, ok: datesOk && guestsOk && contactOk }
}

const dmy = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

// ALWAYS TURKISH, like the listing text. Name and phone go to the partner in this message only;
// the row sent to our own table (screens/NorthHousesApartmentScreen.js) never carries them.
export function nhRequestMessage({ aptNameTr, buildingName, checkIn, checkOut, guests, name, phone }) {
  return [
    `${nhWaLead(aptNameTr, buildingName)} için rezervasyon talebi:`,
    `Giriş: ${dmy(checkIn)}`,
    `Çıkış: ${dmy(checkOut)}`,
    `Misafir sayısı: ${guests}`,
    `Ad: ${String(name).trim()}`,
    `Telefon: ${String(phone).trim()}`,
  ].join('\n')
}
