import { useEffect, useRef, useState } from 'react'
import { View, Animated, Easing } from 'react-native'
import { colors, radii } from '../../constants/theme'
import useReduceMotion from './useReduceMotion'

// Home lab P (polish): the branded skeleton for the event banner. A static colors.border bone (the
// duty tile's placeholder fill, same 100% × 160, radii.widget as today's grey pulse) with a light
// band (colors.skeletonSweep) that loops while mounted: 1100 ms sweep, 400 ms pause (native driver,
// stopped on unmount). Reduce Motion: static base, no sweep.
export const SWEEP_MS = 1100
export const PAUSE_MS = 400
export default function SweepBone({ height = 160, borderRadius = radii.widget }) {
  const reduce = useReduceMotion()
  const [w, setW] = useState(0)
  const x = useRef(new Animated.Value(0)).current
  const band = Math.round(w * 0.45)
  useEffect(() => {
    if (!w || reduce) return
    x.setValue(0)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(PAUSE_MS),
      Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [w, reduce])
  return (
    <View style={{ width: '100%', height, borderRadius, backgroundColor: colors.border, overflow: 'hidden' }}
      onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && !reduce && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: band,
          backgroundColor: colors.skeletonSweep,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-band, w] }) }] }} />
      )}
    </View>
  )
}
