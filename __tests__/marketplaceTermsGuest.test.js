// Defence in depth: beforeSend never shows the Bandabuliya terms gate to a guest session (a guest must not accept terms or write
// profiles); the send's own AUTH_REQUIRED refusal handles it. ConversationScreen is a stub that hands beforeSend to the test.
import { render, screen, act } from '@testing-library/react-native'
import { t } from '../constants/i18n'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() }, isGuest: s => !!s?.guest }))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../utils/marketplaceApi', () => ({ MARKETPLACE_CHAT: {}, noticeAccepted: jest.fn(async () => true), acceptNotice: jest.fn() }))
jest.mock('../screens/ConversationsScreen', () => () => null)
jest.mock('../screens/ConversationScreen', () => ({ __esModule: true, default: p => { global.__beforeSend = p.beforeSend; return null } }))

const MarketplaceChatScreen = require('../screens/MarketplaceChatScreen').default
const L = 'English'
const compose = { userId: 'fx-seller', displayName: 'S', listingId: 'fx-7', listingTitle: 'Kitap' }
const mount = session => render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}} compose={compose} termsVersion={null} />)

test('positive control: a signed-in account with no accepted terms is shown the gate and the send waits', async () => {
  await mount({ user: { id: 'u1' } })
  let settled = false
  await act(async () => { global.__beforeSend().then(() => { settled = true }) })
  expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
  expect(settled).toBe(false)
})

test('a guest session: no gate, the send goes on to the server (which refuses it)', async () => {
  await mount({ user: { id: 'u1' }, guest: true })
  let ok
  await act(async () => { ok = await global.__beforeSend() })
  expect(ok).toBe(true)
  expect(screen.queryByText(t('mkTermsTitle', L))).toBeNull()
})
