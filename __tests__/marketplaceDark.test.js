// Bandabuliya is dark until MODULE_FLAGS.marketplace flips. A production bundle (not dev, no Preview variant) must
// leave every entry point closed: the gate constant, the home tile, and the Bildirimler row. The push handlers, the
// module route, İlanlarım and the admin tab all read the same MARKETPLACE constant (App.js, AdminScreen.js).

const load = ({ dev, variant }) => {
  jest.resetModules()
  global.__DEV__ = dev
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: variant ? { appVariant: variant } : {} } } }))
  return {
    flags: require('../constants/flags'),
    redesign: require('../constants/redesign'),
    groups: require('../constants/homeGroups'),
    route: require('../utils/notificationRoute').notificationRoute,
  }
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

test('the flag is off in the repo', () => {
  expect(load({ dev: false }).flags.MODULE_FLAGS.marketplace).toBe(false)
})

test('production bundle: gate closed, no tile, the Bildirimler row is inert', () => {
  const { redesign, groups, route } = load({ dev: false })
  expect(redesign.MARKETPLACE).toBe(false)
  expect(groups.isLive('marketplace')).toBe(false)
  expect(groups.isComingSoon('marketplace')).toBe(false)
  expect(groups.liveGroups().flatMap(g => g.modules.map(m => m.id))).not.toContain('marketplace')
  expect(route({ type: 'marketplace' })).toBeNull()
})

test('control: the same code opens on ADA Preview and on dev', () => {
  expect(load({ dev: false, variant: 'preview' }).redesign.MARKETPLACE).toBe(true)
  expect(load({ dev: false, variant: 'preview' }).route({ type: 'marketplace' })).toBe('marketplace')
  expect(load({ dev: true }).redesign.MARKETPLACE).toBe(true)
})

test('production bundle: a marked message row has no route and fetchNotifications never calls list_conversations', async () => {
  global.__DEV__ = false
  const { route } = load({ dev: false })
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBeNull()
  const { fetchNotifications } = require('../utils/notificationRoute')
  const rows = [{ id: 'a', type: 'message', conversation_id: 'c1' }]
  const rpc = jest.fn(async () => ({ data: [{ conversation_id: 'c1' }], error: null }))
  const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve({ data: rows, error: null }) }
  const { data } = await fetchNotifications({ from: () => ({ select: () => chain }), rpc }, 'u1')
  expect(rpc).not.toHaveBeenCalled()
  expect(data[0].listing_conversation).toBeUndefined()
})

test('control: the same row routes on ADA Preview', () => {
  const { route } = load({ dev: false, variant: 'preview' })
  expect(route({ type: 'message', conversation_id: 'c1', listing_conversation: true })).toBe('marketplace_conversation')
})
