// Ask Oli render test: every answer kind, in all 9 languages, renders with its words and button and WITHOUT the
// error boundary firing; and a saved history holding one answer of every kind reloads into the sheet.
// The production crash of 2026-11-07 (d82ac6e8: a route answer read a.types.map of undefined) fails here.
//   npm run test:oli   (runs before every `npm run ota` and `npm run ota:preview`)
import { render, screen, act, fireEvent } from '@testing-library/react-native'
import OliChatSheet, { OliAnswer, OliErrorBoundary, TEXT_KEY, SEND_TIMEOUT_MS, SAVE_RETRY_MS } from '../components/OliChatSheet'
import { t, LANGUAGES } from '../constants/i18n'
import { getIntent } from '../constants/oliIntents'
import { loadOliHistory, saveOliMessage } from '../utils/oliHistory'
import { oliProvider } from '../utils/oliAnswers'

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
jest.mock('../lib/supabase', () => ({ supabase: {} }))
jest.mock('../utils/oliAnswers', () => ({ oliProvider: { answer: jest.fn() } }))
jest.mock('../utils/oliHistory', () => ({
  loadOliHistory: jest.fn(), saveOliMessage: jest.fn(async () => null), deleteOliHistory: jest.fn(async () => null),
  saveRefused: err => err?.code === 'P0001',
}))
jest.mock('../components/OliMic', () => ({
  useVoiceInput: () => ({ available: false, listening: false, toggle: () => {}, abort: () => {} }),
  MicButton: () => null,
}))

