// House banner, the parts around AdSlot: fetchAdForSlot's three answers, the counters, the URL by language,
// the Settings row, and the Events empty-feed gate.
import { render, screen, fireEvent } from '@testing-library/react-native'
import { t, LANGUAGES } from '../constants/i18n'
import { AD_HOUSE_URL_TR, AD_HOUSE_URL_EN, AD_HOUSE_PLACEMENTS, feedAdsAllowed } from '../constants/ads'

let mockResult = { data: [], error: null }
const mockRpc = jest.fn()
jest.mock('../lib/supabase', () => {
  const q = {}
  for (const m of ['select', 'eq', 'lte', 'gte', 'order']) q[m] = () => q
  q.limit = () => Promise.resolve(mockResult)
  return { supabase: { from: jest.fn(() => q), rpc: (...a) => mockRpc(...a) } }
})
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }))
jest.mock('../utils/previewTools', () => ({ CAN_RESET_ONBOARDING: false }))
jest.mock('../components/ui/FloatingTabBar', () => ({ FADE_H: 0 }))
jest.mock('../components/ui', () => {
  const React = require('react')
  const { Text } = require('react-native')
  return {
    ListRow: ({ title, onPress }) => React.createElement(Text, { onPress }, title),
    Button: () => null, CategoryIcon: () => null, PageCanvas: ({ children }) => children, useTabBarFootprint: () => 0,
  }
})

const row = { id: 'a1', image_url: 'https://x.test/a.png', link_url: 'https://x.test', route: null }

describe('fetchAdForSlot: exactly one of three answers', () => {
  const { fetchAdForSlot } = require('../utils/adBanner')
  test('sold and renderable -> { row }', async () => {
    mockResult = { data: [row], error: null }
    expect(await fetchAdForSlot('list_bottom', 'home')).toEqual({ row })
  })
  test('zero rows -> { row: null }', async () => {
    mockResult = { data: [], error: null }
    expect(await fetchAdForSlot('list_bottom', 'home')).toEqual({ row: null })
  })
  test.each([
    ['error', { data: null, error: { code: 'XX000', message: 'x' } }],
    ['42P01', { data: null, error: { code: '42P01', message: 'x' } }],
    ['PGRST205', { data: null, error: { code: 'PGRST205', message: 'x' } }],
    ['unrenderable row', { data: [{ ...row, image_url: 'http://x.test/a.png' }], error: null }],
  ])('%s -> { failed: true }', async (_n, result) => {
    mockResult = result
    expect(await fetchAdForSlot('list_bottom', 'home')).toEqual({ failed: true })
  })
  test('unknown placement, missing half, and a throw -> { failed: true }', async () => {
    expect(await fetchAdForSlot('nope', 'home')).toEqual({ failed: true })
    expect(await fetchAdForSlot('list_top', undefined)).toEqual({ failed: true })
    const { supabase } = require('../lib/supabase')
    supabase.from.mockImplementationOnce(() => { throw new Error('offline') })
    expect(await fetchAdForSlot('list_top', 'events')).toEqual({ failed: true })
  })
})

describe('house counters', () => {
  function logger() {
    let m
    jest.isolateModules(() => { m = require('../utils/logAdEvent') })
    return m
  }
  const ok = () => { const q = { abortSignal: () => q, then: (f, g) => Promise.resolve({ error: null }).then(f, g) }; return q }
  beforeEach(() => { mockRpc.mockReset(); mockRpc.mockImplementation(ok) })

  test('a view is counted once per position/module per process; a tap every time', () => {
    const { logHouseView, logHouseTap } = logger()
    logHouseView('list_bottom', 'home'); logHouseView('list_bottom', 'home'); logHouseView('list_top', 'events')
    logHouseTap('list_bottom', 'home'); logHouseTap('list_bottom', 'home')
    expect(mockRpc.mock.calls).toEqual([
      ['bump_house_ad_counter', { p_position: 'list_bottom', p_module: 'home', p_kind: 'view' }],
      ['bump_house_ad_counter', { p_position: 'list_top', p_module: 'events', p_kind: 'view' }],
      ['bump_house_ad_counter', { p_position: 'list_bottom', p_module: 'home', p_kind: 'tap' }],
      ['bump_house_ad_counter', { p_position: 'list_bottom', p_module: 'home', p_kind: 'tap' }],
    ])
  })
  test('a missing RPC (PGRST202 / 42883 / 404) is silent, even in __DEV__; other errors still warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { logHouseTap } = logger()
    for (const res of [{ error: { code: 'PGRST202', message: 'x' } }, { error: { code: '42883', message: 'x' } }, { error: { message: 'x' }, status: 404 }]) {
      mockRpc.mockImplementationOnce(() => { const q = { abortSignal: () => q, then: f => Promise.resolve(res).then(f) }; return q })
      logHouseTap('list_bottom', 'home')
    }
    await new Promise(r => setTimeout(r, 0))
    expect(warn).not.toHaveBeenCalled()
    mockRpc.mockImplementationOnce(() => { const q = { abortSignal: () => q, then: f => Promise.resolve({ error: { code: 'XX000', message: 'boom' } }).then(f) }; return q })
    logHouseTap('list_bottom', 'home')
    await new Promise(r => setTimeout(r, 0))
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  test('never throws, even when the client throws', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockRpc.mockImplementation(() => { throw new Error('no client') })
    const { logHouseView, logHouseTap } = logger()
    expect(() => { logHouseView('list_top', 'events'); logHouseTap('list_top', 'events') }).not.toThrow()
    console.warn.mockRestore()
  })
})

