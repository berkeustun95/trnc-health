import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, Linking, Platform } from 'react-native'
import * as Location from 'expo-location'
import { t } from '../constants/i18n'
import { withTimeout, locateOutcome, locateNote, refineFix, askFreshFix, LOCATE_TIMEOUT_MS } from '../constants/eatery'
import { REDESIGN } from '../constants/redesign'
import { requestWithPrimer } from './permissionPrimer'
import { askedFix, askedWatch, passiveFix } from './locationServices'

// Where the phone is, for the delivery address editor and its map picker. Nothing here is stored or sent: the fix becomes a map
// centre / an optional pin in the address book on this phone. Must not import supabase or logContactEvent (test-eatery-order.mjs).

// First up to LOCATE_REFINE_MS of the best GPS (Highest, stops at LOCATE_GOOD_M): a cached or first fix can sit on the neighbour.
// Services off: no second fresh fix (it would stack a second settings dialog); locate() then shows "Ayarları aç".
// Nothing arrived (services off and declined, indoors) -> the old chain: last known (2 min), else a fresh fix raced against a
// timeout (indoors it can hang), else an older one. ctx.refine holds the live watcher so cancel() can remove it; ctx.stopped() = the
// person left (Back, editor closed, unmount): then no further device call is made.
async function getFix(ctx) {
  const watch = cb => askedWatch({ accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 }, cb)
  ctx.refine = refineFix(watch)
  ctx.onRefining?.(true)
  const best = await ctx.refine.done
  ctx.refine = null
  ctx.onRefining?.(false)
  if (best || ctx.stopped()) return best
  const last = async maxAge => { try { return await Location.getLastKnownPositionAsync({ maxAge }) } catch { return null } }
  let servicesOn = true
  try { servicesOn = await Location.hasServicesEnabledAsync() } catch {}
  return (await last(120000))
    ?? (askFreshFix(servicesOn) ? await withTimeout(askedFix(Location.Accuracy.Balanced), LOCATE_TIMEOUT_MS) : null)
    ?? (await last(600000))
}

// The map picker's own start: a location ONLY when permission is already granted (never asks, never shows the services
// dialog, gives up after a few seconds) — else null and the picker opens on central Lefkoşa.
export async function quietFix() {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (perm?.status !== 'granted') return null
    const fix = (await Location.getLastKnownPositionAsync({ maxAge: 600000 }).catch(() => null))
      ?? (await withTimeout(passiveFix(Location.Accuracy.Balanced), 3000))
    const c = fix?.coords
    return Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude) ? { lat: c.latitude, lng: c.longitude } : null
  } catch { return null }
}

async function openLocationFix(action) {
  try {
    if (action === 'locationSettings' && Platform.OS === 'android') {
      try { await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS') } catch { await Linking.openSettings() }
    } else await Linking.openSettings()
  } catch {}
}

// A tap that asks for the location (the OS prompt follows ADA's own explanation screen). locate() resolves { lat, lng, accuracy } or null
// (accuracy in metres, or null: it lives in the picker's state only — never stored, never sent); cancel() stops a running search.
// The caller ALWAYS shows the result on the map to confirm; nothing here saves it.
// when null, `note` says why ({ msgKey, action }) and the person is told in words, never a dead button.
export function useLocate(lang) {
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState(null)
  const [refining, setRefining] = useState(false)
  const alive = useRef(true)
  const stopped = useRef(false)
  const live = useRef(null)   // the ctx of the running search
  const busy = useRef(false)
  const wentToSettings = useRef(false)   // the services-off dialog itself backgrounds the app on Android; only a trip to Settings may clear the note
  const cancel = () => { stopped.current = true; live.current?.refine?.stop() }
  useEffect(() => () => { alive.current = false; cancel() }, [])
  const hasAction = !!note?.action
  useEffect(() => { wentToSettings.current = false }, [note])
  useEffect(() => {
    if (!hasAction) return
    const sub = AppState.addEventListener('change', s => { if (s === 'active' && wentToSettings.current) { wentToSettings.current = false; setNote(null) } })
    return () => sub.remove()
  }, [hasAction])
  const locate = async () => {
    if (busy.current) return null
    busy.current = true
    stopped.current = false
    setLocating(true)
    setNote(null)
    let perm = { status: null, canAskAgain: true }
    let fix = null
    try {
      perm = REDESIGN ? await requestWithPrimer('location') : await Location.requestForegroundPermissionsAsync()
      if (perm?.status === 'granted' && !stopped.current) {
        live.current = { refine: null, stopped: () => stopped.current || !alive.current, onRefining: v => { if (alive.current) setRefining(v) } }
        fix = await getFix(live.current)
      }
    } catch { fix = null }
    live.current = null
    let servicesOn = true
    try { servicesOn = await Location.hasServicesEnabledAsync() } catch {}
    busy.current = false
    if (!alive.current || stopped.current) { if (alive.current) { setLocating(false); setRefining(false) } return null }
    setLocating(false)
    const outcome = locateOutcome({ granted: perm?.status === 'granted', canAskAgain: perm?.canAskAgain !== false, servicesOn, fix })
    if (outcome === 'ok') {
      const acc = fix.coords.accuracy
      return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: Number.isFinite(acc) ? acc : null }
    }
    const n = locateNote(outcome)
    setNote(n)
    AccessibilityInfo.announceForAccessibility?.(t(n.msgKey, lang))
    return null
  }
  const openFix = action => { wentToSettings.current = true; openLocationFix(action) }
  return { locating, refining, note, locate, cancel, openFix, clearNote: () => setNote(null) }
}
