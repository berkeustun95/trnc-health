// utils/signOut.js: the push token is cleared BEFORE the session ends (RLS refuses the write after), only THIS
// device's token on a local sign-out, and the clear is best effort so it can never block the sign-out.
const mockOrder = []
const mockState = { session: { user: { id: 'u1', is_anonymous: false } }, updateImpl: null }
const mockStore = {}

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (k, v) => { mockStore[k] = v }),
    getItem: jest.fn(async k => (k in mockStore ? mockStore[k] : null)),
    removeItem: jest.fn(async k => { delete mockStore[k] }),
  },
}))
jest.mock('../lib/supabase', () => {
  const chain = (table, patch) => {
    const filters = []
    const q = {
      eq: (col, val) => { filters.push([col, val]); return q },
      then: (res, rej) => {
        mockOrder.push('update')
        q.record = { table, patch, filters }
        mockState.last = q.record
        return (mockState.updateImpl ? mockState.updateImpl() : Promise.resolve({ error: null })).then(res, rej)
      },
    }
    return q
  }
  return {
    isGuest: s => s?.user?.is_anonymous === true,
    supabase: {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: mockState.session } })),
        signOut: jest.fn(async () => { mockOrder.push('signOut'); return mockState.signOutResult ?? { error: null } }),
      },
      from: jest.fn(table => ({ update: patch => chain(table, patch) })),
    },
  }
})

const AsyncStorage = require('@react-native-async-storage/async-storage').default
const { supabase } = require('../lib/supabase')
const H = require('../utils/signOut')

beforeEach(async () => {
  mockOrder.length = 0
  mockState.session = { user: { id: 'u1', is_anonymous: false } }
  mockState.updateImpl = null
  mockState.signOutResult = null
  mockState.last = null
  supabase.auth.signOut.mockClear()
  Object.keys(mockStore).forEach(k => delete mockStore[k])
  await H.savePushToken('ExponentPushToken[this-phone]', 'u1')
  mockOrder.length = 0
})

test('(a) local: update filtered by id AND this phone\'s token, run before signOut', async () => {
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['update', 'signOut'])
  expect(mockState.last).toEqual({ table: 'profiles', patch: { push_token: null },
    filters: [['id', 'u1'], ['push_token', 'ExponentPushToken[this-phone]']] })
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('(a2) token only in AsyncStorage (registration did not run this launch) is still used', async () => {
  jest.resetModules()
  const Fresh = require('../utils/signOut')
  await Fresh.signOutThisDevice()
  expect(mockState.last.filters).toContainEqual(['push_token', 'ExponentPushToken[this-phone]'])
})

test('(b) no remembered token: no update, signOut still local', async () => {
  await H.signOutThisDevice() // success forgets the token
  mockOrder.length = 0
  supabase.auth.signOut.mockClear()
  mockState.last = null
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['signOut'])
  expect(mockState.last).toBeNull()
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('(c) guest: no update', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['signOut'])
})

test('(d) update rejects: signOut still called', async () => {
  mockState.updateImpl = () => Promise.reject(new Error('network'))
  await expect(H.signOutThisDevice()).resolves.toEqual({ error: null })
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('(d2) update never resolves: signOut called after the time box', async () => {
  jest.useFakeTimers()
  try {
    mockState.updateImpl = () => new Promise(() => {})
    const p = H.signOutThisDevice()
    await jest.advanceTimersByTimeAsync(2900)
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(200)
    await p
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  } finally { jest.useRealTimers() }
})

test('(e) global with clear: update filtered by id only, then signOut global', async () => {
  await H.signOutEverywhere({ clearToken: true })
  expect(mockOrder).toEqual(['update', 'signOut'])
  expect(mockState.last.filters).toEqual([['id', 'u1']])
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
})

test('(f) global after deletion: no update', async () => {
  await H.signOutEverywhere({ clearToken: false })
  expect(mockOrder).toEqual(['signOut'])
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
})

test('(g) registration write is suppressed during a sign-out; allowed again once it ends, success or failure, no SIGNED_IN needed', async () => {
  mockState.signOutResult = { error: new Error('offline') }
  mockState.updateImpl = async () => {
    mockState.updateImpl = null
    mockOrder.length = 0
    await H.savePushToken('ExponentPushToken[racing]', 'u1') // the effect re-running mid sign-out
    return { error: null }
  }
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['signOut']) // the racing registration wrote nothing

  mockOrder.length = 0
  await H.savePushToken('ExponentPushToken[after-failure]', 'u1')
  expect(mockOrder).toEqual(['update']) // failed sign-out: session kept, registration allowed

  for (const call of [() => H.signOutThisDevice(), () => H.signOutEverywhere({ clearToken: true })]) {
    mockState.signOutResult = null
    await call()
    mockOrder.length = 0
    // password-recovery link: a session appears with no SIGNED_IN event
    await H.savePushToken('ExponentPushToken[recovery]', 'u1')
    expect(mockOrder).toEqual(['update'])
    expect(mockState.last.patch).toEqual({ push_token: 'ExponentPushToken[recovery]' })
  }
})

test('(g2) sign-out call throws: flag released, error propagates', async () => {
  supabase.auth.signOut.mockImplementationOnce(async () => { throw new Error('boom') })
  await expect(H.signOutThisDevice()).rejects.toThrow('boom')
  mockOrder.length = 0
  await H.savePushToken('ExponentPushToken[x]', 'u1')
  expect(mockOrder).toEqual(['update'])
})

test('(g3) session user differs from the captured id (or none, or a guest): no write, nothing remembered', async () => {
  for (const session of [{ user: { id: 'admin1', is_anonymous: false } }, null, { user: { id: 'u1', is_anonymous: true } }]) {
    mockState.session = session
    mockOrder.length = 0
    AsyncStorage.setItem.mockClear()
    await H.savePushToken('ExponentPushToken[wrong]', 'u1')
    expect(mockOrder).toEqual([])
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  }
})

test('(h) remembered token is forgotten after success, kept after failure', async () => {
  mockState.signOutResult = { error: new Error('offline') }
  await H.signOutThisDevice()
  expect(mockStore.ada_registered_push_token).toBe('ExponentPushToken[this-phone]')
  mockState.signOutResult = null
  await H.signOutThisDevice()
  expect(mockStore.ada_registered_push_token).toBeUndefined()
  expect(AsyncStorage.removeItem).toHaveBeenCalled()
})

// App.js wiring the unit tests above cannot see: the effect must register through the helper (which checks the
// session, remembers the token and honours the sign-out flag). The flag is released by the helper itself.
test('App.js registers via savePushToken; no SIGNED_IN re-arm wiring remains', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'App.js'), 'utf8')
  expect(src).toMatch(/await savePushToken\(token, session\.user\.id\)/)
  expect(src).not.toMatch(/push_token:\s*token/)
  expect(src).not.toMatch(/resetSigningOut|isSigningOut/)
})
