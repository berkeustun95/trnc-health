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
    email:    'info@alasiadorm.com',
    // Verbatim, as they publish it. A street address is a proper noun and is not translated.
    address:  'Lefkoşa Caddesi No:80, Aşağı Dikmen, Lefkoşa',
    // ⚠ THEIR OWN MAPS LINK, used as the directions target rather than a coordinate we
    //   resolved ourselves. A short link resolves to a pin Alasia chose; a lat/lng we
    //   derived is our guess at where they mean. `coords` stays null until they send one,
    //   so the embedded map still does not render — this is the DIRECTIONS button only.
    mapsUrl:  'https://maps.app.goo.gl/W5MWpGWm8aNHw5gq8',
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
    // require(). An unwired key yields undefined and PartnerLogoStrip renders NOTHING —
    // it used to draw an initials monogram, which read as an "AD" ad badge on a partner's
    // own card and was removed in fa0abb4. So the logo slot costs no height until the
    // asset lands.
    logo:       'alasia/logo',
    // ⚠ NULL BECAUSE ALASIA HAS NO INVERTED LOGO, not because nobody looked. Their site
    //   carries logo512.png plus a theme pair that turns out to be `logo desktop` and
    //   `logo mobile` — the same wordmark at two sizes; all three share a 2.65:1 aspect.
    //   partnerLogo() resolves the dark variant as `logoOnDark || logo`, so this falls back
    //   to the light mark. Correct today (every surface it sits on is light) and a real
    //   problem the day one is not. Ask Özok for an inverted file before building one.
    logoOnDark: null,

    // Owed. Null falls back to ADA teal wherever an accent is drawn.
    accent: null,

    // ─── PRICING — VERBATIM STRINGS, NEVER NUMBERS ──────────────────────────
    //
    // ADA is a DIRECTORY for Alasia, not an editor of their information. It reproduces what
    // Özok publishes. That rules out storing figures as numbers, and not pedantically:
    //   · `480.00` cannot survive as a JS number — the trailing zeros are gone
    //   · rendering `2490` through any formatter is OUR formatting, not theirs
    //   · Turkish convention would print `€2.490`, which is a CONVERSION
    // So every figure below is the exact string Özok published. Nothing parses, formats,
    // localises, rounds or sums them. Plan and room LABELS translate; FIGURES never do.
    //
    // ⚠ NO TOTALS ARE STORED OR COMPUTED. Özok publishes "€500 kapora" and "€1.990 bakiye"
    //   as two figures and does not publish their sum. Adding them is OUR arithmetic, and a
    //   directory that does arithmetic has started editing.
    // ⚠ THE FIGURES KEEP ALASIA'S OWN NUMBER FORMAT: comma thousands, dot decimals —
    //   `€2,490` and `€480.00`, exactly as published. An earlier draft of this file
    //   silently rewrote them European-style (`€2.490`, `€480,00`) which is precisely the
    //   CONVERSION the directory rule forbids, and it read as harmless because the digits
    //   were unchanged.
    //
    //   The brief's two examples disagree with each other on this — "€385.83 keeps its dot
    //   even in Turkish" is Anglo, "€500 kapora + €1.990 bakiye" is European — so the
    //   source format is what settles it, and PDF verification will confirm which one
    //   Özok actually publishes. If it turns out to be European, these strings change and
    //   nothing else does, which is the point of storing them verbatim.
    //
    // Bank names are PROPER NOUNS and live here rather than in i18n: "İş Bankası" is the
    // same in all nine locales, and a key would invite somebody to "translate" it.
    academicYear: '2026-2027',

    // ─── THE SINGLE CANONICAL SOURCE FOR EVERY FIGURE ───────────────────────
    //
    // The ENGLISH prices page and the PDF it links. Nothing else.
    //
    // ⚠ alasiadorm.com/tr/fiyatlar/ IS NOT A SOURCE AND MUST NOT BE USED — not for figures,
    //   not for formatting, not for anything. It is a second source already known to
    //   DIVERGE: it is where the €8,000 security-deposit reading came from, against ₺8,000
    //   on the English page. With two sources, "verbatim" has two answers and the word
    //   stops meaning anything.
    //   It stays useful for exactly one thing — cross-CHECKING a transcription — and even
    //   then a disagreement is resolved in the English page's favour or escalated to Özok,
    //   never merged.
    //
    // Number format follows that page: COMMA thousands, DOT decimals (€2,490 · €480.00).
    priceSource: {
      url:     'https://alasiadorm.com/prices/',
      pdfUrl:  'https://alasiadorm.com/wp-content/uploads/2026/08/alasiadorm-prices-payment-plans-en-1.pdf',
      fetched: '2026-09-10',
    },

    // ─── DEPOSITS ───────────────────────────────────────────────────────────
    // The holding deposit is the same €500 on every plan, so it lives here once rather than
    // being repeated into thirty plan rows.
    //
    // ⚠⚠ THE SECURITY DEPOSIT AMOUNT IS OMITTED ON PURPOSE. NOT AN OVERSIGHT. ⚠⚠
    //   alasiadorm.com/prices/ (EN) says ₺8,000. alasiadorm.com/tr/fiyatlar/ (TR) says
    //   €8,000. That is ~€180 versus €8,000 — MORE THAN THE ENTIRE ANNUAL FEE on four of
    //   the six room types. Two sources say ₺ and the TR reading looks like a rendering
    //   artefact, but "likelier" is not a basis for putting a sum a student must hand over
    //   in front of them, and showing both would make ADA the place that told them it might
    //   be either.
    //   So: reproduce the FACT (refundable, per person, separate from the fee), omit the
    //   AMOUNT, link their page. Berke is asking Özok directly.
    //   check-dorms.mjs goes RED if `amount` becomes non-null without `confirmedBy` and
    //   `confirmedOn` recorded in the same commit. Do not simply fill it in.
    deposits: {
      holding:  { amount: '€500', noteKey: 'dormDepositHoldingNote' },
      security: { amount: null, confirmedBy: null, confirmedOn: null,
                  noteKey: 'dormDepositSecurityNote' },
    },

    // ⚠ REFERENCED BUT DELIBERATELY UNWRITTEN. Özok has supplied no "about" copy, and this
    //   is a real business — inventing nine locales of marketing prose about somebody
    //   else's dorm is not a placeholder, it is fabrication with their name on it.
    //   t() returns the KEY when a string is missing, so the screen compares the result
    //   against the key name and the section collapses. scripts/check-dorms.mjs asserts
    //   this key does NOT resolve, so the day the copy is written the guard goes red and
    //   somebody has to consciously graduate it — see PENDING_KEYS below.
    aboutKey: 'dormAlasiaAbout',

    // Owed: { textKey, expiry: 'YYYY-MM-DD' }. BOTH are required — the band renders only
    // when the text exists AND the expiry is still in the future, so a config entry that
    // is never touched again expires itself with no OTA.
    deal: null,

    // ⚠ VERIFIED AS MINUTES, NOT AS DESTINATIONS. Özok gave "5 dk Lefkoşa / 15 dk Girne /
    //   15 dk Ercan" — but a student picks a dorm by which UNIVERSITY the shuttle reaches,
    //   and a city is not a campus. These are the CITIES as given; naming the universities
    //   is owed item 7 and will REPLACE these entries, not be appended to them.
    //
    // The two city labels reuse REGION_LABEL_KEY's own keys (constants/regions.js) rather
    // than minting dorm-prefixed duplicates: they are the same two nouns the district
    // filter already translates, and these entries are known-temporary, so nine new
    // strings each would be written to be thrown away.
    transport: [
      { icon: 'bus-outline',      labelKey: 'blDistrictNicosia', minutes: 5  },
      { icon: 'bus-outline',      labelKey: 'blDistrictKyrenia', minutes: 15 },
      { icon: 'airplane-outline', labelKey: 'dormShuttleErcan',  minutes: 15 },
    ],

    // ─── SERVICES — ALASIA'S OWN ORDER, NOT REGROUPED ───────────────────────
    //
    // 22 items exactly as their homepage lists them, in the order it lists them. Not sorted,
    // not grouped by kind, not reordered so the impressive ones come first — reordering a
    // partner's list is a small edit, and ADA does not edit.
    //
    // Some carry a VALUE and most do not. Value renders right-aligned; absent, the row is
    // just the name. NO TICK COLUMN: a tick beside every row of a list titled "included"
    // says nothing, and it costs a column that the longer locales need.
    //
    // `value` is verbatim where it is language-neutral ("24/7", "Fiber"); `valueKey` where
    // it is words. Names are i18n keys — a label translates, a figure never does.
    //
    // ⚠ "Shuttle service" APPEARS HERE, IN THE INCLUDED LIST, while their shuttles page
    //   describes a PAID dorm shuttle alongside the free university one. Their two pages
    //   disagree. Reproduced as published — ADA does not reconcile a partner's
    //   inconsistencies, and it does not annotate them either.
    servicesIncluded: [
      { labelKey: 'dormSvcHotWater',    value: '24/7' },
      { labelKey: 'dormSvcInternet',    value: 'Fiber' },
      { labelKey: 'dormSvcAircon' },
      { labelKey: 'dormSvcEnsuite' },
      { labelKey: 'dormSvcSatelliteTv' },
      { labelKey: 'dormSvcWifi' },
      { labelKey: 'dormSvcFridge' },
      { labelKey: 'dormSvcKitchen' },
      { labelKey: 'dormSvcLockers' },
      { labelKey: 'dormSvcCoworking',   value: '24/7' },
      { labelKey: 'dormSvcFaceId' },
      { labelKey: 'dormSvcShuttle' },
      { labelKey: 'dormSvcFrontDesk',   value: '24/7' },
      { labelKey: 'dormSvcGarden' },
      { labelKey: 'dormSvcParking' },
      { labelKey: 'dormSvcLuggage' },
    ],
    servicesExtra: [
      { labelKey: 'dormSvcMarket' },
      { labelKey: 'dormSvcLaundry' },
      { labelKey: 'dormSvcCleaning' },
      { labelKey: 'dormSvcGym' },
      { labelKey: 'dormSvcElectricity', valueKey: 'dormSvcElectricityValue' },
      { labelKey: 'dormSvcDining' },
    ],

    // ─── SHUTTLES — TWO SERVICES, DIFFERENT PROVIDERS ───────────────────────
    //
    // ⚠ THE FREE SHUTTLE IS NOT THE DORM'S. It is provided by Alasia International
    //   University. Their homepage markets "our advanced transportation network… straight
    //   from your doorstep", which reads as the dorm's own — that sentence is DROPPED, both
    //   because it is marketing copy and because it is the exact line that misattributes a
    //   university service. The attribution is the load-bearing field here.
    //
    // Presented as two distinct services, which is faithful reproduction and happens to
    // leave no apparent contradiction for a user to trip over. No note is added pointing
    // out that their pages disagree.
    //
    // Route names and stop lists are PROPER NOUNS, verbatim and untranslated. Times are
    // verbatim. Only the service names, the attribution and the day labels translate.
    shuttles: [
      {
        id: 'free',
        nameKey: 'dormShuttleFree',
        providerName: 'Alasia International University',   // NOT the dorm
        routes: [
          { name: 'Yakındoğu',  stops: 'Near East University',
            times: ['07:00', '08:00', '10:00', '12:00', '14:00', '18:00'] },
          { name: 'UKÜ',        stops: 'Ring Road · Cyprus International University',
            times: ['07:45', '10:10', '12:00', '14:00', '17:00'] },
          { name: 'Bahçeşehir', stops: 'Alayköy · Bahçeşehir Cyprus University',
            times: ['08:40', '10:50', '12:40', '14:40', '17:40'] },
          { name: 'Girne',      stops: 'Cyprus Aydın University · Girne University',
            times: ['07:30', '11:30', '16:30'] },
        ],
        // Saturday and Sunday, one out and one back. A separate shape because it is a
        // different KIND of row — not a route with a timetable, a pair of times.
        weekend: { name: 'Lefkoşa · Girne', out: '13:00', back: '19:00' },
      },
      {
        id: 'paid',
        nameKey: 'dormShuttlePaid',
        providerName: 'Alasia Dorm',                       // theirs, and it is paid
        routes: [
          { name: 'Lefkoşa',
            stops: 'Dikmen · Yakın Doğu · Fuar · Terminal · Girne Kapısı · Hastaneler · Dikmen',
            times: ['07:05', '08:45', '10:00', '11:00', '12:45', '13:45',
                    '15:00', '16:00', '17:35', '19:00', '20:00', '21:00'] },
        ],
      },
    ],
    shuttleSource: 'https://alasiadorm.com/shuttles/',

    amenities: [],   // owed — the site publishes services, not a separate amenity list

    // The six room types are verified; every field on them except the code and the name
    // is owed. `code` is what reaches reception in the WhatsApp message as
    // ADA-ALS-<CODE>, so it is pending their sign-off — a code the desk does not
    // recognise makes the handoff worse than no code at all.
    // ─── ROOM TYPES ─────────────────────────────────────────────────────────
    //
    // `nameKey` is ADA's translated label, from Özok's own navigation menu.
    // `sourceName` is the name on their PRICES page, VERBATIM and untranslated — because
    //   that is the label attached to these figures, and a user comparing our page against
    //   theirs needs the word they will see there.
    //
    // ⚠ ALASIA PUBLISHES FOUR NAMES FOR EACH ROOM and they do not agree:
    //     prices page   Triple Room / Quad Bungalow
    //     nav menu      3-Person Dorm Block / 4-Person Bungalow
    //     descriptions  "Dorm Block 3 Person" / "Dorm Bungalov 4 Person"  (sic)
    //     TR page       Üç Kişilik Oda / Dört Kişilik Bungalov
    //   The mismatch is THEIRS to resolve. ADA carries both and picks neither.
    //   OCCUPANCY is what makes that safe: the names disagree, the head counts never do.
    //
    // `available` is a BOOLEAN when known. Still owed; if counts arrive instead, the guard
    // fails on the type, which is the intended place to find out.
    //
    // ⚠ months IS PER BANK. İşbank is 6/8/10/12; Ziraat is 7/8/10/12. One shared array
    //   would silently mislabel every Ziraat figure.
    rooms: [
      { code: 'BNG1', nameKey: 'dormRoomBungalow1', sourceName: 'Single Bungalow',
        photo: null, sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€8,500'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€4,245', '€4,745'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€4,600', '€1,600', '€1,600', '€1,600'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€1,624.17', '€1,251.88', '€1,035.00', '€890.83'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€1,392.14', '€1,250.00', '€1,030.00', '€875.00'] },
        } },
      { code: 'BNG2', nameKey: 'dormRoomBungalow2', sourceName: 'Twin Bungalow',
        photo: 'alasia/room-bng2', sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€4,250'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€2,045', '€2,545'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€2,300', '€850', '€850', '€850'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€818.33', '€631.25', '€523.00', '€450.42'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€701.43', '€618.75', '€515.00', '€437.50'] },
        } },
      { code: 'BNG4', nameKey: 'dormRoomBungalow4', sourceName: 'Quad Bungalow',
        photo: 'alasia/room-bng4', sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€1,990'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€825', '€1,325'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€940', '€450', '€450', '€450'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€385.83', '€301.25', '€250.00', '€216.25'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€330.71', '€293.75', '€240.00', '€204.17'] },
        } },
      { code: 'BLK1', nameKey: 'dormRoomBlock1', sourceName: 'Single Room',
        photo: 'alasia/room-blk1', sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€6,990'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€3,495', '€3,995'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€3,690', '€1,400', '€1,400', '€1,400'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€1,328.33', '€1,031.25', '€853.00', '€734.17'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€1,138.57', '€1,006.25', '€815.00', '€691.67'] },
        } },
      { code: 'BLK2', nameKey: 'dormRoomBlock2', sourceName: 'Twin Room',
        photo: 'alasia/room-blk2', sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€3,490'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€1,625', '€2,125'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€1,700', '€750', '€750', '€750'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€668.33', '€520.00', '€431.00', '€371.67'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€572.86', '€512.50', '€420.00', '€358.33'] },
        } },
      { code: 'BLK3', nameKey: 'dormRoomBlock3', sourceName: 'Triple Room',
        photo: 'alasia/room-blk3', sqm: null, available: null,
        plans: {
          full:   { labelKey: 'dormPlanFull',   discount: '%10', amounts: ['€2,490'] },
          two:    { labelKey: 'dormPlanTwo',    discount: '%5',  amounts: ['€1,095', '€1,595'] },
          four:   { labelKey: 'dormPlanFour',   discount: null,  amounts: ['€1,200', '€550', '€550', '€550'] },
          isbank: { bankName: 'İş Bankası', months: [6, 8, 10, 12],
                    amounts: ['€480.00', '€373.75', '€310.50', '€267.92'] },
          ziraat: { bankName: 'Ziraat Bankası', months: [7, 8, 10, 12],
                    amounts: ['€411.43', '€368.75', '€302.50', '€258.33'] },
        } },
    ],

    // Hero gallery, from their property photos.
    // ⚠ MIXED ASPECTS, AND THE CONTAINER HARDCODES 16/9: hero-1 is 1536x864 (16:9) and
    //   hero-2 is 1536x1026 (3:2), so `cover` centre-crops the second. Same shape as the
    //   TadilArt `aspect: 1` note in constants/partners.js — an aspect guessed before the
    //   files existed. Now that they exist it can be measured. Flagged for 7C, not fixed
    //   here: this slice wires assets and changes no layout.
    // ⚠ ORDER IS EXPLICIT, NOT FILE ORDER. The first thing a student swipes through should
    //   be where they will LIVE, so dorm and property shots come first and transport last.
    //   `kind` drives it (see GALLERY_ORDER below) rather than array position, so the rule
    //   survives new photos being added by someone who does not know it.
    //
    // ⚠ NEITHER HERO FILE CARRIES ALT TEXT ON ALASIA'S SITE, so which of the two is the
    //   shuttle photograph could not be determined from the source — only from looking at
    //   them. Both are marked 'property' below. If one is the bus, change that one word;
    //   the ordering then happens on its own.
    gallery: [
      // DSC06370 — the shot Alasia's own site uses on its shuttle section. Confirmed by
      // Berke on device; neither hero file carries alt text, so it could not be read from
      // the source.
      { key: 'alasia/hero-1', kind: 'transport' },
      { key: 'alasia/hero-2', kind: 'property' },
    ],
    ringTimes:        [],   // owed
    events:           [],   // owed

    operatorKey: 'dormOperatorOzok',
  },
]

