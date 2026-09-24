// Pet hotel partners — the partner surface inside the pets module.
//
// PARTNER-ONLY BY CONSTRUCTION, AND MODELLED ON constants/dorms.js RATHER THAN
// constants/partners.js. The two precedents are not interchangeable and picking the wrong
// one costs a rewrite, so the reason is recorded here:
//
//   partners.js (TadilArt) needs a `home_services` ROW. That table already existed as an
//   open self-registered directory that had to be gated DOWN (is_partner, 20261012), so
//   the row was already there to reuse. HomeServicePartnerScreen is welded to it — it
//   reads service_types through hsCategory (the RENOVATION taxonomy), coverage through
//   HS_DISTRICT_LABEL_KEY, and logs contact events as module 'homeServices'. It has no
//   website, address, opening-hours or pricing affordance at all, by its own stated
//   design. A dog boarding facility needs four of those five.
//
//   dorms.js (Alasia) has no table and never needed one. That is this shape exactly: a
//   signed agreement, a config entry, assets, and nothing else.
//
// ─── WHY THERE IS NO TABLE ──────────────────────────────────────────────────
// The decisive reason is i18n, the same one dorms.js reached. Service names and bodies
// need all nine locales and a `text` column holds one. Every displayable string here is
// therefore an i18n KEY, with the content in constants/i18n.js alongside every other
// nine-locale string. A row would have held only the non-translatable scalars, leaving
// the content in two places with nothing keeping them in step.
//
// THE COST, CHOSEN KNOWINGLY: a pet hotel is NOT in `search_content`, so a global search
// for "köpek oteli" finds nothing. That is the SAFE direction, not a regression —
// search_content ignores MODULE_FLAGS and (as of 20260924) ignores PET_HOTEL_LIVE too,
// so a table would have made Shiny Paw globally findable while the surface was still
// dark. That is the hazard CLAUDE.md records, and a config entry cannot trip it.
//
// No react-native import and NO require(): plain data only, so scripts/check-pet-partners.mjs
// can import this module under plain Node. Assets are KEYS resolved by
// constants/partnerAssets.js — the same split, for the same reason, that partners.js,
// dorms.js and ads.js carry.

// ─── SECTION ORDER ──────────────────────────────────────────────────────────
//
// Data, not JSX position, so the order can change without a component edit — the same
// reason dorms.js keeps SECTION_ORDER out of its screen.
//
// With the config as it stands (2026-09-24) this renders as hero → services → practical →
//   location → contact. `about` is a pending key; `pricing` never renders, because the
//   partner declined to publish prices (DECLINED_FIELDS). The branch stays so a future
//   partner who does publish needs no screen edit.
export const SECTION_ORDER = ['hero', 'about', 'services', 'practical', 'pricing', 'location', 'contact']

// ─── WHAT WE DO NOT KNOW, DECLARED RATHER THAN GUESSED ──────────────────────
//
// Every field here is null on the partner entry below, and scripts/check-pet-partners.mjs
// asserts it STAYS null until somebody removes it from this map in the same commit that
// supplies the value. The point is that filling one in is a reviewed act.
//
// This is the "never invent a price, address, coordinate, phone number, or capacity" rule
// turned into a data structure. Independently corroborated: their own site states none of
// these (fetched 2026-09-14), so there is no source to copy from either.
export const PENDING_FIELDS = {
  address:                 'Site says "Lefkoşa" and no more. A district is not a street address.',
  logoOnDark:              'No inverted wordmark. The partner sent a JPEG on white; shinypaw/logo.png keys that white out, which is clean on light grounds but NOT on dark: the white strokes inside the mark vanish, a light halo remains, and the brown wordmark loses contrast. Ask the partner for a vector or a transparent PNG. partnerLogo() falls back to `logo`, and no surface that renders a pet partner is dark today.',
  photoPermission:         'WRITTEN PERMISSION NOT YET HELD for the five partner-supplied photos below — the partner sent the files, not a written permission. Tracked as a field so it is owed rather than remembered.',
}

