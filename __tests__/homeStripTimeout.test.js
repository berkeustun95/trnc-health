// Home's strip slot: a ladder that never settles must not leave the grey Bone up all session.
// Renders the real HomeScreen; only the network edges (resolver, dismissals, supabase) are mocked.
import { render, screen, act } from '@testing-library/react-native'
import { t } from '../constants/i18n'

const mockSlides = jest.fn()
const mockDismissals = jest.fn()
jest.mock('../utils/homeStripResolver', () => ({
  ...jest.requireActual('../utils/homeStripResolver'),
  resolveStripSlides: (...a) => mockSlides(...a),
  resolveStripItem: (...a) => mockSlides(...a),
  rememberStripKind: jest.fn(),
}))
jest.mock('../utils/stripDismissals', () => ({
  readStripDismissals: (...a) => mockDismissals(...a),
  addStripDismissal: jest.fn(),
}))
jest.mock('../components/Skeleton', () => {
  const { Text } = require('react-native')
  return { Skeleton: ({ height }) => <Text>{`BONE${height}`}</Text> }   // the strip's Bone is the 160 pt one
})
jest.mock('../lib/supabase', () => {
  const q = {}
  const done = { data: [], error: null }
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'lte', 'gte', 'gt', 'lt', 'or', 'order', 'limit', 'range', 'not', 'ilike', 'contains']) q[m] = () => q
  q.maybeSingle = () => Promise.resolve({ data: null, error: null })
  q.single = q.maybeSingle
  q.then = (res, rej) => Promise.resolve(done).then(res, rej)
  return { supabase: { from: () => q, rpc: () => Promise.resolve(done), auth: { getSession: () => Promise.resolve({ data: {} }) },
    channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel: () => {} } }
})
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => new Proxy({}, { get: () => () => null }))
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }))
jest.mock('expo-blur', () => ({ BlurView: ({ children }) => children ?? null }))

const HomeScreen = require('../screens/HomeScreen').default
const baseProps = {
  lang: 'English', facilities: [], dutyFacilityId: null, userLocation: null, facilityRatings: {}, favorites: [],
  notifications: [], weatherData: null, onSelectFacility: () => {}, onOpenMenu: () => {}, onShowNotifs: () => {},
}
const real = id => ({ kind: 'event', id, title: `Real ${id}`, subtitle: null, sponsored: false, action: { type: 'events' } })
const GENERIC = t('stripEventsTitle', 'English')
const never = () => new Promise(() => {})
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const tick = ms => act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve() })
const bone = () => screen.queryAllByText('BONE160').length
const has = txt => screen.queryAllByText(new RegExp(txt)).length > 0
// The module grid has its own "Events" tile (always exactly one, checked in (d)); the generic strip card is the second.
const EVENTS_TILE = 1
const genericCard = () => screen.queryAllByText(GENERIC).length > EVENTS_TILE

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.useFakeTimers()
  mockSlides.mockReset()
  mockDismissals.mockReset().mockResolvedValue(new Set())
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

test('(a) a never-settling ladder: Bone until 10 s, then the generic card', async () => {
  mockSlides.mockImplementation(never)
  await render(<HomeScreen {...baseProps} />)
  await flush()
  await tick(9900)
  expect(bone()).toBeGreaterThan(0)
  await tick(200)
  expect(bone()).toBe(0)
  expect(genericCard()).toBe(true)
})

test('(a2) a never-settling dismissals read is covered too', async () => {
  mockDismissals.mockImplementation(never)
  await render(<HomeScreen {...baseProps} />)
  await flush()
  await tick(10100)
  expect(bone()).toBe(0)
  expect(genericCard()).toBe(true)
})

test('(b) a rejecting ladder ends on the generic card', async () => {
  mockSlides.mockRejectedValue(new Error('network'))
  await render(<HomeScreen {...baseProps} />)
  await flush()
  expect(bone()).toBe(0)
  expect(genericCard()).toBe(true)
})

test('(c) after a timeout a retryCount bump re-runs the ladder, no Bone, real content swaps in', async () => {
  mockSlides.mockImplementation(never)
  const view = await render(<HomeScreen {...baseProps} retryCount={0} />)
  await flush()
  await tick(10100)
  expect(genericCard()).toBe(true)
  let finish
  mockSlides.mockImplementation(() => new Promise(r => { finish = r }))
  await view.rerender(<HomeScreen {...baseProps} retryCount={1} />)
  await flush()
  expect(mockSlides).toHaveBeenCalledTimes(2)
  expect(bone()).toBe(0)
  expect(genericCard()).toBe(true)
  await act(async () => { finish([real('r1')]); await Promise.resolve() })
  expect(bone()).toBe(0)
  expect(has('Real r1')).toBe(true)
  expect(genericCard()).toBe(false)
})

test('(d) a healthy strip does not re-run on a retryCount bump', async () => {
  mockSlides.mockResolvedValue([real('h1')])
  const view = await render(<HomeScreen {...baseProps} retryCount={0} />)
  await flush()
  expect(has('Real h1')).toBe(true)
  expect(screen.queryAllByText(GENERIC)).toHaveLength(EVENTS_TILE)
  await view.rerender(<HomeScreen {...baseProps} retryCount={1} />)
  await flush()
  expect(mockSlides).toHaveBeenCalledTimes(1)
  expect(has('Real h1')).toBe(true)
})

test('(e) a late result of an older run does not overwrite a newer one', async () => {
  let finishOld
  mockSlides.mockImplementationOnce(() => new Promise(r => { finishOld = r }))
  const view = await render(<HomeScreen {...baseProps} retryCount={0} />)
  await flush()
  await tick(10100)
  mockSlides.mockResolvedValue([real('new')])
  await view.rerender(<HomeScreen {...baseProps} retryCount={1} />)
  await flush()
  expect(has('Real new')).toBe(true)
  await act(async () => { finishOld([real('old')]); await Promise.resolve() })
  expect(has('Real new')).toBe(true)
  expect(has('Real old')).toBe(false)
})

test('(f) a late result after the timeout IS applied (real content beats the fallback)', async () => {
  let finish
  mockSlides.mockImplementation(() => new Promise(r => { finish = r }))
  await render(<HomeScreen {...baseProps} />)
  await flush()
  await tick(10100)
  expect(genericCard()).toBe(true)
  await act(async () => { finish([real('late')]); await Promise.resolve() })
  expect(has('Real late')).toBe(true)
})
