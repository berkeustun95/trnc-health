// Ehliyet (driving schools). Plain Node-importable: no require() of images, no expo imports
// (scripts/test-ehliyet-ui.mjs loads this file). The logo KEY is resolved in constants/partnerAssets.js.

// Sampled from the partner's logo (assets/partners/seyhun/logo.png). The logo has no onDark variant:
// it only ever sits on a white surface.
export const EHLIYET_BRIGHT = '#294EA6'
export const EHLIYET_DARK   = '#213565'
// WhatsApp buttons use the dark brand green (white on #25D366 fails AA). No school has a number yet.
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
    phones: ['+90 533 854 39 99', '+90 533 887 39 99', '+90 539 107 39 99'],
    whatsapp: null,
    instagram_url: 'https://instagram.com/seyhunbikmazsoforokulu',
    featured: true,
    sort_order: 0,
    is_active: true,
    driving_school_branches: [
      { region: 'nicosia', lat: null, lng: null, sort_order: 0 },
      { region: 'morphou', lat: null, lng: null, sort_order: 1 },
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

export const hasWhatsApp = (school) => !!school?.whatsapp && String(school.whatsapp).replace(/\D/g, '').length > 0
export const whatsAppUrl = (school) => `https://wa.me/${String(school.whatsapp).replace(/\D/g, '')}`

export const sortedBranches = (school) =>
  [...(school?.driving_school_branches || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

// Instagram opens only a real https link; anything else hides the button.
export const hasInstagram = (school) => /^https:\/\/\S+$/.test(school?.instagram_url || '')
