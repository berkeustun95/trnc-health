// Bandabuliya chat (slice 4): the Student Hub adapter makes exactly the calls the screens made before it existed, and
// the listing adapter's Preview sample data keeps the server's rules (20261184), so a walk on the phone shows what
// production will do. The real listing calls are covered by scripts/test-marketplace-chat-sql.mjs.

const calls = []
// Every real call answers "this does not exist yet" — what production says before 20261183/84 are applied.
const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } }
// A query builder: records the chain, and awaiting it gives MISSING (as PostgREST's builder is a thenable).
const builder = table => {
  const q = { table, ops: [] }
  const chain = new Proxy(q, { get: (o, k) => (k === 'then' ? res => res(MISSING) : (...a) => { o.ops.push([k, ...a]); return chain }) })
  calls.push(q)
  return chain
}
jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async (name, args) => { calls.push({ rpc: name, args }); return MISSING }),
    from: jest.fn(t => builder(t)),
  },
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))

const { supabase } = require('../lib/supabase')
const { STUDENT_CHAT } = require('../utils/chatApi')
const api = require('../utils/marketplaceApi')
const { MK_NOTICE_VERSION, mkChatErrorKey } = require('../constants/marketplace')

beforeEach(() => { calls.length = 0 })

describe('STUDENT_CHAT is the pre-adapter Student Hub calls, unchanged', () => {
  test('list, start, send, act', async () => {
    await STUDENT_CHAT.list()
    await STUDENT_CHAT.start({ userId: 'u2', displayName: 'X' }, 'hi')
    await STUDENT_CHAT.send('c1', 'hello')
    await STUDENT_CHAT.act('block_user', { p_user_id: 'u2' })
    expect(calls).toEqual([
      { rpc: 'list_conversations', args: undefined },
      { rpc: 'start_conversation', args: { p_recipient_id: 'u2', p_body: 'hi' } },
      { rpc: 'send_message', args: { p_conversation_id: 'c1', p_body: 'hello' } },
      { rpc: 'block_user', args: { p_user_id: 'u2' } },
    ])
  })
  test('messages: same columns, filter and order', () => {
    STUDENT_CHAT.messages('c1')
    expect(calls[0]).toEqual({ table: 'messages', ops: [
      ['select', 'id, sender_id, sender_display_name, body, created_at'],
      ['eq', 'conversation_id', 'c1'],
      ['order', 'created_at', { ascending: true }],
    ] })
  })
})

describe('listing chat on the Preview sample data', () => {
  jest.useFakeTimers()
  const ME = 'me-uid'
  let chat
  beforeAll(async () => {
    await api.listListings()                         // MISSING → the sample data
    api.setFixtureUser(ME, 'Ben')
    chat = api.MARKETPLACE_CHAT
  })

  test('the real inbox call asks for listing threads first', async () => {
    jest.resetModules()
    const fresh = require('../utils/marketplaceApi')
    calls.length = 0
    await fresh.MARKETPLACE_CHAT.list()
    expect(calls[0]).toEqual({ rpc: 'list_conversations', args: { p_kind: 'listing' } })
  })

  test('a seeded incoming request on my own listing is waiting for me', async () => {
    const { data } = await chat.list()
    const req = data.find(r => r.conversation_id === 'fx-c-in')
    expect(req).toMatchObject({ awaiting_me: true, is_accepted: false, listing_id: 'fx-5', listing_available: true })
  })

  test('no notice → NOTICE_REQUIRED, which maps to the notice copy', async () => {
    expect(await api.noticeAccepted(ME)).toBe(false)
    const r = await chat.start({ userId: 'fx-seller', listingId: 'fx-1' }, 'Merhaba')
    expect(r.error.message).toBe('NOTICE_REQUIRED')
    expect(mkChatErrorKey(r.error)).toBe('mkNoticeRequired')
  })

  test('after the notice: my own listing is refused; another starts a thread that waits, then the seller answers', async () => {
    await api.acceptNotice()
    expect(await api.noticeAccepted(ME)).toBe(true)
    expect(MK_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await chat.start({ userId: ME, listingId: 'fx-5' }, 'x')).error.message).toBe('OWN_LISTING')

    expect((await chat.start({ userId: 'fx-seller', listingId: 'fx-1' }, 'Merhaba, duruyor mu?')).data).toBe('started')
    let row = (await chat.list()).data.find(r => r.listing_id === 'fx-1')
    expect(row).toMatchObject({ is_accepted: false, awaiting_me: false, listing_title: 'Şehir bisikleti, 21 vites' })
    expect((await chat.send(row.conversation_id, 'ikinci')).error.message).toBe('AWAITING_ACCEPTANCE')
    expect((await chat.start({ userId: 'fx-seller', listingId: 'fx-1' }, 'tekrar')).error.message).toBe('CONVERSATION_EXISTS')

    jest.advanceTimersByTime(4100)
    row = (await chat.list()).data.find(r => r.listing_id === 'fx-1')
    expect(row.is_accepted).toBe(true)
    const msgs = (await chat.messages(row.conversation_id)).data
    expect(msgs.map(m => m.sender_id)).toEqual([ME, 'fx-seller'])
    expect((await chat.send(row.conversation_id, 'Yarın 18:00?')).data).toBe('sent')
  })

  test('accept an incoming request, then block: the thread closes', async () => {
    await chat.act('accept_conversation', { p_conversation_id: 'fx-c-in' })
    expect((await chat.list()).data.find(r => r.conversation_id === 'fx-c-in').is_accepted).toBe(true)
    await chat.act('block_user', { p_user_id: 'fx-buyer' })
    expect((await chat.list()).data.find(r => r.conversation_id === 'fx-c-in').is_closed).toBe(true)
    expect((await chat.send('fx-c-in', 'x')).error.message).toBe('CONVERSATION_CLOSED')
  })

  test('a sold listing stays on its thread as sold and takes no new thread', async () => {
    await api.setSold('fx-2', true)
    expect((await chat.start({ userId: 'fx-seller', listingId: 'fx-2' }, 'x')).error.message).toBe('NO_SUCH_LISTING')
  })

  test('one report hides a listing for everyone but its seller', async () => {
    expect(await api.getListing('fx-4')).not.toBeNull()
    const r = await api.reportListing({ reporter_id: ME, content_type: 'listing', content_id: 'fx-4', reason: 'prohibited_item', details: null })
    expect(r.error).toBeNull()
    expect(await api.getListing('fx-4')).toBeNull()
    expect((await api.listListings()).rows.map(l => l.id)).not.toContain('fx-4')
  })

  test('the sample data never reaches production: every write above stayed in memory', () => {
    expect(supabase.from.mock.calls.filter(([t]) => t === 'content_reports')).toHaveLength(0)
    expect(supabase.rpc.mock.calls.map(([n]) => n)).not.toContain('accept_marketplace_notice')
  })
})
