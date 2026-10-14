import { useState, useEffect } from 'react'
import { AccessibilityInfo } from 'react-native'

// True while the OS "Reduce Motion" setting is on; follows changes while mounted.
export default function useReduceMotion() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return on
}