// ─── GALLERY ORDER ──────────────────────────────────────────────────────────
// Sorted by kind, not by array position. A photo of the shuttle is a photo of getting
// somewhere else; a student deciding where to live wants the building first.
export const GALLERY_ORDER = ['property', 'room', 'transport']

// ─── SECTION ORDER ──────────────────────────────────────────────────────────
//
// Driven from here rather than from JSX position, so it can change again without a
// component edit — which is the whole reason it is data.
//
// Rooms first because PRICE IS THE QUESTION AFTER THE PHOTOS. Services and shuttles are
// what you read once you have decided the price is plausible; putting them above the
// rooms made the page answer a question nobody had asked yet.
// Tail is location → source → contact, per Berke's enumeration ("konum, kaynak, iletişim").
// The committed order had contact before source; that was the mismatch.
export const SECTION_ORDER = ['rooms', 'services', 'shuttles', 'location', 'ring', 'events', 'source', 'contact']

// Sections that open CLOSED and expand on tap. Both are long — 22 service rows and six
// route cards — and a page that opens with 28 rows of detail buries the six room cards
// above them.
//
// ⚠ COLLAPSING IS NOT FILTERING. Every item stays, in Alasia's order, and nothing is
//   summarised or promoted into the header. The header carries a COUNT so a closed section
//   still says how much is inside.
export const COLLAPSIBLE = ['services', 'shuttles']

