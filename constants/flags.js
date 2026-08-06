// Dark-launch feature flags. Kept out of App.js so leaf components (directory +
// owner card) can import the flag directly without prop-drilling it four levels.

// Featured tier (paid promotion for facility listings). false = the "Featured"
// badge/pinning is hidden from normal users and the owner "request featured" CTA
// is hidden; admins still see both (isAdmin override) so the tier can be previewed
// before public launch. Flip to true to release Slice 3. Mirrors GARAGES_LIVE.
export const FEATURED_LIVE = false

// Garage service-price comparison (Slice 4b). false = the "Compare prices" entry
// on the garages directory and the compare screen are hidden from normal users;
// admins still see them (isAdmin override) to preview while the price dataset fills
// in. Flip to true once enough garages have published prices. Mirrors FEATURED_LIVE.
export const PRICE_COMPARE_LIVE = false
