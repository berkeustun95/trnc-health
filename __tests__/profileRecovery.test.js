// utils/profileRecovery.js with the REAL loadWithRetry and a fake network under fake timers, plus the App.js wiring it needs.
// ONB_APP_SRC points the source scan at a scratch copy of App.js (red-first checks); PROFILE_RECOVERY_MODULE does the same for the util.
const fs = require('fs')
const path = require('path')
const { loadWithRetry, isNetworkError } = require('../utils/profileLoad')
const { createProfileRecovery, PROFILE_SCREEN_RETRY_MS, PROFILE_STALE_LOAD_MS } = require(process.env.PROFILE_RECOVERY_MODULE || '../utils/profileRecovery')

const src = fs.readFileSync(process.env.ONB_APP_SRC || path.join(__dirname, '..', 'App.js'), 'utf8')

function at(text, needle, label) {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error(`${label}: ${JSON.stringify(needle)} not found`)
  return i
}

const SESSION = { user: { id: 'u1' } }
const OK = { data: { id: 'u1' }, error: null }
const netErr = () => ({ data: null, error: { message: 'Network request failed' } })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

// A tiny copy of App's glue: held ref, failed flag, offlineShown -> retryCount bump, and the interval that runs while failed.
function makeApp(fetchProfile) {
  const s = { held: false, failed: false, retryCount: 0, offlineShown: false, seq: 0, fetches: 0 }
  let intervalId = null
  const syncInterval = () => {
    if (s.failed && !intervalId) {
      intervalId = setInterval(() => rec.screenTick(SESSION, () => { s.offlineShown = true }), PROFILE_SCREEN_RETRY_MS)
    } else if (!s.failed && intervalId) { clearInterval(intervalId); intervalId = null }
  }
  const setFailed = v => { s.failed = v; syncInterval() }
  async function loadOnce() {
    const seq = ++s.seq
    const { data, error } = await loadWithRetry(
      signal => { s.fetches++; return fetchProfile(signal) },
      { onAttemptFailed: err => { if (isNetworkError(err) && seq === s.seq && !s.held) { s.offlineShown = true; setFailed(true) } } },
    )
    if (seq !== s.seq) return
    if (error || !data) { if (!s.held) setFailed(true); return }
    setFailed(false)
    if (s.offlineShown) { s.offlineShown = false; s.retryCount++ }
    s.held = true
  }
  const rec = createProfileRecovery({ loadOnce, isMissing: () => !s.held, current: () => SESSION })
  return { s, rec, stop: () => { if (intervalId) clearInterval(intervalId) } }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('network hangs, then returns: the 15 s retry loads the profile with no AppState event', async () => {
  let up = false
  const app = makeApp(() => (up ? Promise.resolve(OK) : new Promise(() => {})))
  app.rec.load(SESSION)
  await jest.advanceTimersByTimeAsync(39500) // 4 hung attempts of 8 s + 1 + 2 + 4 s of sleeps = give-up at 39 s
  // Exactly 7, from the fake-timer timeline. The failed flag (and so the 15 s interval) starts at the FIRST timeout, 8 s, so ticks fall at 23 s and 38 s.
  // Chain 1 (0 s): attempts at 0, 9, 19, 31 = 4 (hung 8 s each, sleeps 1, 2, 4 s; it is superseded but its retries run on, no isCurrent here).
  // Chain 2 (23 s, tick found chain 1 hung 23 s): attempts at 23, 32 = 2 (the third would be at 41 s, after the 39.5 s window).
  // Chain 3 (38 s, tick found chain 2 15 s old): attempt at 38 = 1.
  expect(app.s.fetches).toBe(7)
  expect(app.s.failed).toBe(true)
  expect(app.s.held).toBe(false)
  up = true // back at 40 s
  await jest.advanceTimersByTimeAsync(PROFILE_SCREEN_RETRY_MS)
  expect(app.s.held).toBe(true)
  expect(app.s.failed).toBe(false)
  expect(app.s.retryCount).toBe(1) // Home's reads re-run
  app.stop()

  const i = at(src, 'if (!profileFailedHere) return\n    const id = setInterval(', 'screen retry effect')
  const effect = src.slice(i, at(src, 'clearInterval(id)', 'clearInterval'))
  expect(effect).toContain('profileRecoveryRef.current.screenTick(')
  expect(effect).toContain('}, PROFILE_SCREEN_RETRY_MS)')
  expect(src).toContain("import { createProfileRecovery, PROFILE_SCREEN_RETRY_MS } from './utils/profileRecovery'")
})

test('network returns after the 4th attempt, app still open: recovered by the 15 s retry, not before', async () => {
  let up = false
  const app = makeApp(() => Promise.resolve(up ? OK : netErr()))
  app.rec.load(SESSION)
  await jest.advanceTimersByTimeAsync(3500) // attempts at 0 s, 1 s, 3 s: the 4th (7 s) is still to come
  expect(app.rec.screenTick(SESSION)).toBe(false)
  expect(app.s.fetches).toBe(3)
  await jest.advanceTimersByTimeAsync(4000) // 7.5 s: gave up after the 4th attempt
  expect(app.s.fetches).toBe(4)
  expect(app.s.failed).toBe(true)
  up = true // back about 3 s after give-up
  await jest.advanceTimersByTimeAsync(7000) // 14.5 s, just before the first tick at 15 s
  expect(app.s.held).toBe(false)
  await jest.advanceTimersByTimeAsync(500)
  expect(app.s.held).toBe(true)
  expect(app.s.retryCount).toBe(1)
  app.stop()

  const tick = src.slice(at(src, 'const id = setInterval(', 'interval'), at(src, 'clearInterval(id)', 'clearInterval'))
  expect(tick).toContain('screenTick(sessionRef.current, () => { offlineShownRef.current = true })')
  const retry = src.slice(at(src, 'function retryProfileLoad() {', 'retryProfileLoad'), at(src, 'const profileFailedHere', 'profileFailedHere'))
  expect(retry).toContain('profileRecoveryRef.current.load(sess)')
  expect(retry).not.toContain('loadProfile(sess)')
  const effect = src.slice(at(src, '  useEffect(() => {\n    sessionRef.current = session', 'session effect'), at(src, '\n  }, [session])', 'session effect end'))
  expect(effect).toContain('profileRecoveryRef.current.load(session)')
  expect(src).toContain('loadOnce: s => loadProfileRef.current(s)')
  expect(src).toContain('loadProfileRef.current = loadProfile')
})

test('a queued reload uses the CURRENT session, never the one that asked (A signs out, B signs in)', async () => {
  const A = { user: { id: 'a' } }
  const B = { user: { id: 'b' } }
  let cur = A
  let finish
  const loadOnce = jest.fn(() => (loadOnce.mock.calls.length === 1 ? new Promise(r => { finish = r }) : Promise.resolve()))
  const rec = createProfileRecovery({ loadOnce, isMissing: () => true, current: () => cur })
  rec.load(A)
  rec.homeReadOk(A)
  cur = B
  finish()
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2)
  expect(loadOnce.mock.calls[1][0]).toBe(B)

  // Signed out by then: nothing to reload.
  let fin2
  const load2 = jest.fn(() => (load2.mock.calls.length === 1 ? new Promise(r => { fin2 = r }) : Promise.resolve()))
  const rec2 = createProfileRecovery({ loadOnce: load2, isMissing: () => true, current: () => cur })
  rec2.load(B)
  rec2.homeReadOk(B)
  cur = null
  fin2()
  await flush()
  expect(load2).toHaveBeenCalledTimes(1)
})

