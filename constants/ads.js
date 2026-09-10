// Banner advertising — the whole vocabulary and the whole policy, as data.
//
// Extension-free and React-Native-free ON PURPOSE: scripts/check-ad-placement.mjs imports
// this module under plain Node to derive what it enforces. An `import { View } from
// 'react-native'` here would break the guard and not the app, which is the worst place for
// a failure to appear. Same constraint constants/homeStrip.js carries, for the same reason.
//
// Schema, RLS and the counter RPC: supabase/migrations/20261008_ad_banners.sql,
// restructured into this model by 20261009_ad_slots_position_module.sql.

// ─── POSITION × MODULE, NOT ONE ID PER COMBINATION ──────────────────────────
//
// An ad row says "list_top on accommodation". The first scheme minted a flat id per
// combination (home_hero, module_landing, guide_inline…) and it did not survive contact
// with the screens: the ids were names nobody had designed, and a flat vocabulary cannot
// express "the same shape, on a different module" without a new id and a new migration.
//
// POSITION is a CHECK constraint and changing it IS a migration — deliberately. A new
// position is a new component shape, so it is a code change either way, and the CHECK
// forces that to be reviewed.
//
// MODULE is a foreign key into `ad_modules`, so adding one is an INSERT.
//
// ⚠ BUT "ADDING A MODULE IS A DATA CHANGE" IS TRUE OF THE DATABASE ONLY. An INSERT into
//   ad_modules makes the row insertable. NOTHING RENDERS until a wrapper in components/ads/
//   is mounted on that module's screen, allowlisted here, and shipped by OTA. The FK
//   removes the migration, not the code. Do not sell a placement on the strength of the
//   lookup row existing.
export const AD_POSITIONS = [
  'list_top',       // top of a module's list, scrolling with it — never sticky
  'list_inline',    // ONCE per list, after the Nth item, never repeated
  'list_bottom',    // end of a module's list
  'detail_bottom',  // end of a detail screen's scroll content
]

// Mirrors the seed of `ad_modules`. The FK is the authority; this is what the app knows.
//
// ⚠ `home` IS A MODULE HERE AND NOWHERE ELSE. It is not a MODULE_FLAGS key and not a
//   HOME_MODULES id — Home is a hub, not a directory. It is in this vocabulary because
//   the old `home_footer` slot migrated into (list_bottom, home) and one scheme beats two.
//
// ⚠ `newcomerEssentials` IS DELIBERATELY ABSENT — from this array AND from the ad_modules
//   seed. See AD_DEFERRED_MODULES below. It is not an oversight and it is not a rejection.
export const AD_MODULES = ['home', 'accommodation', 'events', 'explore']

// Modules considered for round one and deliberately NOT seeded. Recorded here rather than
// only in the vault, because the reason is a constraint on a future change.
export const AD_DEFERRED_MODULES = {
  newcomerEssentials:
    'The Welcome Guide has NO LIST — a 7-tile hub grid plus seven card ScrollViews, so ' +
    'list_top/list_bottom have nothing to attach to and list_inline (after the 8th item) ' +
    'can never fire against 7 tiles. Only a bottom-of-card slot is meaningful, and that ' +
    'needs seven mounts or a shared card wrapper that does not exist. NOT seeded into ' +
    'ad_modules on purpose: a lookup row with no placeable position accepts a PAID row ' +
    'that renders nowhere and passes every check — inert inventory that looks sold. ' +
    'This is genuinely valuable inventory (newcomers land here) and worth building the ' +
    'day a buyer names it; the one INSERT is then the review moment.',
}

