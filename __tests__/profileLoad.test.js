// utils/profileLoad.js: bounded retry for the profile read, plus the App.js wiring it must keep.
// ONB_APP_SRC points the source scan at a scratch copy of App.js (red-first checks).
const fs = require('fs')
const path = require('path')
const { loadWithRetry, PROFILE_RETRY_DELAYS } = require('../utils/profileLoad')

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
