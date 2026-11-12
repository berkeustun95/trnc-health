// A photo-decision row in Bildirimler opens THE listing when that is certain, else İlanlarım. The row carries no listing
// id, so fetchNotifications matches it to the user's own rejected photos by review time and annotates only an unambiguous,
// still-existing listing. The tap re-checks that the listing is still there.
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
const { notificationRoute, fetchNotifications, marketplaceListingTarget, createListingTap } = require('../utils/notificationRoute')

const T0 = Date.parse('2026-11-12T10:00:00.000Z')
const iso = ms => new Date(ms).toISOString()
const bodyFor = t => `“${t}” ilanındaki bir fotoğraf yayınlanmadı.`
const notice = (o = {}) => ({ id: 'n1', type: 'marketplace', created_at: iso(T0), body: bodyFor('Title 1'), ...o })
const photo = (listing_id, offsetMs) => ({ listing_id, reviewed_at: iso(T0 + offsetMs).replace('Z', '+00:00') })

describe('notificationRoute', () => {
  test('with a listing id: the listing', () => expect(notificationRoute(notice({ listing_id: 'l1' }))).toBe('marketplace_listing'))
  test('without: İlanlarım', () => expect(notificationRoute(notice())).toBe('marketplace'))
})

function fakeSupabase({ notifs = [notice()], photos = [photo('l1', -2000)], count, live = [{ id: 'l1', title: 'Title 1' }], photoError = null, liveError = null } = {}) {
  const log = []
  const answer = {
    notifications: { data: notifs, error: null },
    marketplace_photos: { data: photoError ? null : photos, error: photoError, count: count ?? photos.length },
    marketplace_listings: { data: liveError ? null : live, error: liveError },
  }
  return {
    log,
    from: table => {
      const q = { table, ops: [] }
      log.push(q)
      const chain = new Proxy(q, { get: (o, k) => (k === 'then' ? undefined : k === 'limit' ? (...a) => { o.ops.push([k, ...a]); return Promise.resolve(answer[table]) } : (...a) => { o.ops.push([k, ...a]); return chain }) })
      return chain
    },
    rpc: async () => ({ data: [], error: null }),
  }
}
const run = (sb, opts) => fetchNotifications(sb, 'u1', opts).then(r => r.data)
const tables = sb => sb.log.map(q => q.table)

describe('fetchNotifications: photo-decision rows', () => {
  test('one listing in the window: annotated, route is the listing', async () => {
    const [n] = await run(fakeSupabase())
    expect(n.listing_id).toBe('l1')
    expect(notificationRoute(n)).toBe('marketplace_listing')
  })
  test('two listings in the window: not annotated', async () => {
    const [n] = await run(fakeSupabase({ photos: [photo('l1', -2000), photo('l2', -1000)] }))
    expect(n.listing_id).toBeUndefined()
    expect(notificationRoute(n)).toBe('marketplace')
  })
  test('two photos of the same listing: still one listing', async () => {
    const [n] = await run(fakeSupabase({ photos: [photo('l1', -2000), photo('l1', -1000)] }))
    expect(n.listing_id).toBe('l1')
  })
  test('no photo in the window (too early / too late): not annotated, no listing read', async () => {
    for (const off of [-61_000, 5_001]) {
      const sb = fakeSupabase({ photos: [photo('l1', off)] })
      expect((await run(sb))[0].listing_id).toBeUndefined()
      expect(tables(sb)).not.toContain('marketplace_listings')
    }
  })
  test('window edges are inclusive', async () => {
    expect((await run(fakeSupabase({ photos: [photo('l1', -60_000)] })))[0].listing_id).toBe('l1')
    expect((await run(fakeSupabase({ photos: [photo('l1', 5_000)] })))[0].listing_id).toBe('l1')
  })
  test('the listing is gone: not annotated', async () => {
    expect((await run(fakeSupabase({ live: [] })))[0].listing_id).toBeUndefined()
  })
  test('a read error leaves the row unmarked, and the list loads', async () => {
    expect((await run(fakeSupabase({ photoError: { message: 'x' } })))[0].listing_id).toBeUndefined()
    expect((await run(fakeSupabase({ liveError: { message: 'x' } })))[0].listing_id).toBeUndefined()
  })
  test('a truncated read (count differs from rows) decides nothing', async () => {
    expect((await run(fakeSupabase({ count: 501 })))[0].listing_id).toBeUndefined()
  })
  test('a guest reads no photos', async () => {
    const sb = fakeSupabase()
    await run(sb, { guest: true })
    expect(tables(sb)).toEqual(['notifications'])
  })
  test('no photo-decision rows: no photo read', async () => {
    const sb = fakeSupabase({ notifs: [{ id: 'd', type: 'duty', created_at: iso(T0) }] })
    await run(sb)
    expect(tables(sb)).toEqual(['notifications'])
  })
  test('the photo read is the user\'s own, rejected, time-bounded and limited', async () => {
    const sb = fakeSupabase()
    await run(sb)
    const ops = sb.log.find(q => q.table === 'marketplace_photos').ops
    expect(ops).toEqual(expect.arrayContaining([['eq', 'owner_id', 'u1'], ['eq', 'status', 'rejected'], ['limit', 500]]))
    expect(ops.find(o => o[0] === 'gte')[2]).toBe(iso(T0 - 60_000))
    expect(ops.find(o => o[0] === 'lte')[2]).toBe(iso(T0 + 5_000))
  })
  test('two notices, each tied to its own listing', async () => {
    const T1 = T0 + 3_600_000
    const sb = fakeSupabase({
      notifs: [notice({ id: 'a' }), notice({ id: 'b', created_at: iso(T1), body: bodyFor('Title 2') })],
      photos: [photo('l1', -2000), { listing_id: 'l2', reviewed_at: iso(T1 - 3000) }],
      live: [{ id: 'l1', title: 'Title 1' }, { id: 'l2', title: 'Title 2' }],
    })
    const data = await run(sb)
    expect(data.map(n => n.listing_id)).toEqual(['l1', 'l2'])
  })
  test('the body names a different title: not annotated', async () => {
    expect((await run(fakeSupabase({ notifs: [notice({ body: bodyFor('Other listing') })] })))[0].listing_id).toBeUndefined()
  })
  test('a long title matches in the truncated form the edge function writes', async () => {
    const long = 'A very long listing title that goes past forty characters'
    const cut = long.slice(0, 39).trimEnd() + '…'
    const sb = fakeSupabase({ notifs: [notice({ body: bodyFor(cut) })], live: [{ id: 'l1', title: long }] })
    expect((await run(sb))[0].listing_id).toBe('l1')
    const full = fakeSupabase({ notifs: [notice({ body: bodyFor(long) })], live: [{ id: 'l1', title: long }] })
    expect((await run(full))[0].listing_id).toBeUndefined()
  })
  test('an empty title never matches', async () => {
    expect((await run(fakeSupabase({ live: [{ id: 'l1', title: '' }] })))[0].listing_id).toBeUndefined()
  })
  test('the listings read asks for the title', async () => {
    const sb = fakeSupabase()
    await run(sb)
    expect(sb.log.find(q => q.table === 'marketplace_listings').ops).toContainEqual(['select', 'id, title'])
  })
  test('both annotations land on one list, each row keeps its own mark', async () => {
    const sb = fakeSupabase({ notifs: [notice(), { id: 'm', type: 'message', conversation_id: 'c1', created_at: iso(T0) }] })
    sb.rpc = async () => ({ data: [{ conversation_id: 'c1' }], error: null })
    const data = await run(sb)
    expect(data.find(n => n.id === 'n1').listing_id).toBe('l1')
    expect(data.find(n => n.id === 'n1').listing_conversation).toBeUndefined()
    expect(data.find(n => n.id === 'm').listing_conversation).toBe(true)
    expect(data.find(n => n.id === 'm').listing_id).toBeUndefined()
  })
  test('nothing changed: the same response object comes back', async () => {
    const notifs = [notice()]
    const res = await fetchNotifications(fakeSupabase({ notifs, live: [] }), 'u1')
    expect(res.data).toBe(notifs)
  })
  test('a conversation-annotation failure does not cost the photo annotation', async () => {
    const sb = fakeSupabase({ notifs: [notice(), { id: 'm', type: 'message', conversation_id: 'c1', created_at: iso(T0) }] })
    sb.rpc = async () => { throw new Error('boom') }
    expect((await run(sb))[0].listing_id).toBe('l1')
  })
})

