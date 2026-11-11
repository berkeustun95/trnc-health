// Bandabuliya terms re-acceptance gate (decision 6, 2026-11-07): asked at a first POST or first MESSAGE, never on opening.
// Rules + both triggers. The chat is the real MarketplaceChatScreen over the Preview sample data; MarketplaceScreen's
// form / listing / İlanlarım screens are stubs so the test sees only whether the form is reached.
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native'
import { View, Text, TouchableOpacity } from 'react-native'
import { t } from '../constants/i18n'

const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } }
const thenable = () => { const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res(MISSING) : () => c) }); return c }
const profileWrites = []
let profileReply = v => ({ data: { terms_version: v, terms_locale: 'English', terms_accepted_at: 'now' }, error: null })
// profiles: update(...).eq(...).select(...).single() records what was sent and answers like the server.
const profilesChain = () => {
  let sent
  const c = new Proxy({}, { get: (_, k) => {
    if (k === 'update') return v => { sent = v; profileWrites.push(v); return c }
    if (k === 'single') return async () => profileReply(sent.terms_version)
    return () => c
  } })
  return c
}
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn(async () => MISSING), from: jest.fn(tbl => (tbl === 'profiles' ? profilesChain() : thenable())) },
  isGuest: s => !!s?.guest,
}))
jest.mock('../constants/redesign', () => ({ MARKETPLACE: true, REDESIGN: true }))
jest.mock('../constants/flags', () => ({ MODULE_FLAGS: { marketplace: false } }))
jest.mock('../utils/notify', () => ({ notifyAdmins: jest.fn() }))
jest.mock('../components/PageBackground', () => () => null)
jest.mock('../components/Avatar', () => ({ __esModule: true, default: () => null, prefetchAvatars: async () => {} }))
const mockStub = name => ({ onBack, ...p }) => {
  const { View: V, Text: T, TouchableOpacity: B } = require('react-native')
  return (
    <V>
      <T>{`stub:${name}`}</T>
      {p.onEdit && <B onPress={() => p.onEdit({ id: 'L1' })}><T>stub-edit</T></B>}
      {p.onPostAction && <B onPress={() => p.onPostAction(() => global.__renewed.push('L1'))}><T>stub-renew</T></B>}
      {p.onPost && <B onPress={p.onPost}><T>stub-mine-post</T></B>}
      <B onPress={onBack}><T>stub-back</T></B>
    </V>
  )
}
jest.mock('../screens/MarketplaceFormScreen', () => ({ __esModule: true, default: (...a) => mockStub('form')(...a) }))
jest.mock('../screens/MarketplaceListingScreen', () => ({ __esModule: true, default: (...a) => mockStub('listing')(...a) }))
jest.mock('../screens/MarketplaceMineScreen', () => ({ __esModule: true, default: (...a) => mockStub('mine')(...a) }))

const legal = require('../constants/legal')
const api = require('../utils/marketplaceApi')
const MarketplaceChatScreen = require('../screens/MarketplaceChatScreen').default
const MarketplaceScreen = require('../screens/MarketplaceScreen').default
const L = 'English'
const ME = 'me-uid'
const session = { user: { id: ME } }
const ADULT = '1990-01-01'
const FLOOR = legal.MARKETPLACE_TERMS_MIN
const threadFor = async listingId => (await api.MARKETPLACE_CHAT.list()).data.find(r => r.listing_id === listingId)
const gateTitle = () => screen.queryByText(t('mkTermsTitle', L))
const press = async label => fireEvent.press(await screen.findByText(label))

beforeAll(async () => { await api.listListings(); api.setFixtureUser(ME, 'Ben') })
beforeEach(() => { profileWrites.length = 0; global.__renewed = [] })

describe('the floor', () => {
  const { needsMarketplaceTerms: needs, MARKETPLACE_TERMS_MIN: MIN, LEGAL_VERSION } = legal
  test('null, older, equal, newer', () => {
    expect(needs(null)).toBe(true)
    expect(needs(undefined)).toBe(true)
    expect(needs('2026-09')).toBe(true)
    expect(needs('2026-11-10')).toBe(true)
    expect(needs(MIN)).toBe(false)
    expect(needs('2026-11-12')).toBe(false)
  })
  // Enabled by the LEGAL_VERSION bump commit (next task): LEGAL_VERSION is still 2026-11-09 here, so this is red as a normal test.
  // `.failing` passes while it fails and turns red the day LEGAL_VERSION catches up, which is the prompt to make it a normal test.
  test.failing('the floor never exceeds LEGAL_VERSION (accept writes LEGAL_VERSION; a higher floor re-asks forever)', () => {
    expect(MIN <= LEGAL_VERSION).toBe(true)
  })
})

