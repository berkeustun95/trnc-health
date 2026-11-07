// Ask Oli render test: every answer kind, in all 9 languages, renders with its words and button and WITHOUT the
// error boundary firing; and a saved history holding one answer of every kind reloads into the sheet.
// The production crash of 2026-11-07 (d82ac6e8: a route answer read a.types.map of undefined) fails here.
//   npm run test:oli   (runs before every `npm run ota` and `npm run ota:preview`)
import { render, screen, act } from '@testing-library/react-native'
import OliChatSheet, { OliAnswer, OliErrorBoundary, TEXT_KEY } from '../components/OliChatSheet'
import { t, LANGUAGES } from '../constants/i18n'
import { getIntent } from '../constants/oliIntents'
import { loadOliHistory } from '../utils/oliHistory'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: {} }))
jest.mock('../utils/oliAnswers', () => ({ oliProvider: { answer: jest.fn() } }))
jest.mock('../utils/oliHistory', () => ({
  loadOliHistory: jest.fn(), saveOliMessage: jest.fn(async () => null), deleteOliHistory: jest.fn(async () => null),
}))
jest.mock('../components/OliMic', () => ({
  useVoiceInput: () => ({ available: false, listening: false, toggle: () => {}, abort: () => {} }),
  MicButton: () => null,
}))

const DAY = '2026-11-07'
const item = (title, a) => ({ t: title, s: 'sub', a })
// One payload per answer kind (TEXT_KEY + 'route'), with what it must show: text key (or a function of lang), an
// item title and the button's titleKey. A new kind in TEXT_KEY without a case here fails the coverage check below.
const CASES = {
  pharmacy:     { payload: { v: 1, kind: 'pharmacy', intent: 'pharmacy', items: [item('Ph One', { nav: 'pharmacy' })], day: DAY },
                  textKey: 'oliChatPharmacy', itemTitle: 'Ph One', buttonKey: 'dutyPharmacies' },
  events:       { payload: { v: 1, kind: 'events', intent: 'events', items: [item('Ev One', { event: 12 })], day: DAY },
                  textKey: 'oliChatEvents', itemTitle: 'Ev One', buttonKey: 'menuEvents' },
  eatery:       { payload: { v: 1, kind: 'eatery', intent: 'eatery', items: [item('Eat One', { nav: 'eatery' })], day: DAY },
                  textKey: 'oliChatEatery', itemTitle: 'Eat One', buttonKey: 'menuEatery' },
  nearby:       { payload: { v: 1, kind: 'nearby', intent: 'nearby', items: [item('Near One', { result: { module: 'beach', id: 1 } })], day: DAY },
                  textKey: 'oliChatNearby', itemTitle: 'Near One', buttonKey: 'menuExplore' },
  needLocation: { payload: { v: 1, kind: 'needLocation', intent: 'nearby', items: [], day: DAY },
                  textKey: 'oliChatNeedLocation', buttonKey: 'menuExplore' },
  search:       { payload: { v: 1, kind: 'search', intent: null, items: [item('Found One', { result: { module: 'medical', id: 3 } })], day: DAY },
                  textKey: 'oliChatSearch', itemTitle: 'Found One' },
  noMatch:      { payload: { v: 1, kind: 'noMatch', intent: null, items: [], day: DAY }, textKey: 'oliChatNoMatch' },
  error:        { payload: { v: 1, kind: 'error', intent: null, items: [], day: DAY }, textKey: 'oliChatError' },
  route:        { payload: { v: 1, kind: 'route', intent: 'beaches', items: [], day: DAY },
                  textKey: getIntent('beaches').msgKey, buttonKey: 'menuBeachesLandmarks' },
}
// Answers that are not "normal": each must still render, as the matching words or the honest no-match.
const ODD = {
  'route, emergency':           [{ v: 1, kind: 'route', intent: 'emergency', items: [], day: DAY }, getIntent('emergency').msgKey],
  'route, unknown intent':      [{ v: 1, kind: 'route', intent: 'gone', items: [], day: DAY }, 'oliChatNoMatch'],
  'unknown kind':               [{ v: 9, kind: 'poem', intent: null, items: [], day: DAY }, 'oliChatNoMatch'],
  'nearby, typed':              [{ v: 1, kind: 'nearby', intent: 'nearby', items: [item('Beach', null)], types: ['beach'], day: DAY },
                                 lang => t('oliChatNearbyType', lang).replace('{types}', t('blFilterBeaches', lang))],
  'nearby, typed, none':        [{ v: 1, kind: 'nearby', intent: 'nearby', items: [], types: ['cafe'], day: DAY },
                                 lang => t('oliChatNearbyTypeNone', lang).replace('{types}', t('exploreCatCafe', lang))],
  'nearby, bogus types':        [{ v: 1, kind: 'nearby', intent: 'nearby', items: [], types: ['<b>', 7, null], day: DAY }, 'oliChatNearbyNone'],
  'nearby, types not an array': [{ v: 1, kind: 'nearby', intent: 'nearby', items: [], types: 'beach', day: DAY }, 'oliChatNearbyNone'],
  'items not an array':         [{ v: 1, kind: 'events', intent: 'events', items: 'x', day: DAY }, 'oliChatEventsNone'],
  'items with junk':            [{ v: 1, kind: 'events', intent: 'events', items: [null, 4, { t: 5 }, { t: 'Ok', a: { url: 'http://x' } }], day: DAY }, 'oliChatEvents'],
  'null payload':               [null, 'oliChatNoMatch'],
  'string payload':             ['hello', 'oliChatNoMatch'],
}

