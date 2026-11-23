// utils/profileLoad.js: bounded retry for the profile read, plus the App.js wiring it must keep.
// ONB_APP_SRC points the source scan at a scratch copy of App.js (red-first checks).
const fs = require('fs')
const path = require('path')
const { loadWithRetry, PROFILE_RETRY_DELAYS, PROFILE_ATTEMPT_TIMEOUT_MS } = require('../utils/profileLoad')

const src = fs.readFileSync(process.env.ONB_APP_SRC || path.join(__dirname, '..', 'App.js'), 'utf8')

function harness(results) {
  const sleeps = []
  let calls = 0
  const fetchFn = jest.fn(() => {
    const r = results[Math.min(calls, results.length - 1)]
    calls++
    if (r instanceof Error) return Promise.reject(r)
    return Promise.resolve(r)
  })
  const sleep = jest.fn(ms => { sleeps.push(ms); return Promise.resolve() })
  return { fetchFn, sleep, sleeps }
}
const OK = { data: { id: 'u1' }, error: null }
const ERR = { data: null, error: { message: 'Network request failed' } }

test('delays are 1 s, 2 s, 4 s (3 retries after the first attempt)', () => {
  expect(PROFILE_RETRY_DELAYS).toEqual([1000, 2000, 4000])
})

test('success on the first try: one call, no sleep', async () => {
  const h = harness([OK])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(res).toEqual(OK)
  expect(h.fetchFn).toHaveBeenCalledTimes(1)
  expect(h.sleeps).toEqual([])
})

test('transient error then success: second attempt after 1 s', async () => {
  const h = harness([ERR, OK])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(res).toEqual(OK)
  expect(h.fetchFn).toHaveBeenCalledTimes(2)
  expect(h.sleeps).toEqual([1000])
})

test('data null with no error is a failure too', async () => {
  const h = harness([{ data: null, error: null }, OK])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(res.data).toEqual({ id: 'u1' })
  expect(h.fetchFn).toHaveBeenCalledTimes(2)
})

test('gives up after 4 attempts with { data: null, error }', async () => {
  const h = harness([ERR])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(h.fetchFn).toHaveBeenCalledTimes(4)
  expect(h.sleeps).toEqual([1000, 2000, 4000])
  expect(res.data).toBeNull()
  expect(res.error).toBeTruthy()
})

test('data null with no error still resolves with an error object after the bound', async () => {
  const h = harness([{ data: null, error: null }])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(res.data).toBeNull()
  expect(res.error).toBeTruthy()
})

test('stops as soon as isCurrent() turns false', async () => {
  const h = harness([ERR])
  let current = true
  const sleep = jest.fn(async () => { current = false })
  const res = await loadWithRetry(h.fetchFn, { sleep, isCurrent: () => current })
  expect(h.fetchFn).toHaveBeenCalledTimes(1)
  expect(res.data).toBeNull()
  expect(res.error).toBeTruthy()
})

test('never throws: a rejecting fetch is a failure and is retried', async () => {
  const h = harness([new Error('boom'), OK])
  const res = await loadWithRetry(h.fetchFn, { sleep: h.sleep })
  expect(res).toEqual(OK)
  const h2 = harness([new Error('boom')])
  await expect(loadWithRetry(h2.fetchFn, { sleep: h2.sleep })).resolves.toMatchObject({ data: null })
})

