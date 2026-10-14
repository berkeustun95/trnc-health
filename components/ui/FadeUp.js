import { useEffect, useRef } from 'react'
import { Animated, AccessibilityInfo } from 'react-native'

// Home lab P (polish): a row fades 0→1 and rises 8→0 pt, once. Native driver, one-shot.
// ONCE PER APP SESSION per `name`: the module-level set outlives HomeScreen, so a tab return or a
// remount renders the row static (already visible). Reduce Motion: shown at once, no motion.
// The translate wrapper sits OUTSIDE the row, so a coach-mark ref inside the row keeps its own
// geometry and only reads 8pt low if measured within the first ~0.5 s (device check).
const played = new Set()
export const FADE_MS = 260
export const STAGGER_MS = 45
const RISE = 8

export default function FadeUp({ name, index = 0, children }) {
  const fresh = useRef(!played.has(name)).current
  const v = useRef(new Animated.Value(fresh ? 0 : 1)).current
  useEffect(() => {
    if (!fresh) return undefined
    played.add(name)
    let alive = true, anim = null
    const run = reduce => {
      if (!alive) return
      if (reduce) { v.setValue(1); return }
      anim = Animated.timing(v, { toValue: 1, duration: FADE_MS, delay: index * STAGGER_MS, useNativeDriver: true })
      anim.start()
    }
    AccessibilityInfo.isReduceMotionEnabled().then(run).catch(() => run(false))
    return () => { alive = false; anim?.stop() }
  }, [])
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) }] }}>
      {children}
    </Animated.View>
  )
}
