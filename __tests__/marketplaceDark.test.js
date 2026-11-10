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
