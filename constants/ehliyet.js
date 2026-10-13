// Ehliyet (driving schools). Plain Node-importable: no require() of images, no expo imports
// (scripts/test-ehliyet-ui.mjs loads this file). The logo KEY is resolved in constants/partnerAssets.js.

// Sampled from the partner's logo (assets/partners/seyhun/logo.png). The logo has no onDark variant:
// it only ever sits on a white surface.
export const EHLIYET_BRIGHT = '#294EA6'
export const EHLIYET_DARK   = '#213565'
// WhatsApp buttons use the dark brand green (white on #25D366 fails AA).
export const EHLIYET_WA     = '#075E54'

// ─── Preview fixture, and why it exists ─────────────────────────────────────
// Before go-live the seed row is is_active = false (and the tables are not applied in prod yet), and
// RLS on driving_schools returns active rows only, so a query from dev or ADA Preview returns
// nothing at all: the screen would sit on its error state and nobody could review it. Making the row
// readable would publish it for every user the moment the table lands. So dev and Preview read this
// copy instead, through the same screen and components; only the source of the row differs.
// Same shape as the select: school columns, branches nested under driving_school_branches.
// ⚠ Mirror of the seed row in supabase/migrations/20261108_driving_schools.sql, guarded by
//   scripts/check-ehliyet-fixture.mjs (run by test-ehliyet-ui.mjs). Fixture rows never log contact events.
export const PREVIEW_DRIVING_SCHOOLS = [
  {
    id: '7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17',
    name: 'Seyhun Bıkmaz Şoför Okulu',
    logo_key: 'seyhun/logo',
    phones: ['+90 533 887 39 99'],
    whatsapp: '+90 533 887 39 99',
    instagram_url: 'https://instagram.com/seyhunbikmazsoforokulu',
    facebook_url: 'https://www.facebook.com/seyhunbikmazsoforokulu',
    email: 'seyhunbikmazsoforokulu@gmail.com',
    licence_classes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'H1', 'H2', 'J', 'K'],
    featured: true,
    sort_order: 0,
    is_active: true,
    driving_school_branches: [
      { region: 'nicosia', address: 'Şehit Fevait Ali Sokak 4/B, Göçmenköy, Lefkoşa', lat: null, lng: null, geocode_source: null, sort_order: 0 },
      { region: 'morphou', address: null, lat: null, lng: null, geocode_source: null, sort_order: 1 },
    ],
  },
]

// The fixture rule: the flag is still off, but dev / ADA Preview has the screen open (EHLIYET).
// Otherwise the screen queries. `flagLive` = MODULE_FLAGS.ehliyet, `screenOn` = EHLIYET.
export const usesFixture = (flagLive, screenOn) => !flagLive && !!screenOn

// The contact_events 'ehliyet' CHECK lives in its own migration; if that file is dropped, set this false.
export const EHLIYET_LOGS_CONTACTS = true

// Contact taps are measured for database rows only.
export const shouldLogContact = (fromFixture) => EHLIYET_LOGS_CONTACTS && !fromFixture

export const telUrl = (phone) => `tel:${String(phone).replace(/\s+/g, '')}`
// "Ara" dials phones[0]; the DB allows several numbers, the card shows one button.
export const primaryPhone = (school) => (school?.phones || [])[0] || null

export const hasWhatsApp = (school) => !!school?.whatsapp && String(school.whatsapp).replace(/\D/g, '').length > 0
export const whatsAppUrl = (school) => `https://wa.me/${String(school.whatsapp).replace(/\D/g, '')}`

export const sortedBranches = (school) =>
  [...(school?.driving_school_branches || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

// Instagram opens only a real https link; anything else hides the button.
export const hasInstagram = (school) => /^https:\/\/\S+$/.test(school?.instagram_url || '')

// Facebook: same https-only rule as Instagram.
export const hasFacebook = (school) => /^https:\/\/\S+$/.test(school?.facebook_url || '')

// E-mail link hides when null or malformed (the DB CHECK is looser than a tap target should be).
export const hasEmail = (school) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(school?.email || '')
export const mailtoUrl = (school) => `mailto:${school.email}`
// Display only: a zero-width space after '@' gives the row a break point so a long address wraps as "local@" / "domain" instead of mid-word.
export const emailDisplay = (email) => (email || '').replace('@', '@\u200B')

export const licenceClasses = (school) => (school?.licence_classes || []).filter(Boolean)

// Branch street address (text only: a branch has no pin unless OSM corroborated one).
export const branchAddress = (branch) => String(branch?.address || '').trim()
// Same search URL as the hotels' Harita button (components/accommodation/HotelsTab.js): a text search, never a pin.
export const mapsSearchUrl = (address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, North Cyprus`)}`
