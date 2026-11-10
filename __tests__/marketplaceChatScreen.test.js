// Bandabuliya chat (slice 4), rendered: the real MarketplaceChatScreen over Student Hub's ConversationScreen /
// ConversationsScreen, on the Preview sample data (production answers "does not exist" until 20261183/84 apply).
// Evidence about the wiring — the notice gate holds the first send, the thread appears, the seller side can accept —
// not about layout on a phone.
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { t } from '../constants/i18n'

const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } }
const thenable = () => { const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res(MISSING) : () => c) }); return c }
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn(async () => MISSING), from: jest.fn(() => thenable()) }, isGuest: () => false }))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../components/Avatar', () => ({ __esModule: true, default: () => null, prefetchAvatars: async () => {} }))

const api = require('../utils/marketplaceApi')
const MarketplaceChatScreen = require('../screens/MarketplaceChatScreen').default
const L = 'English'
const ME = 'me-uid'
const session = { user: { id: ME } }
const threadFor = async listingId => (await api.MARKETPLACE_CHAT.list()).data.find(r => r.listing_id === listingId)

beforeAll(async () => {
  await api.listListings()
  api.setFixtureUser(ME, 'Ben')
})

test('buyer: the first send waits for the safety notice, then the thread opens and the seller answers', async () => {
  await render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}}
    compose={{ userId: 'fx-seller', displayName: 'Önizleme Satıcı', listingId: 'fx-3', listingTitle: 'Üniversite hazırlık kitapları' }} />)

  expect(screen.getByText('Üniversite hazırlık kitapları')).toBeTruthy()          // the listing strip
  await fireEvent.changeText(screen.getByPlaceholderText(t('msgPlaceholder', L)), 'Merhaba, kitaplar duruyor mu?')
  // Not awaited: the send itself waits for the notice to be answered, as on the phone.
  const sending = fireEvent.press(screen.getByLabelText(t('msgSend', L)))

  // Held by the notice: nothing sent yet, and a second tap does not queue a second send.
  expect(await screen.findByText(t('mkNoticeTitle', L))).toBeTruthy()
  expect(await threadFor('fx-3')).toBeUndefined()

  await fireEvent.press(screen.getByText(t('mkNoticeAccept', L)))
  await sending
  expect(await screen.findByText('Merhaba, kitaplar duruyor mu?')).toBeTruthy()  // now a thread, with the message
  expect(await screen.findByText(t('msgAwaitingAcceptance', L))).toBeTruthy()
  expect(await threadFor('fx-3')).toMatchObject({ is_accepted: false })

  await act(async () => { await new Promise(r => setTimeout(r, 4200)) })          // the sample seller answers
  expect(await threadFor('fx-3')).toMatchObject({ is_accepted: true })
}, 15000)

test('the notice is asked once: a second thread sends straight away', async () => {
  await render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}}
    compose={{ userId: 'fx-seller', displayName: 'Önizleme Satıcı', listingId: 'fx-1', listingTitle: 'Şehir bisikleti, 21 vites' }} />)
  await fireEvent.changeText(screen.getByPlaceholderText(t('msgPlaceholder', L)), 'Bisiklet duruyor mu?')
  await fireEvent.press(screen.getByLabelText(t('msgSend', L)))
  expect(await screen.findByText('Bisiklet duruyor mu?')).toBeTruthy()
  expect(screen.queryByText(t('mkNoticeTitle', L))).toBeNull()
})

test('seller: the inbox shows the request with its listing, and Accept opens the composer', async () => {
  await render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}} />)
  expect(await screen.findByText(t('mkInboxTitle', L))).toBeTruthy()
  expect(await screen.findByText('Masa lambası, LED')).toBeTruthy()             // the listing line under the name
  await fireEvent.press(screen.getByLabelText('Deniz'))
  await fireEvent.press(await screen.findByText(t('msgAccept', L)))
  expect(await screen.findByPlaceholderText(t('msgPlaceholder', L))).toBeTruthy()
})
