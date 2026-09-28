import { BackHandler, Platform } from 'react-native'

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
