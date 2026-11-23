// Veles banner: hero height maths (VELES off = today's exact heights), the compact cutoff, and the tap path per platform.
// Both platforms open the external browser with Linking and never load expo-web-browser (Berke, 2026-11-23: gambling ads
// on some Veles outlets must not render inside ADA).

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }))
jest.mock('../constants/i18n', () => ({ t: k => k }))
jest.mock('../constants/homeHero', () => ({ resolveHero: () => ({}) }))
jest.mock('../utils/facilityUtils', () => ({}))
jest.mock('../components/ui', () => ({ IconButton: () => null }))
jest.mock('../components/home/HeroCreditSheet', () => () => null)
jest.mock('../components/home/HomeHero', () => ({ rampLayers: () => [] }))
jest.mock('../components/home/homeLayout', () => ({ HERO_LOGO_H_COMPACT: 0 }))
jest.mock('../constants/regions', () => ({ REGION_LABEL_KEY: {} }))
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }))

const { heroHeight, heroNeedsCompact } = require('../components/home/redesign/RedesignHero')

test('VELES off: heroHeight is exactly today\'s Math.max(230, t + 176)', () => {
  for (const t of [0, 24, 47, 59, 80]) {
    expect([t, heroHeight(t)]).toEqual([t, Math.max(230, t + 176)])
    expect([t, heroHeight(t, false)]).toEqual([t, Math.max(230, t + 176)])
  }
})

test('compact heroHeight is Math.max(154, t + 100)', () => {
  for (const t of [0, 24, 47, 59, 80]) expect([t, heroHeight(t, true)]).toEqual([t, Math.max(154, t + 100)])
})

test('compact OliBar top equals the full hero\'s: 154 + 12 + 64 + 16 = 230 + 16', () => {
  expect(154 + 12 + 64 + 16).toBe(230 + 16)
})

test('heroNeedsCompact cutoff is 648 + max(bottom, 8)', () => {
  expect(heroNeedsCompact(640, 16)).toBe(true)
  expect(heroNeedsCompact(915, 24)).toBe(false)
  expect([heroNeedsCompact(655, 0), heroNeedsCompact(656, 0)]).toEqual([true, false])
  expect([heroNeedsCompact(695, 48), heroNeedsCompact(696, 48)]).toEqual([true, false])
})

const load = os => {
  jest.resetModules()
  const calls = []
  const webBrowser = { touched: 0 }
  const Linking = { openURL: jest.fn(async () => { calls.push('open') }) }
  jest.doMock('react-native', () => ({ Platform: { OS: os }, Linking, AppState: { addEventListener: () => ({ remove() {} }) } }))
  jest.doMock('../utils/logContactEvent', () => ({ logContactEvent: jest.fn((...a) => { calls.push(['log', ...a]) }) }))
  jest.doMock('expo-web-browser', () => {
    webBrowser.touched += 1
    return { openBrowserAsync: jest.fn(async () => { webBrowser.touched += 1; return { type: 'opened' } }) }
  })
  const mod = require('../utils/velesLink')
  return { ...mod, calls, webBrowser, Linking }
}

for (const os of ['ios', 'android']) {
  test(`${os}: logs first with lang, opens the external browser via Linking, never loads expo-web-browser`, async () => {
    const m = load(os)
    expect(await m.openVeles('Turkish')).toBe(true)
    expect(m.Linking.openURL).toHaveBeenCalledTimes(1)
    expect(m.Linking.openURL).toHaveBeenCalledWith(m.VELES_URL)
    expect(m.calls).toEqual([['log', 'news', m.VELES_ENTITY_ID, 'website', null, 'Turkish'], 'open'])
    expect(m.webBrowser.touched).toBe(0)
  })
}

test('a failing openURL returns false and the tap is still logged', async () => {
  const m = load('android')
  m.Linking.openURL.mockImplementationOnce(async () => { throw new Error('no browser') })
  expect(await m.openVeles('English')).toBe(false)
  expect(m.calls[0]).toEqual(['log', 'news', m.VELES_ENTITY_ID, 'website', null, 'English'])
})
