import * as Updates from 'expo-updates'
import Constants from 'expo-constants'
import { isNetworkError } from './profileLoad'

// Preview-only diagnostics for a stuck Home skeleton (read with `adb logcat -s ReactNativeJS`). Same two-part gate as
// previewTools.js: production bundles have no extra.appVariant. Never behaviour; never ids, emails, tokens or messages.
export const PROFILE_LOAD_LOG_ON = Updates.channel === 'preview' && Constants.expoConfig?.extra?.appVariant === 'preview'

const SAFE = /^[A-Za-z0-9_.-]{1,32}$/
let lastTickAt = null

function safe(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '?'
  if (typeof v === 'boolean' || v === null) return String(v)
  if (typeof v === 'string' && SAFE.test(v)) return v
  return '?'
}

export function plog(event, fields) {
  if (!PROFILE_LOAD_LOG_ON) return
  const parts = [safe(typeof event === 'string' && SAFE.test(event) ? event : '?')]
  for (const k of Object.keys(fields || {})) parts.push(`${safe(k)}=${safe(fields[k])}`)
  parts.push(`hb=${lastTickAt == null ? 'none' : Date.now() - lastTickAt}`)
  console.log(`[profile-load] ${parts.join(' ')}`)
}

export function errKind(e) {
  if (!e) return 'empty'
  if (e.name === 'TimeoutError') return 'timeout'
  if (e.name === 'AbortError') return 'abort'
  return isNetworkError(e) ? 'network' : 'other'
}

// A tick log with a growing hb= age on other events means timers stopped; no log at all then a big dt means the JS thread was blocked.
export function startHeartbeat(isStuck) {
  if (!PROFILE_LOAD_LOG_ON) return () => {}
  const id = setInterval(() => {
    const now = Date.now()
    const dt = lastTickAt == null ? 1000 : now - lastTickAt
    lastTickAt = now
    const stuck = !!isStuck()
    if (stuck) plog('hb', { dt, stuck })
    else if (dt > 2500) plog('hb-late', { dt, stuck })
  }, 1000)
  return () => clearInterval(id)
}
