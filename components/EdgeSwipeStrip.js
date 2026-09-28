import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, PanResponder, Platform } from 'react-native'
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

// ── DEBUG (dev-only, remove before publishing) ───────────────────────────────
const DEBUG = __DEV__
let debugState = { root: 0, rootX: null, strip: 0, startX: null, dx: 0, dy: 0, result: '—' }
const debugListeners = new Set()
const setDebug = patch => {
  if (!DEBUG) return
  debugState = { ...debugState, ...patch }
  debugListeners.forEach(l => l(debugState))
}
// Observes whether the ROOT sees touches at all (never claims). Spread on the root.
export const rootTouchProbe = DEBUG && Platform.OS === 'ios'
  ? { onStartShouldSetResponderCapture: e => { setDebug({ root: debugState.root + 1, rootX: Math.round(e.nativeEvent.pageX) }); return false } }
  : null
// ─────────────────────────────────────────────────────────────────────────────

export default function EdgeSwipeStrip() {
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once the edge has the touch, nothing below may take it mid-swipe.
    onPanResponderTerminationRequest: () => false,
    // The strip is claimed at touch start, so the grant event's pageX IS the start position.
    // (gestureState.x0 is not used: on feat/slice-2-nav it read 0 before grant.)
    onPanResponderGrant: e => setDebug({ strip: debugState.strip + 1, startX: Math.round(e.nativeEvent.pageX), dx: 0, dy: 0, result: 'touching' }),
    onPanResponderMove: (_, g) => setDebug({ dx: Math.round(g.dx), dy: Math.round(g.dy) }),
    onPanResponderRelease: (_, g) => {
      const horizontal = Math.abs(g.dx) > Math.abs(g.dy) * 1.5
      const commit = horizontal && (g.dx > COMMIT_DISTANCE || (g.dx > 16 && g.vx > COMMIT_VELOCITY))
      if (!commit) { setDebug({ result: `no back (dx ${Math.round(g.dx)}, vx ${g.vx.toFixed(2)})` }); return }
      const handled = dispatchBack()
      setDebug({ result: handled ? 'BACK fired' : 'back fired, nothing handled it' })
    },
    onPanResponderTerminate: () => setDebug({ result: 'terminated' }),
  })).current

  if (Platform.OS !== 'ios') return null
  return (
    <>
      <View style={[styles.strip, { width: EDGE_WIDTH }]} {...responder.panHandlers} />
      {DEBUG && <DebugReadout />}
    </>
  )
}

function DebugReadout() {
  const [s, setS] = useState(debugState)
  useEffect(() => { debugListeners.add(setS); return () => debugListeners.delete(setS) }, [])
  return (
    <View pointerEvents="none" style={styles.debug}>
      <Text style={styles.debugText}>SWIPE v2 · zone {EDGE_WIDTH}pt{Platform.isPad ? ' (iPad)' : ''}</Text>
      <Text style={styles.debugText}>root touches {s.root} · last x {s.rootX ?? '—'}</Text>
      <Text style={styles.debugText}>edge touches {s.strip} · start x {s.startX ?? '—'}</Text>
      <Text style={styles.debugText}>dx {s.dx} · dy {s.dy}</Text>
      <Text style={styles.debugText}>{s.result}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: DEBUG ? 'rgba(255,0,0,0.18)' : 'transparent' },
  debug: { position: 'absolute', right: 8, bottom: 90, zIndex: 1001, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  debugText: { color: '#fff', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
})
