// A Bandabuliya chat row in Bildirimler opens that chat; a Student Hub message row stays inert. The row carries no kind,
// so fetchNotifications marks the rows whose conversation is in list_conversations('listing').
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
const { notificationRoute, fetchNotifications } = require('../utils/notificationRoute')

const msg = o => ({ id: 'n1', type: 'message', conversation_id: 'c1', ...o })

describe('notificationRoute', () => {
  test('a marked listing row opens the chat', () => {
    expect(notificationRoute(msg({ listing_conversation: true }))).toBe('marketplace_conversation')
  })
  test('an unmarked message row (Student Hub) stays inert', () => {
    expect(notificationRoute(msg())).toBeNull()
  })
  test('a marked row without a conversation id stays inert', () => {
    expect(notificationRoute(msg({ listing_conversation: true, conversation_id: null }))).toBeNull()
  })
})

const ROWS = [msg({ id: 'a', conversation_id: 'c-listing' }), msg({ id: 'b', conversation_id: 'c-student' }), { id: 'd', type: 'duty' }]
function fakeSupabase({ failCols = [], rows = ROWS, rpc = { data: [{ conversation_id: 'c-listing' }], error: null } } = {}) {
  const selects = []
  const rpcCalls = []
  return {
    selects, rpcCalls,
    from: () => ({
      select: cols => {
        selects.push(cols)
        const missing = failCols.some(c => cols.includes(c))
        const res = missing ? { data: null, error: { code: '42703' } } : { data: rows, error: null }
        const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve(res) }
        return chain
      },
    }),
    rpc: async (name, args) => { rpcCalls.push([name, args]); return rpc },
  }
}

describe('fetchNotifications', () => {
  test('marks only the rows whose conversation is a listing thread', async () => {
    const sb = fakeSupabase()
    const { data } = await fetchNotifications(sb, 'u1')
    expect(sb.rpcCalls).toEqual([['list_conversations', { p_kind: 'listing' }]])
    expect(data.map(n => !!n.listing_conversation)).toEqual([true, false, false])
    expect(notificationRoute(data[0])).toBe('marketplace_conversation')
    expect(notificationRoute(data[1])).toBeNull()
  })
  test('an rpc error leaves the rows unmarked and the list loads', async () => {
    const { data, error } = await fetchNotifications(fakeSupabase({ rpc: { data: null, error: { message: 'x' } } }), 'u1')
    expect(error).toBeNull()
    expect(data).toEqual(ROWS)
  })
  test('a guest makes no rpc call', async () => {
    const sb = fakeSupabase()
    await fetchNotifications(sb, 'u1', { guest: true })
    expect(sb.rpcCalls).toEqual([])
  })
  test('no message rows with a conversation id: no rpc call', async () => {
    const sb = fakeSupabase({ rows: [{ id: 'd', type: 'duty' }, { id: 'e', type: 'message', conversation_id: null }] })
    await fetchNotifications(sb, 'u1')
    expect(sb.rpcCalls).toEqual([])
  })
})
