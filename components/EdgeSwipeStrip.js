import { useRef } from 'react'
import { View, StyleSheet, PanResponder, Platform } from 'react-native'
import { dispatchBack } from '../utils/backHandler'

// iOS left-edge swipe → dispatchBack(), the same stack Android's hardware back walks.
//
// A thin strip ON TOP of everything, not a capture handler on the root: on iOS a
// UIScrollView's native pan starts after ~10pt and cancels the JS touch, so a root
// responder that waits for 16pt of travel never sees the move on any scrolling screen.
// Owning the edge by hit-test means the scroll view never gets the touch at all.
// Cost: a tap inside the strip is swallowed — hence 20pt, and back buttons start at x≈16.
// Native <Modal>s are their own window and are out of reach by construction.
const EDGE_WIDTH = Platform.OS === 'ios' && Platform.isPad ? 24 : 20
const COMMIT_DISTANCE = 80
const COMMIT_VELOCITY = 0.5

export default function EdgeSwipeStrip() {
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once the edge has the touch, nothing below may take it mid-swipe.
    onPanResponderTerminationRequest: () => false,
    // Claimed at touch start, so the edge zone is the hit-test itself — no gestureState.x0,
    // which read 0 before grant on feat/slice-2-nav and made every touch an edge touch.
    onPanResponderRelease: (_, g) => {
      const horizontal = Math.abs(g.dx) > Math.abs(g.dy) * 1.5
      if (horizontal && (g.dx > COMMIT_DISTANCE || (g.dx > 16 && g.vx > COMMIT_VELOCITY))) dispatchBack()
    },
    // Interrupted (call, notification shade): ends without counting as a back.
    onPanResponderTerminate: () => {},
  })).current

  if (Platform.OS !== 'ios') return null
  return <View style={[styles.strip, { width: EDGE_WIDTH }]} {...responder.panHandlers} />
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: 'transparent' },
})
