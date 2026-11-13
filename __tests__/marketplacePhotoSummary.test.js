// Admin urgency rows (Bandabuliya photos to review · oldest 2h): one read gives the exact pending count and the oldest
// photo; any non-missing error is null (the row says the queue could not be checked). photoWait formats the wait.

let mockResult
const mockCalls = []
const mockChain = new Proxy({}, {
  get: (_, k) => (k === 'then' ? res => res(mockResult) : (...args) => { mockCalls.push([k, ...args]); return mockChain }),
})
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(t => { mockCalls.push(['from', t]); return mockChain }), rpc: jest.fn(), functions: { invoke: jest.fn() } } }))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))

const fresh = () => { jest.resetModules(); mockCalls.length = 0; return require('../utils/marketplaceApi') }

describe('adminPendingPhotoSummary', () => {
  test('one read: exact count + the oldest pending row', async () => {
    const api = fresh()
    mockResult = { data: [{ created_at: '2026-11-13T08:00:00+00:00' }], count: 3, error: null }
    expect(await api.adminPendingPhotoSummary()).toEqual({ count: 3, oldestAt: '2026-11-13T08:00:00+00:00' })
    expect(mockCalls).toEqual([
      ['from', 'marketplace_photos'],
      ['select', 'created_at', { count: 'exact' }],
      ['eq', 'status', 'pending'],
      ['order', 'created_at', { ascending: true }],
      ['limit', 1],
    ])
  })

  test('an empty queue is count 0, no oldest', async () => {
    const api = fresh()
    mockResult = { data: [], count: 0, error: null }
    expect(await api.adminPendingPhotoSummary()).toEqual({ count: 0, oldestAt: null })
  })

  test('a real error (not a missing table) is null, never a zero and never the sample data', async () => {
    const api = fresh()
    mockResult = { data: null, count: null, error: { code: '42501', message: 'permission denied' } }
    expect(await api.adminPendingPhotoSummary()).toBeNull()
    expect(api.usingFixture()).toBe(false)
  })

  test('sample data (table missing on Preview): the fixture queue, oldest of its pending photos', async () => {
    const api = fresh()
    mockResult = { data: null, count: null, error: { code: 'PGRST205', message: 'missing' } }
    const sum = await api.adminPendingPhotoSummary()
    expect(api.usingFixture()).toBe(true)
    const q = await api.adminPhotoQueue()
    expect(sum).toEqual({ count: q.length, oldestAt: q[0].created_at })
    expect(sum.count).toBe(1)
    expect(await api.adminPendingPhotoSummary()).toEqual(sum)   // now served from the sticky fixture branch
    await api.adminReviewPhoto(q[0].id, 'approve')
    expect(await api.adminPendingPhotoSummary()).toEqual({ count: 0, oldestAt: null })
  })
})

describe('photoWait', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  const ago = mins => new Date(now - mins * 60000).toISOString()
  test.each([[0, '0m'], [45, '45m'], [59, '59m'], [60, '1h'], [150, '2h'], [23 * 60 + 59, '23h'], [24 * 60, '1d'], [3 * 24 * 60 + 5, '3d']])(
    '%i minutes → %s', (mins, out) => {
      expect(fresh().photoWait(ago(mins), now)).toBe(out)
    })
  test('a clock skew (row a little in the future) reads 0m, never negative', () => {
    expect(fresh().photoWait(ago(-3), now)).toBe('0m')
  })
})
