// The admin photo-review reminder push (20261196, data { screen: 'admin', tab: 'marketplace', view: 'photos' }) opens
// AdminScreen → Bandabuliya → Photos, from the warm tap listener AND the cold-start handler; a dark bundle ignores it;
// Bandabuliya's own pushes (screen 'marketplace' / 'marketplace_conversation') route exactly as before.
const fs = require('fs')
const path = require('path')

const PUSH = { screen: 'admin', tab: 'marketplace', view: 'photos' }

const load = ({ dev = false, variant, flagOff = false } = {}) => {
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
  return require('../utils/notificationRoute').adminPushRequest
}
const devBefore = global.__DEV__
afterAll(() => { global.__DEV__ = devBefore })

describe('adminPushRequest', () => {
  test('flag on: the reminder asks for the Bandabuliya tab, Photos view', () => {
    expect(load()(PUSH)).toEqual({ tab: 'Bandabuliya', view: 'Photos' })
  })
  test('flag off on a production bundle: ignored', () => {
    expect(load({ flagOff: true })(PUSH)).toBeNull()
  })
  test('control: flag off still opens on ADA Preview', () => {
    expect(load({ variant: 'preview', flagOff: true })(PUSH)).toEqual({ tab: 'Bandabuliya', view: 'Photos' })
  })
  test("Bandabuliya's own pushes and other admin data are not this route", () => {
    const req = load()
    expect(req({ screen: 'marketplace', listing_id: 'l1' })).toBeNull()
    expect(req({ screen: 'marketplace_conversation', conversation_id: 'c1' })).toBeNull()
    expect(req({ screen: 'admin', tab: 'cars' })).toBeNull()
    expect(req({})).toBeNull()
    expect(req(undefined)).toBeNull()
  })
})

describe('App.js / AdminScreen.js wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8')
  const admin = fs.readFileSync(path.join(__dirname, '..', 'screens', 'AdminScreen.js'), 'utf8')
  const between = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); return src.slice(a, b) }

  test('both tap handlers try the admin route before the Bandabuliya one', () => {
    const warm = between(app, 'addNotificationResponseReceivedListener(', 'return () => sub.remove()')
    const cold = between(app, 'Notifications.getLastNotificationResponseAsync().then(', '}, [session])')
    for (const h of [warm, cold]) expect(h).toContain('if (!openAdminPush(data)) openMarketplacePush(data)')
  })

  test("openMarketplacePush is unchanged: 'marketplace' still opens the listing, the chat its thread", () => {
    const mk = between(app, 'const openMarketplacePush = data => {', 'const openAdminPush')
    expect(mk).toContain("if (data.screen === 'marketplace_conversation') { setShowMarketplace({ view: 'inbox', conversationId: data.conversation_id ?? null }); return true }")
    expect(mk).toContain("if (data.screen === 'marketplace') { setShowMarketplace({ view: 'listing', listingId: data.listing_id ?? null }); return true }")
    expect(mk).not.toContain('admin')
  })

  test('openAdminPush closes any preview and sets a nonced request; AdminScreen gets it; the state sits above the selector', () => {
    const fn = between(app, 'const openAdminPush = data => {', '\n  }\n')
    expect(fn).toContain('adminPushRequest(data)')
    expect(fn).toContain('setAdminPreview(null)')
    expect(fn).toContain('setAdminOpen({ ...req, at: Date.now() })')
    const selector = app.indexOf("profile.role === 'admin' && !adminPreview")
    expect(app.indexOf('const [adminOpen, setAdminOpen] = useState(null)')).toBeGreaterThan(-1)
    expect(app.indexOf('const [adminOpen, setAdminOpen] = useState(null)')).toBeLessThan(selector)
    expect(between(app, "profile.role === 'admin' && !adminPreview", "profile.role === 'provider'"))
      .toContain('openRequest={adminOpen} onOpenRequestHandled={() => setAdminOpen(null)}')
  })

  test('AdminScreen opens the tab on each new request and remounts MarketplaceTab on the requested view by its nonce', () => {
    const eff = between(admin, 'if (!openRequest) return', '}, [openRequest?.at, pinBusy])')
    expect(eff).toContain('setTab(openRequest.tab)')
    expect(eff).toContain('setToolsOpen(true)')
    expect(eff).toContain('setMkOpen({ at: openRequest.at, view: openRequest.view })')
    expect(admin).toContain("<MarketplaceTab key={mkOpen?.at ?? 'tab'} initialView={mkOpen?.view} />")
    expect(admin).toMatch(/function MarketplaceTab\(\{ initialView = 'Photos' \}\) \{\n {2}const \[view, setView\] += useState\(initialView\)/)
  })

  test('the Bandabuliya urgency rows keep the sibling label; the wait sits on its own line beneath', () => {
    const home = between(admin, 'const mkRow = MARKETPLACE', '</TouchableOpacity>')
    expect(home).toContain("'Bandabuliya photo queue could not be checked' : 'Bandabuliya photos to review'")
    expect(home).toContain('<View style={{ flex: 1 }}>')
    expect(home).toContain('<Text style={s.cardSub}>Oldest waiting {photoWait(mkOldestAt)}</Text>')
    const dash = between(admin, "stats.pendingMkPhotos !== 0 && stats.pendingMkPhotos !== undefined", '\n')
    expect(dash).toContain("'Bandabuliya photos to review', sub: stats.pendingMkPhotos !== null && stats.mkOldestAt ? `Oldest waiting ${photoWait(stats.mkOldestAt)}` : null")
    const render = between(admin, '{urgencies.map(u => (', '))}')
    expect(render).toContain('{u.sub ? <Text style={s.cardSub}>{u.sub}</Text> : null}')
    expect(admin).not.toContain('mkPhotosLabel')
  })

  test('a request during a Restaurant PIN issue waits, unconsumed, and runs once the tab lock clears', () => {
    const eff = between(admin, 'if (!openRequest) return', '}, [openRequest?.at, pinBusy])')
    const bail = eff.indexOf('if (pinBusy) return')
    expect(bail).toBeGreaterThan(-1)
    expect(bail).toBeLessThan(eff.indexOf('setTab(openRequest.tab)'))
    expect(bail).toBeLessThan(eff.indexOf('onOpenRequestHandled?.()'))
  })
})