// ─── DECLINED: A DECISION, NOT A GAP ────────────────────────────────────────
//
// Not pending. Nobody is waiting on these, so they are not in PENDING_FIELDS, and the
// partner entry carries NO key for them (null would mean "asked, not yet known").
// scripts/check-pet-partners.mjs fails if a declined field's key appears on the entry or
// in PENDING_FIELDS, or if one reaches the rendered sections.
export const DECLINED_FIELDS = {
  email:  'Not shown, by decision (2026-09-24). Contact is WhatsApp, call, website and Maps only.',
  prices: 'The partner declined to publish prices (2026-09-24). The pricing section never renders; a rate is agreed over WhatsApp.',
}

// ─── THE PARTNERS ───────────────────────────────────────────────────────────
export const PET_PARTNERS = [
  {
    // ─── THE UUID IS contact_events.entity_id, AND NOTHING VERIFIES IT ──────
    // A config-only partner still needs a stable id to log taps against. There is no seed
    // migration, so no verify_schema H-token can assert it and nothing will notice if it
    // changes.
    //
    // ⚠ ONCE TAPS HAVE LANDED THIS MUST NEVER CHANGE. contact_events.entity_id is
    //   polymorphic and deliberately has NO foreign key, so a new id does not fail — it
    //   silently orphans every row already counted against the old one and the partner
    //   report quietly restarts from zero. Same warning dorms.js carries, for the same
    //   reason.
    id:   '86f811e9-bc1e-4a2a-a542-42b0631085dd',
    slug: 'shiny-paw',

    // ONE source for both the WhatsApp "Kod: ADA-SPW" suffix and utm_campaign, so the two
    // cannot drift apart. Never inline the string in either builder.
    code: 'SPW',

    // The display name. No DB row owns it, so this is the only place it exists.
    name: 'Shiny Paw & Trail Hotel',

    // ─── DOG BOARDING, NEVER "PETS" ─────────────────────────────────────────
    //
    // Drives the hero subtitle key and nothing else. It is a field rather than a hardcoded
    // string in the screen because it is the one claim on this page most likely to be
    // wrong for partner #2, and because generalising it by accident is easy: the surface
    // lives inside a module called "pets", every icon around it is a paw, and the drift
    // from "dog boarding" to "pet hotel" costs nothing to make and misleads somebody with
    // a cat at the moment they most need a straight answer.
    //
    // It says what they advertise. That they REFUSE cats is a separate fact, confirmed by
    // the partner 2026-09-24 and held in `acceptsCats` below.
    displayType: 'dog_boarding',

    website:  'https://www.shinypawhotel.com',

    // ⚠ VERBATIM AS SUPPLIED — not reformatted, not spaced, not prettified. The digits are
    //   the thing that has to be right, and every transformation is a chance to lose one.
    //   The same number serves both buttons: their WhatsApp link resolves to
    //   phone=905338600278, which is these digits without the +.
    phone:    '+905338600278',
    whatsapp: '+905338600278',

    // ⚠ THEIR OWN MAPS LINK, used as the directions target rather than a coordinate we
    //   resolved ourselves — the same call dorms.js made for Alasia. A short link resolves
    //   to a pin SHINY PAW chose; a lat/lng we derived is our guess at where they mean.
    //   The directions button uses this link, never `coords`. `coords` (below) feeds the
    //   Explore map pin only.
    //
    // It is also the ONLY review affordance on this screen, by decision: the partner has
    // no ADA row to anchor a rating to, and their Wix testimonials are not imported.
    mapsUrl:  'https://maps.app.goo.gl/mYcMS9PJCmoNn7177',

    // ─── 'nicosia', NOT 'lefkosa' ───────────────────────────────────────────
    //
    // The brief says the district is Lefkoşa, which is the Turkish name for the same
    // place. The canonical slug in this repo is `nicosia` (constants/regions.js), and it
    // is what REGION_LABEL_KEY indexes — so it is what renders the district in all nine
    // locales. Writing 'lefkosa' here would not throw; REGION_LABEL_KEY would return
    // undefined, t() would be handed undefined, and the hero would simply show no
    // district at all. A silent blank, which is why the guard asserts the slug resolves.
    district: 'nicosia',

    // ─── COORDINATES: PARTNER-CONFIRMED 2026-09-23 ──────────────────────────
    //
    // VERBATIM AS SUPPLIED, not rounded, for the reason the phone number is: every
    // transformation is a chance to lose a digit. Shiny Paw chose this point; we did not
    // geocode it. check-pet-partners.mjs asserts that resolveRegion() puts it in `district`.
    //
    // It feeds ONE surface: the Explore map pin (constants/mapSources.js, gated on
    // PET_HOTEL_LIVE). The partner screen has no embedded map, and directions still go
    // through `mapsUrl`, their own link. The street address is still pending, and must not
    // be reverse-geocoded from this point: a street name read off a pin is our guess.
    //
    // ─── WHY THIS IS NOT A `places` ROW (decided 2026-09-23) ────────────────
    // A `pet_boarding` category plus a places row was scoped and dropped, for two reasons:
    //   • the Explore map gates pins by group row count exactly as it gates tiles
    //     (groupVisible, GROUP_TILE_THRESHOLD = 8). Services had 0 pinnable rows, so a
    //     single boarding pin would have been visible to admins only;
    //   • a `status = 'pending'` row sits in AdminScreen's place-submission queue as a fake
    //     submission, one approval away from publishing without PET_HOTEL_LIVE.
    // ⚠ REVISIT WHEN A SECOND BOARDING BUSINESS IS LISTED. With two, a `pet_boarding`
    //   category (EXPLORE_GROUPS, CATEGORY_LABEL_KEY, resubmit_place()'s list,
    //   CLAIMABLE_CATEGORIES, nine locales) starts to earn its keep: search, claims, a
    //   directory. Until then this entry is the only boarding business, and it lives here.
    coords:   { latitude: 35.23028092013417, longitude: 33.38629301540769 },
    // No neighbourhood published. Deliberately not guessed from the maps link: an area
    // name read off a pin is our inference, not their address.
    area:     null,

    // Referenced and deliberately UNWRITTEN — see PENDING_KEYS at the foot of this file.
    // Shiny Paw has supplied no about copy, and writing nine locales of marketing prose
    // about a real business is fabrication with their name on it.
    aboutKey: 'petHotelShinyPawAbout',

    // ─── THE SIX SERVICES ───────────────────────────────────────────────────
    //
    // Titles and bodies are THEIR OWN TURKISH COPY, taken verbatim from shinypawhotel.com
    // (fetched 2026-09-14) and carried into constants/i18n.js as the `tr` values. The
    // English is written by ADA from that Turkish; the other seven locales are translated
    // from the English.
    //
    // Order is their site's order and is the render order. No sort key — a numeric field
    // invites somebody to renumber and lose it.
    //
    // ⚠ THESE ARE DESCRIPTIONS OF A SERVICE, NOT COMMITMENTS WE CAN VERIFY. Nothing here
    //   may grow into a structured claim — a body mentioning a camera system must not
    //   become a `cameraAccess: true`, and a body mentioning walks must not become an
    //   hours field. Prose the partner wrote is prose; a field is a promise ADA makes.
    services: [
      { id: 'monitoring', titleKey: 'petHotelSvcMonitoringTitle', bodyKey: 'petHotelSvcMonitoringBody', icon: 'videocam-outline' },
      { id: 'dailycare',  titleKey: 'petHotelSvcDailyCareTitle',  bodyKey: 'petHotelSvcDailyCareBody',  icon: 'heart-outline' },
      { id: 'stay',       titleKey: 'petHotelSvcStayTitle',       bodyKey: 'petHotelSvcStayBody',       icon: 'shield-checkmark-outline' },
      { id: 'walks',      titleKey: 'petHotelSvcWalksTitle',      bodyKey: 'petHotelSvcWalksBody',      icon: 'walk-outline' },
      { id: 'play',       titleKey: 'petHotelSvcPlayTitle',       bodyKey: 'petHotelSvcPlayBody',       icon: 'tennisball-outline' },
      { id: 'attention',  titleKey: 'petHotelSvcAttentionTitle',  bodyKey: 'petHotelSvcAttentionBody',  icon: 'people-outline' },
    ],

    // ─── PHOTOS — SHINY PAW'S OWN, SUPPLIED 2026-09-23 ──────────────────────
    //
    // Sent by the partner over WhatsApp. The partner states these are real photographs of
    // their facility, edited with AI tools; `note` carries that statement verbatim so it
    // travels with each file. They replace the three Wix placeholders, so `placeholder` is
    // false on all five — the guard still counts it on every run.
    //
    // Bundled locally (constants/partnerAssets.js), never hotlinked. Downscaled to 900 px
    // wide (SHOT_W caps at 300pt, x3 density) and re-encoded as JPEG q85. The four
    // portraits arrived at 941x1672; each was cropped to 4:5 around the dogs, trimming
    // empty paving, so the strip does not pair a 300pt-tall square with 533pt-tall
    // neighbours. The kennel row stays square and comes FIRST: PetHotelPartnerCard's
    // 64pt thumb is a square `cover` of the first photo.
    //
    // photoPermission is still PENDING: we hold the files, not written permission.
    //
    // ⚠ JUDGE THE PIXELS, NEVER THE PATH. Every file below was looked at before wiring.
    //   Rejected, and deliberately not stored in the repo:
    //   • `shinypaw/dog-at-mesh` (dropped 2026-09-14, resent in this batch as 14.48.35 (1))
    //     — the near foreleg bent where no joint is, a paw attached to no visible leg, an
    //     unexplained mid-body protrusion.
    //   • 14.48.34 (3) (2026-09-23) — a dog with two merged heads and an extra leg.
    //   • 14.48.33 (2026-09-23) — a two-panel collage; not usable as a gallery frame.
    //   An AI-malformed dog on a real boarding facility's listing misrepresents the premises
    //   somebody is about to leave their animal at, which this surface must never do.
    //
    // ─── `aspect` IS THE DIVISION OF THE FILE AS COMMITTED ──────────────────
    // Written as w / h so the number shows where it came from. Every shot renders with
    // resizeMode 'cover', so a declared aspect that disagrees with the file centre-crops it.
    //
    // ─── `provenance` IS REQUIRED ───────────────────────────────────────────
    // 'photograph'     = looks like a real, unedited photograph of the real premises.
    // 'partner-edited' = the partner's own photograph, AI-edited by the partner, who
    //                    confirmed that it shows the real premises. Judged by eye too.
    // 'disputed'       = shows AI-generation tells and needs the partner to confirm.
    photos: [
      { key: 'shinypaw/kennel-row',      placeholder: false, aspect: 900 / 900,  provenance: 'partner-edited',
        note: 'partner-supplied, real photo, AI-edited per partner — the kennel row.' },
      { key: 'shinypaw/yard-three-dogs', placeholder: false, aspect: 900 / 1125, provenance: 'partner-edited',
        note: 'partner-supplied, real photo, AI-edited per partner — the yard, three dogs.' },
      { key: 'shinypaw/hose',            placeholder: false, aspect: 900 / 1125, provenance: 'partner-edited',
        note: 'partner-supplied, real photo, AI-edited per partner — a dog under the hose.' },
      { key: 'shinypaw/yard-feeding',    placeholder: false, aspect: 900 / 1125, provenance: 'partner-edited',
        note: 'partner-supplied, real photo, AI-edited per partner — two dogs feeding. Judged 2026-09-23: '
          + 'four legs on the spaniel; the pointer\'s middle leg leaves the groin with a visible hock, so it '
          + 'reads as the far hind leg. No anatomical error found.' },
      { key: 'shinypaw/yard-two-dogs',   placeholder: false, aspect: 900 / 1125, provenance: 'partner-edited',
        note: 'partner-supplied, real photo, AI-edited per partner — the yard, two dogs.' },
    ],

    // The card's 64pt square thumb has its OWN file. Pointing it at the first gallery photo
    // decoded 900x900 (3.2 MB) to fill 192x192 px. check-pet-partners.mjs caps its size.
    thumb: 'shinypaw/kennel-row-thumb',

    // ─── PENDING (see PENDING_FIELDS above for the reason on each) ──────────
    //
    // Written out in full rather than omitted. An absent key and a null one read the same
    // to `?.`, but only the null one tells the next person the question was ASKED.
    //
    // ⚠ NO `email` OR `prices` KEY. Both are DECLINED (see DECLINED_FIELDS), which is a
    //   decision rather than a gap, so neither is null here.
    address:                 null,

    // ─── OPERATIONAL DETAILS, SUPPLIED BY THE PARTNER 2026-09-24 ────────────
    //
    // Every displayed value is an i18n KEY, in all nine locales, like every other string in
    // this config. Opening hours is a partner-specific key (petHotelShinyPawHours). Capacity
    // is a NUMBER, rendered through the generic plural key petHotelValDogs_* by tCount(), so
    // changing it is editing one number, never nine strings.
    //
    // ⚠ vaccinationRequirements: they said a vaccination card (aşı karnesi) is mandatory and
    //   named NO vaccines. Do not add any: OwningPetScreen's TRNC schedule is general advice,
    //   not this facility's intake policy.
    //
    // ⚠ cameraAccess: true means the OWNER can watch the 24/7 cameras. That is not the same
    //   claim as the monitoring service (THEY watch), and the value copy in every locale says
    //   the owner watches. Kept a boolean; petPartnerSections() maps true to its key.
    //
    // acceptsCats: false is stored and NOT rendered as a row. The "Dog boarding" pill in the
    // hero already answers it, and the practical list never had a cats row.
    openingHours:            'petHotelShinyPawHours',
    dropOffPickUpHours:      'petHotelValHandoverFlexible',
    capacity:                20,
    acceptedSizes:           'petHotelValSizesAll',
    breedRestrictions:       'petHotelValBreedsNone',
    vaccinationRequirements: 'petHotelValVaccinationCard',
    acceptsCats:             false,
    cameraAccess:            true,

    logo:                    'shinypaw/logo',
    logoOnDark:              null,
    // ─── ACCENT: SAMPLED FROM THE PARTNER'S LOGO, NOT SUPPLIED (2026-09-24) ──
    // The ring and the "TRAIL HOTEL" line of their logo, core pixels only: ring #1AB2C3,
    // wordmark #18B5C6. The partner did not send a brand colour; this is our reading of theirs.
    //
    // ⚠ #1AB2C3 FAILS AS TEXT: 2.56:1 on white, 2.41:1 on colors.bg (AA needs 4.5). It is for
    //   NON-TEXT DECORATION ONLY. As a fill it can carry ink text (5.71:1), never white (2.56:1).
    //   accentText #127D88 is the same hue (186 deg) darkened until it clears 4.5 on every
    //   ground: 4.87:1 on white/cardBg, 4.58:1 on colors.bg. check-pet-partners.mjs recomputes
    //   all of these on every run; trust its output over this comment.
    // Not read by any pet surface today: the badges use ADA's own colors.accent.
    accent:                  '#1AB2C3',
    accentText:              '#127D88',
    accentSource:            'sampled from partner logo',
    photoPermission:         null,
  },
]

