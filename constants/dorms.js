// Dorm partners (Yurtlar) — the segment row of Emlak & Konaklama, and the partners in it.
//
// PARTNER-ONLY BY CONSTRUCTION. There is no dorms table, no self-registration and no
// admin UI: a dorm partnership is a signed agreement, so it is a config entry plus assets
// and nothing else. Partner #2 is one entry in DORM_PARTNERS — no screen code.
//
// ─── WHY THERE IS NO TABLE ──────────────────────────────────────────────────
// TadilArt needed a `home_services` ROW because that table already existed as an open,
// self-registered directory that had to be gated DOWN (is_partner, 20261012). Dorms have
// no such table to gate, so a row would exist only to be read back by us.
//
// The decisive reason is i18n. Room names and service lists need all nine locales, and a
// `text` column holds one — the same conclusion constants/partners.js reached for
// TadilArt's tagline and about block. Every displayable string here is therefore an i18n
// KEY, and the content lives in constants/i18n.js alongside every other nine-locale
// string. A row would have held only the non-translatable scalars, leaving the content in
// two places with nothing keeping them in step.
//
// THE COST, CHOSEN KNOWINGLY: a dorm is NOT in `search_content`, so a global search for
// "yurt" finds nothing. That is the safe direction rather than a regression —
// search_content ignores MODULE_FLAGS, so a table would have made Alasia globally
// findable while the segment was still dark, which is the hazard CLAUDE.md records.
// Revisit at partner #2, when a table starts earning its keep for other reasons.
//
// No react-native import and NO require(): plain data only, so a Node-side guard can
// import this module. Assets are KEYS resolved by constants/partnerAssets.js — the same
// split, for the same reason, that constants/partners.js and constants/ads.js carry.

// ─── THE SEGMENT ROW, AS DATA ───────────────────────────────────────────────
//
// Order and promotion are config, not code, so reverting the Yurtlar promotion is an edit
// to this array and nothing else. `promoted` draws an accent dot when the chip is NOT
// selected; it does not change the chip's shape or size — the dot is absolutely
// positioned in AccommodationScreen, because laid out inline it would widen the chip and
// break the one thing the brief pinned down about it.
//
// 'dorm' AND 'all' ARE BOTH PSEUDO-INTENTS. Neither is a `properties.intent` value and
// neither is ever sent as one: 'all' omits the .eq() filter, and 'dorm' skips the
// properties query altogether and renders DORM_PARTNERS instead. That is why this segment
// needed no migration and properties_intent_check is untouched.
export const ACCOM_SEGMENTS = [
  { id: 'dorm', promoted: true },
  { id: 'sale' },
  { id: 'rent' },
  { id: 'short_term' },
  { id: 'all' },
]

// The tab the module OPENS on. Config, so reverting to 'sale' is one word here.
export const ACCOM_LANDING = 'dorm'

// DORMS_LIVE is INJECTED rather than imported, so this module stays pure data a Node
// harness can drive with either value — the same reason partnerGallery() takes its
// resolver as an argument instead of importing it.
export const accomSegments = dormsLive =>
  ACCOM_SEGMENTS.filter(s => s.id !== 'dorm' || dormsLive)

// ⚠ THE LANDING TAB MUST BE DERIVED, NEVER READ STRAIGHT OFF ACCOM_LANDING.
//
// ACCOM_LANDING is 'dorm' and DORMS_LIVE ships false, so taking the constant literally
// would open the module on a tab that is not in the chip row: an empty list under a
// selection the user can neither see nor change, in production, from the first OTA that
// carries this file. Falling back to the first VISIBLE segment makes the dark state
// correct by construction — it resolves to 'sale', which is exactly where the module
// opened before this segment existed — and it needs no second constant to keep in step
// with this one.
export function accomLanding(dormsLive) {
  const visible = accomSegments(dormsLive)
  return visible.some(s => s.id === ACCOM_LANDING) ? ACCOM_LANDING : visible[0].id
}

