// utils/onboardingEvents.js: onboarding statistics come only from production store installs, and never from a
// phone marked as a test device (ada://test-device, persisted in AsyncStorage).
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)) }

function load({ channel = 'production', dev = false, stored = null, storedError = false, initialUrl = null } = {}) {
  const insert = jest.fn(() => ({ then: (ok) => { ok && ok({ error: null }); return Promise.resolve() } }))
  const AsyncStorage = {
    getItem: jest.fn(() => (storedError ? Promise.reject(new Error('disk')) : Promise.resolve(stored))),
    setItem: jest.fn(() => Promise.resolve()),
  }
  const Linking = { getInitialURL: jest.fn(() => Promise.resolve(initialUrl)) }
  const prevDev = global.__DEV__
  global.__DEV__ = dev
  let mod
  jest.isolateModules(() => {
    jest.doMock('expo-updates', () => ({ channel, runtimeVersion: '1.4.3' }))
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' }, Linking }))
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }))
    jest.doMock('../lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ insert })) } }))
    mod = require('../utils/onboardingEvents')
  })
  global.__DEV__ = prevDev
  return { mod, insert, AsyncStorage, Linking }
}

describe('where events are sent from', () => {
  test('production channel, not dev: sends (positive control)', async () => {
    const { mod, insert } = load()
    expect(mod.SENDS_ONBOARDING_EVENTS).toBe(true)
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({ event: 'start_shown', platform: 'android' })
  })
  test('preview channel: nothing sent', async () => {
    const { mod, insert } = load({ channel: 'preview' })
    expect(mod.SENDS_ONBOARDING_EVENTS).toBe(false)
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('no channel (Expo Go): nothing sent', async () => {
    const { mod, insert } = load({ channel: null })
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('__DEV__ on a production channel: nothing sent', async () => {
    const { mod, insert } = load({ dev: true })
    expect(mod.SENDS_ONBOARDING_EVENTS).toBe(false)
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('test device', () => {
  test('stored flag blocks', async () => {
    const { mod, insert } = load({ stored: 'true' })
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('a cold start opened by the test-device link blocks the very first event, before markTestDevice runs', async () => {
    const { mod, insert } = load({ initialUrl: 'ada://test-device' })
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('markTestDevice blocks later events and persists the key', async () => {
    const { mod, insert, AsyncStorage } = load()
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).toHaveBeenCalledTimes(1)
    const p = mod.markTestDevice()
    mod.logOnboardingEvent('start_choice_guest')
    await p
    await flush()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@ada_test_device', 'true')
  })
  test('markTestDevice flips the flag synchronously, even before the storage write finishes', async () => {
    const { mod, insert, AsyncStorage } = load()
    AsyncStorage.setItem.mockImplementation(() => new Promise(() => {}))
    mod.markTestDevice()
    mod.logOnboardingEvent('start_shown')
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('a getItem rejection blocks (fail closed) and does not throw', async () => {
    const { mod, insert } = load({ storedError: true })
    expect(() => mod.logOnboardingEvent('start_shown')).not.toThrow()
    await flush()
    expect(insert).not.toHaveBeenCalled()
  })
  test('logOnboardingEvent returns nothing the caller could await', () => {
    const { mod } = load()
    expect(mod.logOnboardingEvent('start_shown')).toBeUndefined()
  })
})

describe('isTestDeviceLink', () => {
  const { isTestDeviceLink } = load().mod
  test.each([
    ['ada://test-device', true],
    ['ada://test-device/', true],
    ['ada://test-device?x=1', true],
    ['ada://auth?code=x', false],
    ['https://x/test-device', false],
    ['ada://test-devices', false],
    ['ada://', false],
    ['ada://test-device-x', false],
    ['ada://test-device/x', false],
    ['ada://test-device#f', true],
    ['', false],
    [42, false],
    ['ada://auth?code=test-device', false],
    [null, false],
    [undefined, false],
  ])('%s -> %s', (url, expected) => { expect(isTestDeviceLink(url)).toBe(expected) })
})

test('the onboarding reset never clears the test-device key', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'previewTools.js'), 'utf8')
  expect(src).not.toContain('@ada_test_device')
})

test('App.js handleDeepLink handles the test-device link FIRST, before any auth-token parsing', () => {
  const src = require('fs').readFileSync(process.env.ONB_APP_SRC || require('path').join(__dirname, '..', 'App.js'), 'utf8')
  const fn = src.slice(src.indexOf('async function handleDeepLink(url)'))
  const link = fn.indexOf('isTestDeviceLink(url)')
  expect(link).toBeGreaterThan(0)
  expect(link).toBeLessThan(fn.indexOf('new URL('))
  expect(fn.slice(link, fn.indexOf('new URL(')).replace(/\s+/g, ' ')).toMatch(/await markTestDevice\(\) .*Alert\.alert\(.*\) return/)
})
