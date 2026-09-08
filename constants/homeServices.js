// Ev Hizmetleri — the service vocabulary, in ONE place.
//
// It lived in FOUR identical copies before this file existed (HomeServicesScreen,
// HomeServiceProfileScreen, HomeServiceOnboardingScreen, HomeServiceDashboardScreen),
// which is not a tidiness problem — it is a correctness one. `home_services.service_types`
// is `text[]` with NO CHECK constraint in the database, so this array IS the vocabulary.
// A key added to three copies and missed in the fourth produces a row the onboarding form
// can write and the directory can never surface: a provider who filled in the form,
// pays attention to their listing, and is invisible. Nothing errors.
//
// No react-native import on purpose, so a future Node-side guard can read this list and
// derive what it enforces — the same constraint constants/towing.js and constants/ads.js
// carry. `family` is a STRING, not a component, for exactly that reason;
// components/HomeServiceIcon.js resolves it.

// ─── The 12 service types ────────────────────────────────────────────────────
//
// ⚠ THE ORDER IS THE GRID ORDER. Two columns, so the first six are what a phone shows
//   without scrolling. renovation / bathroom / kitchen are INSERTED after painter rather
//   than appended, so the renovation cluster sits above the fold — the existing nine keep
//   their relative order, which keeps this diff a pure insertion.
//
// ⚠ `family: 'mci'` on bathroom is the ONE exception to Ionicons in this module.
//   Ionicons has no shower, bath, tub or sink glyph — the whole 421-name outline set was
//   searched. The tempting substitute was `water-outline`, which is already the plumber
//   tile: two adjacent tiles carrying the same droplet reads as a rendering bug, not as
//   two trades. MaterialCommunityIcons is already a dependency and already used in the
//   app, so the cost is one string, not a package.
export const HS_CATEGORIES = [
  { key: 'plumber',     icon: 'water-outline',         labelKey: 'hsCategoryPlumber' },
  { key: 'electrician', icon: 'flash-outline',         labelKey: 'hsCategoryElectrician' },
  { key: 'carpenter',   icon: 'construct-outline',     labelKey: 'hsCategoryCarpenter' },
  { key: 'painter',     icon: 'color-palette-outline', labelKey: 'hsCategoryPainter' },
  { key: 'renovation',  icon: 'home-outline',          labelKey: 'hsCategoryRenovation' },
  { key: 'bathroom',    icon: 'bathtub-outline',       labelKey: 'hsCategoryBathroom', family: 'mci' },
  { key: 'kitchen',     icon: 'restaurant-outline',    labelKey: 'hsCategoryKitchen' },
  { key: 'sewer',       icon: 'funnel-outline',        labelKey: 'hsCategorySewer' },
  { key: 'ac_tech',     icon: 'thermometer-outline',   labelKey: 'hsCategoryAcTech' },
  { key: 'locksmith',   icon: 'key-outline',           labelKey: 'hsCategoryLocksmith' },
  { key: 'tiler',       icon: 'grid-outline',          labelKey: 'hsCategoryTiler' },
  { key: 'handyman',    icon: 'hammer-outline',        labelKey: 'hsCategoryHandyman' },
]

const BY_KEY = Object.fromEntries(HS_CATEGORIES.map(c => [c.key, c]))

// Returns undefined for an unknown key. Every call site already renders the raw key as a
// fallback, which is the right behaviour: a service_type this build has never heard of
// should still show the provider, not hide them.
export const hsCategory = key => BY_KEY[key]

// ─── Districts ───────────────────────────────────────────────────────────────
// Mirrors home_services_district_check. NB accommodation uses 5 (no lefke) and towing
// uses 7 (adds karpaz) — three different lists, deliberately. Do not unify them.
export const HS_DISTRICTS = ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke']

export const HS_DISTRICT_LABEL_KEY = {
  nicosia:   'hsDistrictNicosia',
  kyrenia:   'hsDistrictKyrenia',
  famagusta: 'hsDistrictFamagusta',
  morphou:   'hsDistrictMorphou',
  iskele:    'hsDistrictIskele',
  lefke:     'hsDistrictLefke',
}
