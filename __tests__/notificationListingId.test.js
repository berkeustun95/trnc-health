// A photo-decision row (marketplace-photo-review) carries notifications.listing_id (20261192): with it the row opens that
// listing, without it İlanlarım. fetchNotifications asks for the column and falls back, newest column first, on a database
// that lacks it; the tap re-checks the listing is still readable.
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
const { notificationRoute, fetchNotifications, marketplaceListingTarget, createListingTap } = require('../utils/notificationRoute')

const BASE = 'id, title, body, read, created_at'
const ROWS = [{ id: 'n1', type: 'marketplace', listing_id: 'l1' }, { id: 'n2', type: 'marketplace', listing_id: null }]

function fakeSupabase({ failCols = [], rows = ROWS } = {}) {
  const selects = []
  const tables = []
  return {
    selects, tables,
    from: table => {
      tables.push(table)
      return {
        select: cols => {
          selects.push(cols)
          const res = failCols.some(c => cols.includes(c)) ? { data: null, error: { code: '42703' } } : { data: rows, error: null }
          const chain = { eq: () => chain, order: () => chain, limit: () => Promise.resolve(res) }
          return chain
        },
      }
    },
    rpc: async () => ({ data: [], error: null }),
  }
}

describe('fetchNotifications: 42703 chain, newest column dropped first', () => {
  test('all columns present: one select with listing_id', async () => {
    const sb = fakeSupabase()
    await fetchNotifications(sb, 'u1')
    expect(sb.selects).toEqual([`${BASE}, type, conversation_id, listing_id`])
  })
  test('missing listing_id keeps conversation_id and type', async () => {
    const sb = fakeSupabase({ failCols: ['listing_id'] })
    await fetchNotifications(sb, 'u1')
    expect(sb.selects).toEqual([`${BASE}, type, conversation_id, listing_id`, `${BASE}, type, conversation_id`])
  })
  test('missing conversation_id too keeps type', async () => {
    const sb = fakeSupabase({ failCols: ['listing_id', 'conversation_id'] })
    await fetchNotifications(sb, 'u1')
    expect(sb.selects).toEqual([`${BASE}, type, conversation_id, listing_id`, `${BASE}, type, conversation_id`, `${BASE}, type`])
  })
  test('missing type too: the base columns', async () => {
    const sb = fakeSupabase({ failCols: ['listing_id', 'conversation_id', 'type'] })
    await fetchNotifications(sb, 'u1')
    expect(sb.selects).toEqual([`${BASE}, type, conversation_id, listing_id`, `${BASE}, type, conversation_id`, `${BASE}, type`, BASE])
  })
  test('no read of marketplace_photos / marketplace_listings', async () => {
    const sb = fakeSupabase({ rows: [{ id: 'n2', type: 'marketplace', listing_id: null, created_at: '2026-11-12T10:00:00.000Z', body: 'x' }] })
    await fetchNotifications(sb, 'u1')
    expect(sb.tables).toEqual(['notifications'])
  })
  test('listing_id comes back on the rows as the database wrote it', async () => {
    const { data } = await fetchNotifications(fakeSupabase(), 'u1')
    expect(data.map(notificationRoute)).toEqual(['marketplace_listing', 'marketplace'])
  })
  test('a database without the column: no listing route', async () => {
    const { data } = await fetchNotifications(fakeSupabase({ failCols: ['listing_id'], rows: [{ id: 'n2', type: 'marketplace' }] }), 'u1')
    expect(notificationRoute(data[0])).toBe('marketplace')
  })
  test('a guest gets the rows untouched', async () => {
    const { data } = await fetchNotifications(fakeSupabase(), 'u1', { guest: true })
    expect(data).toEqual(ROWS)
  })
})

describe('notificationRoute: photo-decision rows', () => {
  test('listing_id: the listing', () => expect(notificationRoute({ type: 'marketplace', listing_id: 'l1' })).toBe('marketplace_listing'))
  test('NULL or absent: İlanlarım', () => {
    expect(notificationRoute({ type: 'marketplace', listing_id: null })).toBe('marketplace')
    expect(notificationRoute({ type: 'marketplace' })).toBe('marketplace')
  })
})

describe('marketplaceListingTarget (the tap)', () => {
  test('still there: the listing', async () => {
    expect(await marketplaceListingTarget('l1', async () => ({ id: 'l1' }))).toEqual({ view: 'listing', listingId: 'l1' })
  })
  test('gone (null): İlanlarım', async () => {
    expect(await marketplaceListingTarget('l1', async () => null)).toBe('mine')
  })
  test('getListing throws: İlanlarım', async () => {
    expect(await marketplaceListingTarget('l1', async () => { throw new Error('x') })).toBe('mine')
  })
})

describe('createListingTap (the pending tap guard)', () => {
  const flush = () => new Promise(r => setTimeout(r, 0))
  test('a second tap while pending is ignored; the first navigates once', async () => {
    const tap = createListingTap(); const go = jest.fn()
    expect(tap.run(async () => 'A', go)).toBe(true)
    expect(tap.run(async () => 'B', go)).toBe(false)
    await flush()
    expect(go.mock.calls).toEqual([['A']])
  })
  test('a late result after cancel does nothing, and a new tap works', async () => {
    const tap = createListingTap(); const go = jest.fn()
    let late; tap.run(() => new Promise(r => { late = r }), go)
    tap.cancel()
    expect(tap.run(async () => 'B', go)).toBe(true)
    await flush(); late('A'); await flush()
    expect(go.mock.calls).toEqual([['B']])
  })
})