test('a hung fetch is aborted per attempt and the call still resolves { data: null, error } within the bound', async () => {
  jest.useFakeTimers()
  try {
    expect(PROFILE_ATTEMPT_TIMEOUT_MS).toBe(8000)
    const signals = []
    const fetchFn = jest.fn(signal => { signals.push(signal); return new Promise(() => {}) })
    let res = null
    const p = loadWithRetry(fetchFn).then(r => { res = r })
    // 4 attempts x 8 s + waits 1 + 2 + 4 s
    await jest.advanceTimersByTimeAsync(4 * PROFILE_ATTEMPT_TIMEOUT_MS + 7000)
    await p
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(signals.every(sig => sig && sig.aborted === true)).toBe(true)
    expect(res.data).toBeNull()
    expect(res.error).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})

test('a hung fetch with isCurrent() false after the first timeout stops the loop', async () => {
  jest.useFakeTimers()
  try {
    let current = true
    const fetchFn = jest.fn(() => new Promise(() => {}))
    const sleep = jest.fn(async () => { current = false })
    const p = loadWithRetry(fetchFn, { sleep, isCurrent: () => current })
    await jest.advanceTimersByTimeAsync(PROFILE_ATTEMPT_TIMEOUT_MS + 1)
    const res = await p
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(res.data).toBeNull()
    expect(res.error).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})

// ── App.js wiring ──
function at(hay, needle, label) {
  const i = hay.indexOf(needle)
  if (i < 0) throw new Error(`${label}: ${JSON.stringify(needle)} not found`)
  return i
}

test('the session effect reads the profile through loadWithRetry, not a bare .single()', () => {
  const effectStart = at(src, '  useEffect(() => {\n    sessionRef.current = session', 'session effect')
  const effectEnd = at(src, '\n  }, [session])', 'session effect end')
  const effect = src.slice(effectStart, effectEnd)
  expect(effect).toContain('loadProfile(')
  expect(effect).not.toContain(".from('profiles').select(PROFILE_COLUMNS)")
  const fn = src.slice(at(src, 'function loadProfile(', 'loadProfile'), effectStart)
  expect(fn).toContain('loadWithRetry(')
  expect(fn).toContain('isCurrent')
  expect(fn).toContain('setProfileLoadFailedUid(')
})

test('the profile-failed branch sits BEFORE both (loading || !profile) branches', () => {
  const failed = at(src, 'profileLoadFailedUid === session.user.id', 'failed branch')
  const spinner = at(src, '} else if ((loading || !profile) && (onbPending === PENDING_DUTY', 'spinner branch')
  const skeleton = at(src, '} else if (loading || !profile) {', 'skeleton branch')
  expect(failed).toBeLessThan(spinner)
  expect(failed).toBeLessThan(skeleton)
  expect(src).toContain('<ProfileLoadFailedScreen')
  expect(src).toContain('function ProfileLoadFailedScreen(')
  const comp = at(src, 'function ProfileLoadFailedScreen(', 'comp')
  expect(comp).toBeLessThan(at(src, 'export default function App()', 'App'))
})

test('loadProfile applies a result only for the newest call (sequence guard)', () => {
  const start = at(src, 'async function loadProfile(', 'loadProfile')
  const fn = src.slice(start, at(src, '// Language self-heal', 'self-heal'))
  expect(fn).toContain('const seq = ++profileLoadSeqRef.current')
  expect(fn).toContain('seq !== profileLoadSeqRef.current')
  expect(fn.indexOf('seq !== profileLoadSeqRef.current')).toBeLessThan(fn.indexOf('setProfileLoadFailedUid(uid)'))
})

test('a failed reload with a row already held for the same uid does not set the failed uid', () => {
  const start = at(src, 'async function loadProfile(', 'loadProfile')
  const fn = src.slice(start, at(src, '// Language self-heal', 'self-heal'))
  expect(fn).toContain('if (heldProfileUidRef.current !== uid) setProfileLoadFailedUid(uid)')
  expect(fn).toContain('heldProfileUidRef.current = session.user.id')
  expect(src).toContain('heldProfileUidRef.current = null; setNotifications([])')
})

test('both Onboarding v2 spinners sit on PageCanvas, not the legacy colors.bg View', () => {
  const spin = '<PageCanvas><SplashStatusBar style="dark" /><View style={styles.centerOnPage}><ActivityIndicator'
  expect(src.split(spin).length - 1).toBe(2)
  expect(src).toMatch(/centerOnPage:\s+\{[^}]*\}/)
  expect(src.match(/centerOnPage:\s+\{[^}]*\}/)[0]).not.toContain('backgroundColor')
})

test('the profile query carries the attempt signal (.abortSignal)', () => {
  const start = at(src, 'async function loadProfile(', 'loadProfile')
  const fn = src.slice(start, at(src, '// Language self-heal', 'self-heal'))
  expect(fn).toContain('signal => supabase.from(\'profiles\')')
  expect(fn).toContain('.abortSignal(signal)')
})
