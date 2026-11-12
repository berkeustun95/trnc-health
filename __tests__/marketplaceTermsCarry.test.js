// A terms accept made while posting carries into the chat opened afterwards: MarketplaceScreen hands the chat the accepted version
// (termsOk), not just profile.terms_version, which stays stale until App's profile reloads. The chat is a stub that records its props.
import { render, screen, fireEvent } from '@testing-library/react-native'
import { t } from '../constants/i18n'

const MISSING = { data: null, error: { code: 'PGRST202', message: 'x' } }
const profilesChain = () => {
  const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res(MISSING) : () => c) })
  return c
}
const mockAcceptRpc = async (name, args) => (name === 'accept_terms'
  ? { data: { terms_version: args.p_version, terms_locale: args.p_locale, terms_accepted_at: 'now' }, error: null }
  : MISSING)
const thenable = () => { const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res(MISSING) : () => c) }); return c }
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn((name, args) => mockAcceptRpc(name, args)), from: jest.fn(tbl => (tbl === 'profiles' ? profilesChain() : thenable())) },
  isGuest: s => !!s?.guest,
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../screens/MarketplaceChatScreen', () => ({
  __esModule: true,
  ...jest.requireActual('../screens/MarketplaceChatScreen'),
  default: p => { const { Text } = require('react-native'); global.__chatProps = p; return <Text>stub:chat</Text> },
}))
const mockStub = name => ({ onBack, ...p }) => {
  const { View: V, Text: T, TouchableOpacity: B } = require('react-native')
  return (
    <V>
      <T>{`stub:${name}`}</T>
      {p.onEdit && <B onPress={() => p.onEdit({ id: 'L1' })}><T>stub-edit</T></B>}
      {p.onMessage && <B onPress={() => p.onMessage({ id: 'L1', owner_id: 'fx-seller', title: 'Kitap' }, 'Satıcı')}><T>stub-message</T></B>}
      <B onPress={onBack}><T>stub-back</T></B>
    </V>
  )
}
jest.mock('../screens/MarketplaceFormScreen', () => ({ __esModule: true, default: (...a) => mockStub('form')(...a) }))
jest.mock('../screens/MarketplaceListingScreen', () => ({ __esModule: true, default: (...a) => mockStub('listing')(...a) }))
jest.mock('../screens/MarketplaceMineScreen', () => ({ __esModule: true, default: (...a) => mockStub('mine')(...a) }))

const legal = require('../constants/legal')
const MarketplaceScreen = require('../screens/MarketplaceScreen').default
const L = 'English'
const press = async label => fireEvent.press(await screen.findByText(label))

test('after a post-time accept, an unloaded profile does not make the chat re-ask', async () => {
  await render(<MarketplaceScreen lang={L} session={{ user: { id: 'u1' } }} profile={{ date_of_birth: '1990-01-01' }} onBack={() => {}} onSignIn={() => {}}
    target={{ view: 'listing', listingId: 'L1' }} />)
  await press('stub-edit'); await press(t('shTermsAccept', L))
  await press('stub-back'); await press('stub-message')
  expect(await screen.findByText('stub:chat')).toBeTruthy()
  expect(legal.needsMarketplaceTerms(global.__chatProps.termsVersion)).toBe(false)
})
