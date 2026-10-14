import { useState, useEffect } from 'react'
import useForeground from '../../ui/useForeground'
import { islandDayFor } from '../../../constants/islandCalendar'
import { localDateStr } from '../../../constants/calendarContext'
import { useHomeLab, HOME_LAB_DEV } from '../../../constants/homeLab'

// Today's Island Calendar entry (or null): computed on mount and again whenever the app returns
// to the foreground. No timers. `enabled` false → null. `devDate` comes from useHomeLab(), which
// is null unless HOME_LAB_DEV (folded false in a release bundle), so a release build always
// resolves the real device-local date.
// An entry shows only if `verified === true` or we are in the dev lab: a HOME_CALENDAR_LIVE flip
// must never surface unverified (Turkey-list / secondary-source) dates; Berke previews them in dev only.
const shown = e => (e && (e.verified === true || HOME_LAB_DEV) ? e : null)
export default function useIslandDay(enabled) {
  const fg = useForeground()
  const { calendarDate: devDate } = useHomeLab()
  const [day, setDay] = useState(() => (enabled ? shown(islandDayFor(devDate || localDateStr())) : null))
  useEffect(() => {
    if (enabled && fg) setDay(shown(islandDayFor(devDate || localDateStr())))
  }, [enabled, fg, devDate])
  return enabled ? day : null
}
