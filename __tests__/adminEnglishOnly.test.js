// The admin area is English-only whatever the app language (constants/adminLang.js). AdminScreen is rendered with the
// app language set to Turkish; every rendered text node, accessibilityLabel and placeholder is scanned for a fragment of
// a Turkish i18n value (derived from the tr block of constants/i18n.js, never a hand list). The positive controls
// (the English values of keys the surfaces really use) stop the scan passing on an empty render.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, Feather: () => null }))
let mockKbTop = null
jest.mock('../utils/useKeyboardTop', () => ({ __esModule: true, default: () => mockKbTop }))

const mockTables = {}
const mockRpc = {}
const mockInvoke = { current: null }
jest.mock('../lib/supabase', () => {
  const chain = table => {
    const c = new Proxy({}, { get: (_, k) => (k === 'then' ? res => res({ data: mockTables[table] ?? [], error: null, count: 0 }) : () => c) })
    return c
  }
  return {
    supabase: {
      from: jest.fn(chain),
      rpc: jest.fn(async name => (name in mockRpc ? mockRpc[name] : { data: null, error: { code: 'PGRST202', message: 'missing' } })),
      functions: { invoke: jest.fn(async () => mockInvoke.current) },
      auth: { signOut: jest.fn() },
    },
  }
})
jest.mock('../screens/GaragesScreen', () => ({ __esModule: true, default: () => null }))
jest.mock('../utils/signOut', () => ({ signOutThisDevice: jest.fn() }))
jest.mock('../utils/loadEateryPartners', () => ({ loadEateryPartners: jest.fn(async () => ({ rows: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Test Diner', slug: 'test-diner' }], error: null })) }))

import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native'
import { t, hasOwnTranslation } from '../constants/i18n'
const AdminScreen = require('../screens/AdminScreen').default
jest.setTimeout(30000)

const APP_LANG = 'Turkish'
const E = k => t(k, 'English')

// Turkish fragments: for every key whose Turkish value differs from English, the longest literal chunk between {placeholders}.
const src = fs.readFileSync(path.join(__dirname, '..', 'constants', 'i18n.js'), 'utf8')
const trStart = src.indexOf('\n  tr: {')
const trEnd = src.slice(trStart + 8).search(/\n  [a-z]{2}: \{/) + trStart + 8
const TR_KEYS = [...src.slice(trStart, trEnd).matchAll(/^\s{4}(\w+):/gm)].map(m => m[1])
const FRAGMENTS = TR_KEYS.filter(k => hasOwnTranslation(k, APP_LANG) && typeof t(k, APP_LANG) === 'string' && t(k, APP_LANG) !== E(k)).map(k => {
  const frag = t(k, APP_LANG).split(/\{\w+\}/).map(x => x.trim()).sort((a, b) => b.length - a.length)[0] || ''
  return { key: k, frag }
}).filter(f => f.frag.length >= 5)

// Every string a user (or a screen reader) can read: text children, accessibilityLabel / Hint, placeholder.
const readable = () => {
  const out = []
  const walk = n => {
    if (n == null) return
    if (typeof n === 'string') { out.push(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    for (const p of ['accessibilityLabel', 'accessibilityHint', 'placeholder']) if (typeof n.props?.[p] === 'string') out.push(n.props[p])
    walk(n.children)
  }
  walk(screen.toJSON())
  return out
}
const turkishHits = () => {
  const hits = []
  for (const str of readable()) for (const { key, frag } of FRAGMENTS) if (str.includes(frag)) hits.push(`${JSON.stringify(str)} contains ${JSON.stringify(frag)} (${key})`)
  return hits
}
const noTurkish = () => expect(turkishHits()).toEqual([])
const seen = () => readable().join('\n')

const iso = ms => new Date(Date.now() - ms).toISOString()
const job = (key, extra = {}) => ({
  key, runner: 'github', kind: 'sync', switchable: true, paused: false, paused_note: null, paused_at: null,
  expected_every_seconds: 86400, schedule: 'daily', cron_active: null,
  last_run: { started_at: iso(3600e3), finished_at: iso(3590e3), outcome: 'ok', error_class: null, source: 'x' },
  last_ok_at: iso(3600e3), record_source: 'x', state: 'ok', attention: false, ...extra,
})
const JOBS = [
  job('job_ok'),
  job('job_paused', { state: 'paused', paused: true, paused_note: 'vendor outage', paused_at: iso(7200e3) }),
  job('job_failed', { state: 'failed', attention: true, last_run: { started_at: iso(3600e3), finished_at: iso(3590e3), outcome: 'failed', error_class: 'timeout', source: 'x' } }),
  job('job_norecord', { state: 'no_record', switchable: false, last_run: null, last_ok_at: null }),
]
const COUNTS = { total: 20, new_today: 1, new_week: 2, new_month: 3, daily: [{ day: '2026-11-16', n: 1 }, { day: '2026-11-17', n: 2 }], accounts: 10, guests: 10, platform_ios: 4, platform_android: 5, platform_unknown: 1 }

const mount = async () => {
  await render(<AdminScreen session={{ user: { id: 'admin-1' } }} lang={APP_LANG} />)
  await screen.findByText(E('adminJobsAttention'))
}
const openTab = async label => {
  await fireEvent.press(screen.getByText('All admin tools'))
  await fireEvent.press(screen.getByText(label))
}

// A test body that fails first (its English lookup misses once the screen renders Turkish) still reports what Turkish is on screen.
const check = (name, fn) => test(name, async () => {
  try { await fn() } catch (e) {
    let hits = []
    try { hits = turkishHits() } catch { /* nothing mounted */ }
    if (hits.length) throw new Error(`${String(e.message).split('\n')[0]}\n\nTURKISH ON SCREEN (${hits.length}):\n${[...new Set(hits)].join('\n')}`)
    throw e
  }
})

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k]
  for (const k of Object.keys(mockRpc)) delete mockRpc[k]
  mockRpc.admin_user_counts = { data: COUNTS, error: null }
  mockRpc.admin_data_jobs = { data: JOBS, error: null }
  mockInvoke.current = { data: { ok: true, outcome: 'sent', recipients: 3, pushed: 2, test: true }, error: null }
})

test('derivation sanity: the Turkish fragments cover the admin keys', () => {
  expect(FRAGMENTS.filter(f => /^admin(Jobs|Pins|Push)/.test(f.key)).length).toBeGreaterThan(60)
})

check('admin home (user counts + Data jobs row) has no Turkish with the app in Turkish', async () => {
  await mount()
  expect(seen()).toContain(E('adminJobsAttention'))
  noTurkish()
})

check('Data jobs tab: rows, paused row, error line, pause sheet and resume dialog', async () => {
  await mount()
  await openTab(E('adminJobsTab'))
  await screen.findByText(E('adminJobsIntro'))
  expect(seen()).toContain(E('adminJobsSwitchRow'))
  expect(seen()).toMatch(/Paused since/)
  noTurkish()
  await fireEvent(screen.getByLabelText(E('adminJobsSwitchLabel').replace('{job}', 'job_ok')), 'valueChange', false)
  await screen.findByText(E('adminJobsPauseTitle').replace('{job}', 'job_ok'))
  expect(seen()).toContain(E('adminJobsPauseReason'))
  noTurkish()
  await fireEvent.press(screen.getByText(E('cancel')))
  await fireEvent(screen.getByLabelText(E('adminJobsSwitchLabel').replace('{job}', 'job_paused')), 'valueChange', true)
  await screen.findByText(E('adminJobsResumeTitle').replace('{job}', 'job_paused'))
  noTurkish()
})

check('Data jobs tab: a failed switch write shows an English error', async () => {
  await mount()
  await openTab(E('adminJobsTab'))
  await screen.findByText(E('adminJobsIntro'))
  await fireEvent(screen.getByLabelText(E('adminJobsSwitchLabel').replace('{job}', 'job_paused')), 'valueChange', true)
  await screen.findByText(E('adminJobsResumeTitle').replace('{job}', 'job_paused'))
  mockRpc.admin_set_data_job_paused = { data: null, error: { code: 'PGRST202', message: 'x' } }
  await fireEvent.press(screen.getByText(E('adminJobsResumeConfirm')))
  await screen.findByText(E('adminJobsErrUnavailable'))
  noTurkish()
})

check('Data jobs tab: load error state', async () => {
  mockRpc.admin_data_jobs = { data: null, error: { message: 'boom' } }
  await render(<AdminScreen session={{ user: { id: 'admin-1' } }} lang={APP_LANG} />)
  await screen.findByText(E('adminJobsUnread'))
  await fireEvent.press(screen.getByText('All admin tools'))
  await fireEvent.press(screen.getByText(E('adminJobsTab')))
  await screen.findByText(E('adminJobsLoadError'))
  expect(seen()).toContain(E('adminJobsRetry'))
  noTurkish()
})

check('Restaurant PIN tab: intro, choices, confirm dialog, feedback', async () => {
  await mount()
  await openTab(E('adminPinsTab'))
  await screen.findByText(E('adminPinsIntro'))
  expect(seen()).toContain(E('adminPinsChoose'))
  noTurkish()
  await fireEvent.press(screen.getByText('Test Diner'))
  mockRpc.admin_reset_eatery_pin_attempts = { data: null, error: null }
  await fireEvent.press(screen.getByLabelText(E('adminPinsIssue')))
  await screen.findByText(E('adminPinsIssueConfirmTitle'))
  expect(seen()).toContain(E('cancel'))
  noTurkish()
  await fireEvent.press(screen.getByText(E('cancel')))
  await fireEvent.press(screen.getByLabelText(E('adminPinsReset')))
  await screen.findByText(E('adminPinsResetConfirmTitle'))
  noTurkish()
  await fireEvent.press(screen.getByText(E('adminPinsResetConfirmBtn')))
  await screen.findByText(E('adminPinsResetDone').replace('{name}', 'Test Diner'))
  noTurkish()
})

check('Restaurant PIN tab: issued PIN modal and an error line', async () => {
  await mount()
  await openTab(E('adminPinsTab'))
  await screen.findByText(E('adminPinsIntro'))
  await fireEvent.press(screen.getByText('Test Diner'))
  mockRpc.admin_set_eatery_partner_pin = { data: { pin: '123456' }, error: null }
  await fireEvent.press(screen.getByLabelText(E('adminPinsIssue')))
  await fireEvent.press(await screen.findByText(E('adminPinsIssueConfirmBtn')))
  await screen.findByText(E('adminPinsShownOnce'), {}, { timeout: 3000 })
  expect(seen()).toContain(E('adminPinsClose'))
  noTurkish()
  await fireEvent.press(screen.getByText(E('adminPinsClose')))
  mockRpc.admin_set_eatery_partner_pin = { data: null, error: { message: 'whatever' } }
  await fireEvent.press(screen.getByLabelText(E('adminPinsIssue')))
  await fireEvent.press(await screen.findByText(E('adminPinsIssueConfirmBtn')))
  await screen.findByText(E('adminPinsErrGeneric'), {}, { timeout: 3000 })
  noTurkish()
})

check('Broadcast tab: test switch and the push result line (sent, partial, duplicate, error)', async () => {
  await mount()
  await openTab('Broadcast')
  await screen.findByText(E('adminPushTestSwitch'))
  noTurkish()
  const send = async () => {
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Duty pharmacy update'), 'Hello')
    await fireEvent.changeText(screen.getByPlaceholderText('Enter your message…'), 'World')
    await fireEvent.press(screen.getByText('Send broadcast'))
  }
  await send()
  await screen.findByText(new RegExp(`^${E('adminPushResult').replace('{recipients}', '3').replace('{pushed}', '2').replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`))
  expect(seen()).toContain(E('adminPushTestUsed'))
  noTurkish()
  mockInvoke.current = { data: { ok: true, outcome: 'partial', recipients: 3, pushed: 1 }, error: null }
  await fireEvent.changeText(screen.getByPlaceholderText('Enter your message…'), 'World 2')
  await fireEvent.press(screen.getByText('Send broadcast'))
  await waitFor(() => expect(seen()).toContain(E('adminPushPartial')))
  noTurkish()
  mockInvoke.current = { data: { ok: true, outcome: 'duplicate' }, error: null }
  await fireEvent.changeText(screen.getByPlaceholderText('Enter your message…'), 'World 3')
  await fireEvent.press(screen.getByText('Send broadcast'))
  await waitFor(() => expect(seen()).toContain(E('adminPushDuplicate')))
  noTurkish()
  mockInvoke.current = { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ error: 'forbidden' }) } } }
  await fireEvent.changeText(screen.getByPlaceholderText('Enter your message…'), 'World 4')
  await fireEvent.press(screen.getByText('Send broadcast'))
  await waitFor(() => expect(seen()).toContain(E('adminPushError').replace('{error}', 'forbidden')))
  noTurkish()
})

check('Duty tab: swap sheet test switch and the swap result line', async () => {
  mockTables.duty_list = [{ id: 'd1', name: 'Alpha Pharmacy', address: 'Main St', phone: null, region: 'Famagusta', open_from: '09:00', open_until: '18:00' }]
  mockTables.facilities = [{ id: 'f1', name: 'Beta Pharmacy' }]
  await mount()
  await openTab('Duty')
  await fireEvent.press(await screen.findByText('Swap'))
  await screen.findByText('Replace pharmacy')
  expect(seen()).toContain(E('adminPushTestSwitch'))
  noTurkish()
  const beta = screen.getAllByText('Beta Pharmacy')
  await fireEvent.press(beta[beta.length - 1])
  await fireEvent.press(screen.getByText('Confirm'))
  await waitFor(() => expect(seen()).toContain(E('adminPushTestUsed')))
  noTurkish()
})

test('the probe sees Turkish: a Turkish string rendered with the app language is caught', async () => {
  const { Text } = require('react-native')
  const key = FRAGMENTS.find(f => f.key === 'adminJobsIntro')?.key ?? FRAGMENTS[0].key
  await render(<Text>{t(key, APP_LANG)}</Text>)
  expect(turkishHits().length).toBeGreaterThan(0)
})