export const DORM_PARTNER_IDS = DORM_PARTNERS.map(p => p.id)

const BY_ID = Object.fromEntries(DORM_PARTNERS.map(p => [p.id, p]))
export const dormPartner = id => BY_ID[id]

// ─── EMPTINESS AND DERIVATION LIVE HERE, NOT IN THE SCREEN ──────────────────
//
// Same discipline partnerGallery() established for TadilArt: a section that is hidden is
// hidden HERE, once, by a pure function — never by an `&&` chain in the JSX. Two reasons
// it matters more than tidiness. A screen-side condition cannot be tested without
// rendering, and a screen-side condition gets copied wrong when the second partner
// arrives.
//
// Every function below takes what it needs as an argument — including the CLOCK — so
// scripts/check-dorms.mjs can drive them with a fake date and assert both sides of the
// expiry, which no `&&` in a component could ever offer.

// The deal band renders only when there IS text AND the expiry is still ahead. Returning
// null rather than false so the caller destructures one shape or nothing.
//
// ⚠ `now` IS INJECTED. A config entry nobody touches again expires itself with no OTA,
//   which is the whole reason expiry is a date in config rather than a boolean somebody
//   has to remember to flip.
export function dormDeal(partner, now = new Date()) {
  const d = partner?.deal
  if (!d || !d.textKey || !d.expiry) return null
  // Compare at day granularity: an expiry of '2026-12-31' means the band is live all of
  // that day, not until midnight at the start of it.
  const end = new Date(`${d.expiry}T23:59:59`)
  if (Number.isNaN(end.getTime()) || end <= now) return null
  return { textKey: d.textKey, expiry: d.expiry }
}