// The sheet scrolls to the newest message on a timer; React Native's list throws if that fires after a test has
// unmounted it. Scrolling is not what these tests check.
jest.spyOn(require('react-native').FlatList.prototype, 'scrollToEnd').mockImplementation(() => {})

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
  soon:         { payload: { v: 1, kind: 'soon', intent: 'jobs', items: [], day: DAY }, textKey: 'oliChatSoon' },
  route:        { payload: { v: 1, kind: 'route', intent: 'beaches', items: [], day: DAY },
                  textKey: getIntent('beaches').msgKey, buttonKey: 'menuBeachesLandmarks' },
}
// Answers that are not "normal": each must still render, as the matching words or the honest no-match.
const ODD = {
  'route, emergency':           [{ v: 1, kind: 'route', intent: 'emergency', items: [], day: DAY }, getIntent('emergency').msgKey],
  'route, guide card':          [{ v: 1, kind: 'route', intent: 'borders', items: [], day: DAY }, 'oliChatRouteSection'],
  'route, module':              [{ v: 1, kind: 'route', intent: 'esim', items: [], day: DAY }, 'oliChatRouteSection'],
  'soon, unknown intent':       [{ v: 1, kind: 'soon', intent: 'gone', items: [], day: DAY }, 'oliChatSoon'],
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

// ─── Abuse: the real sheet, the answer engine and the store mocked ───────────────────────────────────────────
// History integrity (bug 1, 2026-11-08): one send at a time, nothing sent while history loads, the question stored
// before the reply and the reply only with its question. Offline, slow network, killing the app mid-send and the
// mic are checked on the device (vault build log), not here.
const ANSWER = { v: 1, kind: 'noMatch', intent: null, items: [], day: DAY }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function openSheet({ userId = 'u-1', isGuest = false, rows = [] } = {}) {
  loadOliHistory.mockResolvedValueOnce({ rows, error: null })
  const openRef = { current: null }
  await render(<OliChatSheet lang="English" userId={userId} isGuest={isGuest} openRef={openRef} closeRef={{ current: null }}
    onNavigate={() => {}} onOpenResult={() => {}} onOpenEvent={() => {}} onOpenChange={() => {}} />)
  await act(async () => { openRef.current() })
}
const input = () => screen.getByLabelText(t('oliChatPlaceholder', 'English'))
const sendBtn = () => screen.getByLabelText(t('oliChatSend', 'English'))
const roles = () => saveOliMessage.mock.calls.map(c => c[0].role)
// Taps in the same frame, without waiting for the handler (the answer is held open by a deferred). fireEvent waits
// for the handler, and two overlapping waits break the renderer for the tests after.
const EVT = { nativeEvent: {}, isDefaultPrevented: () => false, persist() {}, stopPropagation() {}, preventDefault() {} }
const tapNow = async (...els) => { await act(async () => { for (const el of els) el.props.onClick(EVT) }) }

describe('abuse', () => {
  beforeEach(() => {
    loadOliHistory.mockReset()
    saveOliMessage.mockReset().mockResolvedValue(null)
    oliProvider.answer.mockReset().mockResolvedValue(ANSWER)
  })

  test('double tap on send sends once', async () => {
    const d = deferred(); oliProvider.answer.mockReturnValueOnce(d.promise)
    await openSheet()
    await fireEvent.changeText(input(), 'where can i eat')
    await tapNow(sendBtn(), sendBtn())
    await act(async () => { d.resolve(ANSWER) })
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
    expect(roles()).toEqual(['user', 'oli'])
  })

  test('sending again while an answer is loading is ignored', async () => {
    const d = deferred(); oliProvider.answer.mockReturnValueOnce(d.promise)
    await openSheet()
    await fireEvent.changeText(input(), 'first')
    await tapNow(sendBtn())
    await fireEvent.changeText(input(), 'second')
    await act(async () => { input().props.onSubmitEditing({ nativeEvent: { text: 'second' } }) })
    await act(async () => { d.resolve(ANSWER) })
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
  })

  test('tapping chips fast sends one', async () => {
    const d = deferred(); oliProvider.answer.mockReturnValueOnce(d.promise)
    await openSheet()
    const chip = screen.getByRole('button', { name: t('oliChatChipEvents', 'English') })
    await tapNow(chip, chip, chip)
    await act(async () => { d.resolve(ANSWER) })
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
  })

  test('nothing is sent while saved history is still loading', async () => {
    const h = deferred(); loadOliHistory.mockReturnValueOnce(h.promise)
    const openRef = { current: null }
    await render(<OliChatSheet lang="English" userId="u-1" isGuest={false} openRef={openRef} closeRef={{ current: null }}
      onNavigate={() => {}} onOpenResult={() => {}} onOpenEvent={() => {}} onOpenChange={() => {}} />)
    await act(async () => { openRef.current() })
    await fireEvent.changeText(input(), 'oturum izni')
    await fireEvent(input(), 'submitEditing')
    expect(oliProvider.answer).not.toHaveBeenCalled()
    await act(async () => { h.resolve({ rows: [], error: null }) })
    await fireEvent(input(), 'submitEditing')
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('oturum izni')).toBeTruthy()
  })

  test('the question is stored before the reply', async () => {
    await openSheet()
    await fireEvent.changeText(input(), 'nöbetçi eczane')
    await fireEvent.press(sendBtn())
    expect(roles()).toEqual(['user', 'oli'])
    expect(saveOliMessage.mock.calls[0][0]).toEqual({ role: 'user', body: 'nöbetçi eczane' })
  })

  test('a reply is never stored without its question', async () => {
    saveOliMessage.mockImplementation(async row => (row.role === 'user' ? new Error('jwt expired') : null))
    await openSheet()
    await fireEvent.changeText(input(), 'oturum izni')
    await fireEvent.press(sendBtn())
    expect(roles()).toEqual(['user'])
    expect(screen.getByText(t('oliChatNotSaved', 'English'))).toBeTruthy()
    expect(screen.getByText(t('oliChatNoMatch', 'English'))).toBeTruthy()
  })

  test('an answer engine failure shows the error reply and stores no reply', async () => {
    oliProvider.answer.mockRejectedValueOnce(new Error('offline'))
    await openSheet()
    await fireEvent.changeText(input(), 'events')
    await fireEvent.press(sendBtn())
    expect(screen.getByText(t('oliChatError', 'English'))).toBeTruthy()
    expect(roles()).toEqual(['user'])
    await fireEvent.changeText(input(), 'events again')
    await fireEvent.press(sendBtn())
    expect(oliProvider.answer).toHaveBeenCalledTimes(2)
  })

  test('very long text is stored at 500 characters', async () => {
    await openSheet()
    await fireEvent.changeText(input(), 'a'.repeat(2000))
    await fireEvent.press(sendBtn())
    expect(saveOliMessage.mock.calls[0][0].body).toHaveLength(500)
  })

  test('emoji only gets a reply, no crash', async () => {
    await openSheet()
    await fireEvent.changeText(input(), '😀🙏🏽🇨🇾')
    await fireEvent.press(sendBtn())
    expect(oliProvider.answer).toHaveBeenCalledWith(expect.objectContaining({ text: '😀🙏🏽🇨🇾' }))
    expect(screen.getByText(t('oliChatNoMatch', 'English'))).toBeTruthy()
  })

  test('empty and spaces-only input never sends', async () => {
    await openSheet()
    for (const text of ['', '   ', '\n\t ']) {
      await fireEvent.changeText(input(), text)
      await fireEvent.press(sendBtn()); await fireEvent(input(), 'submitEditing')
    }
    expect(oliProvider.answer).not.toHaveBeenCalled()
    expect(saveOliMessage).not.toHaveBeenCalled()
  })

  test('a guest chat stores nothing', async () => {
    await openSheet({ userId: null, isGuest: true })
    await fireEvent.changeText(input(), 'where can i eat')
    await fireEvent.press(sendBtn())
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
    expect(saveOliMessage).not.toHaveBeenCalled()
  })

  test('a hung answer ends as the error reply and the chat answers again', async () => {
    jest.useFakeTimers()
    try {
      oliProvider.answer.mockReturnValueOnce(new Promise(() => {}))
      await openSheet()
      await fireEvent.changeText(input(), 'events')
      await tapNow(sendBtn())
      await act(async () => { jest.advanceTimersByTime(SEND_TIMEOUT_MS + 10) })
      expect(screen.getByText(t('oliChatError', 'English'))).toBeTruthy()
      expect(roles()).toEqual(['user'])
      await fireEvent.changeText(input(), 'events again')
      await fireEvent.press(sendBtn())
      expect(oliProvider.answer).toHaveBeenCalledTimes(2)
    } finally { jest.useRealTimers() }
  })

  const notSaved = () => screen.queryByText(t('oliChatNotSaved', 'English'))
  const tick = () => act(async () => { jest.advanceTimersByTime(SAVE_RETRY_MS + 10) })

  test('what could not be saved is saved once the connection is back, and the note goes', async () => {
    jest.useFakeTimers()
    try {
      let online = false
      saveOliMessage.mockImplementation(async () => (online ? null : new Error('Network request failed')))
      await openSheet()
      await fireEvent.changeText(input(), 'first')
      await fireEvent.press(sendBtn())
      await fireEvent.changeText(input(), 'second')
      await fireEvent.press(sendBtn())
      expect(notSaved()).toBeTruthy()
      await tick()
      expect(notSaved()).toBeTruthy()
      online = true
      saveOliMessage.mockClear()
      await tick()
      expect(notSaved()).toBeNull()
      expect(saveOliMessage.mock.calls.map(c => c[0].body ?? c[0].role)).toEqual(['first', 'oli', 'second', 'oli'])
      await tick()
      expect(saveOliMessage).toHaveBeenCalledTimes(4)
    } finally { jest.useRealTimers() }
  })

  test('a refused save is not sent again, and the note goes with the next saved question', async () => {
    jest.useFakeTimers()
    try {
      saveOliMessage.mockResolvedValueOnce(Object.assign(new Error('OLI_RATE_LIMIT'), { code: 'P0001' }))
        .mockResolvedValueOnce(Object.assign(new Error('OLI_RATE_LIMIT'), { code: 'P0001' }))
      await openSheet()
      await fireEvent.changeText(input(), 'first')
      await fireEvent.press(sendBtn())
      await tick()
      await tick()
      expect(saveOliMessage).toHaveBeenCalledTimes(2)
      expect(notSaved()).toBeTruthy()
      await fireEvent.changeText(input(), 'second')
      await fireEvent.press(sendBtn())
      expect(notSaved()).toBeNull()
      expect(saveOliMessage.mock.calls.slice(2).map(c => c[0].body ?? c[0].role)).toEqual(['second', 'oli'])
    } finally { jest.useRealTimers() }
  })

  test('a hung history load ends as an error and the chat stays usable', async () => {
    loadOliHistory.mockResolvedValueOnce({ rows: [], error: new Error('aborted') })
    const openRef = { current: null }
    await render(<OliChatSheet lang="English" userId="u-1" isGuest={false} openRef={openRef} closeRef={{ current: null }}
      onNavigate={() => {}} onOpenResult={() => {}} onOpenEvent={() => {}} onOpenChange={() => {}} />)
    await act(async () => { openRef.current() })
    await fireEvent.changeText(input(), 'events')
    await fireEvent.press(sendBtn())
    expect(oliProvider.answer).toHaveBeenCalledTimes(1)
  })

  test('150 saved messages load and the chat still answers', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => (i % 2
      ? { id: `o${i}`, role: 'oli', body: null, payload: CASES[Object.keys(CASES)[i % Object.keys(CASES).length]].payload, created_at: new Date(Date.UTC(2026, 10, 7, 8, 0, i)).toISOString() }
      : { id: `u${i}`, role: 'user', body: `q${i}`, payload: null, created_at: new Date(Date.UTC(2026, 10, 7, 8, 0, i)).toISOString() }))
    await openSheet({ rows })
    expect(await screen.findByText('q0')).toBeTruthy()
    await fireEvent.changeText(input(), 'one more')
    await fireEvent.press(sendBtn())
    expect(roles()).toEqual(['user', 'oli'])
  })
})