// ─── THE PLACEMENTS THAT EXIST, AND THE FILES ALLOWED TO MOUNT THEM ─────────
//
// EXHAUSTIVE. A file not listed here that imports components/AdSlot fails the guard, and
// a file listed here that also appears in AD_EXCLUDED_SURFACES fails it too — so the
// allowlist cannot be widened INTO an excluded surface by editing one array. That second
// rule is the one that catches the tempting argument "explore is an allowed module, so
// its detail screen is fine": FacilityProfileScreen is reachable from Explore's map and
// is excluded BY FILE, and the module being allowed does not reach it.
//
// `hosts` is the LIST of screens the wrapper may be mounted in. `span` pins it to one
// function inside that screen, for the files that host more than one surface — EventsScreen
// holds the list AND EventDetailScreen (defined at its line 319), and HomeScreen holds the
// hub, the global search results and the gated facility list. A whole-file rule cannot tell
// those apart, and two of HomeScreen's three surfaces are on the exclusion list.
//
// ⚠ WHY `hosts` IS A LIST AND NOT A STRING. One position/module pair is ONE slot and one
//   sold row — the guard enforces that pair is unique, and that uniqueness is what keeps
//   this allowlist a 1:1 map. But one slot can legitimately appear on two SCREENS of the
//   same module: an accommodation detail_bottom belongs at the foot of a property listing
//   AND at the foot of a partner showcase. The alternative was a second wrapper claiming
//   the same pair, which the uniqueness rule exists to forbid, or a new AD_POSITION, which
//   is a migration and would describe the same component shape twice.
//
//   A placement carrying a `span` must declare exactly ONE host: a span is a byte offset
//   inside one file and has no meaning across two.
export const AD_PLACEMENTS = [
  { file: 'components/ads/HomeListBottomSlot.js',            position: 'list_bottom',   module: 'home',
    hosts: ['screens/HomeScreen.js'],            span: 'renderHubV2' },

  { file: 'components/ads/AccommodationListTopSlot.js',      position: 'list_top',      module: 'accommodation',
    hosts: ['screens/AccommodationScreen.js'] },
  { file: 'components/ads/AccommodationListInlineSlot.js',   position: 'list_inline',   module: 'accommodation',
    hosts: ['screens/AccommodationScreen.js'] },
  { file: 'components/ads/AccommodationListBottomSlot.js',   position: 'list_bottom',   module: 'accommodation',
    hosts: ['screens/AccommodationScreen.js'] },
  // ─── TWO HOSTS, AND WHOEVER SELLS THIS SLOT NEEDS TO KNOW ─────────────────
  //
  // ⚠ AN ACCOMMODATION detail_bottom ROW RENDERS ON PARTNER SHOWCASE PAGES TOO, not only on
  //   ordinary property listings. One sold row, both surfaces — that is what "same slots,
  //   same rules" means, and it is deliberate.
  //
  //   THERE IS NO CODE-LEVEL COMPETITOR SUPPRESSION AND THERE WILL NOT BE ONE. Nothing here
  //   stops a rival dorm's banner rendering at the foot of Alasia's own page. That question
  //   is handled COMMERCIALLY, by not selling it, and this comment is the only thing
  //   standing between the two — the ad table has no way to tell anyone. If you are about
  //   to INSERT a detail_bottom/accommodation row, this is where it lands.
  { file: 'components/ads/AccommodationDetailBottomSlot.js', position: 'detail_bottom', module: 'accommodation',
    hosts: ['screens/PropertyDetailScreen.js', 'screens/DormPartnerScreen.js'] },

  { file: 'components/ads/EventsListTopSlot.js',             position: 'list_top',      module: 'events',
    hosts: ['screens/EventsScreen.js'],          span: 'EventsScreen' },
  { file: 'components/ads/EventsListInlineSlot.js',          position: 'list_inline',   module: 'events',
    hosts: ['screens/EventsScreen.js'],          span: 'EventsScreen' },
  { file: 'components/ads/EventsListBottomSlot.js',          position: 'list_bottom',   module: 'events',
    hosts: ['screens/EventsScreen.js'],          span: 'EventsScreen' },
  { file: 'components/ads/EventsDetailBottomSlot.js',        position: 'detail_bottom', module: 'events',
    hosts: ['screens/EventsScreen.js'],          span: 'EventDetailScreen' },

  { file: 'components/ads/ExploreListTopSlot.js',            position: 'list_top',      module: 'explore',
    hosts: ['screens/ExploreScreen.js'] },
  { file: 'components/ads/ExploreListInlineSlot.js',         position: 'list_inline',   module: 'explore',
    hosts: ['screens/ExploreScreen.js'] },
  { file: 'components/ads/ExploreDetailBottomSlot.js',       position: 'detail_bottom', module: 'explore',
    hosts: ['screens/ExploreProfileScreen.js'] },
]

