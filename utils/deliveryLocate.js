import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, Linking, Platform } from 'react-native'
import * as Location from 'expo-location'
import { t } from '../constants/i18n'
import { withTimeout, locateOutcome, locateNote, LOCATE_TIMEOUT_MS } from '../constants/eatery'
import { REDESIGN } from '../constants/redesign'
import { requestWithPrimer } from './permissionPrimer'
import { askedFix, passiveFix } from './locationServices'

// Where the phone is, for the delivery address editor and its map picker. Nothing here is stored or sent: the fix becomes a map
// centre / an optional pin in the address book on this phone. Must not import supabase or logContactEvent (test-eatery-order.mjs).

// Last known (2 min) first, else a fresh fix raced against a timeout (indoors it can hang), else an older one.
async function getFix() {
  const last = async maxAge => { try { return await Location.getLastKnownPositionAsync({ maxAge }) } catch { return null } }
  return (await last(120000))
    ?? (await withTimeout(askedFix(Location.Accuracy.Balanced), LOCATE_TIMEOUT_MS))
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

// A tap that asks for the location (the OS prompt follows ADA's own explanation screen). locate() resolves { lat, lng } or null;
// when null, `note` says why ({ msgKey, action }) and the person is told in words, never a dead button.
export function useLocate(lang) {
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  const busy = useRef(false)
  const wentToSettings = useRef(false)   // the services-off dialog itself backgrounds the app on Android; only a trip to Settings may clear the note
  useEffect(() => () => { alive.current = false }, [])
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
    setLocating(true)
    setNote(null)
    let perm = { status: null, canAskAgain: true }
    let fix = null
    try {
      perm = REDESIGN ? await requestWithPrimer('location') : await Location.requestForegroundPermissionsAsync()
      if (perm?.status === 'granted') fix = await getFix()
    } catch { fix = null }
    let servicesOn = true
    try { servicesOn = await Location.hasServicesEnabledAsync() } catch {}
    busy.current = false
    if (!alive.current) return null
    setLocating(false)
    const outcome = locateOutcome({ granted: perm?.status === 'granted', canAskAgain: perm?.canAskAgain !== false, servicesOn, fix })
    if (outcome === 'ok') {
      AccessibilityInfo.announceForAccessibility?.(t('eateryDeliveryLocated', lang))
      return { lat: fix.coords.latitude, lng: fix.coords.longitude }
    }
    const n = locateNote(outcome)
    setNote(n)
    AccessibilityInfo.announceForAccessibility?.(t(n.msgKey, lang))
    return null
  }
  const openFix = action => { wentToSettings.current = true; openLocationFix(action) }
  return { locating, note, locate, openFix, clearNote: () => setNote(null) }
}
