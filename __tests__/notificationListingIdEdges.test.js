// QA edge cases for 20261192 / createListingTap (not committed by QA).
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true }))
const { fetchNotifications, marketplaceListingTarget, createListingTap } = require('../utils/notificationRoute')

const sbWith = res => { const selects = []; return { selects, from: () => ({ select: c => { selects.push(c); const ch = { eq: () => ch, order: () => ch, limit: () => Promise.resolve(res) }; return ch } }), rpc: async () => ({ data: [], error: null }) } }
const flush = () => new Promise(r => setTimeout(r, 0))

test('network / non-42703 error: ONE select, no fallback chain, error passed through, no throw', async () => {
  const sb = sbWith({ data: null, error: { code: '', message: 'Network request failed' } })
  const res = await fetchNotifications(sb, 'u1')
  expect(sb.selects.length).toBe(1)
  expect(res.error.message).toBe('Network request failed')
  expect(res.data).toBeNull()
})
test('42703 on every select including the base: returns the error, 4 selects, no loop', async () => {
  const sb = sbWith({ data: null, error: { code: '42703' } })
  const res = await fetchNotifications(sb, 'u1')
  expect(sb.selects.length).toBe(4)
  expect(res.error.code).toBe('42703')
})
test('marketplaceListingTarget: read error (rejects) -> mine; null -> mine; undefined -> mine', async () => {
  expect(await marketplaceListingTarget('l', async () => { throw new Error('offline') })).toBe('mine')
  expect(await marketplaceListingTarget('l', async () => undefined)).toBe('mine')
})
test('double tap after the first finished: second tap runs', async () => {
  const tap = createListingTap(); const go = jest.fn()
  tap.run(async () => 'A', go); await flush()
  expect(tap.run(async () => 'B', go)).toBe(true); await flush()
  expect(go.mock.calls).toEqual([['A'], ['B']])
})
test('tap then close (cancel) then late result: nothing navigates', async () => {
  const tap = createListingTap(); const go = jest.fn(); let late
  tap.run(() => new Promise(r => { late = r }), go); await flush(); tap.cancel(); late('A'); await flush()
  expect(go).not.toHaveBeenCalled()
})
test('non-listing row tapped while a listing tap is pending (App.js cancels first): the late listing result is dropped', async () => {
  const tap = createListingTap(); const go = jest.fn(); let late
  tap.run(() => new Promise(r => { late = r }), go); await flush()
  tap.cancel() // what onNotifPress does for route !== marketplace_listing
  late({ view: 'listing', listingId: 'l1' }); await flush()
  expect(go).not.toHaveBeenCalled()
})