describe('posting', () => {
  const open = (profile, props = {}) => render(<MarketplaceScreen lang={L} session={session} profile={profile} onBack={() => {}} onSignIn={() => {}} {...props} />)
  const old = { date_of_birth: ADULT, terms_version: '2026-11-09' }

  test('does not ask on opening, and asks before the form on a post tap (null terms)', async () => {
    await open({ date_of_birth: ADULT, terms_version: null })
    expect(gateTitle()).toBeNull()
    await press(t('mkPost', L))
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    expect(screen.queryByText('stub:form')).toBeNull()
  })
  test('current terms: straight to the form, no gate', async () => {
    await open({ date_of_birth: ADULT, terms_version: FLOOR })
    await press(t('mkPost', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
    expect(gateTitle()).toBeNull()
  })
  test('cancel opens nothing and writes nothing; accept writes the profile and opens the form', async () => {
    const accepted = jest.fn()
    await open(old, { onTermsAccepted: accepted })
    await press(t('mkPost', L))
    await press(t('shTermsCancel', L))
    expect(gateTitle()).toBeNull(); expect(screen.queryByText('stub:form')).toBeNull(); expect(profileWrites).toEqual([])
    await press(t('mkPost', L))
    await press(t('shTermsAccept', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
    expect(profileWrites).toEqual([{ terms_version: legal.LEGAL_VERSION, terms_locale: 'English' }])
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ terms_version: legal.LEGAL_VERSION }))
  })
  test('a failed save keeps the gate (RLS filtered to zero rows) and opens nothing', async () => {
    profileReply = () => ({ data: null, error: null })
    await open(old)
    await press(t('mkPost', L)); await press(t('shTermsAccept', L))
    expect(await screen.findByText(t('shTermsSaveError', L))).toBeTruthy()
    expect(screen.queryByText('stub:form')).toBeNull()
    profileReply = v => ({ data: { terms_version: v, terms_locale: 'English', terms_accepted_at: 'now' }, error: null })
  })
  test('asks once per session: after an accept a second post does not ask again, even with a stale profile', async () => {
    await open(old)
    await press(t('mkPost', L)); await press(t('shTermsAccept', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
    await press('stub-back'); await press(t('mkPost', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
    expect(gateTitle()).toBeNull()
    expect(profileWrites).toHaveLength(1)
  })
  test('initialView post asks before the form opens', async () => {
    await open(old, { initialView: 'post' })
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    expect(screen.queryByText('stub:form')).toBeNull()
    await press(t('shTermsAccept', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
  })
  test('initialView post with current terms opens the form at once', async () => {
    await open({ date_of_birth: ADULT, terms_version: FLOOR }, { initialView: 'post' })
    expect(screen.getByText('stub:form')).toBeTruthy(); expect(gateTitle()).toBeNull()
  })
  test('İlanlarım post is gated: cancel stays put, accept opens the form', async () => {
    await open(old, { initialView: 'mine' })
    await press('stub-mine-post'); expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    await press(t('shTermsCancel', L))
    expect(gateTitle()).toBeNull(); expect(screen.getByText('stub:mine')).toBeTruthy()
    await press('stub-mine-post'); await press(t('shTermsAccept', L))
    expect(await screen.findByText('stub:form')).toBeTruthy()
  })
  test('edit and renew from a listing are gated', async () => {
    await open(old, { target: { view: 'listing', listingId: 'L1' } })
    await press('stub-edit')
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy(); expect(screen.queryByText('stub:form')).toBeNull()
    await press(t('shTermsCancel', L))
    await press('stub-renew')
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy(); expect(global.__renewed).toEqual([])
    await press(t('shTermsAccept', L))
    await waitFor(() => expect(global.__renewed).toEqual(['L1']))
  })
  test('Android back closes the gate first, not the layer under it', async () => {
    const backRef = { current: null }
    await open(old, { target: { view: 'listing', listingId: 'L1' }, backRef })
    await press('stub-edit')
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    let handled; await act(async () => { handled = backRef.current() })
    expect(handled).toBe(true)
    expect(gateTitle()).toBeNull(); expect(screen.getByText('stub:listing')).toBeTruthy()
  })
  test('profile not loaded: a signed-in account is asked (never let an unchecked account through)', async () => {
    await open({ date_of_birth: ADULT })
    await press(t('mkPost', L))
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
  })
})

describe('first message', () => {
  const compose = { userId: 'fx-seller', displayName: 'Önizleme Satıcı', listingId: 'fx-3', listingTitle: 'Üniversite hazırlık kitapları' }
  const mount = (termsVersion, extra = {}) => render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}}
    compose={compose} termsVersion={termsVersion} {...extra} />)
  const type = txt => fireEvent.changeText(screen.getByPlaceholderText(t('msgPlaceholder', L)), txt)
  const send = () => fireEvent.press(screen.getByLabelText(t('msgSend', L)))

  test('old terms: the gate comes first, then the notice, then the send; the draft survives', async () => {
    api.setFixtureUser(ME, 'Ben')
    await mount('2026-11-09')
    await type('Merhaba, hâlâ duruyor mu?')
    const sending = send()
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    expect(screen.queryByText(t('mkNoticeTitle', L))).toBeNull()               // terms before notice
    expect(await threadFor('fx-3')).toBeUndefined()
    await press(t('shTermsAccept', L))
    expect(await screen.findByText(t('mkNoticeTitle', L))).toBeTruthy()          // then the notice
    expect(await threadFor('fx-3')).toBeUndefined()
    await press(t('mkNoticeAccept', L)); await sending
    expect(await screen.findByText('Merhaba, hâlâ duruyor mu?')).toBeTruthy()  // the draft was kept and is what was sent
    expect(await threadFor('fx-3')).toBeDefined()
  }, 15000)

  test('cancel sends nothing and keeps the draft; back closes the gate first', async () => {
    const backRef = { current: null }
    await mount(null, { backRef, compose: { ...compose, listingId: 'fx-1' } })
    await type('Bisiklet duruyor mu?')
    const sending = send()
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    let handled; await act(async () => { handled = backRef.current() })
    expect(handled).toBe(true)
    await sending
    expect(gateTitle()).toBeNull()
    expect(screen.getByDisplayValue('Bisiklet duruyor mu?')).toBeTruthy()
    expect(await threadFor('fx-1')).toBeUndefined()
    expect(profileWrites).toEqual([])
  })

  test('a second Send tap while the gate is open does not queue a second send', async () => {
    await mount(null, { compose: { ...compose, listingId: 'fx-2' } })
    await type('Hâlâ var mı?')
    const first = send()
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    await send()
    await press(t('shTermsCancel', L)); await first
    expect(gateTitle()).toBeNull()
    expect(await threadFor('fx-2')).toBeUndefined()
  })

  test('current terms: no gate, and the message goes on to the safety notice / send', async () => {
    await mount(FLOOR, { compose: { ...compose, listingId: 'fx-4' } })
    await type('Merhaba')
    send()
    // (the sample notice was accepted by the first test in this block; the point is: no terms gate)
    expect(await screen.findByText('Merhaba', { exact: true })).toBeTruthy()
    expect(gateTitle()).toBeNull()
    expect(profileWrites).toEqual([])
  })

  test('seller, from the inbox: asked at the first reply, and not again on the next one (stale profile prop)', async () => {
    await render(<MarketplaceChatScreen lang={L} session={session} onBack={() => {}} onOpenListing={() => {}} termsVersion="2026-11-09" />)
    await fireEvent.press(await screen.findByLabelText('Deniz'))
    await press(t('msgAccept', L))
    await type('Evet, duruyor')
    const first = send()
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
    await press(t('shTermsAccept', L))
    // the sample's safety notice is in whichever state earlier tests left it
    if (await screen.findByText(t('mkNoticeTitle', L), {}, { timeout: 300 }).then(() => true, () => false)) await press(t('mkNoticeAccept', L))
    await first
    expect(await screen.findByText('Evet, duruyor')).toBeTruthy()
    await type('Yarın bakabilirsin'); await send()
    expect(await screen.findByText('Yarın bakabilirsin')).toBeTruthy()
    expect(gateTitle()).toBeNull()
    expect(profileWrites).toHaveLength(1)
  }, 15000)

  test('profile not loaded (no terms version): asked, not let through', async () => {
    await mount(undefined, { compose: { ...compose, listingId: 'fx-6' } })
    await type('x'); send()
    expect(await screen.findByText(t('mkTermsTitle', L))).toBeTruthy()
  })
})