export const PET_PARTNER_IDS = PET_PARTNERS.map(p => p.id)

const BY_ID = Object.fromEntries(PET_PARTNERS.map(p => [p.id, p]))
export const petPartner = id => BY_ID[id]

const BY_SLUG = Object.fromEntries(PET_PARTNERS.map(p => [p.slug, p]))
export const petPartnerBySlug = slug => BY_SLUG[slug]

// ─── EMPTINESS IS DECIDED HERE, ONCE, AND NEVER IN THE SCREEN ───────────────
//
// The discipline partnerGallery() established for TadilArt and dormSections() for Alasia.
// A section that is hidden is hidden HERE, by a pure function — never by an `&&` chain in
// the JSX. Two reasons it matters more than tidiness: a screen-side condition cannot be
// tested without rendering, and a screen-side condition gets copied wrong when the second
// partner arrives.
//
// The asset resolver is INJECTED rather than imported, so this module stays require()-free
// and a Node harness can drive it with a stub map — the same injection dorms.js uses.
//
// ⚠ THE CONTRACT WITH THE SCREEN: a key whose value is null is a section that must not
//   render AT ALL. No empty row, no "bilgi yok", no greyed placeholder. A greyed row tells
//   the user the app is broken; an absent section tells them nothing, which is the honest
//   answer when we know nothing.
export function petPartnerSections(partner, { resolveAsset = () => undefined } = {}) {
  const has = v => Array.isArray(v) && v.length > 0
  // A pending scalar is null. Treating '' or 0 as present would let a future empty string
  // render an empty row, which is the exact failure this function exists to prevent.
  const val = v => (v === null || v === undefined || v === '' ? null : v)

  // The aspect has to travel WITH the image or the screen has to guess one, and a guessed
  // aspect centre-crops the dimension the photo exists to show. A non-positive or
  // non-finite declared value is treated as absent and falls back to square — the same
  // defence HomeServicePartnerScreen's projectAspect() applies, for the same reason: a
  // container with aspectRatio 0 or NaN collapses and the photo silently disappears.
  const photos = (partner?.photos || [])
    .map(p => ({
      source: resolveAsset(p.key),
      aspect: (Number.isFinite(p.aspect) && p.aspect > 0) ? p.aspect : 1,
      provenance: p.provenance || null,
    }))
    .filter(p => p.source)

  // Every `value` is an i18n KEY; the screen renders t(value). Built as a filtered list
  // rather than an object so a pending field drops its row, a single answered field is
  // enough to render the section, and adding a field later needs no change here.
  const practical = [
    { id: 'openingHours',            labelKey: 'petHotelHours',        value: val(partner?.openingHours) },
    { id: 'dropOffPickUpHours',      labelKey: 'petHotelHandover',     value: val(partner?.dropOffPickUpHours) },
    // A count, not a key: rendered with tCount(value, count) so plural forms follow the
    // number. Anything but a positive integer is treated as unanswered.
    { id: 'capacity',                labelKey: 'petHotelCapacity',
      value: Number.isInteger(partner?.capacity) && partner.capacity > 0 ? 'petHotelValDogs' : null,
      count: Number.isInteger(partner?.capacity) && partner.capacity > 0 ? partner.capacity : undefined },
    { id: 'acceptedSizes',           labelKey: 'petHotelSizes',        value: val(partner?.acceptedSizes) },
    { id: 'breedRestrictions',       labelKey: 'petHotelBreeds',       value: val(partner?.breedRestrictions) },
    { id: 'vaccinationRequirements', labelKey: 'petHotelVaccination',  value: val(partner?.vaccinationRequirements) },
    // A boolean, mapped here: true is the owner-watches key. false has no row: we would be
    // stating a negative nobody asked about, and no partner has said it.
    { id: 'cameraAccess',            labelKey: 'petHotelCameraAccess', value: partner?.cameraAccess === true ? 'petHotelValCameraOwners' : null },
  ].filter(r => r.value !== null)

  // Location renders on EITHER half. Address is pending and mapsUrl is known, so today
  // this is a directions button with no street line above it — which is correct: their
  // pin is a fact and their street address is not one we hold.
  const address = val(partner?.address)
  const mapsUrl = val(partner?.mapsUrl)

  return {
    photos:    photos.length ? photos : null,
    about:     partner?.aboutKey || null,
    services:  has(partner?.services) ? partner.services : null,
    practical: practical.length ? practical : null,
    pricing:   val(partner?.prices),
    location:  (address || mapsUrl) ? { address, mapsUrl, coords: partner?.coords || null } : null,
    // No email, by decision (2026-09-24): contact is WhatsApp, call, website and Maps only.
    contact:   [
      partner?.whatsapp && 'whatsapp',
      partner?.phone    && 'call',
      partner?.website  && 'website',
      mapsUrl           && 'maps',
    ].filter(Boolean),
  }
}

