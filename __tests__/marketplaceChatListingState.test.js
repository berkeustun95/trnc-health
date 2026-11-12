// Fix: the listing strip in a Bandabuliya chat tells hidden from deleted from expired, and a buyer never learns a
// listing was reported. list_conversations nulls listing_title for hidden AND deleted, so MARKETPLACE_CHAT.list() adds
// the seller's own-row lookup and the conversation initiator.
const calls = []
const answers = {}
const builder = table => {
  const q = { table, ops: [] }
  const chain = new Proxy(q, { get: (o, k) => (k === 'then' ? res => res(answers[table] ?? { data: [], error: null }) : (...a) => { o.ops.push([k, ...a]); return chain }) })
  calls.push(q)
  return chain
}
let mockRpcAnswer
let mockSessionAnswer
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => mockRpcAnswer),
    from: jest.fn(t => builder(t)),
    auth: { getSession: jest.fn(async () => mockSessionAnswer) },
  },
  isGuest: () => false,
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../components/Avatar', () => ({ __esModule: true, default: () => null, prefetchAvatars: async () => {} }))

const { MARKETPLACE_CHAT, mergeListingExtras } = require('../utils/marketplaceApi')
const { listingState, listingTitleText } = require('../screens/MarketplaceChatScreen')
const { t } = require('../constants/i18n')
const L = 'English'
const ME = 'me-uid'

beforeEach(() => {
  calls.length = 0
  Object.keys(answers).forEach(k => delete answers[k])
  mockSessionAnswer = { data: { session: { user: { id: ME } } } }
})

const row = o => ({ conversation_id: 'c1', listing_id: 'l1', listing_title: 'Bisiklet', listing_status: 'active', listing_available: true, ...o })
const view = r => ({ state: listingState(r), title: listingTitleText(r, L) })

describe('listingState / listingTitleText, every row of the table', () => {
  test('live and sold: title, same for both roles', () => {
    for (const i_am_buyer of [true, false]) {
      expect(view(row({ i_am_buyer }))).toEqual({ state: 'live', title: 'Bisiklet' })
      expect(view(row({ i_am_buyer, listing_status: 'sold' }))).toEqual({ state: 'sold', title: 'Bisiklet' })
    }
  })
  test('expired: title kept, state expired (not "removed")', () => {
    expect(view(row({ listing_available: false }))).toEqual({ state: 'expired', title: 'Bisiklet' })
  })
  test('hidden (seller): own title, state hidden, even when also sold', () => {
    const r = row({ listing_hidden: true, listing_available: false, i_am_buyer: false })
    expect(view(r)).toEqual({ state: 'hidden', title: 'Bisiklet' })
    expect(view({ ...r, listing_status: 'sold' }).state).toBe('hidden')
  })
  test('hidden or deleted, buyer: neutral line, no title, no badge state', () => {
    expect(view(row({ listing_title: null, listing_available: false, i_am_buyer: true }))).toEqual({ state: 'gone', title: t('mkGoneTitle', L) })
  })
  test('deleted, seller: removed', () => {
    expect(view(row({ listing_title: null, listing_available: false, i_am_buyer: false }))).toEqual({ state: 'removed', title: t('mkChatListingRemoved', L) })
  })
  test('purged: removed for both roles', () => {
    for (const i_am_buyer of [true, false]) {
      expect(view(row({ listing_id: null, listing_title: null, i_am_buyer }))).toEqual({ state: 'removed', title: t('mkChatListingRemoved', L) })
    }
  })
  test('role unknown (lookup failed): today\'s wording', () => {
    expect(view(row({ listing_title: null, listing_available: false })).state).toBe('removed')
  })
})

describe('MARKETPLACE_CHAT.list() merging', () => {
  const ambiguous = [row({ listing_title: null, listing_available: false })]

  test('no ambiguous row: no lookup at all', async () => {
    mockRpcAnswer = { data: [row()], error: null }
    const r = await MARKETPLACE_CHAT.list()
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })

  test('own-row lookup filters by owner_id and the ids; hidden fills title + listing_hidden', async () => {
    mockRpcAnswer = { data: ambiguous, error: null }
    answers.marketplace_listings = { data: [{ id: 'l1', title: 'Bisiklet', hidden_at: '2026-11-01' }], error: null }
    answers.conversations = { data: [{ id: 'c1', initiator_id: 'buyer' }], error: null }
    const { data } = await MARKETPLACE_CHAT.list()
    expect(data[0]).toMatchObject({ listing_title: 'Bisiklet', listing_hidden: true, i_am_buyer: false })
    const own = calls.find(c => c.table === 'marketplace_listings')
    expect(own.ops).toContainEqual(['eq', 'owner_id', ME])
    expect(own.ops).toContainEqual(['in', 'id', ['l1']])
    expect(calls.find(c => c.table === 'conversations').ops).toContainEqual(['in', 'id', ['c1']])
  })

  test('buyer: initiator is me, no own row: title stays null, i_am_buyer true', async () => {
    mockRpcAnswer = { data: ambiguous, error: null }
    answers.conversations = { data: [{ id: 'c1', initiator_id: ME }], error: null }
    const { data } = await MARKETPLACE_CHAT.list()
    expect(data[0].listing_title).toBeNull()
    expect(data[0].i_am_buyer).toBe(true)
    expect(data[0].listing_hidden).toBeUndefined()
  })

  test('a lookup error falls back to the raw row; the list is never emptied', async () => {
    mockRpcAnswer = { data: ambiguous, error: null }
    answers.marketplace_listings = { data: null, error: { message: 'boom' } }
    answers.conversations = { data: null, error: { message: 'boom' } }
    const r = await MARKETPLACE_CHAT.list()
    expect(r.error).toBeNull()
    expect(r.data).toEqual(ambiguous)
  })

  test('no session: raw rows, no lookup', async () => {
    mockRpcAnswer = { data: ambiguous, error: null }
    mockSessionAnswer = { data: { session: null } }
    const r = await MARKETPLACE_CHAT.list()
    expect(r.data).toEqual(ambiguous)
    expect(calls).toHaveLength(0)
  })

  test('mergeListingExtras leaves rows with a title untouched', () => {
    const r = row()
    expect(mergeListingExtras([r], [{ id: 'l1', title: 'x', hidden_at: 'y' }], [], ME)[0]).toBe(r)
  })
})
