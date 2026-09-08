import AdSlot from '../AdSlot'

// list_inline on accommodation — mounted in screens/AccommodationScreen.js.
//
// Injected from renderItem after the 8th card, once. Never repeated however far the user
// paginates.
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
export default function AccommodationListInlineSlot({ lang, onNavigate }) {
  return <AdSlot position="list_inline" module="accommodation" lang={lang} onNavigate={onNavigate} />
}
