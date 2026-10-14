// ─── Home lab — dev-only switches for the dark Home experiment (agent/home-lab) ──
//
//   EXPO_PUBLIC_DEV_HOME_LAB=1 npx expo start -c     # then use the "Lab" pill on Home
//
// Each variant = its HOME_*_LIVE flag (constants/flags.js, all false) OR a dev override set
// from the picker. Overrides live in memory only: nothing is persisted, a reload resets them.
//
// ⚠ UNREACHABLE IN PRODUCTION, NOT MERELY DEFAULTED OFF. Metro substitutes `__DEV__` with
//   `false` in a release bundle, so HOME_LAB_DEV is a constant false there (same mechanism as
//   utils/exploreReview.js). With it false, useHomeLab() returns the flag values only.

import { useState, useEffect } from 'react'
import { HOME_DAYLIGHT_LIVE, HOME_OLI_COMPANION_LIVE, HOME_CALENDAR_LIVE, HOME_POLISH_LIVE } from './flags'

export const HOME_LAB_DEV = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_DEV_HOME_LAB === '1'

let overrides = { daylight: false, oli: false, calendar: false, polish: false }
const listeners = new Set()

export function setHomeLab(key, value) {
  if (!HOME_LAB_DEV || !(key in overrides)) return
  overrides = { ...overrides, [key]: value === true }
  listeners.forEach(fn => fn(overrides))
}

export function useHomeLab() {
  // Hook order is stable in both states; with HOME_LAB_DEV false the effect does nothing.
  const [o, setO] = useState(overrides)
  useEffect(() => {
    if (!HOME_LAB_DEV) return undefined
    setO(overrides)
    listeners.add(setO)
    return () => { listeners.delete(setO) }
  }, [])
  return {
    daylight: HOME_DAYLIGHT_LIVE || (HOME_LAB_DEV && o.daylight),
    oli: HOME_OLI_COMPANION_LIVE || (HOME_LAB_DEV && o.oli),
    calendar: HOME_CALENDAR_LIVE || (HOME_LAB_DEV && o.calendar),
    polish: HOME_POLISH_LIVE || (HOME_LAB_DEV && o.polish),
  }
}
