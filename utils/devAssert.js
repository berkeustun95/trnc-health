// Dev-only invariant checks. No-ops in production, so this is safe to ship.
//
// It exists because of a specific failure: the swipe's edge-zone gate read
// gestureState.x0, which React Native leaves at 0 until the responder is granted.
// The comparison `x0 <= 32` therefore passed for every touch anywhere on screen,
// the gate never gated, and nothing said so. It survived three commits and a
// production rollback precisely because a silently-passing check looks identical
// to a working one.
//
// The rule this encodes: if a condition is load-bearing and its failure mode is
// silence, assert it.
//
// This is the ONLY file permitted to call console.* outside the debug trace — the
// pre-flight publish guard greps for console.log/warn added by a commit, and it
// should whitelist this path rather than being weakened.
export function devAssert(condition, message) {
  if (__DEV__ && !condition) {
    console.warn(`[assert] ${message}`)
  }
}