const words = (key, lang) => (typeof key === 'function' ? key(lang) : t(key, lang))
let warn
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  // The boundary logs 'Oli render error' when it catches: a pass with the fallback showing is still a failure.
  expect(warn.mock.calls.filter(c => String(c[0]).includes('Oli render error'))).toEqual([])
  warn.mockRestore()
})

test('every answer kind has a case', () => {
  expect(Object.keys(CASES).sort()).toEqual([...Object.keys(TEXT_KEY), 'route'].sort())
})

describe.each(LANGUAGES.map(l => l.key))('%s', lang => {
  test.each(Object.keys(CASES))('%s renders', async kind => {
    const c = CASES[kind]
    await render(<OliErrorBoundary fallback={null}><OliAnswer payload={c.payload} lang={lang} onAction={() => {}} /></OliErrorBoundary>)
    expect(screen.getByText(words(c.textKey, lang))).toBeTruthy()
    if (c.itemTitle) expect(screen.getByText(c.itemTitle)).toBeTruthy()
    if (c.buttonKey) expect(screen.getByText(t(c.buttonKey, lang))).toBeTruthy()
  })

  test.each(Object.keys(ODD))('%s renders', async name => {
    const [payload, key] = ODD[name]
    await render(<OliErrorBoundary fallback={null}><OliAnswer payload={payload} lang={lang} onAction={() => {}} /></OliErrorBoundary>)
    expect(screen.getByText(words(key, lang))).toBeTruthy()
  })
})

// One saved question + answer per kind (a long history would only render the list's first window).
const HISTORY = [
  ...Object.entries(CASES).map(([kind, c]) => [kind, c.payload, c.textKey]),
  ...Object.entries(ODD).map(([name, [payload, key]]) => [name, payload, key]),
]
test.each(HISTORY)('saved history reloads: %s', async (name, payload, key) => {
  loadOliHistory.mockResolvedValueOnce({ rows: [
    { id: 'u1', role: 'user', body: `question ${name}`, payload: null, created_at: '2026-11-07T09:00:00Z' },
    { id: 'o1', role: 'oli', body: null, payload, created_at: '2026-11-07T09:00:01Z' },
  ], error: null })
  const openRef = { current: null }
  await render(<OliChatSheet lang="Turkish" userId="u-1" isGuest={false} openRef={openRef} closeRef={{ current: null }}
    onNavigate={() => {}} onOpenResult={() => {}} onOpenEvent={() => {}} onOpenChange={() => {}} />)
  await act(async () => { openRef.current() })
  expect(await screen.findByText(`question ${name}`)).toBeTruthy()
  expect(screen.getByText(words(key, 'Turkish'))).toBeTruthy()
})