// ─── THE PARTNERS ───────────────────────────────────────────────────────────
export const DORM_PARTNERS = [
  {
    // ─── THE UUID IS THE CONTRACT, AND HERE NOTHING VERIFIES IT ─────────────
    // contact_events.entity_id is `uuid NOT NULL`, so a config-only partner still needs a
    // stable id to log taps against. Unlike TadilArt there is no seed migration, so no
    // verify_schema H-token can assert it and nothing anywhere will notice if it changes.
    //
    // ⚠ ONCE TAPS HAVE LANDED THIS MUST NEVER CHANGE. contact_events.entity_id is
    //   polymorphic and deliberately has NO foreign key, so a new id does not fail — it
    //   silently orphans every row already counted against the old one, and the partner
    //   report quietly restarts from zero.
    id:   'da75b3f5-7f2c-483d-a572-fdb25a835ff7',
    slug: 'alasia-dorm',

    // ONE source for both the WhatsApp "Kod: ADA-ALS-<ROOM>" suffix and utm_campaign, so
    // the two cannot drift apart. Never inline the string in either builder.
    code: 'ALS',

    // The display name. No DB row owns it, so this is the only place it exists.
    name: 'Alasia Dorm',

    website:  'https://alasiadorm.com',
    // ⚠ ONE NUMBER SERVING BOTH BUTTONS, PENDING CONFIRMATION. Özok has not yet said
    //   whether reception takes calls on the WhatsApp line or a separate landline. If a
    //   landline arrives, `phone` changes and `whatsapp` does not.
    phone:    '+90 548 888 69 65',
    whatsapp: '+90 548 888 69 65',

    // District is a canonical region key (constants/regions.js) and IS translated via
    // REGION_LABEL_KEY. The area is NOT: constants/areas.js states the rule — area names
    // are proper nouns, identical in all nine locales, never translated. So it is a
    // literal here rather than an i18n key.
    //
    // NOT added to AREAS_BY_REGION.nicosia on purpose: that list feeds the property
    // filter dropdown, and adding a neighbourhood with no property listings in it would
    // put a dead option in front of every user to serve one dorm.
    district: 'nicosia',
    area:     'Aşağı Dikmen',

    // Owed by Özok. Null means the map section does not render at all — "Aşağı Dikmen,
    // Lefkoşa" is a neighbourhood, not a pin, and geocoding it to a district centre would
    // put a WRONG pin on a partner's own showcase, which is worse than no map.
    coords: null,

    // Asset KEYS, not files. constants/partnerAssets.js is the only place a key becomes a
    // require(). An unwired key yields undefined and PartnerLogoStrip falls back to a
    // monogram — a finished state, not a placeholder box.
    logo:       'alasia/logo',
    logoOnDark: 'alasia/logo-onDark',

    // Owed. Null falls back to ADA teal wherever an accent is drawn.
    accent: null,

    // ─── VERIFIED, BUT NOT YET RENDERABLE ───────────────────────────────────
    // "From €2490" is the one price Özok has given, and it is meaningless until they say
    // what a dönem is — academic year, semester, or a month count differ by up to 12x.
    // periodKey null therefore means DO NOT RENDER, by the same collapse-when-absent rule
    // every other section follows, rather than shipping a number a reader would have to
    // guess at. Currency is also unconfirmed (€ only, or GBP/TL too).
    priceFrom: { amount: 2490, currency: 'EUR', periodKey: null },

    aboutKey: 'dormAlasiaAbout',

    // Owed: { textKey, expiry: 'YYYY-MM-DD' }. BOTH are required — the band renders only
    // when the text exists AND the expiry is still in the future, so a config entry that
    // is never touched again expires itself with no OTA.
    deal: null,

    // ⚠ VERIFIED AS MINUTES, NOT AS DESTINATIONS. Özok gave "5 dk Lefkoşa / 15 dk Girne /
    //   15 dk Ercan" — but a student picks a dorm by which UNIVERSITY the shuttle reaches,
    //   and a city is not a campus. The labels below are the cities as given; naming the
    //   universities is on the owed list and will replace these keys, not add to them.
    transport: [
      { icon: 'bus-outline',      labelKey: 'dormShuttleNicosia', minutes: 5  },
      { icon: 'bus-outline',      labelKey: 'dormShuttleKyrenia', minutes: 15 },
      { icon: 'airplane-outline', labelKey: 'dormShuttleErcan',   minutes: 15 },
    ],

    amenities: [],   // owed

    // The six room types are verified; every field on them except the code and the name
    // is owed. `code` is what reaches reception in the WhatsApp message as
    // ADA-ALS-<CODE>, so it is pending their sign-off — a code the desk does not
    // recognise makes the handoff worse than no code at all.
    rooms: [
      { code: 'BNG1', nameKey: 'dormRoomBungalow1', price: null, sqm: null, available: null },
      { code: 'BNG2', nameKey: 'dormRoomBungalow2', price: null, sqm: null, available: null },
      { code: 'BNG4', nameKey: 'dormRoomBungalow4', price: null, sqm: null, available: null },
      { code: 'BLK1', nameKey: 'dormRoomBlock1',    price: null, sqm: null, available: null },
      { code: 'BLK2', nameKey: 'dormRoomBlock2',    price: null, sqm: null, available: null },
      { code: 'BLK3', nameKey: 'dormRoomBlock3',    price: null, sqm: null, available: null },
    ],

    gallery:          [],   // owed — hero gallery does not render while empty
    servicesIncluded: [],   // owed
    servicesExtra:    [],   // owed
    ringTimes:        [],   // owed
    events:           [],   // owed

    operatorKey: 'dormOperatorOzok',
  },
]

export const DORM_PARTNER_IDS = DORM_PARTNERS.map(p => p.id)

const BY_ID = Object.fromEntries(DORM_PARTNERS.map(p => [p.id, p]))
export const dormPartner = id => BY_ID[id]