// A section list the screen maps over, so "which sections have content" is answered once.
// Order is the render order and is the order the brief specifies.
export function dormSections(partner, { now = new Date(), resolveAsset = () => undefined } = {}) {
  const has = v => Array.isArray(v) && v.length > 0
  return {
    gallery:   [...(partner?.gallery || [])]
                 .sort((a, b) => GALLERY_ORDER.indexOf(a.kind) - GALLERY_ORDER.indexOf(b.kind))
                 .map(g => resolveAsset(g.key)).filter(Boolean),
    deal:      dormDeal(partner, now),
    transport: has(partner?.transport) ? partner.transport : null,
    amenities: has(partner?.amenities) ? partner.amenities : null,
    rooms:     has(partner?.rooms)     ? partner.rooms     : null,
    included:  has(partner?.servicesIncluded) ? partner.servicesIncluded : null,
    extra:     has(partner?.servicesExtra)    ? partner.servicesExtra    : null,
    shuttles:  has(partner?.shuttles)         ? partner.shuttles         : null,
    coords:    partner?.coords || null,
    ringTimes: has(partner?.ringTimes) ? partner.ringTimes : null,
    events:    has(partner?.events)    ? partner.events    : null,
  }
}

// ─── The WhatsApp handoff — TR and EN only, and not in i18n.js ──────────────
//
// Identical reasoning to constants/partners.js, which states it at length: the message is
// read by the RECEPTION DESK, not by the user who sends it, so nine translations of it is
// work with no reader. A key sitting in i18n.js would invite the next person to "finish"
// the set. The consequence is chosen, not discovered — a Russian speaker's compose box
// opens in English, and they can edit it.
const WA = {
  tr: code => `Merhaba, ADA uygulamasından yazıyorum. Yurt hakkında bilgi almak istiyorum.\nKaynak: ADA · Kod: ${code}`,
  en: code => `Hello, I'm contacting you from the ADA app. I'd like information about the dormitory.\nKaynak: ADA · Kod: ${code}`,
}