describe('workWithAdaUrl', () => {
  const { workWithAdaUrl } = require('../utils/workWithAda')
  test('Turkish -> TR page', () => expect(workWithAdaUrl('Turkish')).toBe(AD_HOUSE_URL_TR))
  test.each(LANGUAGES.map(l => l.key).filter(k => k !== 'Turkish'))('%s -> EN page', lang => {
    expect(workWithAdaUrl(lang)).toBe(AD_HOUSE_URL_EN)
  })
  test('an ISO code is not a language name', () => expect(workWithAdaUrl('tr')).toBe(AD_HOUSE_URL_EN))
  test('the two URLs are what the brief says', () => {
    expect([AD_HOUSE_URL_TR, AD_HOUSE_URL_EN]).toEqual(['https://getadaapp.com/tr/ada-ile-calisin', 'https://getadaapp.com/en/work-with-ada'])
  })
  test('house placements are exactly the two list slots', () => {
    expect(AD_HOUSE_PLACEMENTS).toEqual(['list_bottom/home', 'list_top/events'])
  })
})

describe('Settings: Work with ADA is the last row of Destek', () => {
  const { SettingsGroups } = require('../components/shell/Settings')
  test('present, after the tour row, before Legal, and calls onWorkWithAda', async () => {
    const a = { onWorkWithAda: jest.fn(), onTutorial: jest.fn() }
    await render(<SettingsGroups lang="Turkish" a={a} />)
    const flat = JSON.stringify(screen.toJSON())
    const at = k => flat.indexOf(t(k, 'Turkish'))
    expect(at('hrRowTutorial')).toBeGreaterThan(-1)
    expect(at('hrRowWorkWithAda')).toBeGreaterThan(at('hrRowTutorial'))
    expect(at('hrSetLegal')).toBeGreaterThan(at('hrRowWorkWithAda'))
    await fireEvent.press(screen.getByText('ADA ile çalışın'))
    expect(a.onWorkWithAda).toHaveBeenCalledTimes(1)
    expect(a.onTutorial).not.toHaveBeenCalled()
  })
  test('absent when WORK_WITH_ADA_ROW is off (production until Berke clears it)', async () => {
    const React = require('react')
    const RN = require('react-native')
    let Groups
    jest.isolateModules(() => {
      jest.doMock('react', () => React)
      jest.doMock('react-native', () => RN)
      jest.doMock('../constants/redesign', () => ({ WORK_WITH_ADA_ROW: false }))
      Groups = require('../components/shell/Settings').SettingsGroups
    })
    await render(<Groups lang="Turkish" a={{ onWorkWithAda: jest.fn() }} />)
    expect(screen.queryByText('ADA ile çalışın')).toBeNull()
    expect(screen.getByText(t('hrRowTutorial', 'Turkish'))).toBeTruthy()
  })
})

describe('visibility share', () => {
  const { shareOnScreen, HOUSE_VISIBLE_SHARE } = require('../utils/adVisibility')
  test.each([
    ['fully on screen', 300, 100, 1],
    ['below the fold', 900, 100, 0],
    ['half under the tab bar', 650, 100, 0.5],
    ['scrolled off the top', -100, 100, 0],
    ['half off the top', -50, 100, 0.5],
    ['zero height', 300, 0, 0],
  ])('%s', (_n, y, h, want) => expect(shareOnScreen(y, h, 800, 100)).toBeCloseTo(want))
  test('threshold is half', () => expect(HOUSE_VISIBLE_SHARE).toBe(0.5))
})

describe('Events: no ad over an empty feed', () => {
  // EventsScreen (a very large screen) is not rendered here; its top slot reads feedAdsAllowed(filtered.length), pinned below.
  test('the gate', () => {
    expect(feedAdsAllowed(0)).toBe(false)
    expect(feedAdsAllowed(1)).toBe(true)
    expect(feedAdsAllowed(27)).toBe(true)
  })
  test('EventsScreen gates the top slot on it, so an empty feed mounts no house banner', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../screens/EventsScreen.js'), 'utf8')
    expect(src).toMatch(/const topSlot = feedAdsAllowed\(filtered\.length\)\s*\n\s*\? ./)
  })
})
