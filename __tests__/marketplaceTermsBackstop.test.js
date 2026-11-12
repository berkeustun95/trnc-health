// The server is the terms backstop (20261190): a profile whose terms_version LOOKS current to the client still gets TERMS_REQUIRED
// from the server (floors disagree, or the row changed elsewhere). Every post path and both send paths must re-open the terms
// gate, keep what the user typed, fake no success, and never resubmit by themselves. Real screens; supabase is a router that
// answers reads and refuses every write with a P0001 TERMS_REQUIRED, like the migration does.
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { t } from '../constants/i18n'

const mockRefuse = () => ({ data: null, error: { code: 'P0001', message: 'TERMS_REQUIRED' } })
const mockCalls = []
const mockNow = Date.now()
const mockListing = (over = {}) => ({
  id: 'L1', owner_id: 'u1', status: 'active', hidden_at: null, deleted_at: null, title: 'Bisiklet kirmizi', description: 'Cok temiz bir bisiklet, az kullanildi.',
  price_tl: 500, is_free: false, category: 'other', condition: 'good', district: 'girne', created_at: new Date(mockNow).toISOString(),
  bumped_at: new Date(mockNow).toISOString(), expires_at: new Date(mockNow + 2 * 86400e3).toISOString(), ...over,
})
let mockRow = mockListing()
const mockChain = tbl => {
  let op = 'select'
  const settle = single => {
    if (tbl === 'profiles') {
      if (op === 'update') return { data: { terms_version: require('../constants/legal').LEGAL_VERSION, terms_locale: 'English', terms_accepted_at: 'now' }, error: null }
      return { data: { marketplace_notice_version: '2026-11-09' }, error: null }
    }
    if (op === 'insert' || op === 'update') { mockCalls.push(`${tbl}.${op}`); return mockRefuse() }
    if (tbl === 'marketplace_listings') return { data: single ? mockRow : [mockRow], error: null }
    if (tbl === 'marketplace_photos') return { data: [{ id: 'P1', listing_id: 'L1', position: 0, status: 'approved', storage_path: 'a/b.jpg', reject_reason: null }], error: null }
    return { data: single ? null : [], error: null }
  }
  const c = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return res => res(settle(false))
    if (k === 'single' || k === 'maybeSingle') return async () => settle(true)
    if (k === 'insert' || k === 'update' || k === 'delete') return () => { op = k; return c }
    return () => c
  } })
  return c
}
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file://x.jpg', base64: 'AAAA', mimeType: 'image/jpeg' }] }),
}))
jest.mock('../lib/supabase', () => ({
  isGuest: () => false,
  supabase: {
    from: jest.fn(tbl => mockChain(tbl)),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }), upload: async () => { mockCalls.push('storage.upload'); return { error: null } } }) },
    rpc: jest.fn(async (name, args) => {
      if (name === 'list_conversations') return { data: [{ conversation_id: 'c1', other_user_id: 's1', other_display_name: 'Satici', is_accepted: true, is_closed: false,
        listing_id: 'L1', listing_title: 'Bisiklet', listing_status: 'active', listing_available: true, created_at: new Date().toISOString(), last_message_at: new Date().toISOString() }], error: null }
      if (name === 'marketplace_seller_names') return { data: [], error: null }
      mockCalls.push(name)
      return mockRefuse()
    }),
  },
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../components/Avatar', () => ({ __esModule: true, default: () => null, prefetchAvatars: async () => {} }))
jest.mock('../screens/MarketplaceMineScreen', () => ({ __esModule: true, default: () => null }))

const legal = require('../constants/legal')
const api = require('../utils/marketplaceApi')
const MarketplaceScreen = require('../screens/MarketplaceScreen').default
const MarketplaceChatScreen = require('../screens/MarketplaceChatScreen').default
const L = 'English'
const session = { user: { id: 'u1' } }
const CURRENT = { date_of_birth: '1990-01-01', terms_version: legal.LEGAL_VERSION }
const gateTitle = () => t('mkTermsTitle', L)
const press = async label => fireEvent.press(await screen.findByText(label))
const open = target => render(<MarketplaceScreen lang={L} session={session} profile={CURRENT} onBack={() => {}} onSignIn={() => {}} target={target} />)

beforeEach(() => { mockCalls.length = 0; mockRow = mockListing() })

test('profile looks current: the client alone would not ask', () => {
  expect(legal.needsMarketplaceTerms(CURRENT.terms_version)).toBe(false)
})

