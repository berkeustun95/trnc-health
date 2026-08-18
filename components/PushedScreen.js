import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View, StyleSheet, Animated, Easing, Dimensions, PanResponder } from 'react-native'

// The container every pushed module screen renders inside: it draws its child over
// the persistent tab shell and slides it in and out.
//
// THE ANIMATION IS ONLY AT THE SHELL BOUNDARY. Mounting (nothing pushed -> something
// pushed) slides in; close() slides out. Swapping one pushed screen for another does
// NOT re-animate, because this component is not keyed on which screen it holds — the
// child simply changes inside it. That is deliberate. Four pushes are nested (booking
// over facility, facility over grooming/garages, place over explore, property over
// accommodation), and closing the top of one would otherwise slide out to the shell
// and then slide the PARENT in from the right: a forward animation on a back action,
// with the shell flashing between. Direction-aware per-level animation needs a real
// stack that knows push from pop; that is the next slice, not this one.
//
// WHY close() EXISTS AT ALL: the navigation flags unmount their screen the instant
// they flip, so nothing can animate out if a back button clears the flag directly.
// close() inverts that — it owns the exit and clears the flag only once the exit
// is finished. Everything that dismisses a pushed screen goes through it: the back
// button, the Android hardware/gesture back, and (later) the swipe. One path, both
// platforms; that is the whole point.
const DURATION_IN  = 280
const DURATION_OUT = 240

// Swipe-to-go-back. Built for BOTH platforms: Android has no system gesture doing
// this on the test device, and on an Android that does have one the OS claims the
// edge first and fires hardware back, which lands on the same close(). Either way
// there is one exit path.
const EDGE_ZONE       = 32    // one width everywhere — no per-screen variation
const COMMIT_DISTANCE = 0.35  // fraction of the screen that commits the pop
const COMMIT_VELOCITY = 0.5
const CANCEL_DURATION = 180

const PushedScreen = forwardRef(function PushedScreen({ children, onClosed, swipeEnabled = true }, ref) {
  // Measured per render rather than at module scope so a rotation or a foldable does
  // not leave the screen animating to a stale width.
  const width = Dimensions.get('window').width
  const tx = useRef(new Animated.Value(width)).current

  // Slide in once, on mount. useRef(false) rather than an effect dependency: the child
  // changes on every nested push and this must not re-run for those.
  const entered = useRef(false)
  if (!entered.current) {
    entered.current = true
    Animated.timing(tx, {
      toValue: 0,
      duration: DURATION_IN,
      // Decelerating: fast off the edge, easing into place. Linear reads mechanical,
      // which is most of what "cheap" meant in the tester feedback.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }
  // `onClosed` is a fresh closure on every render. Reading it through a ref means
  // close() always clears the flag belonging to the screen that is actually on
  // screen right now, not the one that was there when the handle was created.
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  const closing = useRef(false)

  // Live refs. The PanResponder is created once and would otherwise capture the
  // first render's values forever — the same reason OliGuide and Game2048Screen
  // keep refs alongside their responders.
  const widthRef = useRef(width); widthRef.current = width
  const swipeRef = useRef(swipeEnabled); swipeRef.current = swipeEnabled
  const closeRef = useRef(null)

  const pan = useRef(
    PanResponder.create({
      // Taps must pass straight through to the screen.
      onStartShouldSetPanResponder: () => false,
      // NON-CAPTURE, deliberately. A child horizontal scroller wins the touch, so in
      // the band where a chip bar or gallery meets the left edge the swipe does not
      // fire and the back button is the way out. Capturing instead would take that
      // touch from every horizontal scroller in the app, which is worse.
      onMoveShouldSetPanResponder: (_, g) =>
        swipeRef.current &&
        !closing.current &&
        g.x0 <= EDGE_ZONE &&           // must START at the edge
        g.dx > 6 &&                    // rightward only
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,   // and clearly horizontal
      onPanResponderMove: (_, g) => { tx.setValue(Math.max(0, g.dx)) },
      onPanResponderRelease: (_, g) => {
        const far  = g.dx > widthRef.current * COMMIT_DISTANCE
        const fast = g.vx > COMMIT_VELOCITY
        if (far || fast) {
          closeRef.current?.()          // same close() as the button and hardware back
        } else {
          Animated.timing(tx, {
            toValue: 0,
            duration: CANCEL_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start()
        }
      },
      // Never hand a half-finished drag to an ancestor.
      onPanResponderTerminationRequest: () => false,
    })
  ).current

  const handle = {
    close() {
      // Idempotency guard. On an Android with gesture navigation the OS claims the
      // left edge and fires system back, while on a 3-button device our own swipe
      // fires instead — but a device can deliver both, and without this the second
      // call would pop the parent screen too on the four nested pushes (booking
      // over facility, facility over garages, place over explore, property over
      // accommodation).
      if (closing.current) return
      closing.current = true
      Animated.timing(tx, {
        toValue: width,
        duration: DURATION_OUT,
        // Accelerating out — the mirror of the entry curve.
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        // The flag is cleared only here. This is the whole reason close() exists:
        // clearing it up front would unmount the screen before it could animate.
        //
        // ORDER MATTERS on the four nested pushes, where clearing the flag swaps the
        // child to the PARENT screen instead of unmounting this container. Clearing
        // first means the swap happens while the container is still parked off-screen
        // at +width, and the reset below then brings the parent straight in. Resetting
        // first would snap the screen we just slid away back to rest for a frame before
        // it swapped — a visible bounce. Worst case in this order is one frame of shell.
        onClosedRef.current?.()
        tx.setValue(0)
        // Re-arm: this instance survives a nested pop and must close again next press.
        closing.current = false
      })
    },
  }
  closeRef.current = handle.close
  useImperativeHandle(ref, () => handle, [])

  return (
    <Animated.View
      style={[s.fill, { transform: [{ translateX: tx }] }]}
      {...pan.panHandlers}
    >
      {children}
    </Animated.View>
  )
})

const s = StyleSheet.create({
  // Absolute, not flex: the shell stays laid out underneath at full size, so it is
  // not reflowed while a screen sits over it.
  fill: { ...StyleSheet.absoluteFillObject },
})

export default PushedScreen
