// The Preview sample-data fallback (utils/marketplaceApi.js useFixtureOr) is only for "the tables / functions are not applied yet".
// A REAL refusal or schema fault must throw, never turn into sample data and a fake success. The fixture, once on,
// stays on for the session (never switched back), so each genuine case gets a fresh module.
let mockErr = null
const mockChain = () => {
  const c = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return res => res({ data: null, error: mockErr })
    if (k === 'single' || k === 'maybeSingle') return async () => ({ data: null, error: mockErr })
    return () => c
  } })
  return c
}
jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn(() => mockChain()), rpc: jest.fn(async () => ({ data: null, error: mockErr })), storage: { from: () => ({}) } },
  isGuest: () => false,
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))

const api = require('../utils/marketplaceApi')
const F = { title: 'x', description: 'y', price_tl: 1, is_free: false, category: 'other', condition: 'good', district: 'girne' }
const REAL = [
  { code: 'P0001', message: 'TERMS_REQUIRED' }, { code: 'P0001', message: 'NOTICE_REQUIRED' }, { code: 'P0001', message: 'NOT_ADULT' },
  { code: 'P0001', message: 'AUTH_REQUIRED' }, { code: '42501', message: 'new row violates row-level security policy for table "marketplace_listings"' },
  { code: '42703', message: 'column marketplace_listings.bumped_at does not exist' },
  { code: 'PGRST204', message: "Could not find the 'bumped_at' column of 'marketplace_listings' in the schema cache" },
  { code: '22P02', message: 'invalid input syntax for type uuid: "x"' },
  { message: 'relation "public.marketplace_listings" does not exist' },   // no code: matched on codes only, never on prose
]

test.each(REAL)('a real refusal %j is thrown by create / read / start / notice read and never switches to sample data', async err => {
  mockErr = err
  await expect(api.createListing(F)).rejects.toMatchObject({ message: err.message })
  await expect(api.listListings()).rejects.toMatchObject({ message: err.message })
  await expect(api.noticeAccepted('u1')).rejects.toMatchObject({ message: err.message })
  expect((await api.MARKETPLACE_CHAT.start({ listingId: 'L1' }, 'hi')).error).toMatchObject({ message: err.message })
  expect(api.usingFixture()).toBe(false)
})

test.each([
  { code: 'PGRST205', message: 'Could not find the table' }, { code: '42P01', message: 'relation "public.marketplace_listings" does not exist' },
  { code: 'PGRST202', message: 'Could not find the function' }, { code: '42883', message: 'function public.start_listing_conversation(uuid, text) does not exist' },
])('a genuinely missing table / function %j switches to sample data', async err => {
  let fresh
  jest.isolateModules(() => { fresh = require('../utils/marketplaceApi') })   // the fixture is sticky: one module per case
  mockErr = err
  expect(fresh.usingFixture()).toBe(false)
  await fresh.listListings()
  expect(fresh.usingFixture()).toBe(true)
})