// Sent from a ROOM. Naming the room is the whole value of the room-level handoff — the desk
// gets "which room" without having to ask, and the code is the machine-readable half of the
// same fact.
const WA_ROOM = {
  tr: (room, code) => `Merhaba, ADA uygulamasından yazıyorum. "${room}" hakkında bilgi almak istiyorum.\nKaynak: ADA · Kod: ${code}`,
  en: (room, code) => `Hello, I'm contacting you from the ADA app. I'd like information about "${room}".\nKaynak: ADA · Kod: ${code}`,
}

// `lang` is a FULL NAME ('Turkish'), never a code — the same trap partners.js documents.
// Comparing against 'tr' here would send English to every Turkish speaker and look correct
// in review. LANG_CODES is not imported (this module stays dependency-free), so the caller
// passes the two-letter code it already has.
export const dormWaLocale = langCode => (langCode === 'tr' ? 'tr' : 'en')

// ⚠ THE CODE IS DERIVED FROM partner.code, NEVER INLINED. This and dormWebsiteUrl() are
//   the only two places `ALS` reaches the outside world, and they must agree — a room
//   enquiry quoting ADA-ALS-BNG1 while the click-through says utm_campaign=alasia would
//   make the two halves of the partner report impossible to join.
export function dormWaCode(partner, roomCode) {
  const base = `ADA-${partner?.code || ''}`
  return roomCode ? `${base}-${roomCode}` : base
}

