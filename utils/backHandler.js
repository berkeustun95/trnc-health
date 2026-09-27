import { BackHandler, PanResponder, Platform } from 'react-native'

// One back stack for both platforms. On Android this IS BackHandler — the same call, the
// same subscription object — so nothing about hardware back changes. On iOS BackHandler is
// a no-op stub, so the left-edge swipe needs its own stack, and every screen that registers
// a back layer (a live walk, the coach marks, a legal tab) must register HERE or the swipe
// skips it and closes the module underneath.
// Mirrors BackHandler.android.js exactly: array, no duplicates, newest first.
const iosHandlers = []

export function addBackListener(handler) {
  if (Platform.OS !== 'ios') return BackHandler.addEventListener('hardwareBackPress', handler)
  if (iosHandlers.indexOf(handler) === -1) iosHandlers.push(handler)
  return {
    remove: () => {
      const i = iosHandlers.indexOf(handler)
      if (i !== -1) iosHandlers.splice(i, 1)
    },
  }
}

// iOS only. Unlike Android there is no exitApp: an unhandled back does nothing.
export function dispatchBack() {
  for (let i = iosHandlers.length - 1; i >= 0; i--) {
    if (iosHandlers[i]?.()) return true
  }
  return false
}

// iOS left-edge swipe → dispatchBack(). Deliberately simple: no slide, no preview, fires
// on release. Spread on the app root on iOS only.
const EDGE_ZONE = 20          // pt from the left edge where the touch must START
const ACTIVATE_DISTANCE = 16  // above iOS touch slop, so a tap on a back button at x≈16 never claims
const COMMIT_DISTANCE = 80
const COMMIT_VELOCITY = 0.5

// The touch's real start x. NOT gestureState.x0: RN leaves that at 0 until the responder
// is granted, so inside onMoveShouldSet… it is always 0 and `x0 <= EDGE_ZONE` passes for
// every touch on screen — the edge zone silently did not exist on feat/slice-2-nav.
let startX = Infinity

export const edgeSwipeHandlers = Platform.OS !== 'ios' ? null : PanResponder.create({
  // Capture runs at touch start with a true pageX. Record only, never claim.
  onStartShouldSetPanResponderCapture: e => { startX = e.nativeEvent.pageX; return false },
  // Capture phase so a horizontal ScrollView/map child that would otherwise win the touch
  // cannot — but only from the edge. Anywhere else this is false and content is untouched.
  onMoveShouldSetPanResponderCapture: (_, g) =>
    startX <= EDGE_ZONE &&
    g.numberActiveTouches === 1 &&
    g.dx > ACTIVATE_DISTANCE &&
    Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
  onPanResponderRelease: (_, g) => {
    startX = Infinity
    if (g.dx > COMMIT_DISTANCE || g.vx > COMMIT_VELOCITY) dispatchBack()
  },
  // An interrupted gesture (call, notification shade, a native view taking the touch)
  // must end cleanly and never count as a back.
  onPanResponderTerminate: () => { startX = Infinity },
}).panHandlers
