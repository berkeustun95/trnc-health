// ─── Explore review mode — the Visit NCY device pass, dev builds only ────────
//
//   EXPO_PUBLIC_DEV_EXPLORE_REVIEW=true npx expo start -c     # then sign in as an ADMIN
//
// Turns on, for an admin in a dev build only: pending places in the Explore list and on the
// Keşfet map, and the walking-routes layer including inactive routes. Reached from
// AdminScreen's "Keşfet map (review)" button, because admins never reach the tab shell.
// It REPLACES ~/trnc-health-local-review-pending.patch, which was a working-tree edit and
// therefore exactly what `eas update` would have bundled.
//
// ⚠ UNREACHABLE IN PRODUCTION, NOT MERELY DEFAULTED OFF. Metro substitutes `__DEV__` with
//   `false` in a release bundle — which is what `eas update` builds — so this is a constant
//   false and no branch behind it can run. Measured 2026-09-23: `expo export` with
//   EXPO_PUBLIC_DEV_EXPLORE_REVIEW=true set compiled this module to `var t=!1`. The review
//   STRINGS still ship (a cross-module constant is not inlined); they are unreachable. Nothing on disk flips, so there
//   is nothing for check-module-flags.mjs to baseline; an env var set in a shell by mistake
//   still cannot reach a user.
//
// Admin-only because RLS decides what it can show: places_select and walking_routes_select
// both open pending/inactive rows to is_admin() and to nobody else. For any other identity
// this would widen a query and get back the same rows.
//
// ⚠ Admin is the least reproducible identity (CLAUDE.md): it is fine for checking CONTENT —
//   names, pins, order, lines — and wrong for judging anything that differs by role.

export const EXPLORE_REVIEW = __DEV__ && process.env.EXPO_PUBLIC_DEV_EXPLORE_REVIEW === 'true'

export const reviewStatuses = review => (review ? ['active', 'pending'] : ['active'])
