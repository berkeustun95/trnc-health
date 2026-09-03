// Home hero — the district photo, and the Explore place it opens.
//
// ─── WHY BUNDLED ASSETS AND NOT places.cover_image_url ──────────────────────
//
// The obvious source is the place's own cover photo, and it is the wrong one. Those
// images are Wikimedia-seeded and carry attribution obligations that ExploreProfileScreen
// honours with a visible credit line and a source link (utils/photoAttribution.js). The
// hero has no attribution UI and cannot grow one without becoming a different design —
// a photo credit over a district name is not a hero, it is a caption. So the hero shows
// only images ADA owns or has licensed outright, bundled with the app.
//
// The side benefit is that it works offline and paints on the first frame: no request,
// no skeleton, no layout shift. That is a consequence of the licensing decision, not the
// reason for it.
//
// ─── THE TWO CONDITIONS ARE SEPARATE, AND BOTH ARE HERE ─────────────────────
//
//   asset   — null means we have no licensed photo for this district yet, so the hero
//             falls back to the generic ADA image.
//   placeId — the Explore place the hero deep-links to.
//
// The product rule is that a GENERIC hero is never tappable: an ADA-branded gradient
// that silently opens a monument the user cannot see in it is a mis-tap generator, not
// a shortcut. resolveHero() below derives tappability from the pair rather than letting
// a caller decide, so the rule cannot be half-applied at one call site.
//
// ⚠ ADDING A DISTRICT PHOTO IS ONE LINE. Drop the file in assets/hero/ and replace the
//   null with a require(). Nothing else changes — the hero becomes a real photo and
//   becomes tappable in the same edit, because those are the same condition.
//
// ─── THE placeIds ARE REAL AND WERE READ FROM THE DATABASE ──────────────────
//
// Queried 2026-09-03 against public.places as anon (status='active', which is exactly
// what the client can see), one row per region, chosen as the district's most
// recognisable destination. All seven regions have at least one active place, so no
// region is structurally photo-less — a NULL asset here is a missing photo, never a
// missing place. A placeId that stops resolving is a graceful no-op, not a crash:
// HomeScreen's lookup is .eq('status','active').maybeSingle(), which returns
// {data: null, error: null} on zero rows.

import { REGIONS } from './regions'

export const HOME_HERO = {
  nicosia:   { placeId: '1100ad4c-a412-4528-b96d-c2543fd23b25', asset: null },  // Büyük Han
  kyrenia:   { placeId: '7ecf2c84-2192-45c9-b075-a2ce115f842c', asset: null },  // Kyrenia Castle
  famagusta: { placeId: '9abee5c9-0d44-4a34-abef-04e3260151d1', asset: null },  // Othello Castle
  morphou:   { placeId: '9f14da0c-e9a2-4489-81e2-20973b662942', asset: null },  // St. Mamas Church
  iskele:    { placeId: '88def13a-3ee3-4c3b-bb7b-56bf15f27f33', asset: null },  // Kantara Castle
  lefke:     { placeId: '328fad9c-9da7-4273-a638-1682de89da39', asset: null },  // Soli Ruins
  karpaz:    { placeId: '2392247c-9cd3-446a-8eeb-588fdd9ea50a', asset: null },  // Apostolos Andreas
}

// The fallback image. auth-bg.png is already the Home background and already ships in
// every bundle, so a district with no photo costs zero additional bytes.
export const HERO_GENERIC = require('../assets/auth-bg.png')

// Resolve a region slug to everything the hero needs. An unknown or null slug — a guest
// with location denied and no profile.region — lands on the generic, which is the same
// state as a known district with no photo yet. One code path, not two.
export function resolveHero(region) {
  const entry = region && HOME_HERO[region]
  const hasPhoto = !!entry?.asset
  return {
    source:   hasPhoto ? entry.asset : HERO_GENERIC,
    isGeneric: !hasPhoto,
    // Tappable ONLY when a real district photo is on screen AND it maps to a place.
    // Both halves, deliberately: see the note above.
    placeId:  hasPhoto ? entry.placeId : null,
  }
}

// Every canonical region should have an entry, or a district silently loses its hero the
// day somebody adds an eighth slug to regions.js.
//
// ⚠ A WARNING AND NOT A THROW, DELIBERATELY. The first draft threw at import time, which
//   would have turned one developer's editing mistake into an app that will not START
//   for anybody — and for nothing, because resolveHero() above ALREADY degrades a missing
//   or unknown region to the generic hero correctly. The throw guarded a case the code
//   handles, at the price of a launch crash. __DEV__ puts the message where the mistake
//   is made and nowhere near a user.
if (__DEV__) {
  const missing = REGIONS.filter(r => !HOME_HERO[r])
  if (missing.length) {
    console.warn(`homeHero.js: no entry for region(s) ${missing.join(', ')} — those districts fall back to the generic hero`)
  }
}
