import AdSlot from '../AdSlot'

// detail_bottom on accommodation — mounted in TWO hosts:
//   screens/PropertyDetailScreen.js   an ordinary property listing
//   screens/DormPartnerScreen.js      a dorm partner showcase
//
// ⚠ ONE SOLD ROW RENDERS ON BOTH. That is what "same slot, same rules" means and it is
//   deliberate — see the note beside this placement in constants/ads.js, which is also the
//   only warning that a rival's banner can land on a partner's own page. There is no
//   code-level competitor suppression by design; that is handled commercially.
//
// Last child of each host's ScrollView. In both, contentContainerStyle already reserves the
// contact-bar space AFTER the last child, so no constant was touched in either.
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
export default function AccommodationDetailBottomSlot({ lang, onNavigate }) {
  return <AdSlot position="detail_bottom" module="accommodation" lang={lang} onNavigate={onNavigate} />
}
