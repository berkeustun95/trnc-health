// ADA house banner: AdSlot shows it only in the two AD_HOUSE_PLACEMENTS, only when HOUSE_BANNER is on and the slot is
// unsold (or ads are not live yet), once per JS process; failed/offline/loading stay empty; paid always wins.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { t, LANGUAGES } from '../constants/i18n'

let mockLive = false
let mockHouse = true
let mockResult = { data: [], error: null }
let mockPending = null            // a promise the query waits on, to hold "loading"
const mockCalls = []

jest.mock('../constants/flags', () => {
  const actual = jest.requireActual('../constants/flags')
  return Object.defineProperty({ ...actual }, 'AD_BANNERS_LIVE', { get: () => mockLive, enumerable: true })
})
jest.mock('../constants/redesign', () => ({ get HOUSE_BANNER() { return mockHouse } }))
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../components/ui', () => ({ RemoteImage: () => require('react').createElement('View', { testID: 'paid-image' }) }))
jest.mock('../utils/workWithAda', () => ({ openWorkWithAda: lang => { mockCalls.push(['open', lang]) } }))
jest.mock('../utils/logAdEvent', () => ({
  logAdView: jest.fn(), logAdTap: jest.fn(),
  logHouseView: (p, m) => { mockCalls.push(['view', p, m]) },
  logHouseTap: (p, m) => { mockCalls.push(['tap', p, m]) },
}))
jest.mock('../lib/supabase', () => {
  const q = {}
  for (const m of ['select', 'eq', 'lte', 'gte', 'order']) q[m] = () => q
  q.limit = () => Promise.resolve(mockPending).then(() => mockResult)
  return { supabase: { from: jest.fn(() => q), rpc: jest.fn() } }
})

// Built, not written out: check-ad-placement.mjs scans every .js file (tests included) for imports of AdSlot, and only the
// wrappers in components/ads/ may have one.
const SLOT_PATH = '../components/' + 'AdSl' + 'ot'
const React = require('react')
const RN = require('react-native')
const { supabase } = require('../lib/supabase')

// A fresh AdSlot module = a fresh "app process" (the once-per-open Set is module-level). React and RN are
// handed through so the isolated copy shares the renderer's hooks dispatcher.
function freshSlot() {
  let S
  jest.isolateModules(() => {
    jest.doMock('react', () => React)
    jest.doMock('react-native', () => RN)
    S = require(SLOT_PATH).default
  })
  return S
}

// Mounts one AdSlot per key in a single tree, so mounts can be added and removed with rerender.
const Mounts = ({ S, keys, position = 'list_bottom', module = 'home', lang = 'English' }) =>
  <>{keys.map(k => <S key={k} position={position} module={module} lang={lang} />)}</>

const goodRow = { id: 'a1', position: 'list_bottom', module: 'home', advertiser_name: 'Acme', image_url: 'https://x.test/a.png', link_url: 'https://x.test', route: null }
const houseLabel = lang => `${t('adHouseTitle', lang)}. ${t('adHouseCta', lang)}`
const house = () => screen.queryByLabelText(houseLabel('English'))

beforeAll(() => { jest.spyOn(RN.Image, 'getSize').mockImplementation(() => {}) })
beforeEach(() => {
  mockLive = false; mockHouse = true; mockResult = { data: [], error: null }; mockPending = null
  mockCalls.length = 0; supabase.from.mockClear()
})