describe('marketplaceListingTarget (the tap)', () => {
  test('still there: the listing', async () => {
    expect(await marketplaceListingTarget('l1', async () => ({ id: 'l1' }))).toEqual({ view: 'listing', listingId: 'l1' })
  })
  test('deleted since the list loaded: İlanlarım, not the "no longer live" page', async () => {
    expect(await marketplaceListingTarget('l1', async () => null)).toBe('mine')
  })
  test('a failed read: İlanlarım', async () => {
    expect(await marketplaceListingTarget('l1', async () => { throw new Error('x') })).toBe('mine')
  })
})

describe('createListingTap (the pending tap guard)', () => {
  const deferred = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
  const flush = () => new Promise(r => setImmediate(r))
  test('a normal tap navigates once', async () => {
    const tap = createListingTap(); const go = jest.fn()
    tap.run(async () => 'T', go)
    await flush()
    expect(go).toHaveBeenCalledTimes(1); expect(go).toHaveBeenCalledWith('T')
  })
  test('a second tap while pending is ignored', async () => {
    const tap = createListingTap(); const go = jest.fn(); const d = deferred(); const resolve = jest.fn(() => d.p)
    tap.run(resolve, go)
    expect(tap.run(resolve, go)).toBe(false)
    d.res('T'); await flush()
    expect(resolve).toHaveBeenCalledTimes(1); expect(go).toHaveBeenCalledTimes(1)
  })
  test('a late result after cancel does not navigate', async () => {
    const tap = createListingTap(); const go = jest.fn(); const d = deferred()
    tap.run(() => d.p, go)
    tap.cancel(); d.res('T'); await flush()
    expect(go).not.toHaveBeenCalled()
  })
  test('after cancel a new tap works and the old late result still does nothing', async () => {
    const tap = createListingTap(); const go = jest.fn(); const old = deferred()
    tap.run(() => old.p, go); tap.cancel()
    tap.run(async () => 'NEW', go)
    old.res('OLD'); await flush()
    expect(go).toHaveBeenCalledTimes(1); expect(go).toHaveBeenCalledWith('NEW')
  })
  test('after a finished tap the next one runs', async () => {
    const tap = createListingTap(); const go = jest.fn()
    tap.run(async () => 'A', go); await flush()
    tap.run(async () => 'B', go); await flush()
    expect(go.mock.calls.map(c => c[0])).toEqual(['A', 'B'])
  })
})
