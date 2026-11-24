// utils/profileLoadLog.js: Preview-only diagnostics. Gate off = silent and no timers; the sanitiser keeps PII out of logcat.
function load({ channel, appVariant }) {
  let mod
  jest.isolateModules(() => {
    jest.doMock('expo-updates', () => ({ channel }))
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: appVariant === undefined ? {} : { appVariant } } },
    }))
    mod = require('../utils/profileLoadLog')
  })
  return mod
}

let logSpy
let intervalSpy
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  intervalSpy = jest.spyOn(global, 'setInterval')
})
afterEach(() => { jest.restoreAllMocks() })

const lastLine = () => logSpy.mock.calls[logSpy.mock.calls.length - 1][0]

describe('gate off', () => {
  test.each([
    ['production channel + preview variant', { channel: 'production', appVariant: 'preview' }],
    ['preview channel, no variant', { channel: 'preview', appVariant: undefined }],
    ['null channel', { channel: null, appVariant: 'preview' }],
  ])('%s: no log, no interval', (_n, cfg) => {
    const m = load(cfg)
    expect(m.PROFILE_LOAD_LOG_ON).toBe(false)
    m.plog('attempt-start', { n: 1 })
    const stop = m.startHeartbeat(() => true)
    stop()
    expect(logSpy).not.toHaveBeenCalled()
    expect(intervalSpy).not.toHaveBeenCalled()
  })
})

describe('gate on', () => {
  test('positive control: logs a [profile-load] line', () => {
    const m = load({ channel: 'preview', appVariant: 'preview' })
    expect(m.PROFILE_LOAD_LOG_ON).toBe(true)
    m.plog('attempt-start', { n: 1, seq: 2 })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(lastLine()).toBe('[profile-load] attempt-start n=1 seq=2 hb=none')
  })

  test('heartbeat ticks and gives plog an hb= age', () => {
    jest.useFakeTimers()
    const m = load({ channel: 'preview', appVariant: 'preview' })
    const stop = m.startHeartbeat(() => true)
    jest.advanceTimersByTime(1000)
    expect(lastLine()).toMatch(/^\[profile-load\] hb dt=1000 stuck=true hb=0$/)
    stop()
    jest.useRealTimers()
  })

  test('sanitiser prints ? for anything that could identify someone', () => {
    const m = load({ channel: 'preview', appVariant: 'preview' })
    const bad = {
      email: 'person@example.com',
      uuid: '3f2b8c1e-aaaa bbbb@cccc:dddd',
      url: 'https://abc.supabase.co/rest/v1/profiles?id=eq.1',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      nan: NaN,
      obj: { a: 1 },
    }
    m.plog('x', bad)
    const line = lastLine()
    for (const k of Object.keys(bad)) expect(line).toContain(`${k}=?`)
    expect(line).not.toMatch(/example|supabase|eyJ|3f2b/)
  })

  test('numbers, booleans, null and enum kinds print as-is; a bad event name is ?', () => {
    const m = load({ channel: 'preview', appVariant: 'preview' })
    m.plog('read-fail', { ms: 42, ok: false, kind: 'timeout', code: 'PGRST116', v: null })
    expect(lastLine()).toBe('[profile-load] read-fail ms=42 ok=false kind=timeout code=PGRST116 v=null hb=none')
    m.plog('has space', {})
    expect(lastLine()).toBe('[profile-load] ? hb=none')
  })

  test('errKind', () => {
    const { errKind } = load({ channel: 'preview', appVariant: 'preview' })
    expect(errKind(null)).toBe('empty')
    expect(errKind({ name: 'TimeoutError' })).toBe('timeout')
    expect(errKind({ name: 'AbortError' })).toBe('abort')
    expect(errKind(new Error('Network request failed'))).toBe('network')
    expect(errKind(new Error('boom'))).toBe('other')
  })
})
