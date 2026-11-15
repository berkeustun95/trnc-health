// Home Hizmetler: the STORAGE half (utils/moduleUsage.js) feeding the resolver, which homeServices.test.js
// only exercises with in-memory arrays. Every read goes through loadPins / loadUsage against a mocked
// AsyncStorage, the way HomeScreen's mount effect does.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const LOCKED_FRESH = ['events', 'accommodation', 'exchangeRates', 'newcomerEssentials', 'exploreTab', 'eatery', 'hotels', 'pets']
const KEY_PINS = '@trnc_module_pins'
const KEY_USAGE = '@trnc_module_usage'
const KEY_CARD = '@ada_home_customise_card_done'

const load = () => {
  jest.resetModules()
  global.__DEV__ = false
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  const AsyncStorage = require('@react-native-async-storage/async-storage')
  return {
    AsyncStorage,
    usage: require('../utils/moduleUsage'),
    groups: require('../constants/homeGroups'),
    fav: require('../constants/homeFavourites'),
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

async function homeEight(env) {
  const [u, p] = await Promise.all([env.usage.loadUsage(), env.usage.loadPins()])
  return { pins: p, out: env.fav.resolveFavourites({ pins: p, usage: u, visible: env.groups.visibleServiceIds() }) }
}

test('fresh install (no keys): 8 nulls, the locked eight, card not done', async () => {
  const env = load()
  await env.AsyncStorage.clear()
  const { pins, out } = await homeEight(env)
  expect(pins).toEqual(new Array(8).fill(null))
  expect(out).toEqual(LOCKED_FRESH)
  expect(await env.usage.loadCustomiseCardDone()).toBe(false)
})

test('an old 4-slot pins array with nulls carries into slots 1-4', async () => {
  const env = load()
  await env.AsyncStorage.clear()
  await env.AsyncStorage.setItem(KEY_PINS, JSON.stringify(['pets', null, 'health', null]))
  const { pins, out } = await homeEight(env)
  expect(pins).toEqual(['pets', null, 'health', null, null, null, null, null])
  expect([out[0], out[2]]).toEqual(['pets', 'health'])
  expect(out).toHaveLength(8)
  expect(new Set(out).size).toBe(8)
})

test.each([
  ['corrupt pins JSON', '{not json', null],
  ['pins is an object', '{"a":1}', null],
  ['pins hold non-strings', '[1, {}, true, "", null]', null],
  ['corrupt usage JSON', null, '[[['],
  ['usage is an array', null, '["health"]'],
  ['usage counts are NaN / negative / strings', null, '{"health":"x","municipal":-5,"towing":null}'],
])('%s -> no throw, the locked eight', async (_name, pinsRaw, usageRaw) => {
  const env = load()
  await env.AsyncStorage.clear()
  if (pinsRaw !== null) await env.AsyncStorage.setItem(KEY_PINS, pinsRaw)
  if (usageRaw !== null) await env.AsyncStorage.setItem(KEY_USAGE, usageRaw)
  const { out } = await homeEight(env)
  expect(out).toEqual(LOCKED_FRESH)
})

test('pins to a dark id (cars, production), a hidden id (garages) and an unknown id are skipped; storage untouched', async () => {
  const env = load()
  await env.AsyncStorage.clear()
  const stored = JSON.stringify(['cars', 'garages', 'no-such-module', null, null, null, null, null])
  await env.AsyncStorage.setItem(KEY_PINS, stored)
  expect(env.groups.visibleServiceIds()).not.toContain('cars')   // positive control: cars really is dark here
  env.AsyncStorage.setItem.mockClear()
  const { out } = await homeEight(env)
  expect(out).toEqual(LOCKED_FRESH)
  expect(env.AsyncStorage.setItem).not.toHaveBeenCalled()
  expect(await env.AsyncStorage.getItem(KEY_PINS)).toBe(stored)
})

test('customise card: once done it stays done, also after clearModuleUsage', async () => {
  const env = load()
  await env.AsyncStorage.clear()
  expect(await env.usage.loadCustomiseCardDone()).toBe(false)
  await env.usage.markCustomiseCardDone()
  expect(await env.AsyncStorage.getItem(KEY_CARD)).toBe('1')
  await env.AsyncStorage.setItem(KEY_PINS, JSON.stringify(['pets']))
  await env.usage.clearModuleUsage()
  expect(await env.AsyncStorage.getItem(KEY_PINS)).toBe(null)   // positive control: the clear did run
  expect(await env.usage.loadCustomiseCardDone()).toBe(true)
})

test('customise card: a storage read failure reads as not done (card shows), never throws', async () => {
  const env = load()
  env.AsyncStorage.getItem.mockImplementationOnce(() => Promise.reject(new Error('disk')))
  expect(await env.usage.loadCustomiseCardDone()).toBe(false)
})