// ⚠ THE ROOM NAME MUST BE IN THE MESSAGE'S LANGUAGE, NOT THE READER'S. This is the same
//   trap constants/partners.js documents for service names: a Turkish message naming
//   "Bungalow, twin" is worse than either language on its own, and a Russian user's compose
//   box must still hand the desk something they can act on.
//
//   So the caller passes `roomByLocale = { tr, en }`, resolved with t(nameKey, 'Turkish')
//   and t(nameKey, 'English') — this module stays dependency-free and never imports i18n,
//   the same injection the asset resolver uses. Omit it and the message falls back to the
//   generic property-level text, which is correct rather than broken.
export function dormWaMessage(partner, langCode, roomCode, roomByLocale) {
  const loc  = dormWaLocale(langCode)
  const code = dormWaCode(partner, roomCode)
  const room = roomByLocale?.[loc]
  return room ? WA_ROOM[loc](room, code) : WA[loc](code)
}

// utm_content carries the room only when the tap came FROM a room, per the brief.
export function dormWebsiteUrl(partner, roomCode) {
  if (!partner?.website) return null
  const u = new URL(partner.website)
  u.searchParams.set('utm_source', 'ada')
  u.searchParams.set('utm_medium', 'app')
  u.searchParams.set('utm_campaign', String(partner.code || '').toLowerCase())
  if (roomCode) u.searchParams.set('utm_content', String(roomCode).toLowerCase())
  return u.toString()
}

// ─── Keys that are REFERENCED and must NOT resolve yet ──────────────────────
//
// scripts/check-dorms.mjs asserts these are missing from all nine locales, which is the
// opposite direction from every other key it checks. The point is that writing the string
// turns the guard RED — so graduating a placeholder into real content is a deliberate act
// somebody reviews, not something that happens because a translator filled a gap.
//
// dormAlasiaAbout: Özok has supplied no about copy and this is a real business. When they
// do, write the nine locales and delete the entry here in the same commit.
export const PENDING_KEYS = ['dormAlasiaAbout']
