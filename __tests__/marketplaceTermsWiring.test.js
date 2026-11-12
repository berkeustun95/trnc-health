// Wiring QA gap: MarketplaceScreen must hand the chat the account's REAL terms_version (a hard-coded current version would pass every
// other test and never ask at the first message), for both entries - a listing's Message button and a push-tap straight to the inbox.
// Guests are never asked to post. The chat is a stub that records its props.
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
const OLD = '2026-11-09'
const open = (props, profile = { date_of_birth: '1990-01-01', terms_version: OLD }, session = { user: { id: 'u1' } }) =>
  render(<MarketplaceScreen lang={L} session={session} profile={profile} onBack={() => {}} onSignIn={() => {}} {...props} />)

test('listing -> Message with old terms: the chat is handed the old version, so it asks', async () => {
  await open({ target: { view: 'listing', listingId: 'L1' } })
  await press('stub-message')
  expect(await screen.findByText('stub:chat')).toBeTruthy()
  expect(global.__chatProps.termsVersion).toBe(OLD)
  expect(legal.needsMarketplaceTerms(global.__chatProps.termsVersion)).toBe(true)
})

test('push-tap into the inbox with old terms: the chat is handed the old version (a seller reply asks)', async () => {
  await open({ target: { view: 'inbox', conversationId: 'c1' } })
  expect(await screen.findByText('stub:chat')).toBeTruthy()
  expect(global.__chatProps.termsVersion).toBe(OLD)
  expect(legal.needsMarketplaceTerms(global.__chatProps.termsVersion)).toBe(true)
})

test('push-tap into the inbox with an unloaded profile: handed undefined, which asks', async () => {
  await open({ target: { view: 'inbox', conversationId: 'c1' } }, null)
  expect(await screen.findByText('stub:chat')).toBeTruthy()
  expect(legal.needsMarketplaceTerms(global.__chatProps.termsVersion)).toBe(true)
})

test('current terms: the chat is handed a version that does not ask', async () => {
  await open({ target: { view: 'inbox', conversationId: 'c1' } }, { date_of_birth: '1990-01-01', terms_version: legal.LEGAL_VERSION })
  expect(await screen.findByText('stub:chat')).toBeTruthy()
  expect(legal.needsMarketplaceTerms(global.__chatProps.termsVersion)).toBe(false)
})

test('a guest session reaching initialView post is not shown the terms gate (it must not write profiles)', async () => {
  await open({ initialView: 'post' }, { terms_version: null }, { user: { id: 'g1' }, guest: true })
  expect(await screen.findByText('stub:form')).toBeTruthy()
  expect(screen.queryByText(t('mkTermsTitle', L))).toBeNull()
})
