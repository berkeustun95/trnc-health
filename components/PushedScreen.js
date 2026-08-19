import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { View, StyleSheet, Animated, Easing, Dimensions, PanResponder } from 'react-native'
import { devAssert } from '../utils/devAssert'
import DebugBanner from './DebugBanner'   // TEMP — delete with the banners

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
// How far the finger must travel horizontally before the gesture claims the touch.
//
// THIS NUMBER IS A BUG FIX, not a feel preference. At the original 6px the responder
// took taps away from buttons: a press starts on a child Touchable, but the parent's
// onMoveShouldSetPanResponder is polled on every move, and when it returns true React
// Native asks the current responder to give the touch up — which Touchables grant by
// default (the same mechanism that lets a ScrollView steal a press once you scroll).
// The press is cancelled and onPress never fires, so the control silently does nothing.
// 6px is inside ordinary finger jitter on a tap; 24 is about three times the platform
// touch slop, so a tap cannot reach it while a real swipe crosses it within a frame or
// two. Do not lower it without re-reading this.
// Now that the edge gate actually gates (see startX below), this no longer has to do
// the whole job of keeping taps out. 24 was compensation for a gate that was passing
// everything. 16 is twice Android's 8dp touch slop and above iOS's ~10pt, so a press
// cannot reach it, while a deliberate swipe crosses it almost immediately. It is not
// dropped to the slop floor because the back button spans x=16..60 — its left third is
// still inside the zone, so this term keeps a real job.
const ACTIVATE_DISTANCE = 16
const COMMIT_DISTANCE = 0.35  // fraction of the screen that commits the pop
const COMMIT_VELOCITY = 0.5
const CANCEL_DURATION = 180

const PushedScreen = forwardRef(function PushedScreen({ children, onClosed, swipeEnabled = true, pushedKey }, ref) {
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

  // The REAL x of the touch that started this gesture. gestureState.x0 cannot be used:
  // React Native initialises it to 0 and only assigns it in onResponderGrant, so during
  // onMoveShouldSetPanResponder — which runs before any grant — it is always 0 and
  // `x0 <= EDGE_ZONE` is always true. That is why the edge zone never existed.
  const startX = useRef(0)
  // Whether a swipe is genuinely in flight. Cleared on every exit path.
  const gestureActive = useRef(false)

  // Nothing is reset on mount: `prevKey` starts equal, so the entry animation is not
  // cut short. On any later change the child has swapped inside this container — a
  // nested push or pop — and the transform is parked at rest before the frame is drawn.
  // On a pop it is off-screen at +width, so this is what brings the parent in; on a
  // forward push it is already 0 and this is a no-op. If the container is unmounting
  // instead (the last screen closing) no effect runs at all, which is exactly right —
  // that case never needed a reset, it only ever caused the flash.
  // Exit path 5. A container torn down mid-gesture must not leave the flag set.
  useEffect(() => () => { gestureActive.current = false }, [])

  const prevKey = useRef(pushedKey)
  useLayoutEffect(() => {
    if (prevKey.current === pushedKey) return
    prevKey.current = pushedKey
    tx.setValue(0)
  }, [pushedKey])

  // Return the screen to rest. Shared by a cancelled drag and a terminated one so both
  // recover through exactly one path.
  const settle = () => {
    Animated.timing(tx, {
      toValue: 0,
      duration: CANCEL_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }

  const pan = useRef(
    PanResponder.create({
      // DEBUG probe. Capture runs before any child sees the touch; returning false means
      // this only observes and never claims. If taps on a frozen screen produce these
      // lines, the touch is reaching the container and dying below it; if they produce
      // nothing, something above the container is swallowing them.
      // Capture runs at touch start, before any grant, and carries a true pageX — which
      // is the only place the real start position is available. Recorded, never claimed.
      onStartShouldSetPanResponderCapture: (e) => {
        startX.current = e.nativeEvent.pageX
        return false
      },
      // Taps must pass straight through to the screen.
      onStartShouldSetPanResponder: () => false,
      // NON-CAPTURE, deliberately. A child horizontal scroller wins the touch, so in
      // the band where a chip bar or gallery meets the left edge the swipe does not
      // fire and the back button is the way out. Capturing instead would take that
      // touch from every horizontal scroller in the app, which is worse.
      onMoveShouldSetPanResponder: (_, g) => {
        const inZone = startX.current <= EDGE_ZONE          // must START at the edge
        const farEnough = g.dx > ACTIVATE_DISTANCE          // rightward, past tap jitter
        const horiz = Math.abs(g.dx) > Math.abs(g.dy) * 1.5 // and clearly horizontal
        return swipeRef.current && !closing.current && inZone && farEnough && horiz
      },
      // The activation distance is subtracted so the screen starts moving from rest at
      // the moment the gesture is claimed. Tracking raw g.dx would snap it 24px sideways
      // on the first frame — trading the dead button for a visible jump.
      onPanResponderGrant: () => {
        gestureActive.current = true
        // The invariant the old gate silently violated. If a grant ever happens from
        // outside the edge zone again, this says so instead of manifesting three weeks
        // later as an unresponsive screen.
        devAssert(
          startX.current <= EDGE_ZONE,
          `swipe granted from x=${Math.round(startX.current)}, outside the ${EDGE_ZONE}px edge zone — the activation gate is not gating`,
        )
      },
      onPanResponderMove: (_, g) => { tx.setValue(Math.max(0, g.dx - ACTIVATE_DISTANCE)) },
      onPanResponderRelease: (_, g) => {
        const travel = g.dx - ACTIVATE_DISTANCE      // what the user actually saw move
        const far  = travel > widthRef.current * COMMIT_DISTANCE
        const fast = g.vx > COMMIT_VELOCITY
        gestureActive.current = false
        if (far || fast) {
          closeRef.current?.('gesture')  // same close() as the button and hardware back
        } else {
          settle()
        }
      },
      // Never hand a half-finished drag to an ancestor.
      onPanResponderTerminationRequest: () => false,
      // A terminated gesture never reaches onPanResponderRelease, so without this the
      // transform is left wherever the finger stopped and NOTHING recovers it: the only
      // other reset is the layout effect, which fires solely on a pushedKey change, so a
      // re-render with the same screen leaves it stranded. That state is not merely
      // cosmetic — this container is absoluteFill and still carries panHandlers, so a
      // stranded one is a full-screen invisible surface sitting over the shell and eating
      // every tap. Termination is reachable in normal use: the OS interrupts for a call
      // or notification shade, or an ancestor claims the touch mid-drag.
      onPanResponderTerminate: () => { gestureActive.current = false; settle() },
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
      gestureActive.current = false   // exit path 3 and 4: button and hardware back
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
        // NOTHING TOUCHES THE TRANSFORM HERE. It used to reset to 0 on this line, which
        // is what made the exit bounce: this callback clears the flag through React, so
        // that update is batched to the next commit, while setValue writes to the native
        // view immediately. The container was therefore still showing the OUTGOING screen
        // when it snapped from off-screen back to rest — visible as the screen going back,
        // coming forward again, then landing. Reordering the two lines cannot fix it,
        // because they are not racing on one timeline: one is synchronous to native and
        // the other is deferred to React, so the reset always wins. The reset now happens
        // in the layout effect below, after the new child is committed.
        onClosedRef.current?.()
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
      <DebugBanner name="CONTAINER" top={30} color="#7C3AED" detail={`key=${pushedKey}`} />
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
