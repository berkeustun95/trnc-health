import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View, StyleSheet } from 'react-native'

// The container every pushed module screen renders inside. In this slice it is
// only a render target — it draws its child over the persistent tab shell instead
// of replacing it. The slide animation and the edge-swipe gesture land in the two
// slices after this one; the close() seam below is built now so neither of them
// has to change how exits are wired.
//
// WHY close() EXISTS AT ALL: the navigation flags unmount their screen the instant
// they flip, so nothing can animate out if a back button clears the flag directly.
// close() inverts that — it owns the exit and clears the flag only once the exit
// is finished. Everything that dismisses a pushed screen goes through it: the back
// button, the Android hardware/gesture back, and (later) the swipe. One path, both
// platforms; that is the whole point.
const PushedScreen = forwardRef(function PushedScreen({ children, onClosed }, ref) {
  // `onClosed` is a fresh closure on every render. Reading it through a ref means
  // close() always clears the flag belonging to the screen that is actually on
  // screen right now, not the one that was there when the handle was created.
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  const closing = useRef(false)

  useImperativeHandle(ref, () => ({
    close() {
      // Idempotency guard. On an Android with gesture navigation the OS claims the
      // left edge and fires system back, while on a 3-button device our own swipe
      // fires instead — but a device can deliver both, and without this the second
      // call would pop the parent screen too on the four nested pushes (booking
      // over facility, facility over garages, place over explore, property over
      // accommodation).
      if (closing.current) return
      closing.current = true
      onClosedRef.current?.()
      // Re-arm past the state flush. The guard only needs to cover the double-fire
      // window; this instance survives a nested pop and must be able to close the
      // parent on the next press.
      requestAnimationFrame(() => { closing.current = false })
    },
  }), [])

  return <View style={s.fill}>{children}</View>
})

const s = StyleSheet.create({
  // Absolute, not flex: the shell stays laid out underneath at full size, so it is
  // not reflowed while a screen sits over it.
  fill: { ...StyleSheet.absoluteFillObject },
})

export default PushedScreen
