import AdSlot from '../AdSlot'

// list_bottom on home — mounted in screens/HomeScreen.js (inside renderHubV2).
//
// The migrated home_footer. Home is a hub, not a directory, so list_bottom here means
// "the end of the page" — the position describes the shape, which is why one scheme beat
// two.
//
// ⚠ THIS FILE EXISTS SO THE ALLOWLIST CAN BE PER-FILE. constants/ads.js names it in
//   AD_PLACEMENTS, and scripts/check-ad-placement.mjs refuses a push if any OTHER file
//   imports components/AdSlot, or if a file on that list is also an excluded surface.
//   A whole-screen rule could not work: EventsScreen holds both the list and
//   EventDetailScreen, and HomeScreen holds the hub, the global search results and the
//   gated facility list — two of which are on the permanent exclusion list. Deleting this
//   indirection deletes the thing that makes those distinctions checkable.
//
// ─── CARRIED OVER FROM components/home/HomeFooterSlot.js, WHICH THIS REPLACES ──────
// ADA is a declared MIXED-AUDIENCE app since 2026-08-29 (13-15 / 16-17 / 18+), and users
// under 18 must receive NON-PERSONALIZED ads. That is answered STRUCTURALLY, not by a
// branch: selection reads no user attribute whatsoever, so every user is served the same
// row and a personalized ad is not something the design can express. date_of_birth is not
// consulted and does not need to be.
//
// ⚠ ONLY TRUE WHILE SELECTION STAYS BLIND. The moment anything user-derived enters it —
//   an age branch, a region filter, "people who opened Pets" — the claim stops being
//   structural, the under-18 branch has to be written for real, and three published copies
//   of the privacy policy saying "We do not use your data for advertising" have to change
//   first.
//
// Still no SDK, no ad network, no bidder, no tracker, no native dependency: rows in
// ad_banners, added by hand, over the same Supabase client every other screen uses. One
// non-compliant SDK would make the whole app ineligible under Play Families policy.
//
// Unsold renders null: zero height, no placeholder, no house ad.
export default function HomeListBottomSlot({ lang, onNavigate }) {
  return <AdSlot position="list_bottom" module="home" lang={lang} onNavigate={onNavigate} />
}
