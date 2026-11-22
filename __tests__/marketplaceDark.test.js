// Bandabuliya: LIVE 2026-11-12, DARK again from 2026-11-22 (Berke: possible e-commerce collaboration).
// Every test forces the flag (on or off) instead of reading the repo value, so turning it back on touches only
// constants/flags.js and scripts/check-module-flags.mjs (the guard is the authority on the repo value).
//  1. flag on: a production bundle opens every entry point (gate, tile, Bildirimler routes);
//  2. flag off: a production bundle AND ADA Preview close every entry point (MARKETPLACE_PREVIEW is false, so Berke
//     can check "dark" on Preview); the push handlers, the module route, İlanlarım and the admin tab all read the
//     same MARKETPLACE constant in App.js and AdminScreen.js. Dev bundles stay open (the positive control).

const load = ({ dev, variant, flag }) => {
  jest.resetModules()
  global.__DEV__ = dev
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: variant ? { appVariant: variant } : {} } } }))
  jest.doMock('../constants/flags', () => {
    const real = jest.requireActual('../constants/flags')
    return { ...real, MODULE_FLAGS: { ...real.MODULE_FLAGS, marketplace: flag } }
  })
  return {
    flags: require('../constants/flags'),
    redesign: require('../constants/redesign'),
    groups: require('../constants/homeGroups'),
    route: require('../utils/notificationRoute').notificationRoute,
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

test('the repo flag is a plain boolean (its value is pinned by check-module-flags.mjs, not here)', () => {
  expect(typeof jest.requireActual('../constants/flags').MODULE_FLAGS.marketplace).toBe('boolean')
})

test('production bundle with the flag on: gate open, tile live, both Bildirimler routes work', () => {
  const { redesign, groups, route } = load({ dev: false, flag: true })
  expect(redesign.MARKETPLACE).toBe(true)
  expect(groups.isLive('marketplace')).toBe(true)
  expect(groups.liveGroups().flatMap(g => g.modules.map(m => m.id))).toContain('marketplace')
  expect(route({ type: 'marketplace' })).toBe('marketplace')
  expect(route({ type: 'marketplace', listing_id: 'l1' })).toBe('marketplace_listing')
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBe('marketplace_conversation')
  expect(route({ type: 'message', conversation_id: 'c2' })).toBeNull()
})

test('off switch: production bundle with the flag forced off: gate closed, no tile, the Bildirimler row is inert', () => {
  const { redesign, groups, route } = load({ dev: false, flag: false })
  expect(redesign.MARKETPLACE).toBe(false)
  expect(groups.isLive('marketplace')).toBe(false)
  expect(groups.isComingSoon('marketplace')).toBe(false)
  expect(groups.liveGroups().flatMap(g => g.modules.map(m => m.id))).not.toContain('marketplace')
  expect(route({ type: 'marketplace' })).toBeNull()
  expect(route({ type: 'marketplace', listing_id: 'l1' })).toBeNull()
})

test('flag off: ADA Preview is dark too (MARKETPLACE_PREVIEW false); control: dev still opens', () => {
  expect(load({ dev: false, variant: 'preview', flag: false }).redesign.MARKETPLACE).toBe(false)
  expect(load({ dev: false, variant: 'preview', flag: false }).route({ type: 'marketplace' })).toBeNull()
  expect(load({ dev: false, variant: 'preview', flag: false }).groups.isLive('marketplace')).toBe(false)
  expect(load({ dev: true, flag: false }).redesign.MARKETPLACE).toBe(true)
  expect(load({ dev: true, flag: false }).route({ type: 'marketplace' })).toBe('marketplace')
})

test('off switch: a marked message row has no route and fetchNotifications never calls list_conversations', async () => {
  global.__DEV__ = false
  const { route } = load({ dev: false, flag: false })
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBeNull()
  const { fetchNotifications } = require('../utils/notificationRoute')
  const rows = [{ id: 'a', type: 'message', conversation_id: 'c1' }]
  const rpc = jest.fn(async () => ({ data: [{ conversation_id: 'c1' }], error: null }))
  const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve({ data: rows, error: null }) }
  const { data } = await fetchNotifications({ from: () => ({ select: () => chain }), rpc }, 'u1')
  expect(rpc).not.toHaveBeenCalled()
  expect(data[0].listing_conversation).toBeUndefined()
})

test('flag off: the marked row is inert on ADA Preview too; control: it routes on dev', () => {
  expect(load({ dev: false, variant: 'preview', flag: false }).route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBeNull()
  expect(load({ dev: true, flag: false }).route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBe('marketplace_conversation')
})