// ─── The WhatsApp handoff — TR and EN only, and not in i18n.js ──────────────
//
// Identical reasoning to constants/partners.js and constants/dorms.js, which both state it
// at length: the message is read by SHINY PAW'S DESK, not by the user who sends it, so
// nine translations of it is work with no reader. A key sitting in i18n.js would invite
// the next person to "finish" the set.
//
// The consequence is chosen, not discovered — a Russian speaker's compose box opens in
// English, and they can edit it. An English sentence the facility can act on beats a
// Russian one nobody there reads.
//
// ⚠ IT STATES THE CUSTOMER CAME FROM ADA. That is the whole point of the handoff: the desk
//   can attribute the enquiry without asking, and `Kod:` is the machine-readable half of
//   the same fact.
const WA = {
  tr: code => `Merhaba, ADA uygulamasından yazıyorum. Köpeğim için konaklama hakkında bilgi almak istiyorum.\nKaynak: ADA · Kod: ${code}`,
  en: code => `Hello, I'm contacting you from the ADA app. I'd like information about boarding for my dog.\nKaynak: ADA · Kod: ${code}`,
}

// `lang` is a FULL NAME ('Turkish'), never a code — the trap partners.js and dorms.js both
// document. Comparing against 'tr' here would send English to every Turkish speaker and
// look completely correct in review. LANG_CODES is not imported (this module stays
// dependency-free), so the caller passes the two-letter code it already has.
export const petWaLocale = langCode => (langCode === 'tr' ? 'tr' : 'en')

