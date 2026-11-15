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
      // Lazy like the real builder: nothing is sent until it is awaited.
      rpc: jest.fn((fn, args) => ({
        then: (res, rej) => {
          mockOrder.push('rpc')
          mockState.lastRpc = { fn, args }
          return (mockState.rpcImpl ? mockState.rpcImpl() : Promise.resolve({ error: null })).then(res, rej)
        },
      })),
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
  mockState.lastRpc = null
  mockState.rpcImpl = null
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

// Onboarding v2 guest push: a guest row now holds a token, so a guest sign-out clears it through the guest-only
// RPC (never a profiles update, which RLS refuses for guests) BEFORE the session ends.
test('(c) guest: no profiles update; set_guest_push(NULL, device language) runs before signOut', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  mockStore['@trnc_lang'] = 'Turkish'
  mockState.last = null // beforeEach's registration write
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['rpc', 'signOut'])
  expect(mockState.last).toBeNull()
  expect(mockState.lastRpc).toEqual({ fn: 'set_guest_push', args: { p_token: null, p_lang: 'Turkish' } })
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('(c2) guest clear with no device language falls back to English; a failed or hung RPC never blocks the sign-out', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  await H.signOutThisDevice()
  expect(mockState.lastRpc.args).toEqual({ p_token: null, p_lang: 'English' })

  mockState.rpcImpl = () => Promise.reject(new Error('network'))
  supabase.auth.signOut.mockClear()
  await expect(H.signOutThisDevice()).resolves.toEqual({ error: null })
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })

  jest.useFakeTimers()
  try {
    mockState.rpcImpl = () => new Promise(() => {})
    supabase.auth.signOut.mockClear()
    const p = H.signOutThisDevice()
    await jest.advanceTimersByTimeAsync(2900)
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(200)
    await p
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  } finally { jest.useRealTimers() }
})

test('(c3) signed-in sign-out never calls the guest RPC (positive control for (c))', async () => {
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['update', 'signOut'])
  expect(mockState.lastRpc).toBeNull()
})

test('(c4) guest save: set_guest_push(token, lang), token remembered; refused for a non-guest, another guest, or no session', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  mockOrder.length = 0
  await H.saveGuestPushToken('ExponentPushToken[guest-phone]', 'g1', 'Greek')
  expect(mockOrder).toEqual(['rpc'])
  expect(mockState.lastRpc).toEqual({ fn: 'set_guest_push', args: { p_token: 'ExponentPushToken[guest-phone]', p_lang: 'Greek' } })
  expect(mockStore.ada_registered_push_token).toBe('ExponentPushToken[guest-phone]')

  for (const session of [{ user: { id: 'g1', is_anonymous: false } }, { user: { id: 'g2', is_anonymous: true } }, null]) {
    mockState.session = session
    mockOrder.length = 0
    AsyncStorage.setItem.mockClear()
    await H.saveGuestPushToken('ExponentPushToken[wrong]', 'g1', 'Greek')
    expect(mockOrder).toEqual([])
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  }
})

test('(c5) guest language change re-sends the remembered token; nothing registered -> nothing sent; never for a signed-in user', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  await H.saveGuestPushToken('ExponentPushToken[guest-phone]', 'g1', 'English')
  mockOrder.length = 0
  await H.saveGuestPushLang('g1', 'Russian')
  expect(mockOrder).toEqual(['rpc'])
  expect(mockState.lastRpc.args).toEqual({ p_token: 'ExponentPushToken[guest-phone]', p_lang: 'Russian' })

  mockState.session = { user: { id: 'u1', is_anonymous: false } }
  mockOrder.length = 0
  await H.saveGuestPushLang('u1', 'Russian')
  expect(mockOrder).toEqual([])

  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  await H.signOutThisDevice() // success forgets the token
  mockOrder.length = 0
  await H.saveGuestPushLang('g1', 'German')
  expect(mockOrder).toEqual([])
})

test('(c6) guest save is suppressed while the guest sign-out runs', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  mockState.rpcImpl = async () => {
    mockState.rpcImpl = null
    mockOrder.length = 0
    await H.saveGuestPushToken('ExponentPushToken[racing]', 'g1', 'English')
    await H.saveGuestPushLang('g1', 'English')
    return { error: null }
  }
  await H.signOutThisDevice()
  expect(mockOrder).toEqual(['signOut'])
})

test('(c7) endGuestSessionThen: a guest session replaced by a link clears the guest token first; a signed-in session runs the switch untouched', async () => {
  mockState.session = { user: { id: 'g1', is_anonymous: true } }
  mockStore['@trnc_lang'] = 'French'
  mockOrder.length = 0
  const work = jest.fn(async () => { mockOrder.push('switch'); return { error: null } })
  await H.endGuestSessionThen(work)
  expect(mockOrder).toEqual(['rpc', 'switch'])
  expect(mockState.lastRpc.args).toEqual({ p_token: null, p_lang: 'French' })
  expect(mockStore.ada_registered_push_token).toBeUndefined()

  // the flag is released afterwards: the new user's registration may write
  mockState.session = { user: { id: 'u1', is_anonymous: false } }
  mockOrder.length = 0
  await H.savePushToken('ExponentPushToken[new-user]', 'u1')
  expect(mockOrder).toEqual(['update'])

  mockOrder.length = 0
  mockState.lastRpc = null
  await H.endGuestSessionThen(work)
  expect(mockOrder).toEqual(['switch'])
  expect(mockState.lastRpc).toBeNull()
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

// Onboarding v2: every App.js path that can replace a GUEST session without a sign-out (the email-confirmation /
// recovery deep links) goes through endGuestSessionThen, so the guest row's push token is cleared first.
test('App.js deep-link session switches run through endGuestSessionThen', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'App.js'), 'utf8')
  for (const call of ['setSession', 'verifyOtp', 'exchangeCodeForSession']) {
    const all = src.match(new RegExp(`supabase\\.auth\\.${call}\\(`, 'g')) || []
    const wrapped = src.match(new RegExp(`endGuestSessionThen\\(\\(\\) => supabase\\.auth\\.${call}\\(`, 'g')) || []
    expect({ call, all: all.length }).toEqual({ call, all: 1 })
    expect({ call, wrapped: wrapped.length }).toEqual({ call, wrapped: 1 })
  }
})
