import { createContext, useContext } from 'react'
import { StatusBar } from 'expo-status-bar'

// True while the white boot splash covers the app (App.js `splashUp`). RN's StatusBar is a stack
// where the last-mounted entry wins, and Home / Onboarding mount UNDER the splash after it, so a
// screen asking for light icons would make them vanish on the white splash. Screens that want light
// icons render this instead: dark until the splash exit has finished, then their own style.
export const SplashUpContext = createContext(false)

export default function SplashStatusBar({ style }) {
  const splashUp = useContext(SplashUpContext)
  return <StatusBar style={splashUp ? 'dark' : style} />
}
