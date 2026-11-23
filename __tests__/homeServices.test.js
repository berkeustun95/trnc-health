// Home Hizmetler, slice 1: the ONE visibility list (visibleServiceIds) and the favourites resolver on top of it.
//
// __DEV__ is true under jest-expo, which would turn EATERY / CARS / MARKETPLACE on and make a "production"
// count meaningless. So every load() sets global.__DEV__ explicitly and mocks expo-constants (the Preview
// switch reads Constants.expoConfig.extra.appVariant), exactly as marketplaceDark.test.js does.
// Expected counts were DERIVED by printing the lists, not remembered; the rows ride in every failure message.

// `marketplace` (Bandabuliya) is forced when given, never read from the repo, so flipping it needs no test edit.
const load = ({ dev, marketplace }) => {
  jest.resetModules()
  global.__DEV__ = dev
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  if (marketplace === undefined) jest.dontMock('../constants/flags')
  else jest.doMock('../constants/flags', () => {
    const real = jest.requireActual('../constants/flags')
    return { ...real, MODULE_FLAGS: { ...real.MODULE_FLAGS, marketplace } }
  })
  return {
    groups: require('../constants/homeGroups'),
    fav: require('../constants/homeFavourites'),
    modules: require('../constants/homeModules'),
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

// HomeScreen's HOME_UNLOCK on ADA Preview / dev: ehliyet + marketplace. Production shows 19 with Bandabuliya on,
// 18 with it off (dark again from 2026-11-22); dev adds `cars` (dark in production) for 20.
const PREVIEW_UNLOCK = new Set(['ehliyet', 'marketplace'])

const LOCKED_FRESH = ['events', 'accommodation', 'exchangeRates', 'newcomerEssentials', 'exploreTab', 'eatery', 'hotels', 'pets']

test.each([[true, 19], [false, 18]])('production gates (no unlock), Bandabuliya %s: exact count, no hidden or soon tile', (marketplace, n) => {
  const { groups, modules } = load({ dev: false, marketplace })
  const list = groups.visibleServiceIds()
  const rows = `\n${list.join('\n')}`
  expect({ n: list.length, rows }).toEqual({ n, rows })
  expect(list).not.toContain('cars')
  expect(list.includes('marketplace')).toBe(marketplace)
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

// Berke 2026-11-14: the pill's N counts only modules the user can open, the same list as the 8 and the picker.
// "Yakında" tiles never count. With HIDDEN_TILES emptied a soon tile exists, so it must be excluded from N.
test('N = visibleServiceIds, Yakında tiles excluded', () => {
  jest.resetModules()
  global.__DEV__ = false
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
  jest.doMock('../constants/homeModules', () => ({ ...jest.requireActual('../constants/homeModules'), HIDDEN_TILES: new Set() }))
  const unhidden = require('../constants/homeGroups')
  jest.dontMock('../constants/homeModules')
  const soon = unhidden.liveGroups().flatMap(g => g.modules.filter(m => m.soon).map(m => m.id))
  expect({ soonExists: soon.length > 0, soon }).toEqual({ soonExists: true, soon })
  const visible = unhidden.visibleServiceIds()
  for (const id of soon) expect([id, visible.includes(id)]).toEqual([id, false])
})

test('usage outranks the defaults, and a pin outranks usage', () => {
  const { groups, fav } = load({ dev: false })
  const visible = groups.visibleServiceIds()
  const used = fav.resolveFavourites({ pins: [], usage: { health: 9, municipal: 5 }, visible })
  expect(used.slice(0, 2)).toEqual(['health', 'municipal'])
  const pinned = fav.resolveFavourites({ pins: ['towing'], usage: { health: 9 }, visible })
  expect(pinned.slice(0, 2)).toEqual(['towing', 'health'])
})

// Audit D-01 (Berke 2026-11-23): Nöbetçi + Acil are Home's top tiles, so "Tüm hizmetler" does not repeat them,
// but they stay visible (pinnable) and keep the health colour.
test('Tüm hizmetler panels leave out duty + emergency; visibility and colour keep them', () => {
  const { groups } = load({ dev: false })
  const panelIds = groups.panelGroups().flatMap(g => g.modules.map(m => m.id))
  const liveIds = groups.liveGroups().flatMap(g => g.modules.map(m => m.id))
  const dropped = liveIds.filter(id => !panelIds.includes(id))
  expect({ dropped, panelHasDuty: panelIds.includes('duty') }).toEqual({ dropped: ['duty', 'emergency'], panelHasDuty: false })
  expect(groups.visibleServiceIds()).toEqual(expect.arrayContaining(['duty', 'emergency']))
  expect([groups.categoryOf('duty'), groups.categoryOf('emergency')]).toEqual(['health', 'health'])
  const health = groups.panelGroups().find(g => g.key === 'health')
  expect(health && health.modules.map(m => m.id)).toEqual(['health'])
})

test('the Tüm hizmetler screen renders panelGroups, not liveGroups', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'components/home/redesign/ServicePanels.js'), 'utf8')
  expect(src).toContain('{panelGroups(unlocked).map(g => (')
  expect(src).not.toContain('liveGroups(')
  // The button's count is the number of tiles the panels show.
  const home = require('fs').readFileSync(require('path').join(__dirname, '..', 'screens/HomeScreen.js'), 'utf8')
  expect(home).toContain('count={visibleIds.filter(id => !ON_HOME_TOP.has(id)).length}')
})