test('recovery without advancing timers: a Home read success asks for the missing profile at once', async () => {
  // Fake timers are installed and no advanceTimers* is ever called; only microtasks are flushed (await Promise.resolve).
  const app = makeApp(() => Promise.resolve(OK))
  app.rec.homeReadOk(SESSION)
  await flush()
  expect(app.s.held).toBe(true)

  // A load in flight: nothing extra starts; when it gives up, the wanted reload starts at once.
  let finish
  let missing = true
  const loadOnce = jest.fn(() => (loadOnce.mock.calls.length === 1 ? new Promise(r => { finish = r }) : Promise.resolve()))
  const rec = createProfileRecovery({ loadOnce, isMissing: () => missing, current: () => SESSION })
  rec.load(SESSION)
  rec.homeReadOk(SESSION)
  rec.homeReadOk(SESSION)
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(1)
  finish()
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2) // once, however many reads asked
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2)

  // Profile held: a Home read does nothing.
  missing = false
  rec.homeReadOk(SESSION)
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2)

  const home = src.slice(at(src, "plog('read-start', { name: 'facilities' })", 'facilities'), at(src, 'let resolvedCoords = null', 'resolvedCoords'))
  const names = ['facilities', 'duty_schedule', 'reviews']
  names.forEach((name, i) => {
    const from = at(home, `name: '${name}' })`, name)
    const to = i + 1 < names.length ? at(home, `name: '${names[i + 1]}' })`, names[i + 1]) : home.length
    const part = home.slice(from, to)
    expect(part).toContain('profileRecoveryRef.current.homeReadOk(sessionRef.current)')
  })
  const roster = src.slice(at(src, 'async function loadRosterHealth() {', 'roster'), at(src, '    loadRosterHealth()\n', 'roster call'))
  expect(roster).toContain('profileRecoveryRef.current.homeReadOk(sessionRef.current)')
  expect(roster.split("withTimeout(s => supabase.from('duty_list')").length - 1).toBe(2)
  expect(roster.split('.abortSignal(s)').length - 1).toBe(2)
  expect(roster.split('.catch(e => ({ data: null, error: e }))').length - 1).toBe(2)
})

