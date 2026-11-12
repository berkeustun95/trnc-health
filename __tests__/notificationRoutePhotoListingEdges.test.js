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


// QA edge cases beyond notificationRoutePhotoListing.test.js: the 40/41 title boundary, odd created_at, null body,
// a listing read error, two notices for one listing, odd titles.
const ok = async (o, opts) => (await run(fakeSupabase(o), opts))
const cutOf = t => (t.length > 40 ? t.slice(0, 39).trimEnd() + '…' : t)

describe('title boundary (mirrors review.ts rejectText)', () => {
  test('exactly 40 chars: matched whole', async () => {
    const t = 'x'.repeat(40)
    expect((await ok({ notifs: [notice({ body: bodyFor(t) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBe('l1')
    expect((await ok({ notifs: [notice({ body: bodyFor('x'.repeat(39) + '…') })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBeUndefined()
  })
  test('41 chars: matched only in the 39 + ellipsis form', async () => {
    const t = 'x'.repeat(41)
    expect((await ok({ notifs: [notice({ body: bodyFor('x'.repeat(39) + '…') })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBe('l1')
    expect((await ok({ notifs: [notice({ body: bodyFor(t) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBeUndefined()
  })
  test('45 chars (between 41 and 50): still truncated', async () => {
    const t = 'y'.repeat(45)
    expect((await ok({ notifs: [notice({ body: bodyFor(cutOf(t)) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBe('l1')
    expect((await ok({ notifs: [notice({ body: bodyFor(t) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBeUndefined()
  })
  test('cut point is exactly 39 (the 39th char differs, so a 38-cut would not be a substring)', async () => {
    const t = 'a'.repeat(38) + 'b' + 'c'.repeat(10)
    expect(cutOf(t)).toBe('a'.repeat(38) + 'b…')
    expect((await ok({ notifs: [notice({ body: bodyFor(cutOf(t)) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBe('l1')
  })
  test('a space at position 39 is trimmed before the ellipsis', async () => {
    const t = 'a'.repeat(38) + ' ' + 'b'.repeat(10)
    expect(cutOf(t)).toBe('a'.repeat(38) + '…')
    expect((await ok({ notifs: [notice({ body: bodyFor(cutOf(t)) })], live: [{ id: 'l1', title: t }] }))[0].listing_id).toBe('l1')
  })
})

describe('odd rows', () => {
  test('null / garbage created_at: row left alone, no photo read', async () => {
    for (const created_at of [null, undefined, 'not a date', '']) {
      const sb = fakeSupabase({ notifs: [notice({ created_at })] })
      const [n] = await run(sb)
      expect(n.listing_id).toBeUndefined()
      expect(notificationRoute(n)).toBe('marketplace')
      expect(sb.log.map(q => q.table)).not.toContain('marketplace_photos')
    }
  })
  test('a garbage-dated notice does not break a good one beside it', async () => {
    const data = await ok({ notifs: [notice({ id: 'bad', created_at: 'nope' }), notice({ id: 'good' })] })
    expect(data.find(n => n.id === 'good').listing_id).toBe('l1')
    expect(data.find(n => n.id === 'bad').listing_id).toBeUndefined()
  })
  test('null / non-string body: not annotated, no throw', async () => {
    for (const body of [null, undefined, 42]) expect((await ok({ notifs: [notice({ body })] }))[0].listing_id).toBeUndefined()
  })
  test('non-string listing title: not annotated, no throw', async () => {
    for (const title of [null, undefined, 7]) expect((await ok({ live: [{ id: 'l1', title }] }))[0].listing_id).toBeUndefined()
  })
  test('listing read error: row unmarked, list still returned', async () => {
    const data = await ok({ liveError: { code: 'XX' } })
    expect(data).toHaveLength(1)
    expect(data[0].listing_id).toBeUndefined()
  })
  test('photo rows with null listing_id / reviewed_at are ignored, not counted as a second listing', async () => {
    const data = await ok({ photos: [photo('l1', -2000), { listing_id: null, reviewed_at: iso(T0 - 1000) }, { listing_id: 'l2', reviewed_at: null }] })
    expect(data[0].listing_id).toBe('l1')
  })
  test('two notices, same listing (both windows hit it): both annotated', async () => {
    const data = await ok({ notifs: [notice({ id: 'n2', created_at: iso(T0 + 30_000) }), notice({ id: 'n1' })], photos: [photo('l1', -2000), photo('l1', 29_000)] })
    expect(data.map(n => n.listing_id)).toEqual(['l1', 'l1'])
  })
  test('MARKETPLACE guest: no reads; an unmarked row routes to İlanlarım', async () => {
    const sb = fakeSupabase()
    const [n] = await run(sb, { guest: true })
    expect(sb.log.map(q => q.table)).toEqual(['notifications'])
    expect(notificationRoute(n)).toBe('marketplace')
  })
})
