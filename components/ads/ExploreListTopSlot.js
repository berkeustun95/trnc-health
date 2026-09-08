import AdSlot from '../AdSlot'

// list_top on explore — mounted in screens/ExploreScreen.js.
//
// ListHeaderComponent on the DRILLED-IN CATEGORY LIST only. Not the group-tile landing,
// not the saved list, never the map.
//
// ⚠ THIS FILE EXISTS SO THE ALLOWLIST CAN BE PER-FILE. constants/ads.js names it in
//   AD_PLACEMENTS, and scripts/check-ad-placement.mjs refuses a push if any OTHER file
//   imports components/AdSlot, or if a file on that list is also an excluded surface.
//   A whole-screen rule could not work: EventsScreen holds both the list and
//   EventDetailScreen, and HomeScreen holds the hub, the global search results and the
//   gated facility list — two of which are on the permanent exclusion list. Deleting this
//   indirection deletes the thing that makes those distinctions checkable.
//
// Unsold renders null: zero height, no placeholder, no house ad.
export default function ExploreListTopSlot({ lang, onNavigate }) {
  return <AdSlot position="list_top" module="explore" lang={lang} onNavigate={onNavigate} />
}
