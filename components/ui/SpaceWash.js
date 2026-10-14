import { useEffect, useRef } from 'react'
import { View, Image, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native'
import { PHOTO_TEAL } from './PhotoFade'
import useReduceMotion from './useReduceMotion'

// App spaces: the "colour bloom" between the picker and a chosen space. The picker's teal ground fades in
// over everything, and the chosen space's glow (oli-glow.png, tinted) blooms from the touch point; at the
// peak the caller swaps the screen underneath (onPeak), the wash holds ~60 ms at full cover, then fades away
// (onDone). The glow is drawn twice, stacked and identical, so its effective alpha is ~0.66 (one layer read
// olive on Explore, not amber). Core Animated, native driver, opacity/transform only: no per-frame JS.
// The wash blocks touches for its ~600 ms life (a second pick cannot land); a hardware back during it may
// run the picker's back, but the space still commits at the peak (App.js documents the rule).
const GLOW = require('../../assets/oli-scenes/oli-glow.png')
const IN_MS = 260
const OUT_MS = 340
const REDUCE_OUT_MS = 150
const HOLD_MS = 60      // after the peak (the swap has happened), before the out-fade
const SCALE_FROM = 0.12
const SIZE_FRAC = 2.4   // x the larger screen side: the glow's faint rim leaves the screen before the peak

export default function SpaceWash({ color, origin, onPeak, onDone, reduce: reduceProp }) {
  const hookReduce = useReduceMotion()
  const reduce = reduceProp ?? hookReduce
  const { width, height } = useWindowDimensions()
  const base = useRef(new Animated.Value(0)).current
  const bloom = useRef(new Animated.Value(0)).current   // 0 -> 1 drives the glow's scale and opacity
  const fade = useRef(new Animated.Value(1)).current    // whole wash, out
  const peaked = useRef(false)
  const done = useRef(false)
  const cb = useRef({ onPeak, onDone })
  cb.current = { onPeak, onDone }
  // The animation is decided once, at mount. The caller passes `reduce` (the picker already knows it): the
  // hook's first value is always false (async read), so it is only the fallback for a caller that omits it.
  useEffect(() => {
    const peak = () => { if (!peaked.current) { peaked.current = true; cb.current.onPeak?.() } }
    const finish = () => { if (!done.current) { done.current = true; cb.current.onDone?.() } }
    const out = ms => Animated.timing(fade, { toValue: 0, duration: ms, easing: Easing.in(Easing.quad), useNativeDriver: true })
    let running
    if (reduce) {
      base.setValue(1)
      peak()
      running = out(REDUCE_OUT_MS)
      running.start(finish)
    } else {
      running = Animated.parallel([
        Animated.timing(base, { toValue: 1, duration: IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bloom, { toValue: 1, duration: IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
      // Callbacks fire whether or not `finished` is true (the refs make each run once).
      running.start(() => { peak(); running = Animated.sequence([Animated.delay(HOLD_MS), out(OUT_MS)]); running.start(finish) })
    }
    return () => { running.stop() }
  }, [])
  const size = Math.max(width, height) * SIZE_FRAC
  const ox = Number.isFinite(origin?.x) ? origin.x : width / 2
  const oy = Number.isFinite(origin?.y) ? origin.y : height / 2
  const scale = bloom.interpolate({ inputRange: [0, 1], outputRange: [SCALE_FROM, 1] })
  return (
    <Animated.View style={[s.root, { opacity: fade }]} pointerEvents="auto" accessible={false}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: PHOTO_TEAL, opacity: base }]} />
      {!reduce && [0, 1].map(i => (
        <Animated.Image key={i} source={GLOW} resizeMode="contain" accessible={false} accessibilityIgnoresInvertColors
          style={{ position: 'absolute', width: size, height: size, left: ox - size / 2, top: oy - size / 2,
                   tintColor: color, opacity: bloom, transform: [{ scale }] }} />
      ))}
    </Animated.View>
  )
}

const s = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', zIndex: 50, elevation: 50 },
})