// A load whose promise never settles, with a hand-moved clock (no timers advanced anywhere below).
function hung(missing = () => true) {
  let t = 1000000
  const loadOnce = jest.fn(() => new Promise(() => {}))
  const logs = []
  const rec = createProfileRecovery({ loadOnce, isMissing: missing, current: () => SESSION, now: () => t, log: (e, d) => logs.push([e, d]) })
  return { rec, loadOnce, logs, advance: ms => { t += ms } }
}

test('a hung load is superseded on a Home read, with no timer', async () => {
  const h = hung()
  h.rec.load(SESSION)
  h.advance(PROFILE_STALE_LOAD_MS - 1000)
  h.rec.homeReadOk(SESSION) // newest load younger than the threshold: only wanted
  await flush()
  expect(h.loadOnce).toHaveBeenCalledTimes(1)
  h.advance(1000 + 4000) // 14 s old
  h.rec.homeReadOk(SESSION)
  await flush()
  expect(h.loadOnce).toHaveBeenCalledTimes(2)
  expect(h.loadOnce.mock.calls[1][0]).toBe(SESSION)
  expect(h.logs).toContainEqual(['supersede-stale', { age: 14, via: 'home' }])
})

test('a clock that went backwards counts as stale: the hung load is superseded', async () => {
  const h = hung()
  h.rec.load(SESSION)
  h.advance(-5000)
  h.rec.homeReadOk(SESSION)
  await flush()
  expect(h.loadOnce).toHaveBeenCalledTimes(2)
})

test('three Home reads in a row past the threshold start exactly one superseding load', async () => {
  let missing = true
  let finish
  let t = 0
  const loadOnce = jest.fn(() => (loadOnce.mock.calls.length === 1 ? new Promise(() => {}) : new Promise(r => { finish = r })))
  const rec = createProfileRecovery({ loadOnce, isMissing: () => missing, current: () => SESSION, now: () => t })
  rec.load(SESSION)
  t += PROFILE_STALE_LOAD_MS
  rec.homeReadOk(SESSION)
  rec.homeReadOk(SESSION)
  rec.homeReadOk(SESSION)
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2)
  // The superseding load settles, the hung one never does: the queued wanted reload still fires while the profile is missing.
  finish()
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(3)
  finish()
  await flush()
  missing = false
  expect(loadOnce).toHaveBeenCalledTimes(3)
})

test('a late settle of a superseded load does not reload or disturb the newest load', async () => {
  let t = 0
  const resolvers = []
  const loadOnce = jest.fn(() => new Promise(r => { resolvers.push(r) }))
  const rec = createProfileRecovery({ loadOnce, isMissing: () => true, current: () => SESSION, now: () => t })
  rec.load(SESSION)
  t += PROFILE_STALE_LOAD_MS
  rec.homeReadOk(SESSION) // supersedes #1
  rec.homeReadOk(SESSION) // wanted
  resolvers[0]() // the old one settles late
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(2)
  expect(rec.busy()).toBe(true)
  resolvers[1]() // the newest settles: now the wanted reload runs
  await flush()
  expect(loadOnce).toHaveBeenCalledTimes(3)
})

test('screenTick supersedes a hung load older than the threshold and leaves a younger one alone', async () => {
  const h = hung()
  const before = jest.fn()
  h.rec.load(SESSION)
  h.advance(PROFILE_STALE_LOAD_MS - 1000)
  expect(h.rec.screenTick(SESSION, before)).toBe(false)
  expect(before).not.toHaveBeenCalled()
  expect(h.loadOnce).toHaveBeenCalledTimes(1)
  h.advance(1000)
  expect(h.rec.screenTick(SESSION, before)).toBe(true)
  expect(before).toHaveBeenCalledTimes(1)
  await flush()
  expect(h.loadOnce).toHaveBeenCalledTimes(2)
  expect(h.loadOnce.mock.calls[1][0]).toBe(SESSION)
  expect(h.logs).toContainEqual(['supersede-stale', { age: 10, via: 'tick' }])
})
