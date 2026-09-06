// Home V2 module grid — the whole grid, as data.
//
// ─── WHY THIS IS A CONFIG FILE AND NOT A LIST INSIDE HomeScreen ─────────────
//
// A wider consolidation pass (combining and removing modules) is coming, and the grid
// has to survive it as an EDIT rather than a rewrite. So the row below carries
// everything that decides how a tile looks and where it sits, and the grid component
// carries no knowledge of any particular module. Adding, removing or reordering a tile
// is a change to this array and nothing else — no layout code, no styles, no JSX.
//
//   id         stable identifier, also the key the handler map in HomeScreen uses
//   icon       Ionicons outline name (no icon-library change: @expo/vector-icons)
//   tint       urgent | standard — see the urgency encoding below
//   labelKey   i18n key, resolved in all 9 locales
//   opensModal true for the two entries that are modals rather than screens
//
// ─── THE TINT ENCODES URGENCY, AND ONLY URGENCY ─────────────────────────────
//
// TWO values, not three. The previous set (urgent / service / lifestyle) was a
// CATEGORY split, and as a visual system it said nothing: Games and Pets were coral
// while Insurance and Transport were teal, which no user could have derived a rule from
// and which spent the palette's only strong signal on a distinction nobody needs at a
// glance.
//
//   urgent    coral — the things somebody opens the app FOR in an emergency:
//             health facilities, emergency numbers, towing/roadside. (Duty pharmacy is
//             the fourth, and it is the permanent Nöbetçi row above this grid rather
//             than a tile — it already carries the same coral.)
//   standard  teal — everything else.
//
// The two families carry EQUAL tint strength (a pale background, a saturated icon) so
// that neither reads as disabled or secondary. Teal is not "off"; it is "not urgent".
//
// ⚠ COLOUR IS NOT THE SOLE CARRIER OF MEANING, and that is a property to preserve, not
//   a claim to repeat. All 19 icons are distinct and every tile is labelled, so the
//   grid is fully usable in greyscale and to a red-green colourblind reader. Do not add
//   an affordance whose only signal is its colour.
//
// ⚠ RECOLOURING A MODULE IS A DATA CHANGE — edit its `tint` here. There is deliberately
//   no id list anywhere in the rendering code; ModuleGrid maps `tint` to a pair and
//   knows nothing about which module is which.
//
// ─── EVERY MODULE, FOR EVERY USER — AND WHAT THAT CHANGED ───────────────────
//
// The V1 grid hid two tiles conditionally: garages behind `garagesTileVisible`
// (GARAGES_LIVE || admin || ownsGarage) and towing behind MODULE_FLAGS.towing. Both
// filters are gone. A dark module now renders its tile and routes to Coming Soon
// through the gates already in App.js, which is the towing lesson applied: a flag-gated
// ENTRY POINT hides the very demand the flag is waiting for — towing collected exactly
// zero waitlist signups because nobody could reach its Coming Soon screen to sign up.
//
// The visible consequence, named rather than discovered later: the garages tile is now
// public for the first time. That is accepted — garages is a likely removal in the
// consolidation pass, so special-casing it here would be scaffolding for something on
// its way out.
//
// ─── WHAT IS NOT HERE ───────────────────────────────────────────────────────
//
// • Duty pharmacies. It has its own permanent Nöbetçi row above the grid; a tile as
//   well would be the same destination twice on one screen.
// • Beaches. Folded into `explore` — the V1 tile opened ExploreScreen with
//   initialCategory="beach", i.e. the same screen the explore tile opens. Beaches
//   survives as an Explore group, not as a Home tile.
// • eat_drink. A taxonomy row inside Explore (constants/exploreCategories.js), never a
//   module of its own.

// ─── HIDDEN_TILES — GRID VISIBILITY, DELIBERATELY NOT A MODULE FLAG ─────────
//
// A tile named here is not rendered in the grid, is not offered in the Düzenle sheet and
// cannot auto-fill a shortcut slot. Everything else about the module is untouched: its
// screen, its route, its handler and its MODULE_FLAGS entry all still exist, so unhiding
// is deleting one line.
//
// ⚠ WHY NOT MODULE_FLAGS. A MODULE_FLAGS key is a WAITLIST STORY. scripts/check-module-flags.mjs
//   requires every live key to appear in WAITLIST_BLAST_DONE, and the notify-path check
//   requires it inside notify_module_waitlist and module_notif_text — three places, one of
//   them a database function. That machinery exists so a module going LIVE notifies the
//   people who asked for it. Hiding a tile for a month is not that story, and minting a
//   flag for it would put a fake waitlist entry in the notify path forever.
//
// ⚠ AND THIS IS THE FIRST THING THAT HIDES ANYTHING FROM THE V2 GRID AT ALL. V1 filtered
//   two tiles (garages behind garagesTileVisible, towing behind its flag); V2 deliberately
//   filters NONE — see the note below on every module for every user. So a dark module has
//   been rendering to every user by design since Slice 1, which is the answer to "why can
//   I see grooming and garages": that is the towing lesson working, not a bug.
//
// ⚠ HIDING IS NOT DARK-LAUNCHING. A dark module still renders its tile and routes to
//   Coming Soon, which is how it collects demand. A HIDDEN module collects nothing —
//   nobody can reach its waitlist. That is the correct trade only when the tile is being
//   removed for a REASON OTHER than "not ready yet". Read the per-entry notes below.
export const HIDDEN_TILES = new Set([
  // Both are already dark, so this is belt-and-braces rather than a change in what a tap
  // does — it changes whether the tap is offered at all. Accepted knowingly: neither has a
  // waitlist worth collecting, and a Coming Soon screen for a service category with no
  // providers reads as an empty app rather than as a promise.
  'grooming',
  'garages',
  // ─── explore, 2026-09-13 ─────────────────────────────────────────────────
  // Hidden for a DIFFERENT reason from the two above, and the difference matters if this
  // is ever revisited: grooming and garages are hidden because they are empty, while the
  // places directory is hidden because the Keşfet TAB covers the same content better —
  // with a map, and now with a map/list control that reaches the same browsable screen.
  //
  // ⚠ IT WAS NOT HIDDEN UNTIL THAT CONTROL SHIPPED AND WAS CHECKED ON DEVICE. Until
  //   2026-09-11 this tile was the ONLY non-admin entrance to the directory, so hiding it
  //   would have stranded the 2-level taxonomy, the ownership guards, the claimed listings
  //   and the featured tier. If the map/list control is ever removed, this line has to come
  //   out in the same commit.
  'explore',
])