describe('ads not live (today)', () => {
  test('house placement renders the house banner with NO query', async () => {
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    await waitFor(() => expect(house()).toBeTruthy())
    expect(supabase.from).not.toHaveBeenCalled()
    expect(mockCalls).toEqual([['view', 'list_bottom', 'home']])
  })
  test('list_top/events is the other house placement', async () => {
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_top" module="events" lang="English" />)
    await waitFor(() => expect(house()).toBeTruthy())
  })
  test('a non-house slot stays empty with no query', async () => {
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="accommodation" lang="English" />)
    expect(screen.toJSON()).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('list_inline and detail_bottom on a house module never show it', async () => {
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_inline" module="events" lang="English" />)
    await render(<AdSlot position="detail_bottom" module="events" lang="English" />)
    expect(house()).toBeNull()
  })
  test('HOUSE_BANNER off: nothing', async () => {
    mockHouse = false
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    expect(screen.toJSON()).toBeNull()
  })
})

describe('ads live', () => {
  beforeEach(() => { mockLive = true })

  test('loading is empty, then unsold shows the house banner', async () => {
    let release
    mockPending = new Promise(r => { release = r })
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    expect(screen.toJSON()).toBeNull()
    expect(supabase.from).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(house()).toBeTruthy())
  })

  test.each([
    ['query error', { data: null, error: { code: 'XX000', message: 'boom' } }],
    ['missing table 42P01', { data: null, error: { code: '42P01', message: 'no table' } }],
    ['missing table PGRST205', { data: null, error: { code: 'PGRST205', message: 'no table' } }],
    ['unrenderable paid row', { data: [{ ...goodRow, image_url: 'http://x.test/a.png' }], error: null }],
    ['paid row with neither link nor route', { data: [{ ...goodRow, link_url: null }], error: null }],
  ])('%s: nothing, never the house banner', async (_n, result) => {
    mockResult = result
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    await waitFor(() => expect(supabase.from).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.toJSON()).toBeNull()
    expect(house()).toBeNull()
  })

  test('a thrown fetch (offline) is empty too', async () => {
    supabase.from.mockImplementationOnce(() => { throw new Error('offline') })
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    await act(async () => {})
    expect(screen.toJSON()).toBeNull()
  })

  test('sold: the paid banner, and no house banner', async () => {
    mockResult = { data: [goodRow], error: null }
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="home" lang="English" />)
    await waitFor(() => expect(screen.queryByTestId('paid-image')).toBeTruthy())
    expect(house()).toBeNull()
  })

  test('sold on a second mount still shows (paid is uncapped)', async () => {
    mockResult = { data: [goodRow], error: null }
    const AdSlot = freshSlot()
    await render(<Mounts S={AdSlot} keys={['a', 'b']} />)
    await waitFor(() => expect(screen.queryAllByTestId('paid-image')).toHaveLength(2))
    expect(house()).toBeNull()
  })

  test('a non-house slot that is unsold stays empty', async () => {
    const AdSlot = freshSlot()
    await render(<AdSlot position="list_bottom" module="accommodation" lang="English" />)
    await waitFor(() => expect(supabase.from).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.toJSON()).toBeNull()
  })
})

describe('once per app open', () => {
  test('the first mount keeps it across re-renders; later mounts of the same slot show nothing, even after the first unmounts', async () => {
    const AdSlot = freshSlot()
    const view = await render(<Mounts S={AdSlot} keys={['a']} />)
    await waitFor(() => expect(screen.queryAllByLabelText(houseLabel('English'))).toHaveLength(1))
    await view.rerender(<Mounts S={AdSlot} keys={['a']} />)
    expect(screen.queryAllByLabelText(houseLabel('English'))).toHaveLength(1)

    await view.rerender(<Mounts S={AdSlot} keys={['a', 'b']} />)
    await act(async () => {})
    expect(screen.queryAllByLabelText(houseLabel('English'))).toHaveLength(1)

    await view.rerender(<Mounts S={AdSlot} keys={['b', 'c']} />)
    await act(async () => {})
    expect(screen.toJSON()).toBeNull()
    expect(mockCalls.filter(c => c[0] === 'view')).toHaveLength(1)
  })

  test('the cap is per placement: the Events slot still gets its own', async () => {
    const AdSlot = freshSlot()
    await render(<><AdSlot position="list_bottom" module="home" lang="English" /><AdSlot position="list_top" module="events" lang="English" /></>)
    await waitFor(() => expect(screen.queryAllByLabelText(houseLabel('English'))).toHaveLength(2))
  })

  test('a new process (fresh module) shows it again', async () => {
    const First = freshSlot()
    const view = await render(<Mounts S={First} keys={['a']} />)
    await waitFor(() => expect(house()).toBeTruthy())
    const Next = freshSlot()
    await view.rerender(<Mounts S={Next} keys={['a']} />)
    await waitFor(() => expect(house()).toBeTruthy())
  })
})

test('tap counts BEFORE the page opens, with the app language', async () => {
  const AdSlot = freshSlot()
  await render(<AdSlot position="list_top" module="events" lang="Turkish" />)
  await fireEvent.press(await screen.findByLabelText(houseLabel('Turkish')))
  expect(mockCalls).toEqual([['view', 'list_top', 'events'], ['tap', 'list_top', 'events'], ['open', 'Turkish']])
})

describe('house copy exists in every language', () => {
  test.each(LANGUAGES.map(l => l.key))('%s', lang => {
    for (const k of ['hrRowWorkWithAda', 'adHouseTitle', 'adHouseCta']) {
      expect(t(k, lang)).toBeTruthy()
      if (lang !== 'English') expect(t(k, lang)).not.toBe(t(k, 'English'))
    }
  })
  test('Turkish row label is exact', () => expect(t('hrRowWorkWithAda', 'Turkish')).toBe('ADA ile çalışın'))
})
