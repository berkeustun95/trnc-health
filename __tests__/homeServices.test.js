// Home Hizmetler, slice 1: the ONE visibility list (visibleServiceIds) and the favourites resolver on top of it.
//
// __DEV__ is true under jest-expo, which would turn EATERY / CARS / MARKETPLACE on and make a "production"
// count meaningless. So every load() sets global.__DEV__ explicitly and mocks expo-constants (the Preview
// switch reads Constants.expoConfig.extra.appVariant), exactly as marketplaceDark.test.js does.
// Expected counts were DERIVED by printing the lists, not remembered; the rows ride in every failure message.

const load = ({ dev }) => {
  jest.resetModules()
  global.__DEV__ = dev
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  return {
    groups: require('../constants/homeGroups'),
    fav: require('../constants/homeFavourites'),
    modules: require('../constants/homeModules'),
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

// HomeScreen's HOME_UNLOCK on ADA Preview / dev: ehliyet + marketplace. Both flags are live now, so production
// shows 19; dev adds `cars` (dark in production) for 20.
const PREVIEW_UNLOCK = new Set(['ehliyet', 'marketplace'])

const LOCKED_FRESH = ['events', 'accommodation', 'exchangeRates', 'newcomerEssentials', 'exploreTab', 'eatery', 'hotels', 'pets']

test('production gates (no unlock): exact count, no hidden or soon tile', () => {
  const { groups, modules } = load({ dev: false })
  const list = groups.visibleServiceIds()
  const rows = `\n${list.join('\n')}`
  expect({ n: list.length, rows }).toEqual({ n: 19, rows })
  expect(list).not.toContain('cars')
  expect(new Set(list).size).toBe(list.length)
  for (const id of list) expect([id, modules.HIDDEN_TILES.has(id)]).toEqual([id, false])
  const soon = groups.liveGroups().flatMap(g => g.modules).filter(m => m.soon).map(m => m.id)
  for (const id of soon) expect([id, list.includes(id)]).toEqual([id, false])
})

test('Preview / dev unlock set: exact count', () => {
  const { groups } = load({ dev: true })
  const list = groups.visibleServiceIds(PREVIEW_UNLOCK)
  const rows = `\n${list.join('\n')}`
  expect({ n: list.length, rows }).toEqual({ n: 20, rows })
  expect(list).toEqual(expect.arrayContaining(['duty', 'exploreTab', 'marketplace', 'ehliyet', 'cars']))
})

test('fresh install resolves to the locked eight, in order', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  expect(fav.resolveFavourites({ pins: [], usage: {}, visible })).toEqual(LOCKED_FRESH)
})

test('an old four-slot pin array carries into slots 1-4 and the rest auto-fill', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  const out = fav.resolveFavourites({ pins: ['pets', 'towing', 'health', 'events'], usage: {}, visible })
  expect(out.slice(0, 4)).toEqual(['pets', 'towing', 'health', 'events'])
  expect(out).toHaveLength(8)
  expect(new Set(out).size).toBe(8)
})

test('a pin to a hidden id is skipped and the stored pins are untouched', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  const pins = ['garages', 'transport', null, null, null, null, null, null]
  const before = JSON.stringify(pins)
  const out = fav.resolveFavourites({ pins, usage: {}, visible })
  expect(out).not.toContain('garages')
  expect(out).not.toContain('transport')
  expect(out).toEqual(LOCKED_FRESH)
  expect(JSON.stringify(pins)).toBe(before)
})

test('duty is never auto-filled but shows when pinned', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  const heavy = fav.resolveFavourites({ pins: [], usage: { duty: 999, emergency: 999 }, visible })
  expect(heavy).not.toContain('duty')
  expect(heavy).not.toContain('emergency')
  expect(fav.resolveFavourites({ pins: [null, 'duty'], usage: {}, visible })[1]).toBe('duty')
})

// No tile is "Yakında" under today's flags (every COMING_SOON id is also hidden), so the exclusion is exercised
// with HIDDEN_TILES emptied. The non-empty `soon` list is the positive control: without it the test could pass
// on nothing.
test('Yakında tiles are placed in their group but never in the visible list', () => {
  jest.resetModules()
  global.__DEV__ = false
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  jest.doMock('../constants/homeModules', () => ({ ...jest.requireActual('../constants/homeModules'), HIDDEN_TILES: new Set() }))
  const groups = require('../constants/homeGroups')
  jest.dontMock('../constants/homeModules')
  const soon = groups.liveGroups().flatMap(g => g.modules).filter(m => m.soon).map(m => m.id)
  expect(soon.length).toBeGreaterThan(0)
  const visible = groups.visibleServiceIds()
  for (const id of soon) expect([id, visible.includes(id)]).toEqual([id, false])
})

// The pill's N must equal the tiles the Tüm hizmetler page draws (ServicePanels renders liveGroups, soon tiles
// included). With HIDDEN_TILES emptied a soon tile exists, so the count must exceed the favourites list; under
// production gates none exists and the two agree.
test('allServicesCount counts every tile the page draws', () => {
  jest.resetModules()
  global.__DEV__ = false
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  jest.doMock('../constants/homeModules', () => ({ ...jest.requireActual('../constants/homeModules'), HIDDEN_TILES: new Set() }))
  const unhidden = require('../constants/homeGroups')
  jest.dontMock('../constants/homeModules')
  const drawn = unhidden.liveGroups().flatMap(g => g.modules.map(m => `${g.key}:${m.id}${m.soon ? ' (soon)' : ''}`))
  const rows = `\n${drawn.join('\n')}`
  expect({ n: unhidden.allServicesCount(), rows }).toEqual({ n: drawn.length, rows })
  expect({ more: unhidden.allServicesCount() > unhidden.visibleServiceIds().length, rows }).toEqual({ more: true, rows })

  const { groups } = load({ dev: false })
  const prodRows = `\n${groups.liveGroups().flatMap(g => g.modules.map(m => `${g.key}:${m.id}${m.soon ? ' (soon)' : ''}`)).join('\n')}`
  expect({ n: groups.allServicesCount(), rows: prodRows }).toEqual({ n: groups.visibleServiceIds().length, rows: prodRows })
})

test('usage outranks the defaults, and a pin outranks usage', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  const used = fav.resolveFavourites({ pins: [], usage: { health: 9, municipal: 5 }, visible })
  expect(used.slice(0, 2)).toEqual(['health', 'municipal'])
  const pinned = fav.resolveFavourites({ pins: ['towing'], usage: { health: 9 }, visible })
  expect(pinned.slice(0, 2)).toEqual(['towing', 'health'])
})
