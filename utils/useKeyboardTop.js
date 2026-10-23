import { useEffect, useState } from 'react'
import { Keyboard, Dimensions, Platform } from 'react-native'

// The keyboard's top edge in screen coordinates (null while it is closed). The lift is NOT taken from the reported
// height: Sepetim and the address editor measure where their footer really ends against this edge (device-tested:
// the reported height and the window's own partial resize disagree).
export default function useKeyboardTop() {
  const [top, setTop] = useState(null)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', e => {
      const { height, screenY } = e.endCoordinates
      setTop(screenY > 0 ? Math.round(screenY) : Math.round(Dimensions.get('screen').height - height))
    })
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setTop(null))
    return () => { show.remove(); hide.remove() }
  }, [])
  return top
}
