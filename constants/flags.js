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
export const PROFILE_GATE_LIVE = true   // live 2026-09-02

// Wizard headings. false = the profile wizard renders NO heading text in its content
// area: no step title, no "Step n of N" label, and no intro title. Field labels, hints,
// the progress dots, the emergency button and every modal title are untouched — this
// flag is about heading text only.
//
// A FLAG RATHER THAN A DELETION, on purpose. Removing six required fields' worth of
// scaffolding is a judgement call that has to be made ON DEVICE, and the two candidate
// screens are one boolean apart. Deleting the markup would make going back an unpick;
// this way it is one line. Flip to true to see the headed version again.
//
// NOT a dark-launch flag — nothing is hidden from users that they would otherwise get,
// and either value is shippable. It lives here anyway because this file is the one the
// OTA guard reads: `eas update` bundles the WORKING TREE, so a value left flipped after
// a device comparison would ship, and check-module-flags.mjs carrying it in
// EXPECTED_SCALARS is what stops that.
export const SHOW_WIZARD_HEADINGS = false

// Marketplace module gating. Each key is a module that is empty in prod today, so
// it renders a "Coming soon" screen (with one-tap Notify me) instead of an empty
// list that reads as broken. false = gated (Coming Soon); flip to true via OTA to
// go live. Admins bypass the gate for preview (see the gate in App.js); garages
// additionally bypasses for an owner via ownsGarage. Each key is the module's
// stable identifier, reused verbatim by the gate here, and (Slices 2-3) the
// waitlist `module` column + its CHECK and the go-live notify RPC.
export const MODULE_FLAGS = {
  // LIVE 2026-09-09 — PARTNER-ONLY. This is not the open directory the key originally
  // gated: the tile grid and the filterable list are gone, hs_select_public requires
  // is_partner, and hs_insert_self is closed. What flipping this reveals is a curated
  // list of firms ADA has agreements with.
  //
  // ⚠ IT DOES NOT MAKE THE PARTNER VISIBLE. TadilArt is still status='pending', so the
  //   module opens on its empty state until the go-live UPDATE runs. That ordering is
  //   deliberate — see HS_SELF_REGISTRATION below for the block and why it runs LAST.
  //
  // ⚠ AND IT IS THE OFF SWITCH. Turning the module off needs no SQL and no rollback of
  //   anything: flip this back to false and OTA. That is why activation is allowed to be
  //   a paste — the emergency direction is one boolean.
  homeServices: true,
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

// Tile-label typeface. false = Inter_500Medium (what ships today); true = Manrope Medium.
//
// A LOOK EXPERIMENT, NOT A LAUNCH. The grid's 11pt labels read cheap in Inter Regular, and
// Manrope is the candidate that survived measurement: identical script coverage to Inter
// (Latin, Turkish, Greek, Cyrillic — Arabic and Persian fall back to the system font in
// BOTH, so nothing is lost), and 2.1% narrower at the same weight, so no copy changes.
// Plus Jakarta Sans was rejected on measurement — no Greek and no Cyrillic, a regression.
// Rubik was rejected as a trade rather than a win: it gains Arabic and Persian but drops
// Greek, a locale we deliberately support.
//
// ⚠ THE FILE IS A STATIC INSTANCE, NOT THE VARIABLE FONT. Manrope's variable default is
//   wght=200 (ExtraLight), so shipping Manrope[wght].ttf would have rendered hairline
//   labels and produced a false comparison — the first overflow numbers I took were
//   against that 200 weight and made it look 7% narrower than it is.
//   assets/fonts/Manrope-Medium.ttf is pinned to 500 with fontTools.varLib.instancer.
//
// ⚠ NOT a MODULE_FLAGS key: it gates a TYPEFACE, not content, and has no waitlist. Same
//   reasoning as HOME_V2_LIVE and SHOW_WIZARD_HEADINGS — carried in EXPECTED_SCALARS so a
//   working-tree flip cannot ride out on an unrelated `eas update`.
//
// Reverting is this one boolean; nothing else depends on it.
export const TILE_FONT_MANROPE = false

// Home V2 (HOME_V2 redesign). false = HomeScreen renders today's hub — weather card,
// inline search bar, duty tile, three quick buttons, seventeen two-across white cards.
// true = the new anatomy: top bar, half-height district hero, Oli row, Nöbetçi row,
// bare-icon 4-across grid, footer ad slot.
//
// NOT a MODULE_FLAGS key, and that is a mechanical constraint rather than a preference.
// A true entry in that map trips two guards in scripts/check-module-flags.mjs — the
// WAITLIST_BLAST_DONE check ("LIVE but not listed in WAITLIST_BLAST_DONE") and the
// notify-path agreement, which requires the key to appear inside notify_module_waitlist
// and module_notif_text. HOME_V2 has no waitlist and cannot be notified about: it is a
// redesign of a surface every user already has, not content that becomes ready. Same
// reasoning that kept PROFILE_GATE_LIVE out of the map, and the same resolution — a
// scalar carried in EXPECTED_SCALARS, which gives identical `eas update` protection
// without the false failures.
//
// ⚠ IT SWAPS renderHub() AND NOTHING ELSE. HomeScreen's facility-list mode is
//   load-bearing for the profile gate — GATE_EXEMPT_SCREENS.health names this screen,
//   and the gate renders it with forceFacilityList / hideHeaderActions /
//   onExitFacilityList to grant a read-only directory WITHOUT the hub. If the V2 branch
//   ever reached that path, an incomplete profile would be handed the whole app. Both
//   flag states must leave that path byte-identical, and `npm run profile:check` is what
//   says so.
export const HOME_V2_LIVE = true   // live 2026-09-08

// Banner advertising (ad_banners). false = no banner slot renders anywhere, whatever is in
// the table — AdSlot returns null before it even reads. true = a sold, active, in-window ad
// draws in whichever slots are placed (today: home_footer only, at the foot of the V2 hub).
//
// NOT a MODULE_FLAGS key, and for the same mechanical reason HOME_V2_LIVE and
// PROFILE_GATE_LIVE are not: a true entry in that map trips the WAITLIST_BLAST_DONE check
// and the notify-path agreement in scripts/check-module-flags.mjs, both of which require
// the key to exist inside notify_module_waitlist and module_notif_text. Advertising has no
// waitlist and cannot be notified about — nobody signed up to be shown an advert. It is a
// scalar carried in EXPECTED_SCALARS, which gives identical `eas update` protection with no
// false failures.
//
// ⚠ FLIPPING THIS IS NOT BY ITSELF A GO-LIVE, AND THAT IS THE DESIGN. Every slot is unsold
//   until a row is INSERTed by hand, and ad_banners.is_active DEFAULTs to false, so a flip
//   with an empty table changes nothing a user can see. Going live is: seed the row
//   inactive, check the artwork and the destination, THEN flip is_active. Two deliberate
//   acts, neither of which is this boolean.
//
// ⚠ AND IT DOES NOT GATE THE DATA. Same lesson MODULE_FLAGS records about search: a flag
//   hides a SURFACE, never a table. ad_banners rows are publicly readable when active and
//   in-window regardless of this flag — which is harmless here (an ad row is artwork and a
//   link, not content a user could stumble into out of context) but is the reason the
//   is_active DEFAULT, and not this flag, is what keeps a draft campaign invisible.
export const AD_BANNERS_LIVE = false


// Ev Hizmetleri partner preview. false = the module shows only what the database
// returns, which is what production does and the only thing users ever see. true = the
// pinned card and the partner detail screen render from a LOCAL FIXTURE
// (constants/partnerPreview.js) that mirrors the seeded row, so the card, the district
// awareness, the list pin and dedupe, the gallery and the contact handoff can all be
// checked on device before the partner is approved.
//
// ⚠ IT IS A FIXTURE AND NOT A QUERY, AND THAT IS NOT A SHORTCUT. This flag used to swap
//   the query's status filter to 'pending'. It could never have worked: hs_select_public
//   exposes status='active' rows, the caller's own rows, and everything to admins — and
//   the seeded row is pending with owner_id NULL, so no customer and no anon session can
//   read it. Measured against the live database, even a query with NO status filter
//   returned zero rows while a control asking for any active row returned three. And the
//   one role that CAN read it, admin, never reaches this screen, because App.js is
//   role-first and renders AdminScreen instead. See constants/partnerPreview.js.
//
// ⚠ IT DOES NOT APPROVE THE ROW, and must not be "fixed" by doing so. search_content
//   gates on status='active' ALONE and has never heard of MODULE_FLAGS, so an approved
//   row is findable in global search while the module is still dark for everyone else.
//
// ⚠ UNREACHABLE IN PRODUCTION, NOT MERELY DEFAULTED OFF. HomeServicesScreen reads it as
//   `__DEV__ && PREVIEW_PENDING_PARTNERS`. Metro substitutes `__DEV__` with the literal
//   `false` in a release bundle, so the whole branch constant-folds and the shipped
//   module contains no reference to the fixture at all — verified by running Metro's own
//   inliner and constant folder over the file.
//
//   That is TWO independent guards, deliberately, because they fail differently: the
//   dead-code fold protects USERS (a flip cannot change a release bundle), and the
//   EXPECTED_SCALARS baseline in scripts/check-module-flags.mjs protects the REPO (a
//   flip cannot be pushed or ride out on `npm run ota`). Neither substitutes for the
//   other — `eas update` bundles the working tree and never runs a release fold.
//
// NOT a MODULE_FLAGS key: it gates nothing and reveals nothing. It changes where a
// developer's own build gets one row from. Same resolution as SHOW_WIZARD_HEADINGS.
export const PREVIEW_PENDING_PARTNERS = false

// Ev Hizmetleri self-registration. false = the module is PARTNER-ONLY: no "List your
// services" CTA, no onboarding form, no provider dashboard route, and no admin approval
// queue. true restores the open directory.
//
// A POLICY, EXPRESSED AS A FLAG, and the flag is only the app half. The database half
// shipped in 20261012 and is not reversed by flipping this: hs_insert_self is
// WITH CHECK (false), so the API refuses a self-registration INSERT whatever the UI
// shows, and hs_select_public requires is_partner, so a non-partner row is unreadable
// even if one existed. Flipping this back to true gives you the FORMS again and a
// database that still rejects what they submit — reverting the policy properly means
// reverting that migration too. Deliberate: a UI-only revert would otherwise look like
// it worked and fail at the moment a real tradesperson pressed Submit.
//
// ⚠ GO-LIVE IS THE ADMIN TAB, NOT SQL. AdminScreen's HomeServices tab approves a
//   home_services row, and it is no longer gated on this flag (2026-09-12). Approving
//   there works because the request carries a session — auth.uid() is non-null, so
//   hs_guard_owner_update reaches its is_admin branch instead of raising
//   'no system-context updates allowed', which is what it does for every SQL-editor
//   UPDATE regardless of who is running it.
//
//   A DISABLE TRIGGER / UPDATE / ENABLE TRIGGER block used to live here as the
//   workaround. DELETED 2026-09-12, and deliberately not replaced: ALTER TABLE ...
//   DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock and turns the guard off for EVERY
//   session, not the one running it — so a procedure written for one row, pasted in a
//   hurry, is an unguarded window on the whole table. A button that works is safer than
//   a documented way to switch the guard off.
//
//   Turning a partner OFF still needs no SQL: MODULE_FLAGS.homeServices over OTA.
//
// ⚠ REVERTING THE POLICY IS TWO STEPS, AND THIS FLAG IS ONLY THE FIRST. Setting it back
//   to true restores the CTA, the onboarding form, the provider route and the admin tab
//   over a database that STILL refuses what they submit: hs_insert_self is
//   WITH CHECK (false) and hs_select_public requires is_partner. The second step is the
//   REVERT block at the bottom of
//   supabase/migrations/20261012_home_services_partner_only.sql, and it must be applied
//   in the order written there — the read policy comes back before the column is dropped,
//   because the policy depends on it. A UI-only revert looks like it worked and fails at
//   the moment a real tradesperson presses Submit.
//
// Nothing is stranded by the provider-route gate: confirmed 2026-09-09 that NO account
// anywhere holds role='home_service_provider'. If one ever does while this is false,
// they fall through to the ordinary customer hub rather than to a dashboard for a
// listing they cannot have.
//
// NOT a MODULE_FLAGS key: it does not gate a module, it gates a FLOW inside one that is
// itself still dark. Same resolution as PREVIEW_PENDING_PARTNERS.
export const HS_SELF_REGISTRATION = false

// Yurtlar (dorm partners) — the fifth segment of Emlak & Konaklama. false = the chip is
// absent from the segment row, the showcase is unreachable, and the module opens on
// Satılık exactly as it does today. true = the chip appears FIRST with its accent dot and
// the module opens on it.
//
// NOT a MODULE_FLAGS key, and the reason is mechanical rather than stylistic. A true
// entry in that map trips three checks in scripts/check-module-flags.mjs — the
// WAITLIST_BLAST_DONE requirement, the notify_module_waitlist whitelist and the
// module_notif_text display name — plus the module_waitlist.module CHECK. All four exist
// to make sure a module that goes live can notify the people who asked to be told. This
// gates a SEGMENT inside a module that is already live (MODULE_FLAGS.accommodation is
// true), so there is no Coming Soon screen to collect a waitlist from and nothing to
// notify. Same resolution, and the same reasoning, as HOME_V2_LIVE, AD_BANNERS_LIVE and
// PROFILE_GATE_LIVE above; carried in EXPECTED_SCALARS so a working-tree flip still
// cannot ride out on an unrelated `eas update`.
//
// ⚠ IT ALSO MOVES THE LANDING TAB, WHICH IS WHY constants/dorms.js DERIVES IT.
//   ACCOM_LANDING is 'dorm'. With this false, accomLanding() falls back to the first
//   VISIBLE segment — 'sale' — so the dark state is correct by construction. Reading
//   ACCOM_LANDING directly would open the module on a tab that is not in the chip row.
//
// ⚠ IT DOES NOT GATE ANY DATA, because there is no data to gate. Dorm partners live in
//   constants/dorms.js, not in a table, so nothing is publicly readable and nothing is
//   findable in search whatever this is set to. That is the whole reason the config-only
//   shape was chosen — the usual "a flag hides a SURFACE, never a table" hazard has no
//   table to apply to here.
//
// ⚠ PRECONDITION — APPLY 20261014_contact_events_website_action.sql BEFORE FLIPPING THIS.
//   The showcase's website CTA calls logContactEvent(..., 'website'), and until that
//   migration is applied `contact_events_action_check` rejects the row. logContactEvent is
//   fire-and-forget and CANNOT THROW by design — it runs before Linking.openURL so a
//   hanging write never costs somebody their tap — so the rejection is swallowed. Nothing
//   errors, nothing crashes, and website taps read as a permanent ZERO that is
//   indistinguishable from nobody tapping. Verify with supabase/verify_schema.sql's
//   20261014_website_action tokens, which assert the constraint DEFINITION rather than its
//   name (the name never went away, so the E-section token cannot see this).
//
// Reverting is this one boolean, and so is the emergency direction.
export const DORMS_LIVE = false
