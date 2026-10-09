import Constants from 'expo-constants'
import { REDESIGN_LIVE, MODULE_FLAGS } from './flags'

// The one switch every redesigned surface reads. On when:
//   • REDESIGN_LIVE is flipped (go-live, both files in one commit — the flag guard), or
//   • the bundle is a dev bundle (__DEV__: Expo Go on the redesign branch), or
//   • the binary is ADA Preview: app.config.js sets extra.appVariant = 'preview' ONLY when
//     APP_VARIANT=preview, so the production config carries no such key and a production
//     build or `npm run ota` can never switch this on by itself.
// Kept out of flags.js because node scripts import flags.js, and they cannot load expo-constants.
const IS_PREVIEW_BUILD = Constants.expoConfig?.extra?.appVariant === 'preview'

export const REDESIGN = REDESIGN_LIVE || (typeof __DEV__ !== 'undefined' && __DEV__) || IS_PREVIEW_BUILD

// Check-ins (20261092) before go-live: dev bundles, and ADA Preview while CHECKINS_PREVIEW is
// true; the flag stays off. `npm run ota` (production, no APP_VARIANT) can never switch it on.
// CHECKINS_PREVIEW is FALSE for the Explore restyle launch (2026-10-03) so ADA Preview shows
// exactly what production will — no check-in UI. Flip it to true at check-ins go-live step 3
// (CLAUDE.md), when 20261092 is applied and preview is where check-ins get tested.
// FALSE again on feat/explore-v2 (2026-10-07): it arrived true from feat/checkins-ready, and this
// branch merges to main before go-live. Production cannot see it either way (IS_PREVIEW_BUILD is
// false without APP_VARIANT=preview, and check-ota-preflight.mjs (c) refuses a production publish
// that resolves to the Preview config), but on main it would put check-ins on ADA Preview before
// 20261092/20261093 exist. Go-live step 3 flips it, in its own commit.
// TRUE from 2026-10-07 (go-live step 3, Berke's go): 20261092 + 20261093 are applied and
// google-places is deployed; ADA Preview tests check-ins. Production cannot see it (preflight (c)).
const CHECKINS_PREVIEW = true
export const CHECKINS = MODULE_FLAGS.checkins || (typeof __DEV__ !== 'undefined' && __DEV__) || (IS_PREVIEW_BUILD && CHECKINS_PREVIEW)
