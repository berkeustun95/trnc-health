import { useState, useEffect } from 'react'
import useForeground from '../../ui/useForeground'
import { dayPart } from '../../../constants/dayParts'

// The current day part: computed on mount and again whenever the app returns to the foreground.
// No timers. `enabled` false → still 'day', never recomputed.
export default function useDayPart(enabled) {
  const fg = useForeground()
  const [part, setPart] = useState(() => dayPart())
  useEffect(() => {
    if (enabled && fg) setPart(dayPart())
  }, [enabled, fg])
  return enabled ? part : 'day'
}