// ─── PLACEMENTS CONSIDERED AND REJECTED ─────────────────────────────────────
// Recorded because the reason is a constraint on anyone who tries to add them later.
export const AD_REJECTED_PLACEMENTS = {
  'list_bottom/explore':
    'ExploreScreen carries a 52x52 FAB at bottom:24 right:16 that floats over EVERY ' +
    'branch, and listContent paddingBottom is 40 — less than the FAB footprint. A ' +
    'full-width banner at the end of the list renders underneath it. Raising the inset ' +
    'to make room would degrade the module to sell a placement nobody has asked for.',
  'list_top/explore-landing':
    'Explore has five mutually-exclusive branches. Only the DRILLED-IN CATEGORY LIST is ' +
    'ad-bearing. Not the group-tile landing, not the saved list, and NEVER the map: ' +
    'ExploreMapScreen draws health pins and is two taps from FacilityProfileScreen.',
}

// ─── IN-APP DESTINATIONS ────────────────────────────────────────────────────
//
// Mirrors ad_banners_route_check. Every id here must be a key of HomeScreen's
// moduleHandlers map, because that map is what turns a route into a screen.
//
// ⚠ THE ABSENCES ARE THE POINT. health, emergency and duty are NOT here, and `search` is
//   not a destination at all. The exclusion list forbids ads ON those surfaces; sending a
//   PAID banner INTO one monetises it at one remove.
export const AD_ROUTES = [
  'accommodation', 'beaches', 'esim', 'events', 'exchangeRates', 'explore', 'games',
  'garages', 'grooming', 'homeServices', 'insurance', 'jobPostings', 'municipal',
  'newcomerEssentials', 'pets', 'studentHub', 'towing', 'transport',
]

export const AD_EXCLUDED_ROUTES = ['health', 'emergency', 'duty', 'search']

// ─── THE PERMANENT EXCLUSION LIST, AS FILE PATHS ────────────────────────────
//
// NO ADS ON: duty pharmacy, emergency contacts, health facilities, search results, push
// notifications, Ask Oli.
//
// ⚠ ENFORCED PER SCREEN, NOT PER MODULE, AND THAT DISTINCTION IS THE WHOLE DESIGN. Explore
//   is an allowed module; a health facility profile is reachable from Explore's MAP; and
//   `detail_bottom` is a position, not a screen. Only a file path identifies a surface.
//
//   Verified while designing round one, five ways, and it is why explore/detail_bottom is
//   safe: ExploreProfileScreen CANNOT render a health facility. The Explore taxonomy has
//   16 categories and none is health (constants/exploreCategories.js); the screen takes
//   `place` as a prop and never queries for it; all three feeders read `places` filtered
//   to status='active'; HomeScreen's search routes `medical` hits to FacilityProfileScreen
//   instead; and constants/mapSources.js drops any row whose category has no group.
//   The Explore→health path is ExploreMapScreen, a different file, excluded below.
export const AD_EXCLUDED_SURFACES = {
  'App.js':                           'emergency contacts modal (155/112/199) + the language sheet',
  'screens/DutyListScreen.js':        'duty pharmacy — the one screen somebody opens this app for at 2am',
  'screens/FacilityProfileScreen.js': 'health facilities',
  'components/SearchModal.js':        'search results',
  'components/OliGuide.js':           'Ask Oli',
  'screens/NotificationsScreen.js':   'the notification inbox — the in-app face of push',
  'utils/notify.js':                  'push notification composition',
  // ─── The two maps, excluded EXPLICITLY rather than merely left un-allowlisted ──
  // ExploreMapScreen draws pharmacy/clinic/hospital/dentist pins and its PinCard "View
  // profile" calls onSelectFacility -> FacilityProfileScreen. It is two taps from an
  // excluded surface and it draws health content itself. MapScreen is the health-only map
  // the Keşfet tab replaced and is health by definition. Neither has a list to host an ad
  // anyway — naming them makes that a rule instead of an accident of there being nowhere
  // convenient to put one.
  'screens/ExploreMapScreen.js':      'draws health facility pins; two taps from FacilityProfileScreen',
  'screens/MapScreen.js':             'the health-only facilities map',
}

