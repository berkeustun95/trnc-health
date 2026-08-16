// Dark-launch feature flags. Kept out of App.js so leaf components (directory +
// owner card) can import the flag directly without prop-drilling it four levels.

// Featured tier (paid promotion for facility listings). false = the "Featured"
// badge/pinning is hidden from normal users and the owner "request featured" CTA
// is hidden; admins still see both (isAdmin override) so the tier can be previewed
// before public launch. Flip to true to release Slice 3. Mirrors GARAGES_LIVE.
export const FEATURED_LIVE = false

// Featured tier for Explore PLACES (Slice 4 piece 3). SEPARATE from FEATURED_LIVE so the
// two directories launch independently. false = the "Featured" badge/pinning is hidden
// from normal users (the owner "request featured" CTA lands in Slice 5); admins still see
// the badge/pinning (isAdmin override) to preview. Flip to true to release. Mirrors
// FEATURED_LIVE. Listing stays free forever — only placement is paid.
export const EXPLORE_FEATURED_LIVE = false

// Garage service-price comparison (Slice 4b). false = the "Compare prices" entry
// on the garages directory and the compare screen are hidden from normal users;
// admins still see them (isAdmin override) to preview while the price dataset fills
// in. Flip to true once enough garages have published prices. Mirrors FEATURED_LIVE.
export const PRICE_COMPARE_LIVE = false

// Marketplace module gating. Each key is a module that is empty in prod today, so
// it renders a "Coming soon" screen (with one-tap Notify me) instead of an empty
// list that reads as broken. false = gated (Coming Soon); flip to true via OTA to
// go live. Admins bypass the gate for preview (see the gate in App.js); garages
// additionally bypasses for an owner via ownsGarage. Each key is the module's
// stable identifier, reused verbatim by the gate here, and (Slices 2-3) the
// waitlist `module` column + its CHECK and the go-live notify RPC.
export const MODULE_FLAGS = {
  homeServices: false,
  grooming:     false,
  garages:      false,
  transport:    false,
  insurance:    false,
  pets:         false,
  events:       false,
  jobs:         false,
  accommodation: false,
  studentHub:   false,
  explore:      false,
}