// ── post paths ──
async function openForm(listingOver) {
  await open({ view: 'listing', listingId: 'L1' })
  await press(t('mkEdit', L))
  await screen.findByText(t('mkEditTitle', L))
}
test('edit-save refused: gate opens over the form, fields kept, no error line, no resubmit; accept clears; a second refusal re-opens', async () => {
  await openForm()
  expect(screen.queryByText(gateTitle())).toBeNull()
  await press(t('mkSave', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(screen.queryByText(t('mkErrGeneric', L))).toBeNull()
  expect(screen.queryByText(t('mkErrPhotosPartial', L))).toBeNull()
  expect(mockCalls.filter(c => c === 'marketplace_listings.update')).toHaveLength(1)
  await press(t('shTermsAccept', L))
  await waitFor(() => expect(screen.queryByText(gateTitle())).toBeNull())
  expect(screen.getByDisplayValue('Bisiklet kirmizi')).toBeTruthy()
  expect(mockCalls.filter(c => c === 'marketplace_listings.update')).toHaveLength(1)   // no automatic resubmit
  await press(t('mkSave', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(mockCalls.filter(c => c === 'marketplace_listings.update')).toHaveLength(2)
}, 20000)   // first render of the edit form: 5.2 s on a cold transform cache (over jest's 5 s), well under 1 s warm
test('create refused (picked photo kept): gate opens, nothing saved, form stays in create mode', async () => {
  const { id: _id, ...noId } = mockListing()
  // a form over a listing without an id is the create form with its fields filled in
  const Form = require('../screens/MarketplaceFormScreen').default
  const onTermsRequired = jest.fn(); const onSaved = jest.fn()
  await render(<Form lang={L} session={session} listing={noId} onBack={() => {}} onSaved={onSaved} onTermsRequired={onTermsRequired} />)
  await press(t('mkAddPhotos', L))
  await press(t('mkPublish', L))
  await waitFor(() => expect(onTermsRequired).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.queryByText(t('mkErrGeneric', L))).toBeNull()
  expect(screen.queryByText(t('mkErrPhotosPartial', L))).toBeNull()
  expect(mockCalls).toEqual(['marketplace_listings.insert'])
  expect(screen.getByDisplayValue('Bisiklet kirmizi')).toBeTruthy()
})
test('renew refused: gate opens; accept leaves the user on the listing (repeats the action), second refusal re-opens', async () => {
  await open({ view: 'listing', listingId: 'L1' })
  await press(t('mkRenew', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(screen.queryByText(t('mkErrGeneric', L))).toBeNull()
  await press(t('shTermsAccept', L))
  await waitFor(() => expect(screen.queryByText(gateTitle())).toBeNull())
  expect(mockCalls.filter(c => c === 'renew_marketplace_listing')).toHaveLength(1)
  await press(t('mkRenew', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(mockCalls.filter(c => c === 'renew_marketplace_listing')).toHaveLength(2)
})
test('forced gate: after a server refusal and a cancelled gate, the next post action asks WITHOUT calling the server (termsForced; profile still looks current)', async () => {
  await open({ view: 'listing', listingId: 'L1' })
  await press(t('mkRenew', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(mockCalls.filter(c => c === 'renew_marketplace_listing')).toHaveLength(1)
  await press(t('shTermsCancel', L))
  await waitFor(() => expect(screen.queryByText(gateTitle())).toBeNull())
  await press(t('mkRenew', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(mockCalls.filter(c => c === 'renew_marketplace_listing')).toHaveLength(1)   // 2 here = termsDue() ignored termsForced
})
test('relist (mark available again) refused: gate opens, no error line', async () => {
  mockRow = mockListing({ status: 'sold' })
  await open({ view: 'listing', listingId: 'L1' })
  await press(t('mkMarkAvailable', L))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(screen.queryByText(t('mkErrGeneric', L))).toBeNull()
  expect(mockCalls.filter(c => c === 'marketplace_listings.update')).toHaveLength(1)
}, 20000)   // 2.5 s on a cold transform cache (first listing-page render), same cause

// ── send paths ──
const chatProps = { lang: L, session, termsVersion: legal.LEGAL_VERSION, onBack: () => {}, onOpenListing: () => {} }
async function sendRefusedThenCheck(rpcName) {
  const input = await screen.findByPlaceholderText(t('msgPlaceholder', L))
  await fireEvent.changeText(input, 'Merhaba')
  await fireEvent.press(screen.getByLabelText(t('msgSend', L)))
  expect(await screen.findByText(gateTitle())).toBeTruthy()
  expect(screen.queryByText(t('msgSendFailed', L))).toBeNull()
  expect(mockCalls.filter(c => c === rpcName)).toHaveLength(1)
  await press(t('shTermsAccept', L))
  await waitFor(() => expect(screen.queryByText(gateTitle())).toBeNull())
  expect(screen.getByDisplayValue('Merhaba')).toBeTruthy()                          // the draft stays
  expect(mockCalls.filter(c => c === rpcName)).toHaveLength(1)                      // no duplicate send
  await fireEvent.press(screen.getByLabelText(t('msgSend', L)))
  expect(await screen.findByText(gateTitle())).toBeTruthy()                         // second refusal re-opens
  expect(mockCalls.filter(c => c === rpcName)).toHaveLength(2)
}
test('first message from a listing refused: gate opens at once, draft kept, accept clears, second refusal re-opens', async () => {
  await render(<MarketplaceChatScreen {...chatProps} compose={{ userId: 's1', displayName: 'Satici', listingId: 'L1', listingTitle: 'Bisiklet' }} />)
  await sendRefusedThenCheck('start_listing_conversation')
})
test('reply in a thread refused: same', async () => {
  await render(<MarketplaceChatScreen {...chatProps} initialConversationId="c1" />)
  await sendRefusedThenCheck('send_message')
})

// ── fixture: a real refusal is never masked ──
test('a P0001 TERMS_REQUIRED throws from create / update / renew / send and never switches to sample data', async () => {
  const f = { title: 'x', description: 'y', price_tl: 1, is_free: false, category: 'other', condition: 'good', district: 'girne' }
  await expect(api.createListing(f)).rejects.toMatchObject({ message: 'TERMS_REQUIRED' })
  await expect(api.updateListing('L1', f)).rejects.toMatchObject({ message: 'TERMS_REQUIRED' })
  await expect(api.renewListing('L1')).rejects.toMatchObject({ message: 'TERMS_REQUIRED' })
  expect((await api.MARKETPLACE_CHAT.send('c1', 'hi')).error).toMatchObject({ message: 'TERMS_REQUIRED' })
  expect((await api.MARKETPLACE_CHAT.start({ listingId: 'L1' }, 'hi')).error).toMatchObject({ message: 'TERMS_REQUIRED' })
  expect(api.usingFixture()).toBe(false)
})