// Derived from AD_PLACEMENTS — never hand-maintained, so it cannot disagree with it.
export const AD_MOUNT_ALLOWLIST = AD_PLACEMENTS.map(p => p.file)

// ─── GEOMETRY ───────────────────────────────────────────────────────────────
//
// TWO creative specs, and the split is deliberate.
//
// 3.2:1 — list_top, list_bottom, detail_bottom. ONE spec across three positions so an
// advertiser supplies ONE image for all of them.
//
// 6.4:1 — list_inline ONLY, and it must look nothing like a listing. An ad shaped like a
// row in a directory people trust is the fastest way to make the directory untrustworthy.
// See AD_INLINE_* below for the four structural reasons this one cannot be mistaken for
// a list item.
//
// ⚠ SUPPLIED AT 2x. 640x200 and 640x100. A 320x100 asset upscales ~1.13x at 393dp and
//   worse on larger phones — soft on exactly the surface being sold. The RATIOS are the
//   contract; the pixel counts are the density the artwork must be authored at, and they
//   are what the rate card prints.
export const AD_BANNER_W = 640
export const AD_BANNER_H = 200
export const AD_BANNER_RATIO = AD_BANNER_W / AD_BANNER_H     // 3.2

export const AD_INLINE_W = 640
export const AD_INLINE_H = 100
export const AD_INLINE_RATIO = AD_INLINE_W / AD_INLINE_H     // 6.4

// Below this, a deviation is rounding; above it, somebody sent the wrong file.
export const AD_RATIO_TOLERANCE = 0.02

export function adRatioFor(position) {
  return position === 'list_inline' ? AD_INLINE_RATIO : AD_BANNER_RATIO
}
export function adSpecFor(position) {
  return position === 'list_inline'
    ? { w: AD_INLINE_W, h: AD_INLINE_H, ratio: AD_INLINE_RATIO }
    : { w: AD_BANNER_W, h: AD_BANNER_H, ratio: AD_BANNER_RATIO }
}

// Every ad-bearing list screen insets its content by this much. list_inline breaks OUT of
// it with a negative margin to run full-bleed, which is structural reason #1 below — so
// this number is a CONTRACT with those screens, not a local style value. The guard asserts
// each hosting screen actually uses it.
export const AD_PAGE_INSET = 16

// ─── WHY list_inline CANNOT BE MISTAKEN FOR A LIST ITEM ─────────────────────
//
// Four structural differences. NONE of them requires the user to read anything, and none
// depends on colour — so the distinction survives greyscale, a red-green colourblind
// reader, and a glance at arm's length:
//
//   1. IT BREAKS THE INSET. Every card in all three modules is inset AD_PAGE_INSET with a
//      radius. This touches both screen edges and has SQUARE corners.
//   2. IT IS HALF THE HEIGHT. A listing card is ~90-120pt; this is ~61pt at 393dp.
//   3. IT HAS NO APP-STYLED TEXT BLOCK. Every list item carries a title and subtitle in
//      ADA's typography. This has none — all advertiser text lives inside their artwork.
//   4. THE LABEL IS OUTSIDE THE CREATIVE. A chip drawn ON the artwork can be blended into
//      it by a competent designer. A caption rendered in the page gutter, in our font,
//      above the image, cannot be touched by the advertiser at all.
//
// Reason 4 is the one that does the real work, and it is why the inline variant does NOT
// use the overlay chip the 3.2:1 banner uses.
export const AD_INLINE_RULE_HAIRLINE = 1