// ⚠ DERIVED FROM partner.code, NEVER INLINED. This and petPartnerWebsiteUrl() are the only
//   two places `SPW` reaches the outside world and they must agree — an enquiry quoting
//   ADA-SPW while the click-through says utm_campaign=shinypaw would make the two halves
//   of the partner report impossible to join.
export function petWaCode(partner) {
  return `ADA-${partner?.code || ''}`
}

export function petWaMessage(partner, langCode) {
  return WA[petWaLocale(langCode)](petWaCode(partner))
}

// ⚠ THE NUMBER IS DIGITS-ONLY FOR wa.me, AND THAT STRIP HAPPENS HERE. Doing it in the
//   screen means doing it again, slightly differently, on the next surface — and a wa.me
//   URL with a '+' in it opens WhatsApp on a blank chat, which looks like the partner's
//   number is wrong rather than like our formatting is.
export function petWaUrl(partner, langCode) {
  const digits = String(partner?.whatsapp || '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(petWaMessage(partner, langCode))}`
}

export function petPartnerWebsiteUrl(partner) {
  if (!partner?.website) return null
  const u = new URL(partner.website)
  u.searchParams.set('utm_source', 'ada')
  u.searchParams.set('utm_medium', 'app')
  u.searchParams.set('utm_campaign', String(partner.code || '').toLowerCase())
  return u.toString()
}

// ─── Keys that are REFERENCED and must NOT resolve yet ──────────────────────
//
// scripts/check-pet-partners.mjs asserts these are missing from all nine locales, which is
// the OPPOSITE direction from every other key it checks. The point is that writing the
// string turns the guard RED — so graduating a placeholder into real content is a
// deliberate act somebody reviews, not something that happens because a translator filled
// a gap they found empty.
//
// petHotelShinyPawAbout: Shiny Paw has supplied no about copy. When they do, write the
// nine locales and delete this entry in the same commit.
export const PENDING_KEYS = ['petHotelShinyPawAbout']
