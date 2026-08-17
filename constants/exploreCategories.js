// Two-level Explore taxonomy: GROUP -> categories. The group is DERIVED in JS from a
// place's `category` and is NEVER stored in the DB — places.category is the only stored
// axis, a shape-guarded plain text column (not a DB enum). Adding a category is a JS edit
// + OTA, never a migration.
//
// i18n: legacy beach/heritage categories reuse bl* keys; the Slice-5 categories + all five
// group labels use exploreCat* / exploreGroup* keys (constants/i18n.js). Every category and
// group has a label — none fall back to a raw slug.

import { placeColors } from './theme'

// group -> ordered category slugs
export const EXPLORE_GROUPS = {
  nature:    ['beach', 'nature_scenic'],
  heritage:  ['castle_fortress', 'ancient_ruins', 'museum', 'religious_site', 'monument'],
  eat_drink: ['cafe', 'restaurant', 'bakery'],
  active:    ['gym', 'sports_facility', 'pool'],
  services:  ['barber', 'print_shop', 'laundry'],
}

// Landing-grid order.
export const GROUP_ORDER = ['nature', 'heritage', 'eat_drink', 'active', 'services']

// category -> group, built once from EXPLORE_GROUPS.
const CATEGORY_TO_GROUP = Object.entries(EXPLORE_GROUPS).reduce((acc, [group, cats]) => {
  cats.forEach(c => { acc[c] = group })
  return acc
}, {})

export function categoryToGroup(category) {
  return CATEGORY_TO_GROUP[category] || null
}

// Per-group presentation. Each group has its own exploreGroup* label key (Slice 5). The
// three non-nature/heritage groups still borrow placeColors.beach as their color token —
// they had no dedicated token pre-launch; a real token per group is deferred (backlog).
export const GROUP_META = {
  nature:    { icon: 'leaf-outline',      colorToken: placeColors.beach,    labelKey: 'exploreGroupNature' },
  heritage:  { icon: 'library-outline',   colorToken: placeColors.landmark, labelKey: 'exploreGroupHeritage' },
  eat_drink: { icon: 'cafe-outline',      colorToken: placeColors.beach,    labelKey: 'exploreGroupEatDrink' },
  active:    { icon: 'barbell-outline',   colorToken: placeColors.beach,    labelKey: 'exploreGroupActive' },
  services:  { icon: 'construct-outline', colorToken: placeColors.beach,    labelKey: 'exploreGroupServices' },
}

// category -> i18n key. Legacy heritage/beach categories keep their bl* keys; the Slice-5
// categories use exploreCat* keys. Every category in EXPLORE_GROUPS has a label here.
export const CATEGORY_LABEL_KEY = {
  beach:           'blFilterBeaches',
  nature_scenic:   'blCatNatureScenic',
  castle_fortress: 'blCatCastleFortress',
  ancient_ruins:   'blCatAncientRuins',
  museum:          'blCatMuseum',
  religious_site:  'blCatReligiousSite',
  monument:        'blCatMonument',
  cafe:            'exploreCatCafe',
  restaurant:      'exploreCatRestaurant',
  bakery:          'exploreCatBakery',
  gym:             'exploreCatGym',
  sports_facility: 'exploreCatSportsFacility',
  pool:            'exploreCatPool',
  barber:          'exploreCatBarber',
  print_shop:      'exploreCatPrintShop',
  laundry:         'exploreCatLaundry',
}

// Categories a user may SUBMIT. Slice 5 opened the eat_drink / active / services sets now
// that they have labels; every entry maps to a group in EXPLORE_GROUPS and a CATEGORY_LABEL_KEY.
// ⚠ resubmit_place() (migration 20260829) DUPLICATES this exact list in SQL to reject unknown
//   categories (the column CHECK is only a shape regex) — keep the two in sync until the DROP-era
//   cleanup can centralize it.
export const SUBMITTABLE_CATEGORIES = [
  'beach', 'nature_scenic',
  'castle_fortress', 'ancient_ruins', 'museum', 'religious_site', 'monument',
  'cafe', 'restaurant', 'bakery',
  'gym', 'sports_facility', 'pool',
  'barber', 'print_shop', 'laundry',
]

// ─── Threshold gating ────────────────────────────────────────────────────────
export const GROUP_TILE_THRESHOLD = 8

// Groups that render REGARDLESS of row count. nature = beach(4) + nature_scenic(0) = 4,
// below the >=8 gate; without this exemption the Slice 5 flag flip would take the
// currently-live beaches surface DARK. Hard constraint — beaches must never go dark.
// Do NOT lower GROUP_TILE_THRESHOLD to accommodate this (that defeats gating for
// eat_drink / active / services).
export const LIVE_TILE_GROUPS = ['nature']

// A group tile renders iff: admin (sees all), OR the group is exempt, OR it has >= the
// threshold row count in the fetched active set.
export function groupVisible(group, count, isAdmin) {
  return isAdmin || LIVE_TILE_GROUPS.includes(group) || count >= GROUP_TILE_THRESHOLD
}
