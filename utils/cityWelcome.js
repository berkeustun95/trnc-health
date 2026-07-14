// City welcome — storage, trigger, throttling. No UI (slice 3 adds the card).
// The pure decision rules live in cityWelcomeRules.js; this is the shell around
// them.
//
// Everything here is DEVICE-LOCAL (AsyncStorage). Nothing is written to Supabase
// and nothing is per-account, so a guest behaves identically to a signed-in user
// — which matters, because a visiting tourist on a guest session is the primary
// user of this feature.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { resolveRegion } from './resolveRegion'
import {
  KEY_ENABLED, KEY_HOME, KEY_SEEN, KEY_ASKED, KEY_ASK_LAST,
  decideWelcome, shouldAskHomeCity, parseSeen,
} from './cityWelcomeRules'

export { VISITING, COOLDOWN_MS, decideWelcome, shouldAskHomeCity } from './cityWelcomeRules'

// --- flags ------------------------------------------------------------------

// Slice 2 is log-only: the decision is computed and printed, never rendered.
// Slice 3 renders the card instead. Grep the logs for `[city-welcome]`.
export const CITY_WELCOME_DEBUG = true

// Set to a region slug ('kyrenia', 'karpaz', …) to pretend the device is there,
// so the trigger and cooldown can be exercised without driving to Famagusta.
export const DEBUG_FORCE_REGION = null

// --- storage ----------------------------------------------------------------

export async function loadCityWelcomeState() {
  const [[, enabled], [, home], [, seenRaw], [, asked], [, askLast]] = await AsyncStorage.multiGet([
    KEY_ENABLED, KEY_HOME, KEY_SEEN, KEY_ASKED, KEY_ASK_LAST,
  ])
  return {
    enabled: enabled !== 'off',    // absent => on
    home:    home ?? null,         // null | region slug | 'visiting'
    seen:    parseSeen(seenRaw),
    asked:   asked === 'true',
    askLast: Number(askLast) || 0, // 0 => never asked
  }
}

// Recorded when the question goes ON SCREEN, not when it is answered — a soft
// dismiss leaves `asked` false, and this timestamp is the only thing stopping us
// asking again on the very next launch.
export async function markAskShown(now = Date.now()) {
  try { await AsyncStorage.setItem(KEY_ASK_LAST, String(now)) } catch {}
}

// Errors are swallowed: a storage failure should cost a remembered timestamp,
// not break the app. Same contract as @trnc_oli_pos.
export async function markWelcomeShown(region, now = Date.now()) {
  try {
    const { seen } = await loadCityWelcomeState()
    await AsyncStorage.setItem(KEY_SEEN, JSON.stringify({ ...seen, [region]: now }))
  } catch {}
}

export async function setCityWelcomeEnabled(on) {
  try { await AsyncStorage.setItem(KEY_ENABLED, on ? 'on' : 'off') } catch {}
}

// `home` is a region slug or VISITING. Answering the question at all is what
// sets KEY_ASKED — including answering "I'm just visiting".
export async function setHomeCity(home) {
  try {
    if (home) await AsyncStorage.multiSet([[KEY_HOME, home], [KEY_ASKED, 'true']])
    else      await AsyncStorage.multiRemove([KEY_HOME])
  } catch {}
}

// --- trigger ----------------------------------------------------------------

// One foreground fix. Returns null rather than prompting: if location was never
// granted, or was revoked, city welcome simply stays silent. v1 must never
// escalate a permission, and must never re-ask.
async function getForegroundFix() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') return null

    // Usually enough, and free — the OS returns a cached fix with no radio work.
    // Only pay for a live fix when there is nothing cached.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })
    if (last?.coords) return last.coords

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return loc?.coords ?? null
  } catch {
    return null
  }
}

// The whole check. Returns the decision plus the resolved region and coords.
//
// PRECISION: the raw ~100 m fix goes straight into resolveRegion, uncoarsened.
// That is deliberate and privacy-neutral — resolveRegion is offline, so the
// coordinate never leaves the device. `coarseCoord` is a TRANSMISSION guard (it
// exists for the open-meteo call); coarsening here would buy no privacy and
// would push central-Lefkoşa users outside the outline. See the slice-1 report.
export async function evaluateCityWelcome(trigger = 'unknown') {
  const state = await loadCityWelcomeState()

  let region = DEBUG_FORCE_REGION
  let coords = null
  if (!region) {
    coords = await getForegroundFix()
    region = coords ? resolveRegion(coords.latitude, coords.longitude) : null
  }

  const decision = decideWelcome({ ...state, region, now: Date.now() })

  if (CITY_WELCOME_DEBUG) {
    const where = DEBUG_FORCE_REGION ? `FORCED=${DEBUG_FORCE_REGION}`
      : coords ? `${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)}`
      : 'no-fix'
    console.log(
      `[city-welcome] trigger=${trigger} at=${where} region=${region} ` +
      `=> show=${decision.show}${decision.variant ? ` variant=${decision.variant}` : ''} reason=${decision.reason} ` +
      `| enabled=${state.enabled} home=${state.home} asked=${state.asked} seen=${JSON.stringify(state.seen)}`
    )
  }

  return { ...decision, region, coords }
}