// ─── CREATIVE PATHS ARE WRITE-ONCE. NEVER REPLACE ARTWORK AT A LIVE PATH. ──
//
// React Native's Image caches on disk keyed by URI. Replacing the bytes at a URL a device
// has already loaded does NOT update that device: it keeps drawing the old image until its
// cache evicts, which killing and relaunching the app does not do. Measured here on
// 2026-09-17 — corrected artwork was live in the bucket, verified by sha256 from the
// server, and the device still showed the previous version 2.5 hours later.
//
// ⚠ THIS IS AN ADVERTISER-FACING FAILURE, NOT A TEST ARTEFACT. A campaign whose creative is
//   swapped mid-flight would keep showing the OLD image on every device that had already
//   loaded it — and those are precisely the engaged users. The advertiser sees the new
//   artwork on their own fresh install and has no way to know.
//
// THE RULE: every creative gets its own path. Never overwrite one that has been live.
//   ad-images/<advertiser>/<yyyy-mm-dd>-<slug>.png
//
// ⚠ WHY THIS IS A CONVENTION AND NOT SOMETHING AdSlot HANDLES. Three candidate component
//   fixes, and all three are worse:
//     • Append a timestamp at render time — defeats caching entirely. This image is
//       fetched on essentially every app open; making it uncacheable is a real cost paid
//       forever to fix a rare event.
//     • Append a version column the admin bumps — back to "someone must remember", with
//       the failure now buried in a column instead of in a filename.
//     • Append `updated_at`, maintained by a trigger, so it cannot be forgotten — POISONED
//       BY THE COUNTER. bump_ad_counter does `UPDATE ad_banners SET view_count = ...` on
//       the same row on every view, so an updated_at trigger would fire on every view, the
//       URI would change constantly, and caching would be defeated exactly as in the first
//       option — but unpredictably.
//   A unique path has no failure mode in the serving path at all: two creatives, two URLs,
//   no invalidation to get right.
//
// ESCAPE HATCH, if a path ever must be reused: append a query string to `image_url` in the
// row — `?v=2`. Supabase Storage ignores unknown params and serves the object (verified,
// 200 + matching sha256), and the differing URI misses RN's cache. It is a DATA change, no
// code, no re-upload. Do not reach for it as the normal path.
//
// ⚠ NOTHING MECHANICAL ENFORCES THIS. scripts/check-ad-placement.mjs reads FILES and cannot
//   see image_url; a CHECK constraint cannot know a path's history; and one creative
//   legitimately serves many rows (the round-one test seed shares two files across twelve).
//   It is a convention, and this paragraph is the whole of its enforcement. Said plainly so
//   nobody mistakes a green guard run for coverage of it.

// ─── DISCLOSURE ─────────────────────────────────────────────────────────────
//
// ONE switch, read in exactly one place (components/AdSlot.js), so revisiting this with
// the marketing side costs one boolean.
//
// ⚠ SHIPPING LABELLED AND REMOVING LATER IS THE SAFE ORDER. Shipping unlabelled to a
//   declared 13-17 audience is not. The live strip already labels every promo "Sponsorlu",
//   and home_strip_pin_sponsor_check exists to make an unattributable sponsor an
//   incomplete row; a banner less disclosed than the strip is a regression against our own
//   precedent.
//
// Reuses the existing `stripSponsored` key — already translated in all nine locales, so
// this whole slice adds NO new string and cannot drift from the strip's word.
export const AD_SHOW_SPONSORED_LABEL = true
export const AD_SPONSORED_KEY = 'stripSponsored'
