// Bandabuliya went LIVE on 2026-11-12 (MODULE_FLAGS.marketplace true). These tests keep two promises:
//  1. the repo flag is on, and a production bundle opens every entry point (gate, tile, Bildirimler routes);
//  2. the off switch still works: with the flag forced off, a production bundle closes every entry point again
//     (the gate constant, the home tile and the Bildirimler rows; the push handlers, the module route, İlanlarım
//     and the admin tab all read the same MARKETPLACE constant in App.js and AdminScreen.js).

const load = ({ dev, variant, flagOff = false }) => {
  jest.resetModules()
  global.__DEV__ = dev
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: variant ? { appVariant: variant } : {} } } }))
  if (flagOff) {
    jest.doMock('../constants/flags', () => {
      const real = jest.requireActual('../constants/flags')
      return { ...real, MODULE_FLAGS: { ...real.MODULE_FLAGS, marketplace: false } }
    })
  } else {
    jest.dontMock('../constants/flags')
  }
  return {
    flags: require('../constants/flags'),
    redesign: require('../constants/redesign'),
    groups: require('../constants/homeGroups'),
    route: require('../utils/notificationRoute').notificationRoute,
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

test('the flag is on in the repo', () => {
  expect(load({ dev: false }).flags.MODULE_FLAGS.marketplace).toBe(true)
})

test('production bundle with the flag on: gate open, tile live, both Bildirimler routes work', () => {
  const { redesign, groups, route } = load({ dev: false })
  expect(redesign.MARKETPLACE).toBe(true)
  expect(groups.isLive('marketplace')).toBe(true)
  expect(groups.liveGroups().flatMap(g => g.modules.map(m => m.id))).toContain('marketplace')
  expect(route({ type: 'marketplace' })).toBe('marketplace')
  expect(route({ type: 'marketplace', listing_id: 'l1' })).toBe('marketplace_listing')
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBe('marketplace_conversation')
  expect(route({ type: 'message', conversation_id: 'c2' })).toBeNull()
})

test('off switch: production bundle with the flag forced off: gate closed, no tile, the Bildirimler row is inert', () => {
  const { redesign, groups, route } = load({ dev: false, flagOff: true })
  expect(redesign.MARKETPLACE).toBe(false)
  expect(groups.isLive('marketplace')).toBe(false)
  expect(groups.isComingSoon('marketplace')).toBe(false)
  expect(groups.liveGroups().flatMap(g => g.modules.map(m => m.id))).not.toContain('marketplace')
  expect(route({ type: 'marketplace' })).toBeNull()
  expect(route({ type: 'marketplace', listing_id: 'l1' })).toBeNull()
})

test('control: with the flag forced off the same code still opens on ADA Preview and on dev', () => {
  expect(load({ dev: false, variant: 'preview', flagOff: true }).redesign.MARKETPLACE).toBe(true)
  expect(load({ dev: false, variant: 'preview', flagOff: true }).route({ type: 'marketplace' })).toBe('marketplace')
  expect(load({ dev: true, flagOff: true }).redesign.MARKETPLACE).toBe(true)
})

test('off switch: a marked message row has no route and fetchNotifications never calls list_conversations', async () => {
  global.__DEV__ = false
  const { route } = load({ dev: false, flagOff: true })
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBeNull()
  const { fetchNotifications } = require('../utils/notificationRoute')
  const rows = [{ id: 'a', type: 'message', conversation_id: 'c1' }]
  const rpc = jest.fn(async () => ({ data: [{ conversation_id: 'c1' }], error: null }))
  const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve({ data: rows, error: null }) }
  const { data } = await fetchNotifications({ from: () => ({ select: () => chain }), rpc }, 'u1')
  expect(rpc).not.toHaveBeenCalled()
  expect(data[0].listing_conversation).toBeUndefined()
})

test('control: with the flag forced off the same row routes on ADA Preview', () => {
  const { route } = load({ dev: false, variant: 'preview', flagOff: true })
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBe('marketplace_conversation')
})
