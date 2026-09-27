// ─── Walk simulator — medal review without walking, dev builds only ─────────
//
//   EXPO_PUBLIC_DEV_WALK_SIM=true npx expo start -c
//
// Adds two TEST buttons to the walk panel that feed a fabricated fix into useWalkPosition's
// own state — the same setter the real watchPositionAsync callback uses — so the visit
// check, auto-advance, distance line and live leg all see it exactly as they see GPS.
// Order to earn a stop: "100 m away" (arms it, like approaching) → "at this stop" (visits
// it and advances). A real fix from the watcher can still arrive and overwrite a fake one.
//
// ⚠ UNREACHABLE IN PRODUCTION, the same way EXPLORE_REVIEW is (utils/exploreReview.js):
//   Metro substitutes `__DEV__` with `false` in a release bundle, which is what `eas
//   update` builds, so this is a constant false there. Nothing on disk flips.

export const WALK_SIM = __DEV__ && process.env.EXPO_PUBLIC_DEV_WALK_SIM === 'true'

// A fix `metresNorth` north of the stop, reporting 5 m accuracy.
export const fakeFixNear = (stop, metresNorth = 0) => ({
  latitude: stop.latitude + metresNorth / 111320,
  longitude: stop.longitude,
  accuracy: 5,
})
