// Two-level Explore taxonomy: GROUP -> categories. The group is DERIVED in JS from a
// place's `category` and is NEVER stored in the DB — places.category is the only stored
// axis, a shape-guarded plain text column (not a DB enum). Adding a category is a JS edit
// + OTA, never a migration.
//
// i18n (Slice 2 constraint): reuse existing bl* keys where they fit; categories/groups
// without a key are marked TODO(slice5-i18n) and cannot be shown to users until Slice 5
// adds keys. Keyless groups are admin-gated off today (0 rows), so nothing user-facing
// depends on them yet.

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

// Per-group presentation. colorToken/labelKey reuse existing tokens where they exist:
// nature -> beach token, heritage -> landmark token (the only two with live data AND an
// existing placeColors entry + bl* label key). The other three have no color token or
// i18n key yet; they are gated off today, so the fallback token is never rendered and
// their label falls back to the raw group id (admin-only dev placeholder). Slice 5 adds
// real tokens + the exploreGroup* keys.
export const GROUP_META = {
  nature:    { icon: 'leaf-outline',      colorToken: placeColors.beach,    labelKey: 'blFilterBeaches',   todoLabelKey: 'exploreGroupNature' },
  heritage:  { icon: 'library-outline',   colorToken: placeColors.landmark, labelKey: 'blFilterLandmarks', todoLabelKey: 'exploreGroupHeritage' },
  eat_drink: { icon: 'cafe-outline',      colorToken: placeColors.beach,    labelKey: null,                todoLabelKey: 'exploreGroupEatDrink' },
  active:    { icon: 'barbell-outline',   colorToken: placeColors.beach,    labelKey: null,                todoLabelKey: 'exploreGroupActive' },
  services:  { icon: 'construct-outline', colorToken: placeColors.beach,    labelKey: null,                todoLabelKey: 'exploreGroupServices' },
}

// category -> i18n key, ONLY for categories that already have a key (Slice 2: no new keys,
// no hand-written English). The submit picker + category chips render only these.
// TODO(slice5-i18n): cafe, restaurant, bakery, gym, sports_facility, pool, barber,
//                    print_shop, laundry
export const CATEGORY_LABEL_KEY = {
  beach:           'blFilterBeaches',
  nature_scenic:   'blCatNatureScenic',
  castle_fortress: 'blCatCastleFortress',
  ancient_ruins:   'blCatAncientRuins',
  museum:          'blCatMuseum',
  religious_site:  'blCatReligiousSite',
  monument:        'blCatMonument',
}

// Categories a user may SUBMIT in Slice 2 — exactly the keyed set the old form offered
// (beach + the 6 landmark categories). Keyless categories open in Slice 5.
export const SUBMITTABLE_CATEGORIES = [
  'beach', 'castle_fortress', 'ancient_ruins', 'museum',
  'religious_site', 'monument', 'nature_scenic',
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
