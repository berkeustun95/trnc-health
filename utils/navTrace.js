// Navigation tracing — DEBUG ONLY, must not reach production.
//
// Added to characterise a state bug in the slice-2 pushed-screen model that four
// successive fixes each failed to pin down. It prints a line to the Metro console
// on every navigation state change and every exit, so the sequence can be read off
// a trace instead of guessed at.
//
// This file exists to be DELETED, along with its call sites, once the trace has
// been captured. The publish guard greps for console.log introduced by a commit,
// so an attempt to ship this will fail the pre-flight check by design.
export const NAV_TRACE = true

export function navTrace(tag, data = {}) {
  if (!NAV_TRACE) return
  const body = Object.entries(data)
    .map(([k, v]) => `${k}=${v === '' || v === null || v === undefined ? '-' : v}`)
    .join('  ')
  console.log(`[nav] ${String(tag).padEnd(14)} ${body}`)
}

// Animated.Value keeps its JS-side number in __getValue(). With useNativeDriver the
// native side can be a frame ahead mid-animation, so treat these as indicative at
// rest and approximate in flight — which is enough to tell 0 from width from stranded.
export function txOf(v) {
  try { return Math.round(v.__getValue()) } catch { return '?' }
}
