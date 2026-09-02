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

// Explore map on the bottom-nav "map" tab. false = the tab keeps the health-only
// MapScreen and its "Harita" label; true = it becomes ExploreMapScreen, all ADA content
// on one clustered map, labelled "Keşfet".
//
// THIS IS NOT A DARK-LAUNCH FLAG FOR NEW CONTENT — it guards a SWAP OF SOMETHING USERS
// ALREADY HAVE. The map tab is ungated and has shipped since launch. Flipping this
// exchanges a labelled health map for an 11-pin "Keşfet", because 387 of 394 facilities
// still have NULL coordinates. That trade is a downgrade until the pharmacies are
// geocoded, so the swap must be a deliberate act on a chosen day, not a dormant payload
// riding out on whatever the next unrelated OTA happens to be.
//
// Preconditions for flipping (all of them, in this order):
//   1. pharmacies geocoded properly — NOT seed_pharmacies_geocoded.sql, whose 387 rows
//      carry 142 distinct points with 28 stacked on one coordinate
//   2. Slice 6 — the seven remaining locales for any keys the map introduced
//   3. coachMapTitle/coachMapBody still say "see all facilities on a map"; a tab renamed
//      Keşfet with that tutorial copy is a polish bug nobody will assign
//
// Flipping it locally is how the map is previewed and demoed. check-module-flags.mjs
// carries the baseline, so a flip left in the working tree cannot reach `eas update`.
export const EXPLORE_MAP_LIVE = true

// Profile completion gate (Slice 2). false = the gate never fires and the wizard is
// unreachable; the schema, the lookup tables and the availability RPC from Slice 1 are
// all live either way and harmless on their own.
//
// NOT a MODULE_FLAGS key, deliberately: this gates a BLOCK, not a module. Every
// MODULE_FLAGS entry answers "is this content ready to show"; this one answers "does
// every customer get stopped at the door". Putting it in that map would let a future
// loop over MODULE_FLAGS switch it on as though it were a directory.
//
// ⚠ FLIPPING THIS IS NOT AN ORDINARY GO-LIVE. It hard-blocks every existing customer
//   account on next open, and it collects four new categories of personal data — so
//   docs/terms.html and screens/LegalScreen.js need their clause FIRST, and neither
//   copy may carry it alone. See the Slice 2 journal entry.
export const PROFILE_GATE_LIVE = false

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
  pets:         true,
  events:       true,
  jobs:         false,
  accommodation: true,
  studentHub:   false,
  explore:      true,   // live 2026-08-26 — 42 places, nature + heritage tiles
  // Çekici & Yol Yardım (towing / roadside assistance). Admin-seeded directory, no
  // self-serve. Stays false until Slice 3 seeds real firms — an emergency screen with
  // an empty list is worse than no screen at all.
  towing:       true,
  // Place check-ins ("Buradayım"). Entry point only: the button on a place profile opens
  // ComingSoonScreen and captures a waitlist signup. There is no check-in table, no
  // location capture and no write of a user position anywhere — and there must not be one
  // added behind this flag without that being its own decision.
  //
  // ⚠ UNLIKE EVERY OTHER KEY HERE, ITS ENTRY POINT IS NOT GATED. ExploreProfileScreen is
  //   live today through the beaches path, so the button ships on the next OTA and starts
  //   collecting demand immediately. That is deliberate: towing collected ZERO signups
  //   because every entry point was flag-gated, so the flag hid the very demand it was
  //   waiting for. This flag gates the eventual FEATURE, not the signup.
  checkins:     false,
}