export const HOME_MODULES = [
  // Urgent first. These are what somebody opens the app FOR at 2am, and the profile
  // gate's exemption list (constants/profileGate.js) names the same three concerns.
  { id: 'health',             icon: 'medkit-outline',           tint: 'urgent',   labelKey: 'hubMedicalTitle' },
  { id: 'emergency',          icon: 'call-outline',             tint: 'urgent',   labelKey: 'menuEmergency', opensModal: true },
  { id: 'towing',             icon: 'car-outline',              tint: 'urgent',   labelKey: 'menuTowing' },

  // Everyday life.
  { id: 'events',             icon: 'calendar-outline',         tint: 'standard', labelKey: 'menuEvents' },
  // menuPlaces, NOT menuExplore: the bottom-nav tab owns 'Keşfet'. This tile opens the
  // browsable DIRECTORY, the one thing the map tab does not offer. Icon must not be
  // compass-outline either — that is the tab's icon.
  { id: 'explore',            icon: 'albums-outline',           tint: 'standard', labelKey: 'menuPlaces' },
  { id: 'accommodation',      icon: 'home-outline',             tint: 'standard', labelKey: 'menuAccommodations' },
  { id: 'pets',               icon: 'paw-outline',              tint: 'standard', labelKey: 'menuPets' },
  { id: 'games',              icon: 'game-controller-outline',  tint: 'standard', labelKey: 'menuGames' },

  // Getting things done.
  { id: 'jobPostings',        icon: 'briefcase-outline',        tint: 'standard', labelKey: 'menuJobPostings' },
  { id: 'homeServices',       icon: 'hammer-outline',           tint: 'standard', labelKey: 'menuHomeServices' },
  { id: 'transport',          icon: 'bus-outline',              tint: 'standard', labelKey: 'menuTransportation' },
  { id: 'garages',            icon: 'car-sport-outline',        tint: 'standard', labelKey: 'menuGarages' },
  { id: 'insurance',          icon: 'shield-checkmark-outline', tint: 'standard', labelKey: 'menuInsurance' },
  { id: 'grooming',           icon: 'cut-outline',              tint: 'standard', labelKey: 'menuGrooming' },

  // Settling in.
  { id: 'newcomerEssentials', icon: 'compass-outline',          tint: 'standard', labelKey: 'menuNewcomerEssentials' },
  { id: 'exchangeRates',      icon: 'trending-up-outline',      tint: 'standard', labelKey: 'menuExchangeRates' },
  { id: 'esim',               icon: 'cellular-outline',         tint: 'standard', labelKey: 'menuEsim' },
  { id: 'studentHub',         icon: 'school-outline',           tint: 'standard', labelKey: 'menuStudentHub' },
  { id: 'municipal',          icon: 'business-outline',         tint: 'standard', labelKey: 'menuMunicipalities', opensModal: true },
]

// ─── THE FIXED LABEL HEIGHT, AND WHY IT IS A NUMBER RATHER THAN A MIN ───────
//
// Turkish, German and Russian labels are materially longer than English —
// "Nöbetçi Eczaneler", "Unterkünfte", "Обмен валюты" — so a label box that sizes to its
// content makes every row in the grid a different height, and the grid reflows the
// moment somebody switches language. Two lines at 15pt line-height is the measured
// worst case across the nine locales for the labels above; the box is that height
// ALWAYS, empty space included, so a one-word English label and a two-line Turkish one
// occupy identical space and the grid is the same shape in every language.
//
// numberOfLines={2} on the Text is the other half: without it a third line pushes past
// the box instead of ellipsing.
// RETUNED 2026-09-03 (polish round 2). 15 was tight for 11pt — roughly 1.36x, which is
// caption spacing, not label spacing, and two lines of it looked cramped. 16 is ~1.45x
// and lets the second line breathe. The BOX is still exactly two lines tall, which is
// the requirement that stands: every tile is the same height in every locale, so the
// grid cannot reshape when the language changes.
export const GRID_LABEL_LINE_HEIGHT = 16
export const GRID_LABEL_HEIGHT = GRID_LABEL_LINE_HEIGHT * 2
export const GRID_COLUMNS = 4
