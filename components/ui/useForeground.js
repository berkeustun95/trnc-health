import { useState, useEffect } from 'react'
import { AppState } from 'react-native'

// True while the app is in the foreground ('active'); follows AppState changes while mounted.
export default function useForeground() {
  const [fg, setFg] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setFg(st === 'active'))
    return () => sub.remove()
  }, [])
  return fg
}
