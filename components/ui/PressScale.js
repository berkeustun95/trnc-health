import { useRef } from 'react'
import { Animated, TouchableOpacity } from 'react-native'
import useReduceMotion from './useReduceMotion'

// Home lab P (polish): a TouchableOpacity that also dips to `scaleTo` (0.97) on press and springs back.
// Drop-in: same props, the scale rides the card's own style (no wrapper, so layout and any
// ref/measure are untouched). Reduce Motion: no scale, the opacity press stays.
export const PRESS_SCALE = 0.97
export default function PressScale({ style, scaleTo = PRESS_SCALE, onPressIn, onPressOut, ...rest }) {
  const reduce = useReduceMotion()
  const scale = useRef(new Animated.Value(1)).current
  const to = v => Animated.spring(scale, { toValue: v, speed: 40, bounciness: 0, useNativeDriver: true }).start()
  return (
    <TouchableOpacity {...rest}
      style={[style, !reduce && { transform: [{ scale }] }]}
      onPressIn={e => { if (!reduce) to(scaleTo); onPressIn?.(e) }}
      onPressOut={e => { if (!reduce) to(1); onPressOut?.(e) }} />
  )
}
