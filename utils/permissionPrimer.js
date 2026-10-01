import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'

// Permission explanation screens (redesign): before the OS pop-up, a short ADA screen says WHY
// (components/PermissionPrimer.js draws it). Its own buttons are "Devam" / "Şimdi değil", never
// "İzin ver", so it cannot pass for the system dialog (App Store 5.1.1).
// Shown only when the OS would actually ask: never once granted, never when the OS will no
// longer ask (canAskAgain false — the screens offer "Ayarları aç" instead).
// Same triggers as before; only the explanation is new. Automatic triggers (app start, sign-in)
// back off after "Şimdi değil": SNOOZE_DAYS the first time, then no automatic ask at all —
// tap-triggered asks (a "near me" button, Başla) still explain every time.
export const SNOOZE_DAYS = 7
const AUTO_MAX_LATER = 2
const KEY = 'ada.permPrimer.v1'

const API = {
  location:      { get: () => Location.getForegroundPermissionsAsync(), request: () => Location.requestForegroundPermissionsAsync() },
  notifications: { get: () => Notifications.getPermissionsAsync(),      request: () => Notifications.requestPermissionsAsync() },
}

// ── the visible request + the mounted hosts (App's root, and one inside any RN Modal that can
// ask — a root overlay cannot draw above a Modal). The newest mounted host draws it.
let request = null
let hosts = []
let snapshot = { request: null, top: null }
const subs = new Set()
function update() { snapshot = { request, top: hosts[hosts.length - 1] ?? null }; subs.forEach(f => f()) }
export const primerStore = {
  subscribe: f => { subs.add(f); return () => subs.delete(f) },
  get: () => snapshot,
}
let hostWaiters = []
export function registerHost(id) {
  hosts.push(id); update()
  hostWaiters.forEach(f => f()); hostWaiters = []
  return () => { hosts = hosts.filter(h => h !== id); update() }
}
export function answerPrimer(choice) {
  const r = request
  request = null; update()
  r?.resolve(choice)
}
// For a Modal's onRequestClose: Android back inside a Modal never reaches addBackListener.
export function dismissPrimer() {
  if (!request) return false
  answerPrimer('later')
  return true
}
// App's host mounts once the fonts are in, which the startup ask can beat by a moment.
const HOST_WAIT_MS = 4000
function waitForHost() {
  if (hosts.length) return Promise.resolve(true)
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(hosts.length > 0) }
    const timer = setTimeout(() => { hostWaiters = hostWaiters.filter(f => f !== done); resolve(false) }, HOST_WAIT_MS)
    hostWaiters.push(done)
  })
}
async function showPrimer(kind) {
  if (!(await waitForHost())) return 'continue'   // nothing can draw it: the OS dialog, as before
  return new Promise(resolve => { request = { kind, resolve }; update() })
}

async function readState() {
  try { return JSON.parse(await AsyncStorage.getItem(KEY)) || {} } catch { return {} }
}
async function autoAllowed(kind) {
  const s = (await readState())[kind]
  if (!s) return true
  return s.later < AUTO_MAX_LATER && Date.now() >= (s.until || 0)
}
async function recordLater(kind) {
  try {
    const all = await readState()
    const later = (all[kind]?.later || 0) + 1
    all[kind] = { later, until: Date.now() + SNOOZE_DAYS * 864e5 }
    await AsyncStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
}

// One flow at a time: app start (location) and sign-in (notifications) can fire together.
let chain = Promise.resolve()
function queued(fn) {
  const p = chain.then(fn)
  chain = p.catch(() => {})
  return p
}

// → { status, canAskAgain, asked } — asked: the OS dialog was shown (so a "No" just happened).
export function requestWithPrimer(kind, { auto = false } = {}) {
  return queued(async () => {
    const api = API[kind]
    const cur = await api.get()
    const now = { status: cur.status, canAskAgain: cur.canAskAgain !== false, asked: false }
    if (cur.status === 'granted' || cur.canAskAgain === false) return now
    if (auto && !(await autoAllowed(kind))) return now
    if ((await showPrimer(kind)) !== 'continue') {
      if (auto) await recordLater(kind)
      return now
    }
    const res = await api.request()
    return { status: res.status, canAskAgain: res.canAskAgain !== false, asked: true }
  })
}
